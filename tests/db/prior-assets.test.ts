import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Sql } from "@/lib/db/types";
import { deletePriorAsset, listClientAssets, PriorAssetError, savePriorAsset, type PriorAssetInput } from "@/lib/assets/prior";
import { loadPlanData } from "@/lib/tax/load";
import { loadReportData } from "@/lib/reports/data";
import { loadFilingSource } from "@/lib/filing/load";
import { compute2c } from "@/lib/filing/vsy02c";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Aiemmin hankittu investointi kannan kanssa (migraatio 0014, DECISIONS 28.9.2026). */

let db: Database;
let a: OrgFixture;

// Metsäautotie: hankintahinta 5 000 €, kertynyt poisto 1 734,40 €, menojäännös 31.12.2024 3 265,60 €.
const road: PriorAssetInput = {
  description: "Metsäautotie", ratePct: 15, balanceYear: 2024, acquiredOn: null, acquisitionCost: 5000, accumulatedDepreciation: 1734.4, forestPropertyId: null,
};

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  // Seedin traktori pois, jotta poistotaulukossa on vain tämän testin investoinnit.
  await db.asService((tx) => tx.query("delete from sk_assets where id = $1", [a.asset]));
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const asStaff = <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(a.staff.sub, fn);
const closeYear = (status: "open" | "closed") =>
  db.asService((tx) =>
    tx.query(`update sk_tax_years set status = $2, closed_at = ${status === "closed" ? "now()" : "null"} where client_id = $1 and year = 2025`, [a.client, status]),
  );

describe("migraatio 0014", () => {
  it("ei kaadu suljettuun vuoteen, ja vanhat investoinnit toimivat ennallaan", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, undefined, "0013_business_share.sql");
      const o = await seedOrg(old, "Vanha toimisto");
      await old.asService(async (tx) => {
        // Vanhasta sovelluksesta tuotu rivi: poistamaton arvo ilman avausvuotta.
        await tx.query("update sk_assets set opening_book_value = 25000 where id = $1", [o.asset]);
        await tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [o.client]);
      });
      expect(await migrateLocal(old, undefined, "0014_prior_assets.sql")).toEqual(["0014_prior_assets.sql"]);
      const [r] = await old.asService((tx) =>
        tx.query<{ opening_year: number | null; opening_accumulated_depreciation: string | null }>(
          "select opening_year, opening_accumulated_depreciation from sk_assets where id = $1",
          [o.asset],
        ),
      );
      expect(r).toEqual({ opening_year: null, opening_accumulated_depreciation: null });
      // Tavallisen investoinnin muutos ei osu aiemman investoinnin lukitukseen.
      await old.asService((tx) => tx.query("update sk_assets set description = 'Traktori' where id = $1", [o.asset]));
      const plan = await old.asUser(o.staff.sub, (tx) => loadPlanData(tx, o.client, 2025));
      expect(plan.assets[0]).toMatchObject({ opening: { year: null, accumulated: 5000, bookValue: 25000 } });
    } finally {
      await old.close();
    }
  });
});

