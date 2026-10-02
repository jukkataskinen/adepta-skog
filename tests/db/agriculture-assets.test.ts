import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { listClientAssets, PriorAssetError, savePriorAsset } from "@/lib/assets/prior";
import { loadAgriDepreciation } from "@/lib/tax/agri-load";
import { loadPlanData } from "@/lib/tax/load";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Maatalouden aiemmat investoinnit ja ryhmäpoistot kannan kanssa (DECISIONS 2.10.2026). */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService((tx) => tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]));
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const prior = {
  description: "Koneet ja kalusto yhteensä", ratePct: 0, agriChoice: "agri_machinery", balanceYear: 2024, acquiredOn: null, acquisitionCost: 120000,
  accumulatedDepreciation: 80000, forestPropertyId: null,
};

describe("maatalouden aiempi investointi", () => {
  it("koneiden menojäännös 31.12.2024 yhtenä rivinä menee koneiden ryhmään vuoden 2025 alkuun", async () => {
    const saved = await db.asUser(a.staff.sub, (tx) => savePriorAsset(tx, actor(), a.client, prior));
    const assets = await db.asUser(a.staff.sub, (tx) => listClientAssets(tx, a.client));
    expect(assets.find((x) => x.id === saved.id)).toMatchObject({ activity: "agriculture", asset_class: "agri_machinery", accelerated: false, opening_book_value: "40000.00" });

    const dep = await db.asUser(a.staff.sub, (tx) => loadAgriDepreciation(tx, a.client, 2025));
    expect(dep.pools).toEqual([expect.objectContaining({ pool: "agri_machinery", start: 40000, max: 10000 })]);
    // Metsätalouden poistoihin maatalouden investointi ei tule.
    const plan = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2025));
    expect(plan.assets.some((x) => x.id === saved.id)).toBe(false);
  });

  it("investointituki, käytetty tasausvaraus ja kirjattu poisto", async () => {
    const [asset] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ id: string }>(
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, activity, asset_class)
         values ($1, $2, 'Navetta', '2025-05-01', 300000, 'declining_balance', 10, 'agriculture', 'agri_production_building') returning id`,
        [a.id, a.client],
      ),
    );
    await db.asUser(a.staff.sub, async (tx) => {
      await tx.query("insert into sk_asset_adjustments (organization_id, client_id, asset_id, tax_year, amount) values ($1, $2, $3, 2025, 100000)", [a.id, a.client, asset.id]);
      const [r] = await tx.query<{ id: string }>(
        "insert into sk_agri_reserves (organization_id, client_id, kind, made_year, amount) values ($1, $2, 'equalization', 2024, 20000) returning id",
        [a.id, a.client],
      );
      await tx.query(
        "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, asset_id, amount) values ($1, $2, $3, 2025, 'asset', $4, 20000)",
        [a.id, a.client, r.id, asset.id],
      );
      await tx.query("insert into sk_agri_depreciations (organization_id, client_id, tax_year, pool, amount) values ($1, $2, 2025, 'agri_production_building', 18000)", [
        a.id, a.client,
      ]);
    });
    const dep = await db.asUser(a.staff.sub, (tx) => loadAgriDepreciation(tx, a.client, 2025));
    expect(dep.pools.find((p) => p.pool === "agri_production_building")).toMatchObject({
      additions: 300000, grants: 100000, equalization: 20000, base: 180000, max: 18000, recorded: 18000, depreciation: 18000, end: 162000,
    });
  });

  it("korotettu poisto ei käy aiemmalle investoinnille, jonka ensimmäinen poistovuosi on 2026", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => savePriorAsset(tx, actor(), a.client, { ...prior, agriChoice: "agri_machinery_accelerated", balanceYear: 2025 })),
    ).rejects.toThrow(PriorAssetError);
  });
});
