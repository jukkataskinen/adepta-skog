import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import type { Database } from "@/lib/db/types";
import { loadPlanData } from "@/lib/tax/load";
import { loadReportData } from "@/lib/reports/data";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Metsätilan luovutukset (0008): kantasäännöt, osamyynti tie- ja ojamenoineen ja 0007:n tietojen siirto. */

let db: Database;
let a: OrgFixture;

const insertDisposal = (org: OrgFixture, values: { on: string; price: number; share: number; client?: string; costs?: number }) =>
  `insert into sk_forest_property_disposals (organization_id, client_id, forest_property_id, disposed_on, sale_price, share_pct, selling_costs)
   values ('${org.id}', '${values.client ?? org.client}', '${org.property}', '${values.on}', ${values.price}, ${values.share}, ${values.costs ?? 0})`;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService(async (tx) => {
    await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2026)", [a.id, a.client]);
    // Metsätie Kotimetsällä: 10 000 €, poisto 2025 1 500 €, arvo 8 500 € vuoden 2026 alussa.
    const [road] = await tx.query<{ id: string }>(
      `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, forest_property_id)
       values ($1, $2, 'Metsätie', '2024-06-01', 10000, 'declining_balance', 15, $3) returning id`,
      [a.id, a.client, a.property],
    );
    await tx.query("insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1, $2, 2025, 1500, 8500)", [a.id, road.id]);
  });
});
afterAll(async () => {
  await db.close();
});

describe("luovutusten kantasäännöt", () => {
  it("kirjanpitäjä lisää luovutuksen vastuuasiakkaalleen", async () => {
    const rows = await db.asUser(a.staff.sub, (tx) => tx.query(`${insertDisposal(a, { on: "2026-06-01", price: 40000, share: 25, costs: 2000 })} returning id`));
    expect(rows).toHaveLength(1);
  });

  it("tilasta ei voi myydä yli 100 %", async () => {
    await expect(db.asUser(a.owner.sub, (tx) => tx.query(insertDisposal(a, { on: "2026-07-01", price: 1, share: 80 })))).rejects.toThrow(/yli 100 prosenttia/);
  });

  it("luovutus ei voi olla ennen tilan hankintaa", async () => {
    await expect(db.asUser(a.owner.sub, (tx) => tx.query(insertDisposal(a, { on: "2017-01-01", price: 1, share: 10 })))).rejects.toThrow(/ennen tilan hankintaa/);
  });

  it("luovutus ei voi viitata saman toimiston toisen asiakkaan tilaan", async () => {
    await expect(db.asUser(a.owner.sub, (tx) => tx.query(insertDisposal(a, { on: "2026-07-01", price: 1, share: 10, client: a.otherClient })))).rejects.toThrow(
      /toisen asiakkaan/,
    );
  });

  it("suljetun vuoden luovutusta ei voi lisätä, muuttaa eikä poistaa", async () => {
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]));
    await expect(db.asUser(a.owner.sub, (tx) => tx.query(insertDisposal(a, { on: "2025-07-01", price: 1, share: 10 })))).rejects.toThrow(/Verovuosi 2025 on suljettu/);
    await expect(
      db.asUser(a.owner.sub, (tx) => tx.query("update sk_forest_property_disposals set disposed_on = '2025-07-01' where forest_property_id = $1", [a.property])),
    ).rejects.toThrow(/Verovuosi 2025 on suljettu/);
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'open', closed_at = null where client_id = $1 and year = 2025", [a.client]));
  });
});

describe("osamyynti verosuunnitelmassa", () => {
  it("myyty osuus, tien poistamaton arvo ja myyntikulut luovutusvoittoon", async () => {
    const plan = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2026));
    // Hankintameno 25 % × 120 000 = 30 000, tie 25 % × 8 500 = 2 125, myyntikulut 2 000.
    // Lisäys: käytetty 3 000, enintään 60 % × 25 % × 96 000 = 14 400. Voitto 40 000 − 34 125 + 3 000.
    expect(plan.forestSales).toHaveLength(1);
    expect(plan.forestSales[0]).toMatchObject({
      name: "Kotimetsä", sharePct: 25, acquisitionCost: 30000, roadDitchCost: 2125, sellingCosts: 2000, cost: 34125, usesDeemedCost: false, addition: 3000, gain: 8875,
    });
    // Tien poisto lasketaan jäljelle jäävästä arvosta 6 375.
    const road = plan.assets.find((x) => x.description === "Metsätie")!;
    expect(road.year).toMatchObject({ bookValueStart: 8500, transferred: 2125, bookValueBase: 6375, max: 956.25 });
    // Pohja: 75 % × 80 % × 75 % × 120 000 = 54 000, käytetty 3 000 on jo lisätty luovutusvoittoon.
    expect(plan.deductionPool).toBe(54000);
    const r = await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2026));
    expect(r?.result.saleResult).toBe(8875);
  });

  it("koko tilan myynnin jälkeen tila ja tie eivät ole enää laskelmassa", async () => {
    await db.asService(async (tx) => {
      await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2027)", [a.id, a.client]);
      await tx.query(insertDisposal(a, { on: "2027-03-01", price: 150000, share: 75 }));
      await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2028)", [a.id, a.client]);
    });
    const y2027 = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2027));
    expect(y2027.forestSales.map((f) => f.sharePct)).toEqual([75]);
    expect(y2027.forestSales[0].roadDitchCost).toBeGreaterThan(0);
    expect(y2027.assets.some((x) => x.description === "Metsätie")).toBe(false);
    expect(y2027.properties).toEqual([]);
    const y2028 = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2028));
    expect(y2028.assets.some((x) => x.description === "Metsätie")).toBe(false);
    expect(y2028.deductionPool).toBeNull();
  });
});

describe("0007:n luovutustiedot siirtyvät", () => {
  it("myyty tila tulee luovutukseksi, jonka osuus on 100 %", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, undefined, "0007_property_disposal.sql");
      const b = await seedOrg(old, "Toimisto B");
      await old.asService(async (tx) => {
        await tx.query("update sk_forest_properties set disposed_on = '2025-06-01', sale_price = 150000, no_deduction_addition = true where id = $1", [b.property]);
        // Suljettu vuosi ei estä siirtoa.
        await tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [b.client]);
      });
      await migrateLocal(old);
      const rows = await old.asService((tx) =>
        tx.query<{ forest_property_id: string; disposed_on: string; sale_price: string; share_pct: string; no_deduction_addition: boolean; tax_year: number }>(
          "select forest_property_id, disposed_on::text, sale_price, share_pct, no_deduction_addition, tax_year from sk_forest_property_disposals",
        ),
      );
      expect(rows).toEqual([
        { forest_property_id: b.property, disposed_on: "2025-06-01", sale_price: "150000.00", share_pct: "100.00", no_deduction_addition: true, tax_year: 2025 },
      ]);
      const cols = await old.asService((tx) =>
        tx.query("select column_name from information_schema.columns where table_name = 'sk_forest_properties' and column_name in ('disposed_on', 'sale_price')"),
      );
      expect(cols).toEqual([]);
    } finally {
      await old.close();
    }
  });
});