describe("aiempi investointi", () => {
  let roadId: string;
  let trailerId: string;

  it("lisäys tallentaa hankintahinnan, kertyneen poiston ja menojäännöksen sekä lokin", async () => {
    roadId = (await asStaff((tx) => savePriorAsset(tx, actor(), a.client, { ...road, forestPropertyId: a.property }))).id;
    trailerId = (
      await asStaff((tx) =>
        savePriorAsset(tx, actor(), a.client, {
          ...road, description: "Metsäperävaunu", ratePct: 25, acquisitionCost: 8000, accumulatedDepreciation: 3000, acquiredOn: "2019-05-01",
        }),
      )
    ).id;
    const rows = await asStaff((tx) => listClientAssets(tx, a.client));
    const r = rows.find((x) => x.id === roadId)!;
    expect(r).toMatchObject({ acquired_on: "2024-12-31", opening_year: 2025, property_name: "Kotimetsä", locked: false });
    expect([Number(r.acquisition_cost), Number(r.opening_accumulated_depreciation), Number(r.opening_book_value)]).toEqual([5000, 1734.4, 3265.6]);
    const log = await db.asService((tx) => tx.query<{ action: string }>("select action from sk_audit_log where entity_id = $1", [roadId]));
    expect(log.map((l) => l.action)).toEqual(["asset.prior.create"]);
  });

  it("verosuunnitelma: tie 15 % → 489,84 €, perävaunu 25 % → 1 250 €, ei vuodelle 2024", async () => {
    const plan = await asStaff((tx) => loadPlanData(tx, a.client, 2025));
    const r = plan.assets.find((x) => x.id === roadId)!;
    expect(r.year).toMatchObject({ bookValueStart: 3265.6, max: 489.84 });
    expect(r.opening).toEqual({ year: 2025, accumulated: 1734.4, bookValue: 3265.6 });
    expect(plan.assets.find((x) => x.id === trailerId)?.year).toMatchObject({ bookValueStart: 5000, max: 1250 });
    const before = await asStaff((tx) => loadPlanData(tx, a.client, 2024));
    expect(before.assets).toEqual([]);
  });

  it("raportti ja 2C: vahvistettu poisto ja menojäännös 1.1. poistotaulukkoon", async () => {
    await db.asService((tx) =>
      tx.query(
        "insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1, $2, 2025, 489.84, 2775.76), ($1, $3, 2025, 1250, 3750)",
        [a.id, roadId, trailerId],
      ),
    );
    const report = await asStaff((tx) => loadReportData(tx, a.id, a.client, 2025));
    expect(report?.depreciation.find((d) => d.description === "Metsäautotie")).toMatchObject({
      bookValueStart: 3265.6, amount: 489.84, bookValueEnd: 2775.76, acquisitionCost: 5000, opening: { year: 2025, accumulated: 1734.4, bookValue: 3265.6 },
    });
    const source = await asStaff((tx) => loadFilingSource(tx, a.id, a.client, 2025));
    const c = compute2c(source!.data);
    const f = (code: string) => c.fields.find((x) => x.code === code)?.value;
    // Tiet ja ojat: 680 alussa, 681 lisäys, 644 poisto, 628 loppu. Koneet: 660, 661, 642, 626.
    expect([f("680"), f("681"), f("644"), f("628")]).toEqual([3265.6, undefined, 489.84, 2775.76]);
    expect([f("660"), f("661"), f("642"), f("626")]).toEqual([5000, undefined, 1250, 3750]);
  });

  it("kanta estää ristiriitaiset luvut, tasapoiston ja liian suuren kertyneen poiston", async () => {
    await expect(asStaff((tx) => savePriorAsset(tx, actor(), a.client, { ...road, accumulatedDepreciation: 6000 }))).rejects.toThrow(PriorAssetError);
    const insert = (method: string, bookValue: number) =>
      db.asService((tx) =>
        tx.query(
          `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, useful_life_years,
                                  opening_book_value, opening_year, opening_accumulated_depreciation)
           values ($1, $2, 'Väärä', '2024-12-31', 5000, $3, 15, 10, $4, 2025, 500)`,
          [a.id, a.client, method, bookValue],
        ),
      );
    await expect(insert("declining_balance", 4000)).rejects.toThrow(/sk_assets_prior/);
    await expect(insert("straight_line", 4500)).rejects.toThrow(/sk_assets_prior/);
  });

  it("muutos poistaa vahvistetut poistot, kun arvo muuttuu", async () => {
    const saved = await asStaff((tx) => savePriorAsset(tx, actor(), a.client, { ...road, accumulatedDepreciation: 1500 }, roadId));
    expect(saved.removedDepreciations).toBe(1);
    const plan = await asStaff((tx) => loadPlanData(tx, a.client, 2025));
    expect(plan.assets.find((x) => x.id === roadId)).toMatchObject({ recorded: null, year: { bookValueStart: 3500, max: 525 } });
    // Pelkkä kuvauksen muutos ei poista poistoja.
    const again = await asStaff((tx) => savePriorAsset(tx, actor(), a.client, { ...road, accumulatedDepreciation: 1500, description: "Metsäautotie 2" }, roadId));
    expect(again.removedDepreciations).toBe(0);
  });

  it("suljettu ensimmäinen poistovuosi lukitsee lähtötiedot, mutta myynnin voi kirjata", async () => {
    await closeYear("closed");
    try {
      await expect(asStaff((tx) => savePriorAsset(tx, actor(), a.client, road, roadId))).rejects.toThrow(/Verovuosi 2025 on suljettu/);
      await expect(asStaff((tx) => deletePriorAsset(tx, actor(), a.client, trailerId))).rejects.toThrow(/Verovuosi 2025 on suljettu/);
      await expect(asStaff((tx) => savePriorAsset(tx, actor(), a.client, road))).rejects.toThrow(/Verovuosi 2025 on suljettu/);
      // Kanta estää saman myös suoraan.
      await expect(
        asStaff((tx) => tx.query("update sk_assets set acquisition_cost = 6000, opening_book_value = 4500 where id = $1", [roadId])),
      ).rejects.toThrow(/Verovuosi 2025 on suljettu/);
      await expect(asStaff((tx) => tx.query("delete from sk_assets where id = $1", [trailerId]))).rejects.toThrow(/Verovuosi 2025 on suljettu/);
      await asStaff((tx) => tx.query("update sk_assets set disposed_on = '2026-03-01', sale_price = 4000 where id = $1", [trailerId]));
      const rows = await asStaff((tx) => listClientAssets(tx, a.client));
      expect(rows.find((r) => r.id === roadId)?.locked).toBe(true);
    } finally {
      await closeYear("open");
    }
  });

  it("myytyä ei poisteta; muun poisto kirjataan lokiin", async () => {
    await expect(asStaff((tx) => deletePriorAsset(tx, actor(), a.client, trailerId))).rejects.toThrow(/myyty/);
    await asStaff((tx) => deletePriorAsset(tx, actor(), a.client, roadId));
    const log = await db.asService((tx) => tx.query<{ action: string }>("select action from sk_audit_log where entity_id = $1", [roadId]));
    expect(log.map((l) => l.action)).toContain("asset.prior.delete");
  });

  it("toisen toimiston käyttäjä ei näe eikä poista investointia", async () => {
    const b = await seedOrg(db, "Toimisto B");
    expect(await db.asUser(b.staff.sub, (tx) => listClientAssets(tx, a.client))).toEqual([]);
    await expect(
      db.asUser(b.staff.sub, (tx) => deletePriorAsset(tx, { organizationId: b.id, userId: b.staff.id }, a.client, trailerId)),
    ).rejects.toThrow(/ei löytynyt/);
  });
});
