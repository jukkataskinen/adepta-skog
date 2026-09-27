import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { loadPlanData } from "@/lib/tax/load";
import { loadReportData } from "@/lib/reports/data";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  // Traktori myydään 2026. Poistamaton arvo vuoden alussa on 22 500 (poisto 2025).
  await db.asService(async (tx) => {
    await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2026)", [a.id, a.client]);
    await tx.query("update sk_assets set disposed_on = '2026-04-01', sale_price = 25000 where id = $1", [a.asset]);
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, asset_id)
       values ($1, $2, '2026-04-01', 'income', 'asset_sale', 'Traktorin myynti', 25000, 25.5, $3),
              ($1, $2, '2026-05-01', 'income', 'asset_sale', 'Vanha myynti ilman investointia', 1000, 25.5, null)`,
      [a.id, a.client, a.asset],
    );
  });
});
afterAll(async () => {
  await db.close();
});

describe("verosuunnitelman lähtötiedot", () => {
  it("investoinnin myyntihinta ei ole tuloa, vaan myyntivoitto lasketaan investoinnista", async () => {
    const plan = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2026));
    // Vain investointiin liittämätön myynti jää tuloksi.
    expect(plan.income).toBe(1000);
    expect(plan.assets[0].year).toMatchObject({ sold: true, bookValueStart: 22500, saleGain: 2500 });
  });

  it("myyntivoitto on luovutusvoittoa metsätalouden tuloksen ulkopuolella, ja se lasketaan kerran", async () => {
    const r = await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2026));
    // Metsätalous: 1 000 € tuloa, yrittäjävähennys 5 %. Luovutusvoitto 2 500 € erikseen.
    expect(r?.result).toMatchObject({ netBeforeDeduction: 1000, entrepreneurDeduction: 50, forestryTaxable: 950, saleResult: 2500, taxable: 3450 });
  });
});
