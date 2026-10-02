import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Sql } from "@/lib/db/types";
import { saveAgriPlanChoices } from "@/lib/agriculture/plan";
import { AgriError, getAgriYear, listReserves } from "@/lib/agriculture/year";
import { loadAgriPlanData, loadForm2 } from "@/lib/tax/agri-form-load";
import type { AgriChoices } from "@/lib/tax/agri-plan";
import { loadReportData } from "@/lib/reports/data";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Verosuunnitelman maatalousvalinnat tallentuvat samoihin tauluihin kuin
 * Lomake 2 -välilehdellä (DECISIONS 2.10.2026), ja raportin arvio kattaa
 * metsän ja maatalouden. Pelkän metsäasiakkaan raportti on ennallaan.
 */

let db: Database;
let a: OrgFixture;
let farm: string;
let old: string;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService(async (tx) => {
    await tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]);
    farm = (await tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name) values ($1,$2,'Kotitila') returning id", [a.id, a.client]))[0].id;
    // Koneiden menojäännös 31.12.2024: 40 000 €, enimmäispoisto 2025 10 000 €.
    await tx.query(
      `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_book_value, opening_year,
                              opening_accumulated_depreciation, activity, asset_class)
       values ($1,$2,'Koneet','2024-12-31',80000,'declining_balance',25,40000,2025,40000,'agriculture','agri_machinery')`,
      [a.id, a.client],
    );
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, activity)
       values ($1,$2,'2025-05-01','income','agri_crops','Vilja',60000,14,'agriculture'),
              ($1,$2,'2025-06-01','expense','agri_feed','Rehu',20000,14,'agriculture')`,
      [a.id, a.client],
    );
    old = (
      await tx.query<{ id: string }>(
        "insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount) values ($1,$2,$3,'equalization',2023,2000) returning id",
        [a.id, a.client, farm],
      )
    )[0].id;
    await tx.query("insert into sk_agri_years (organization_id, client_id, tax_year, prior_net_wealth) values ($1,$2,2025,100000)", [a.id, a.client]);
  });
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const asStaff = <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(a.staff.sub, fn);
const save = (c: AgriChoices) =>
  asStaff(async (tx) => {
    const d = await loadAgriPlanData(tx, a.client, 2025);
    return saveAgriPlanChoices(tx, actor(), a.client, d!, c);
  });

describe("verosuunnitelman maatalousvalinnat", () => {
  it("lähtötiedot: syötetty nettovarallisuus, varaukset ja poistopohja", async () => {
    const d = await asStaff((tx) => loadAgriPlanData(tx, a.client, 2025));
    expect(d?.priorWealth).toEqual({ netWealth: 100000, wages: 0, source: "manual" });
    expect(d?.reserves).toHaveLength(1);
    expect(d?.equalizationThisYear).toMatchObject({ id: null, editable: true });
    expect(d?.depreciationConfirmed).toBe(false);
  });

  it("vahvistus tallentaa poistot, tasausvarauksen, tuloutuksen ja vaatimuksen Lomake 2:n tauluihin", async () => {
    const r = await save({ depreciation: { agri_machinery: 10000 }, equalization: 4000, releases: { [old]: 2000 }, claim: "ten", lossToCapital: false });
    // 60 000 − 20 000 − 10 000 − 4 000 + 2 000 = 28 000.
    expect(r.form2.result).toBe(28000);
    const rows = await asStaff((tx) =>
      Promise.all([
        tx.query<{ pool: string; amount: string }>("select pool, amount from sk_agri_depreciations where client_id = $1 and tax_year = 2025", [a.client]),
        tx.query<{ amount: string; farm_id: string | null; note: string }>("select amount, farm_id, note from sk_agri_reserves where client_id = $1 and made_year = 2025", [a.client]),
        tx.query<{ amount: string; use_kind: string }>("select amount, use_kind from sk_agri_reserve_uses where reserve_id = $1 and tax_year = 2025", [old]),
      ]),
    );
    expect(rows[0].map((x) => [x.pool, Number(x.amount)])).toEqual([["agri_machinery", 10000]]);
    expect(rows[1].map((x) => [Number(x.amount), x.farm_id])).toEqual([[4000, farm]]);
    expect(rows[2].map((x) => [Number(x.amount), x.use_kind])).toEqual([[2000, "income"]]);
    const y = await asStaff((tx) => getAgriYear(tx, a.client, 2025));
    expect(y).toMatchObject({ incomeSplitClaim: "ten", priorNetWealth: 100000 });

    // Lomake 2 -välilehti laskee samat luvut samoista tauluista.
    const form2 = await asStaff((tx) => loadForm2(tx, a.client, 2025));
    expect(form2?.result).toBe(28000);
    expect(form2?.fields).toMatchObject({ "232": 4000, "219": 2000, "418": 1, "511": 10000 });
    const reserves = await asStaff((tx) => listReserves(tx, a.client, 2025));
    expect(reserves.find((x) => x.id === old)?.remaining).toBe(0);
  });

  it("uusi vahvistus muuttaa saman varauksen ja poistaa nollatut", async () => {
    await save({ depreciation: { agri_machinery: 5000 }, equalization: 3000, releases: { [old]: 2000 }, claim: null, lossToCapital: false });
    let eq = await asStaff((tx) => tx.query<{ amount: string }>("select amount from sk_agri_reserves where client_id = $1 and made_year = 2025", [a.client]));
    expect(eq.map((x) => Number(x.amount))).toEqual([3000]);
    await save({ depreciation: { agri_machinery: 5000 }, equalization: 0, releases: { [old]: 0 }, claim: null, lossToCapital: false });
    eq = await asStaff((tx) => tx.query<{ amount: string }>("select amount from sk_agri_reserves where client_id = $1 and made_year = 2025", [a.client]));
    expect(eq).toHaveLength(0);
    const uses = await asStaff((tx) => tx.query("select id from sk_agri_reserve_uses where reserve_id = $1", [old]));
    expect(uses).toHaveLength(0);
    expect((await asStaff((tx) => getAgriYear(tx, a.client, 2025))).incomeSplitClaim).toBeNull();
  });

  it("palvelin tarkistaa rajat eikä tallenna mitään virheellisestä", async () => {
    const base: AgriChoices = { depreciation: { agri_machinery: 5000 }, equalization: 0, releases: {}, claim: null, lossToCapital: false };
    await expect(save({ ...base, equalization: 99000 })).rejects.toThrow(AgriError);
    await expect(save({ ...base, equalization: 1250 })).rejects.toThrow(/satoina/);
    await expect(save({ ...base, depreciation: { agri_machinery: 20000 } })).rejects.toThrow(/enintään/);
    await expect(save({ ...base, releases: { [old]: 2500 } })).rejects.toThrow(/tulouttaa enintään/);
    const dep = await asStaff((tx) => tx.query<{ amount: string }>("select amount from sk_agri_depreciations where client_id = $1 and tax_year = 2025", [a.client]));
    expect(dep.map((x) => Number(x.amount))).toEqual([5000]);
  });

  it("veroraportin arvio kattaa metsän ja maatalouden", async () => {
    await save({ depreciation: { agri_machinery: 10000 }, equalization: 0, releases: {}, claim: null, lossToCapital: false });
    const r = await asStaff((tx) => loadReportData(tx, a.id, a.client, 2025));
    // Maatalous 30 000 − 5 % = 28 500; pääomatuloa 20 % × 100 000 = 20 000, ansiotuloa 8 500.
    expect(r?.agri?.split).toMatchObject({ splitBase: 28500, capital: 20000, earned: 8500 });
    // Metsä 15 000 − 7 500 − 3 000 − 5 % = 4 275; pääomatuloa yhteensä 24 275.
    expect(r?.agri?.tax).toMatchObject({ forestCapital: 4275, agriCapital: 20000, capital: 24275 });
    expect(r?.agri?.tax.total).toBeGreaterThan(r!.result.tax.total);
  });

  it("edellisen vuoden nettovarallisuus lasketaan Skogin edellisestä vuodesta", async () => {
    await db.asService(async (tx) => {
      await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1,$2,2024)", [a.id, a.client]);
      await tx.query(
        "insert into sk_agri_years (organization_id, client_id, tax_year, land_value, liabilities, wages_subject_to_withholding) values ($1,$2,2024,90000,20000,10000)",
        [a.id, a.client],
      );
    });
    const d = await asStaff((tx) => loadAgriPlanData(tx, a.client, 2025));
    expect(d?.priorWealth).toEqual({ netWealth: 70000, wages: 10000, source: "computed" });
  });
});

describe("pelkkä metsäasiakas", () => {
  it("raportissa ei ole maatalousosaa, ja vero on metsän laskelman mukainen", async () => {
    const b = await seedOrg(db, "Toimisto B");
    const r = await db.asUser(b.staff.sub, (tx) => loadReportData(tx, b.id, b.client, 2025));
    expect(r?.agri).toBeNull();
    expect(r?.result).toMatchObject({ forestryTaxable: 4275, taxable: 4275 });
    expect(r?.result.tax.total).toBe(1282.5);
  });
});
