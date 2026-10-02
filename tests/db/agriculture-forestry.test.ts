import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { loadPlanData } from "@/lib/tax/load";
import { loadFilingSource } from "@/lib/filing/load";
import { loadReportData } from "@/lib/reports/data";
import { saveTransaction } from "@/lib/ledger/write";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Maatalouden kirjaukset eivät sekoitu metsätalouden laskelmiin (0015).
 * Metsätalouteen tulee vain maatalouden kirjauksen metsätaloudelle annettu osuus.
 */

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
const base = { kind: null, description: "", withholding: 0, businessSharePct: 100, forestPropertyId: null, assetRatePct: null, saleAssetId: null };

describe("metsätalouden laskelmat maatalousasiakkaalla", () => {
  it("maatalouden tulo ei tule metsätaloudelle, toisen toiminnon osuus tulee", async () => {
    const before = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2025));
    await db.asUser(a.staff.sub, async (tx) => {
      // Maito 1 140 € sis. alv 14 %: maatalouden tuloa.
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-03-31", category: "agri_livestock_products", amountGross: 1140, vatRate: 14 });
      // Sähkö 1 255 € sis. alv: 70 % maatalous, 20 % metsätalous, 10 % yksityinen.
      await saveTransaction(tx, actor(), a.client, null, {
        ...base, bookedOn: "2025-04-30", category: "agri_energy", amountGross: 1255, vatRate: 25.5, businessSharePct: 70, otherSharePct: 20,
      });
    });
    const [row] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ activity: string; other_share_pct: string }>("select activity, other_share_pct from sk_transactions where category = 'agri_energy'"),
    );
    expect(row).toEqual({ activity: "agriculture", other_share_pct: "20.00" });

    const after = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2025));
    expect(after.income).toBe(before.income);
    expect(after.expense).toBe(Math.round((before.expense + 200) * 100) / 100);

    const filing = await db.asUser(a.staff.sub, (tx) => loadFilingSource(tx, a.id, a.client, 2025));
    expect(filing!.data.categories.agri_livestock_products).toBeUndefined();
    expect(filing!.data.categories.other_expense?.net).toBe(200);

    const report = await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2025));
    expect(report!.categories.some((c) => c.label === "Maito ja muut kotieläintuotteet")).toBe(false);
  });

  it("maatalouden investointi ei ole metsätalouden poistoissa", async () => {
    await db.asService((tx) =>
      tx.query(
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, activity, asset_class)
         values ($1, $2, 'Navetta', '2025-02-01', 100000, 'declining_balance', 10, 'agriculture', 'agri_production_building')`,
        [a.id, a.client],
      ),
    );
    const plan = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2025));
    expect(plan.assets.some((x) => x.description === "Navetta")).toBe(false);
    expect(plan.assets.some((x) => x.description === "Metsätraktori")).toBe(true);
  });

  it("toisen toiminnon osuutta ei tallenneta tulolle", async () => {
    const id = await db.asUser(a.staff.sub, (tx) =>
      saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-05-05", category: "agri_crops", amountGross: 114, vatRate: 14, businessSharePct: 50, otherSharePct: 50 }),
    );
    const [row] = await db.asUser(a.staff.sub, (tx) => tx.query<{ other_share_pct: string }>("select other_share_pct from sk_transactions where id = $1", [id]));
    expect(row.other_share_pct).toBe("0.00");
  });
});
