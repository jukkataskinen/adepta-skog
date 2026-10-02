import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PDFPage } from "pdf-lib";
import type { Database, Sql } from "@/lib/db/types";
import { freshDb, createUser } from "../../helpers/db";
import { loadPlanData, planTotals, type PlanData } from "@/lib/tax/load";
import { computePlan, forestDeductionLimits, forestDeductionIncome } from "@/lib/tax/plan";
import { loadReportData, type ReportData } from "@/lib/reports/data";
import { renderTaxReport } from "@/lib/reports/pdf";
import { loadFilingSource } from "@/lib/filing/load";
import { compute2c, render2c, SKOG_SOFTWARE } from "@/lib/filing/vsy02c";
import { vatSummary, type VatPeriod } from "@/lib/tax/vat";
import { forestryShare } from "@/lib/tax/share";
import { summarize } from "@/lib/ledger/summary";

/*
 * Pelkän metsäasiakkaan regressiolukko maatalouden lisäämisen jälkeen.
 *
 * Odotusarvot on ajettu samalla syötteellä commitissa 6f637a4 (viimeinen ennen
 * maataloutta). Asiakas A on alv-rekisterissä, asiakas B ei. Syöte kattaa
 * puukaupat, hankintatyön, osuudet alle 100 %, poistot (kone, tie, rakennus,
 * tasapoisto), aiemman investoinnin, koneen myynnin, metsätilan osan myynnin,
 * metsävähennyksen sekä vuodet 2025 (suljettu) ja 2026.
 *
 * Tarkoitukselliset lisäykset (DECISIONS 2.10.2026) jätetään vertailusta pois ja
 * tarkistetaan erikseen: alv-ilmoituksen kentät 301–308 raportissa ja uudet
 * kentät (otherSourceExpense, byActivity, form, agri, hasForestry, activity,
 * ownShare-funktion cross- ja privateGross-kentät). Menovarausta (616) Skogissa
 * ei ole, joten sitä ei voi testata.
 */

let db: Database;
const ids = new Map<string, string>();
const one = async (tx: Sql, label: string, text: string, params: unknown[]) => {
  const [r] = await tx.query<{ id: string }>(text, params);
  ids.set(r.id, label);
  return r.id;
};

async function seed() {
  const owner = await createUser(db);
  return db.asService(async (tx) => {
    const org = await one(tx, "org", "insert into sk_organizations (name, business_id, contact_email, contact_phone) values ('Tilitoimisto Testi', '1234567-1', 'toimisto@example.test', '040 000') returning id", []);
    await tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1,$2,'owner')", [org, owner.id]);
    const A = await one(tx, "A", "insert into sk_clients (organization_id, first_name, last_name, business_id, vat_registered, municipality, tax_account_reference) values ($1, 'Aino', 'Metsänen', '7654321-0', true, 'Joutsa', 'RF123') returning id", [org]);
    const B = await one(tx, "B", "insert into sk_clients (organization_id, first_name, last_name, vat_registered) values ($1, 'Eero', 'Kuusinen', false) returning id", [org]);
    for (const c of [A, B]) for (const y of [2025, 2026]) await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1,$2,$3)", [org, c, y]);

    // Metsätilat
    const p1 = await one(tx, "P1", `insert into sk_forest_properties (organization_id, client_id, name, property_code, area_ha, acquisition_price, acquired_on, forest_land_share_pct, deduction_used_before)
      values ($1,$2,'Kotimetsä','172-401-3-45',42.5,120000,'2018-05-01',80,5000) returning id`, [org, A]);
    const p2 = await one(tx, "P2", `insert into sk_forest_properties (organization_id, client_id, name, area_ha, acquisition_price, acquired_on, forest_land_share_pct)
      values ($1,$2,'Järvenranta',20,60000,'2020-02-01',70) returning id`, [org, A]);
    const pb = await one(tx, "PB", `insert into sk_forest_properties (organization_id, client_id, name, acquisition_price, acquired_on, forest_land_share_pct)
      values ($1,$2,'Kuusikko',40000,'2019-01-01',90) returning id`, [org, B]);
    await tx.query("insert into sk_forest_property_disposals (organization_id, client_id, forest_property_id, disposed_on, sale_price, share_pct, selling_costs) values ($1,$2,$3,'2026-04-15',50000,50,1000)", [org, A, p2]);

    // Investoinnit: kone, tie (tilaan liitetty), rakennus, aiempi investointi, myyty kone
    const tractor = await one(tx, "Traktori", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct) values ($1,$2,'Traktori','2024-03-01',30000,'declining_balance',25) returning id`, [org, A]);
    const road = await one(tx, "Metsätie", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, forest_property_id) values ($1,$2,'Metsätie','2022-06-01',10000,'declining_balance',15,$3) returning id`, [org, A, p2]);
    const shed = await one(tx, "Varasto", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct) values ($1,$2,'Varasto','2025-04-01',20000,'declining_balance',10) returning id`, [org, A]);
    const atv = await one(tx, "Mönkijä", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_year, opening_accumulated_depreciation, opening_book_value)
      values ($1,$2,'Mönkijä','2019-05-01',12000,'declining_balance',25,2025,4000,8000) returning id`, [org, A]);
    const harvester = await one(tx, "Harvesteri", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, disposed_on, sale_price) values ($1,$2,'Harvesteri','2023-01-10',20000,'declining_balance',25,'2026-05-01',9000) returning id`, [org, A]);
    const saw = await one(tx, "Saha", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, useful_life_years) values ($1,$2,'Saha','2025-02-01',3000,'straight_line',5) returning id`, [org, A]);
    const bAsset = await one(tx, "B-kone", `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct) values ($1,$2,'Kuormain','2024-08-01',8000,'declining_balance',25) returning id`, [org, B]);

    const t = (c: string, d: string, kind: string, cat: string, desc: string, gross: number, rate: number, share = 100, wh = 0, asset: string | null = null) =>
      tx.query(
        `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_gross, vat_rate, business_share_pct, withholding, asset_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [org, c, d, kind, cat, desc, gross, rate, share, wh, asset],
      );
    // A 2025
    await t(A, "2025-02-10", "income", "standing_sale", "Pystykauppa UPM", 18825, 25.5, 100, 0);
    await t(A, "2025-05-20", "income", "delivery_sale", "Hankintakauppa", 10040, 25.5);
    await t(A, "2025-06-01", "income", "firewood_sale", "Polttopuut", 1255, 25.5, 60);
    await t(A, "2025-07-01", "income", "forestry_subsidy", "Kemera", 1200, 0);
    await t(A, "2025-08-15", "expense", "other_expense", "Tiemaksu", 251, 25.5, 50);
    await t(A, "2025-09-01", "expense", "travel", "Matkat", 300, 0);
    await t(A, "2025-10-05", "expense", "delivery_work", "Oma hankintatyö", 2000, 0);
    await t(A, "2025-11-11", "expense", "wages", "Palkat", 800, 0);
    await t(A, "2025-04-01", "investment", "asset_purchase", "Varasto", 25100, 25.5, 100, 0, shed);
    await t(A, "2025-02-01", "investment", "asset_purchase", "Saha", 3765, 25.5, 80, 0, saw);
    await t(A, "2025-12-01", "expense", "other_expense", "Taimet 14 %", 1140, 14);
    // A 2026
    await t(A, "2026-01-15", "income", "standing_sale", "Pystykauppa Metsä Group", 50200, 25.5);
    await t(A, "2026-03-15", "expense", "other_expense", "Metsänhoitomaksu", 1506, 25.5, 70);
    await t(A, "2026-04-20", "expense", "wages", "Palkat", 900, 0);
    await t(A, "2026-06-01", "expense", "delivery_work", "Oma hankintatyö", 1500, 0);
    await t(A, "2026-05-01", "income", "asset_sale", "Harvesterin myynti", 11295, 25.5, 100, 0, harvester);
    await t(A, "2026-08-08", "income", "moose_damage_compensation", "Hirvivahinko", 400, 0);
    await t(A, "2026-09-09", "income", "firewood_sale", "Polttopuut", 1000, 13.5, 50);
    // B 2025 ja 2026: ei alv-rekisterissä
    await t(B, "2025-03-03", "income", "standing_sale", "Pystykauppa", 10000, 0, 100, 2500);
    await t(B, "2025-04-04", "expense", "other_expense", "Tiemaksu", 627.5, 25.5, 50);
    await t(B, "2025-05-05", "expense", "travel", "Matkat", 120, 0);
    await t(B, "2026-02-02", "income", "standing_sale", "Pystykauppa", 6000, 0, 100, 1500);
    await t(B, "2026-03-03", "expense", "other_expense", "Myyrätuho", 200, 0, 75);

    // Vahvistetut poistot ja metsävähennykset (2025 vahvistettu, 2026 osin)
    const dep = (a: string, y: number, amount: number, bv: number) => tx.query("insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1,$2,$3,$4,$5)", [org, a, y, amount, bv]);
    await dep(tractor, 2025, 7500, 22500);
    await dep(road, 2025, 1200, 6800);
    await dep(shed, 2025, 2000, 18000);
    await dep(atv, 2025, 2000, 6000);
    await dep(harvester, 2025, 3000, 12000);
    await dep(saw, 2025, 480, 1920);
    await dep(bAsset, 2025, 2000, 6000);
    await dep(tractor, 2026, 5000, 17500);
    const ded = (p: string, y: number, amount: number) => tx.query("insert into sk_forest_deductions (organization_id, forest_property_id, tax_year, amount) values ($1,$2,$3,$4)", [org, p, y, amount]);
    await ded(p1, 2025, 3000);
    await ded(p2, 2025, 1000);
    await ded(p1, 2026, 4000);
    await ded(pb, 2025, 1500);
    // 2025 suljetaan kuten oikeassa käytössä.
    await tx.query("update sk_tax_years set status = 'closed', closed_at = '2026-03-01T10:00:00Z' where year = 2025 and client_id = $1", [A]);
    return { org, A, B };
  });
}
const sha = (lines: string[]) => createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
const VAT_FORM_TITLE = "Arvonlisäveroilmoituksen kentät";
/** Alv-ilmoituksen kenttäosio (otsikko ja 5 riviä × 3 tekstiä) on uusi ja tarkoituksellinen. */
const withoutVatForm = (t: string[]) => {
  const i = t.indexOf(VAT_FORM_TITLE);
  return i < 0 ? t : [...t.slice(0, i), ...t.slice(i + 16)];
};
const oldVat = (p: VatPeriod) => ({ label: p.label, output: p.output, input: p.input, nonDeductible: p.nonDeductible, payable: p.payable, byRate: p.byRate });
const named = <T,>(v: T): T => JSON.parse(JSON.stringify(v), (_k, x) => (typeof x === "string" && ids.has(x) ? `<${ids.get(x)}>` : x));
const planOld = (plan: PlanData) => ({
  income: plan.income, expense: plan.expense, deliveryWork: plan.deliveryWork, investment: plan.investment, withholding: plan.withholding,
  recordedDeduction: plan.recordedDeduction, confirmed: plan.confirmed, deductionPool: plan.deductionPool, transfersOut: plan.transfersOut,
  deductionTracking: plan.deductionTracking,
  assets: plan.assets.map((a) => ({ description: a.description, opening: a.opening, year: a.year, recorded: a.recorded })),
  properties: plan.properties.map((p) => ({ name: p.name, remaining: p.remaining, recordedThisYear: p.recordedThisYear })),
  forestSales: named(plan.forestSales.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== "id")))),
});
const reportOld = (r: ReportData) => ({
  categories: r.categories,
  vat: { quarters: r.vat.quarters.map(oldVat), year: oldVat(r.vat.year) },
  result: r.result,
  depreciation: r.depreciation,
  properties: r.properties,
  transactions: r.transactions.map((t) => ({ bookedOn: t.bookedOn, category: t.category, net: t.net, gross: t.gross, sharePct: t.sharePct, shareNet: t.shareNet })),
});

interface Out {
  plan: PlanData;
  totals: ReturnType<typeof planTotals>;
  limits: ReturnType<typeof forestDeductionLimits>;
  computed: ReturnType<typeof computePlan>;
  report: ReportData;
  pdfText: string[];
  c2: ReturnType<typeof compute2c>;
  file: string;
}
const results: Record<string, Out> = {};

beforeAll(async () => {
  db = await freshDb();
  const { org, A, B } = await seed();
  const texts: string[] = [];
  // PDF:n teksti kerätään piirtokutsuista, koska tiedosto itse on pakattu.
  const orig = PDFPage.prototype.drawText;
  PDFPage.prototype.drawText = function (text: string, opts?: Parameters<typeof orig>[1]) {
    texts.push(text);
    return orig.call(this, text, opts);
  };
  try {
    for (const [name, client] of [["A", A], ["B", B]] as const) {
      for (const year of [2025, 2026]) {
        const plan = await db.asService((tx) => loadPlanData(tx, client, year));
        const totals = planTotals(plan, Object.fromEntries(plan.assets.map((a) => [a.id, a.year.max])));
        const limits = forestDeductionLimits(
          plan.properties.map((p) => ({ id: p.id, remaining: p.remaining })),
          forestDeductionIncome(plan.income, plan.deliveryWork),
          year,
          plan.deductionPool,
        );
        const computed = computePlan({ year, income: plan.income, expense: plan.expense, ...totals, forestDeduction: limits.max });
        const report = (await db.asService((tx) => loadReportData(tx, org, client, year)))!;
        report.generatedAt = "2026-10-02T09:00:00.000Z";
        texts.length = 0;
        await renderTaxReport(report);
        const filing = (await db.asService((tx) => loadFilingSource(tx, org, client, year)))!;
        const c2 = compute2c(filing.data);
        const file = render2c({
          computed: c2, filerId: name === "A" ? "7654321-0" : "131052-308T", software: SKOG_SOFTWARE, createdAt: new Date("2026-10-02T09:00:00Z"), workers: [],
          contact: { name: "Kirjanpitäjä", email: "toimisto@example.test", phone: "040 000" },
        });
        results[`${name}${year}`] = { plan, totals, limits, computed, report, pdfText: [...texts], c2, file };
      }
    }
  } finally {
    PDFPage.prototype.drawText = orig;
  }
});
afterAll(async () => {
  await db.close();
});

describe.each(["A2025", "A2026", "B2025", "B2026"] as const)("pelkkä metsäasiakas %s on ennallaan", (key) => {
  it("verosuunnitelman lähtötiedot ja laskelma", () => {
    const r = results[key];
    const e = EXPECTED[key];
    expect(planOld(r.plan)).toEqual(e.plan);
    expect(r.totals).toEqual(e.totals);
    expect(r.limits).toEqual(e.limits);
    expect(r.computed).toEqual(e.computed);
    // Uusi kenttä: ei maatalouden ajoneuvoselvitystä, joten menot ovat ennallaan.
    expect(r.plan.otherSourceExpense).toBe(0);
  });

  it("veroraportin luvut", () => {
    const r = results[key];
    expect(reportOld(r.report)).toEqual(EXPECTED[key].report);
    expect(r.report.agri).toBeNull();
    expect(r.report.client).toMatchObject({ hasForestry: true, hasAgriculture: false });
    expect(r.report.vat.year.byActivity.agriculture).toEqual({ output: 0, input: 0 });
    expect(r.report.categories.some((c) => c.label.includes("630"))).toBe(false);
  });

  it("veroraportin PDF: sama teksti, lisänä vain alv-ilmoituksen kentät rekisteröidylle", () => {
    const r = results[key];
    const t = r.pdfText;
    // Kentät 301–308 vain alv-rekisteröidylle (A); rekisteröimättömän (B) raportti on täsmälleen vanha.
    const registered = key.startsWith("A");
    expect(t.filter((x) => x === VAT_FORM_TITLE)).toHaveLength(registered ? 1 : 0);
    if (registered) {
      const i = t.indexOf(VAT_FORM_TITLE);
      expect(t.slice(i + 1, i + 16).filter((_, j) => j % 3 === 0)).toEqual(["301", "302", "303", "307", "308"]);
    }
    expect(r.report.vat.year.form.deductible).toBe(r.report.vat.year.input);
    expect(r.report.vat.year.form.payable).toBe(r.report.vat.year.payable);
    const old = withoutVatForm(t);
    expect(old).toHaveLength(EXPECTED[key].pdfLines);
    expect(sha(old)).toBe(EXPECTED[key].pdfTextSha256);
    // Maatalouden osiot eivät näy pelkälle metsäasiakkaalle.
    expect(t.some((x) => x.includes("Maatalous") || x.includes("Metsä ja maatalous"))).toBe(false);
  });

  it("2C-laskenta ja -tiedosto", () => {
    const r = results[key];
    const e = EXPECTED[key];
    expect(r.c2.fields.map((f) => [f.code, f.value])).toEqual(e.c2.fields);
    expect(r.c2.errors).toEqual(e.c2.errors);
    expect(r.c2.warnings).toEqual(e.c2.warnings);
    expect(r.c2.fields.some((f) => f.code === "630")).toBe(false);
    expect(r.file).toBe(e.file);
  });
});

describe("puhtaat funktiot ennallaan", () => {
  const vrows = [
    { bookedOn: "2025-01-10", kind: "income" as const, amountNet: 1000, amountGross: 1255, vatRate: 25.5 },
    { bookedOn: "2025-04-10", kind: "income" as const, amountNet: 800, amountGross: 1004, vatRate: 25.5, businessSharePct: 40 },
    { bookedOn: "2025-07-10", kind: "expense" as const, amountNet: 333.33, amountGross: 418.33, vatRate: 25.5, businessSharePct: 33.33 },
    { bookedOn: "2025-10-10", kind: "investment" as const, amountNet: 10000, amountGross: 12550, vatRate: 25.5, businessSharePct: 75 },
    { bookedOn: "2025-12-31", kind: "expense" as const, amountNet: 100, amountGross: 114, vatRate: 14 },
    { bookedOn: "2025-11-30", kind: "income" as const, amountNet: 500, amountGross: 550, vatRate: 10 },
  ];

  it("alv-yhteenveto", () => {
    const s = vatSummary(vrows);
    expect({ quarters: s.quarters.map(oldVat), year: oldVat(s.year) }).toEqual(EXPECTED.vatPure);
  });

  it("metsätalouden osuus", () => {
    const shares = vrows.map((r) => forestryShare(r));
    expect(
      shares.map((s) => ({ sharePct: s.sharePct, net: s.net, vat: s.vat, gross: s.gross, nonDeductibleVat: s.nonDeductibleVat, otherNet: s.otherNet, otherGross: s.otherGross })),
    ).toEqual(EXPECTED.sharePure);
    // Ilman toisen toiminnon osuutta ristiinosuudet ovat nollia.
    expect(shares.every((s) => s.crossPct === 0 && s.crossNet === 0 && s.crossVat === 0)).toBe(true);
  });

  it("kirjausten summat", () => {
    expect(summarize(vrows.map((r) => ({ ...r, withholding: 10 })))).toEqual(EXPECTED.summaryPure);
  });
});

// Ajettu commitissa 6f637a4 (ennen maataloutta) samalla syötteellä.
const EXPECTED = {
  "A2025": {
    "plan": {
      "income": 24800,
      "expense": 4200,
      "deliveryWork": 2000,
      "investment": 22400,
      "withholding": 0,
      "recordedDeduction": 4000,
      "confirmed": true,
      "deductionPool": 77800,
      "transfersOut": [],
      "deductionTracking": {
        "base": 82800,
        "usedBefore": 5000,
        "addedToGains": 0,
        "missing": 0
      },
      "assets": [
        {
          "description": "Mönkijä",
          "opening": {
            "year": 2025,
            "accumulated": 4000,
            "bookValue": 8000
          },
          "year": {
            "active": true,
            "bookValueStart": 8000,
            "min": 0,
            "max": 2000,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 8000
          },
          "recorded": 2000
        },
        {
          "description": "Metsätie",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 10000,
            "min": 0,
            "max": 1500,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 10000
          },
          "recorded": 1200
        },
        {
          "description": "Harvesteri",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 20000,
            "min": 0,
            "max": 5000,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 20000
          },
          "recorded": 3000
        },
        {
          "description": "Traktori",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 30000,
            "min": 0,
            "max": 7500,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 30000
          },
          "recorded": 7500
        },
        {
          "description": "Saha",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 3000,
            "min": 0,
            "max": 600,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 3000
          },
          "recorded": 480
        },
        {
          "description": "Varasto",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 20000,
            "min": 0,
            "max": 2000,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 20000
          },
          "recorded": 2000
        }
      ],
      "properties": [
        {
          "name": "Kotimetsä",
          "remaining": 48600,
          "recordedThisYear": 3000
        },
        {
          "name": "Järvenranta",
          "remaining": 25200,
          "recordedThisYear": 1000
        }
      ],
      "forestSales": []
    },
    "totals": {
      "depreciation": 18600,
      "saleGain": 0,
      "saleLoss": 0,
      "salePrices": 0
    },
    "limits": {
      "available": 77800,
      "annualPct": 60,
      "annualMax": 13680,
      "max": 13680,
      "min": 1500
    },
    "computed": {
      "netBeforeDeduction": 2000,
      "entrepreneurDeduction": 0,
      "forestryTaxable": -11680,
      "saleResult": 0,
      "saleExempt": false,
      "taxable": 0,
      "tax": {
        "low": 0,
        "high": 0,
        "total": 0
      },
      "taxWithoutDeductions": {
        "low": 6180,
        "high": 0,
        "total": 6180
      },
      "saving": 6180
    },
    "report": {
      "categories": [
        {
          "label": "Käyttöomaisuuden hankinta",
          "kind": "investment",
          "net": 22400,
          "vat": 5712,
          "gross": 28112
        },
        {
          "label": "Pystykauppa",
          "kind": "income",
          "net": 15000,
          "vat": 3825,
          "gross": 18825
        },
        {
          "label": "Hankintakauppa",
          "kind": "income",
          "net": 8000,
          "vat": 2040,
          "gross": 10040
        },
        {
          "label": "Polttopuukauppa",
          "kind": "income",
          "net": 600,
          "vat": 255,
          "gross": 855
        },
        {
          "label": "Metsätalouden tuet",
          "kind": "income",
          "net": 1200,
          "vat": 0,
          "gross": 1200
        },
        {
          "label": "Muut vuosimenot",
          "kind": "expense",
          "net": 1100,
          "vat": 165.5,
          "gross": 1265.5
        },
        {
          "label": "Matkakulut",
          "kind": "expense",
          "net": 300,
          "vat": 0,
          "gross": 300
        },
        {
          "label": "Hankintatyö",
          "kind": "expense",
          "net": 2000,
          "vat": 0,
          "gross": 2000
        },
        {
          "label": "Palkkausmenot",
          "kind": "expense",
          "net": 800,
          "vat": 0,
          "gross": 800
        }
      ],
      "vat": {
        "quarters": [
          {
            "label": "1. neljännes",
            "output": 3825,
            "input": 612,
            "nonDeductible": 153,
            "payable": 3213,
            "byRate": [
              {
                "rate": 25.5,
                "net": 15000,
                "vat": 3825
              }
            ]
          },
          {
            "label": "2. neljännes",
            "output": 2295,
            "input": 5100,
            "nonDeductible": 0,
            "payable": -2805,
            "byRate": [
              {
                "rate": 25.5,
                "net": 9000,
                "vat": 2295
              }
            ]
          },
          {
            "label": "3. neljännes",
            "output": 0,
            "input": 25.5,
            "nonDeductible": 25.5,
            "payable": -25.5,
            "byRate": [
              {
                "rate": 0,
                "net": 1200,
                "vat": 0
              }
            ]
          },
          {
            "label": "4. neljännes",
            "output": 0,
            "input": 140,
            "nonDeductible": 0,
            "payable": -140,
            "byRate": []
          }
        ],
        "year": {
          "label": "Koko vuosi",
          "output": 6120,
          "input": 5877.5,
          "nonDeductible": 178.5,
          "payable": 242.5,
          "byRate": [
            {
              "rate": 25.5,
              "net": 24000,
              "vat": 6120
            },
            {
              "rate": 0,
              "net": 1200,
              "vat": 0
            }
          ]
        }
      },
      "result": {
        "netBeforeDeduction": 4420,
        "entrepreneurDeduction": 21,
        "forestryTaxable": 399,
        "saleResult": 0,
        "saleExempt": false,
        "taxable": 399,
        "tax": {
          "low": 119.7,
          "high": 0,
          "total": 119.7
        },
        "taxWithoutDeductions": {
          "low": 6180,
          "high": 0,
          "total": 6180
        },
        "saving": 6060.3
      },
      "depreciation": [
        {
          "description": "Mönkijä",
          "method": "Menojäännös 25 %",
          "bookValueStart": 8000,
          "amount": 2000,
          "bookValueEnd": 6000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 12000,
          "opening": {
            "year": 2025,
            "accumulated": 4000,
            "bookValue": 8000
          }
        },
        {
          "description": "Metsätie",
          "method": "Menojäännös 15 %",
          "bookValueStart": 10000,
          "amount": 1200,
          "bookValueEnd": 8800,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 10000,
          "opening": null
        },
        {
          "description": "Harvesteri",
          "method": "Menojäännös 25 %",
          "bookValueStart": 20000,
          "amount": 3000,
          "bookValueEnd": 17000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 20000,
          "opening": null
        },
        {
          "description": "Traktori",
          "method": "Menojäännös 25 %",
          "bookValueStart": 30000,
          "amount": 7500,
          "bookValueEnd": 22500,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 30000,
          "opening": null
        },
        {
          "description": "Saha",
          "method": "Tasapoisto (vanha)",
          "bookValueStart": 3000,
          "amount": 480,
          "bookValueEnd": 2520,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 3000,
          "opening": null
        },
        {
          "description": "Varasto",
          "method": "Menojäännös 10 %",
          "bookValueStart": 20000,
          "amount": 2000,
          "bookValueEnd": 18000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 20000,
          "opening": null
        }
      ],
      "properties": [
        {
          "name": "Kotimetsä",
          "remainingBefore": 48600,
          "deduction": 3000
        },
        {
          "name": "Järvenranta",
          "remainingBefore": 25200,
          "deduction": 1000
        }
      ],
      "transactions": [
        {
          "bookedOn": "2025-02-01",
          "category": "Käyttöomaisuuden hankinta",
          "net": 3000,
          "gross": 3765,
          "sharePct": 80,
          "shareNet": 2400
        },
        {
          "bookedOn": "2025-02-10",
          "category": "Pystykauppa",
          "net": 15000,
          "gross": 18825,
          "sharePct": 100,
          "shareNet": 15000
        },
        {
          "bookedOn": "2025-04-01",
          "category": "Käyttöomaisuuden hankinta",
          "net": 20000,
          "gross": 25100,
          "sharePct": 100,
          "shareNet": 20000
        },
        {
          "bookedOn": "2025-05-20",
          "category": "Hankintakauppa",
          "net": 8000,
          "gross": 10040,
          "sharePct": 100,
          "shareNet": 8000
        },
        {
          "bookedOn": "2025-06-01",
          "category": "Polttopuukauppa",
          "net": 1000,
          "gross": 1255,
          "sharePct": 60,
          "shareNet": 600
        },
        {
          "bookedOn": "2025-07-01",
          "category": "Metsätalouden tuet",
          "net": 1200,
          "gross": 1200,
          "sharePct": 100,
          "shareNet": 1200
        },
        {
          "bookedOn": "2025-08-15",
          "category": "Muut vuosimenot",
          "net": 200,
          "gross": 251,
          "sharePct": 50,
          "shareNet": 100
        },
        {
          "bookedOn": "2025-09-01",
          "category": "Matkakulut",
          "net": 300,
          "gross": 300,
          "sharePct": 100,
          "shareNet": 300
        },
        {
          "bookedOn": "2025-10-05",
          "category": "Hankintatyö",
          "net": 2000,
          "gross": 2000,
          "sharePct": 100,
          "shareNet": 2000
        },
        {
          "bookedOn": "2025-11-11",
          "category": "Palkkausmenot",
          "net": 800,
          "gross": 800,
          "sharePct": 100,
          "shareNet": 800
        },
        {
          "bookedOn": "2025-12-01",
          "category": "Muut vuosimenot",
          "net": 1000,
          "gross": 1140,
          "sharePct": 100,
          "shareNet": 1000
        }
      ]
    },
    "c2": {
      "fields": [
        [
          "603",
          15000
        ],
        [
          "604",
          8000
        ],
        [
          "613",
          600
        ],
        [
          "690",
          23600
        ],
        [
          "605",
          2000
        ],
        [
          "691",
          2000
        ],
        [
          "609",
          1200
        ],
        [
          "610",
          1200
        ],
        [
          "615",
          4000
        ],
        [
          "618",
          4000
        ],
        [
          "622",
          800
        ],
        [
          "623",
          300
        ],
        [
          "624",
          1100
        ],
        [
          "693",
          2200
        ],
        [
          "660",
          58000
        ],
        [
          "680",
          10000
        ],
        [
          "661",
          3000
        ],
        [
          "671",
          20000
        ],
        [
          "642",
          12980
        ],
        [
          "643",
          2000
        ],
        [
          "644",
          1200
        ],
        [
          "694",
          16180
        ],
        [
          "626",
          48020
        ],
        [
          "627",
          18000
        ],
        [
          "628",
          8800
        ],
        [
          "635",
          420
        ],
        [
          "655",
          82800
        ],
        [
          "656",
          5000
        ],
        [
          "715",
          77800
        ],
        [
          "716",
          22800
        ],
        [
          "717",
          4000
        ],
        [
          "720",
          9000
        ]
      ],
      "errors": [],
      "warnings": [
        "1 investoinnin lajia ei tiedetä (vanha tasapoisto). Ne on viety koneisiin ja kalustoon. Tarkista laji."
      ]
    },
    "file": "000:VSY02C25\r\n198:02102026120000\r\n048:Adepta Skog 2\r\n014:2237131-2_SK\r\n010:7654321-0\r\n603:15000,00\r\n604:8000,00\r\n613:600,00\r\n690:23600,00\r\n605:2000,00\r\n691:2000,00\r\n609:1200,00\r\n610:1200,00\r\n615:4000,00\r\n618:4000,00\r\n622:800,00\r\n623:300,00\r\n624:1100,00\r\n693:2200,00\r\n660:58000,00\r\n680:10000,00\r\n661:3000,00\r\n671:20000,00\r\n642:12980,00\r\n643:2000,00\r\n644:1200,00\r\n694:16180,00\r\n626:48020,00\r\n627:18000,00\r\n628:8800,00\r\n635:420,00\r\n655:82800,00\r\n656:5000,00\r\n715:77800,00\r\n716:22800,00\r\n717:4000,00\r\n720:9000,00\r\n041:Kirjanpitäjä\r\n044:toimisto@example.test\r\n042:040 000\r\n999:1\r\n",
    "pdfTextSha256": "ed281420c264b4f710cf7ab5a6a0d43f4fee699cddbc8fbd34653c55102914d8",
    "pdfLines": 368
  },
  "A2026": {
    "plan": {
      "income": 40840.53,
      "expense": 3240,
      "deliveryWork": 1500,
      "investment": 0,
      "withholding": 0,
      "recordedDeduction": 4000,
      "confirmed": true,
      "deductionPool": 87750,
      "transfersOut": [],
      "deductionTracking": {
        "base": 87750,
        "usedBefore": 9000,
        "addedToGains": 9000,
        "missing": 0
      },
      "assets": [
        {
          "description": "Mönkijä",
          "opening": {
            "year": 2025,
            "accumulated": 4000,
            "bookValue": 8000
          },
          "year": {
            "active": true,
            "bookValueStart": 6000,
            "min": 0,
            "max": 1500,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 6000
          },
          "recorded": null
        },
        {
          "description": "Metsätie",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 6800,
            "min": 0,
            "max": 510,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 3400,
            "bookValueBase": 3400
          },
          "recorded": null
        },
        {
          "description": "Harvesteri",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 12000,
            "min": 0,
            "max": 0,
            "mandatory": false,
            "sold": true,
            "salePrice": 9000,
            "saleGain": 0,
            "saleLoss": 3000,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 0
          },
          "recorded": null
        },
        {
          "description": "Traktori",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 22500,
            "min": 0,
            "max": 5625,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 22500
          },
          "recorded": 5000
        },
        {
          "description": "Saha",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 1920,
            "min": 0,
            "max": 600,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 1920
          },
          "recorded": null
        },
        {
          "description": "Varasto",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 18000,
            "min": 0,
            "max": 1800,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 18000
          },
          "recorded": null
        }
      ],
      "properties": [
        {
          "name": "Kotimetsä",
          "remaining": 64000,
          "recordedThisYear": 4000
        },
        {
          "name": "Järvenranta",
          "remaining": 14750,
          "recordedThisYear": 0
        }
      ],
      "forestSales": [
        {
          "propertyId": "<P2>",
          "year": 2026,
          "disposedOn": "2026-04-15",
          "salePrice": 50000,
          "sharePct": 50,
          "acquisitionCost": 30000,
          "roadDitchCost": 3400,
          "sellingCosts": 1000,
          "deemedCost": 10000,
          "deemedPct": 20,
          "usesDeemedCost": false,
          "cost": 34400,
          "addition": 9000,
          "gain": 24600,
          "name": "Järvenranta"
        }
      ]
    },
    "totals": {
      "depreciation": 10035,
      "saleGain": 24600,
      "saleLoss": 3000,
      "salePrices": 59000
    },
    "limits": {
      "available": 87750,
      "annualPct": 75,
      "annualMax": 29505.4,
      "max": 29505.4,
      "min": 1500
    },
    "computed": {
      "netBeforeDeduction": 27565.53,
      "entrepreneurDeduction": 0,
      "forestryTaxable": -1939.87,
      "saleResult": 21600,
      "saleExempt": false,
      "taxable": 19660.13,
      "tax": {
        "low": 5898.04,
        "high": 0,
        "total": 5898.04
      },
      "taxWithoutDeductions": {
        "low": 9000,
        "high": 9928.18,
        "total": 18928.18
      },
      "saving": 13030.14
    },
    "report": {
      "categories": [
        {
          "label": "Pystykauppa",
          "kind": "income",
          "net": 40000,
          "vat": 10200,
          "gross": 50200
        },
        {
          "label": "Muut vuosimenot",
          "kind": "expense",
          "net": 840,
          "vat": 214.2,
          "gross": 1054.2
        },
        {
          "label": "Palkkausmenot",
          "kind": "expense",
          "net": 900,
          "vat": 0,
          "gross": 900
        },
        {
          "label": "Käyttöomaisuuden myynti",
          "kind": "income",
          "net": 9000,
          "vat": 2295,
          "gross": 11295
        },
        {
          "label": "Hankintatyö",
          "kind": "expense",
          "net": 1500,
          "vat": 0,
          "gross": 1500
        },
        {
          "label": "Hirvivahinkokorvaukset",
          "kind": "income",
          "net": 400,
          "vat": 0,
          "gross": 400
        },
        {
          "label": "Polttopuukauppa",
          "kind": "income",
          "net": 440.53,
          "vat": 118.94,
          "gross": 559.47
        }
      ],
      "vat": {
        "quarters": [
          {
            "label": "1. neljännes",
            "output": 10200,
            "input": 214.2,
            "nonDeductible": 91.8,
            "payable": 9985.8,
            "byRate": [
              {
                "rate": 25.5,
                "net": 40000,
                "vat": 10200
              }
            ]
          },
          {
            "label": "2. neljännes",
            "output": 2295,
            "input": 0,
            "nonDeductible": 0,
            "payable": 2295,
            "byRate": [
              {
                "rate": 25.5,
                "net": 9000,
                "vat": 2295
              }
            ]
          },
          {
            "label": "3. neljännes",
            "output": 118.94,
            "input": 0,
            "nonDeductible": 0,
            "payable": 118.94,
            "byRate": [
              {
                "rate": 13.5,
                "net": 881.06,
                "vat": 118.94
              },
              {
                "rate": 0,
                "net": 400,
                "vat": 0
              }
            ]
          },
          {
            "label": "4. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": []
          }
        ],
        "year": {
          "label": "Koko vuosi",
          "output": 12613.94,
          "input": 214.2,
          "nonDeductible": 91.8,
          "payable": 12399.74,
          "byRate": [
            {
              "rate": 25.5,
              "net": 49000,
              "vat": 12495
            },
            {
              "rate": 13.5,
              "net": 881.06,
              "vat": 118.94
            },
            {
              "rate": 0,
              "net": 400,
              "vat": 0
            }
          ]
        }
      },
      "result": {
        "netBeforeDeduction": 32600.53,
        "entrepreneurDeduction": 1430.03,
        "forestryTaxable": 27170.5,
        "saleResult": 21600,
        "saleExempt": false,
        "taxable": 48770.5,
        "tax": {
          "low": 9000,
          "high": 6381.97,
          "total": 15381.97
        },
        "taxWithoutDeductions": {
          "low": 9000,
          "high": 9928.18,
          "total": 18928.18
        },
        "saving": 3546.21
      },
      "depreciation": [
        {
          "description": "Mönkijä",
          "method": "Menojäännös 25 %",
          "bookValueStart": 6000,
          "amount": 0,
          "bookValueEnd": 6000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 12000,
          "opening": {
            "year": 2025,
            "accumulated": 4000,
            "bookValue": 8000
          }
        },
        {
          "description": "Metsätie",
          "method": "Menojäännös 15 %",
          "bookValueStart": 6800,
          "amount": 0,
          "bookValueEnd": 3400,
          "transferred": 3400,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 10000,
          "opening": null
        },
        {
          "description": "Harvesteri",
          "method": "Menojäännös 25 %",
          "bookValueStart": 12000,
          "amount": 0,
          "bookValueEnd": 0,
          "transferred": 0,
          "sold": true,
          "salePrice": 9000,
          "saleGain": 0,
          "saleLoss": 3000,
          "acquisitionCost": 20000,
          "opening": null
        },
        {
          "description": "Traktori",
          "method": "Menojäännös 25 %",
          "bookValueStart": 22500,
          "amount": 5000,
          "bookValueEnd": 17500,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 30000,
          "opening": null
        },
        {
          "description": "Saha",
          "method": "Tasapoisto (vanha)",
          "bookValueStart": 1920,
          "amount": 0,
          "bookValueEnd": 1920,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 3000,
          "opening": null
        },
        {
          "description": "Varasto",
          "method": "Menojäännös 10 %",
          "bookValueStart": 18000,
          "amount": 0,
          "bookValueEnd": 18000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 20000,
          "opening": null
        }
      ],
      "properties": [
        {
          "name": "Kotimetsä",
          "remainingBefore": 64000,
          "deduction": 4000
        },
        {
          "name": "Järvenranta",
          "remainingBefore": 14750,
          "deduction": 0
        }
      ],
      "transactions": [
        {
          "bookedOn": "2026-01-15",
          "category": "Pystykauppa",
          "net": 40000,
          "gross": 50200,
          "sharePct": 100,
          "shareNet": 40000
        },
        {
          "bookedOn": "2026-03-15",
          "category": "Muut vuosimenot",
          "net": 1200,
          "gross": 1506,
          "sharePct": 70,
          "shareNet": 840
        },
        {
          "bookedOn": "2026-04-20",
          "category": "Palkkausmenot",
          "net": 900,
          "gross": 900,
          "sharePct": 100,
          "shareNet": 900
        },
        {
          "bookedOn": "2026-05-01",
          "category": "Käyttöomaisuuden myynti",
          "net": 9000,
          "gross": 11295,
          "sharePct": 100,
          "shareNet": 9000
        },
        {
          "bookedOn": "2026-06-01",
          "category": "Hankintatyö",
          "net": 1500,
          "gross": 1500,
          "sharePct": 100,
          "shareNet": 1500
        },
        {
          "bookedOn": "2026-08-08",
          "category": "Hirvivahinkokorvaukset",
          "net": 400,
          "gross": 400,
          "sharePct": 100,
          "shareNet": 400
        },
        {
          "bookedOn": "2026-09-09",
          "category": "Polttopuukauppa",
          "net": 881.06,
          "gross": 1000,
          "sharePct": 50,
          "shareNet": 440.53
        }
      ]
    },
    "c2": {
      "fields": [
        [
          "603",
          40000
        ],
        [
          "613",
          440.53
        ],
        [
          "690",
          40440.53
        ],
        [
          "625",
          440.53
        ],
        [
          "691",
          440.53
        ],
        [
          "608",
          400
        ],
        [
          "610",
          400
        ],
        [
          "615",
          4000
        ],
        [
          "618",
          4000
        ],
        [
          "622",
          900
        ],
        [
          "624",
          840
        ],
        [
          "693",
          1740
        ],
        [
          "660",
          42420
        ],
        [
          "670",
          18000
        ],
        [
          "680",
          6800
        ],
        [
          "645",
          12000
        ],
        [
          "682",
          3400
        ],
        [
          "642",
          5000
        ],
        [
          "694",
          5000
        ],
        [
          "626",
          25420
        ],
        [
          "627",
          18000
        ],
        [
          "628",
          3400
        ],
        [
          "635",
          29660
        ],
        [
          "655",
          87750
        ],
        [
          "656",
          9000
        ],
        [
          "657",
          9000
        ],
        [
          "715",
          87750
        ],
        [
          "716",
          40400
        ],
        [
          "717",
          4000
        ],
        [
          "720",
          13000
        ]
      ],
      "errors": [],
      "warnings": [
        "Hankintatyön arvosta 1 059,47 € ei mahdu tämän vuoden hankinta- tai polttopuukauppojen tuloihin. Se vähennetään sinä vuonna, kun kaupasta saadaan maksu, joten se jää tästä tiedostosta pois.",
        "1 investoinnin lajia ei tiedetä (vanha tasapoisto). Ne on viety koneisiin ja kalustoon. Tarkista laji.",
        "Vuosi on avoin, joten luvut voivat vielä muuttua."
      ]
    },
    "file": "000:VSY02C26\r\n198:02102026120000\r\n048:Adepta Skog 2\r\n014:2237131-2_SK\r\n010:7654321-0\r\n603:40000,00\r\n613:440,53\r\n690:40440,53\r\n625:440,53\r\n691:440,53\r\n608:400,00\r\n610:400,00\r\n615:4000,00\r\n618:4000,00\r\n622:900,00\r\n624:840,00\r\n693:1740,00\r\n660:42420,00\r\n670:18000,00\r\n680:6800,00\r\n645:12000,00\r\n682:3400,00\r\n642:5000,00\r\n694:5000,00\r\n626:25420,00\r\n627:18000,00\r\n628:3400,00\r\n635:29660,00\r\n655:87750,00\r\n656:9000,00\r\n657:9000,00\r\n715:87750,00\r\n716:40400,00\r\n717:4000,00\r\n720:13000,00\r\n041:Kirjanpitäjä\r\n044:toimisto@example.test\r\n042:040 000\r\n999:1\r\n",
    "pdfTextSha256": "4306ac7ca51e9cd3eb15de4a9c4a30acfc22114e53441b242ad2408ad6b2650a",
    "pdfLines": 359
  },
  "B2025": {
    "plan": {
      "income": 10000,
      "expense": 370,
      "deliveryWork": 0,
      "investment": 0,
      "withholding": 2500,
      "recordedDeduction": 1500,
      "confirmed": true,
      "deductionPool": 21600,
      "transfersOut": [],
      "deductionTracking": {
        "base": 21600,
        "usedBefore": 0,
        "addedToGains": 0,
        "missing": 0
      },
      "assets": [
        {
          "description": "Kuormain",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 8000,
            "min": 0,
            "max": 2000,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 8000
          },
          "recorded": 2000
        }
      ],
      "properties": [
        {
          "name": "Kuusikko",
          "remaining": 21600,
          "recordedThisYear": 1500
        }
      ],
      "forestSales": []
    },
    "totals": {
      "depreciation": 2000,
      "saleGain": 0,
      "saleLoss": 0,
      "salePrices": 0
    },
    "limits": {
      "available": 21600,
      "annualPct": 60,
      "annualMax": 6000,
      "max": 6000,
      "min": 1500
    },
    "computed": {
      "netBeforeDeduction": 7630,
      "entrepreneurDeduction": 81.5,
      "forestryTaxable": 1548.5,
      "saleResult": 0,
      "saleExempt": false,
      "taxable": 1548.5,
      "tax": {
        "low": 464.55,
        "high": 0,
        "total": 464.55
      },
      "taxWithoutDeductions": {
        "low": 2889,
        "high": 0,
        "total": 2889
      },
      "saving": 2424.45
    },
    "report": {
      "categories": [
        {
          "label": "Pystykauppa",
          "kind": "income",
          "net": 10000,
          "vat": 0,
          "gross": 10000
        },
        {
          "label": "Muut vuosimenot",
          "kind": "expense",
          "net": 250,
          "vat": 63.75,
          "gross": 313.75
        },
        {
          "label": "Matkakulut",
          "kind": "expense",
          "net": 120,
          "vat": 0,
          "gross": 120
        }
      ],
      "vat": {
        "quarters": [
          {
            "label": "1. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": [
              {
                "rate": 0,
                "net": 10000,
                "vat": 0
              }
            ]
          },
          {
            "label": "2. neljännes",
            "output": 0,
            "input": 63.75,
            "nonDeductible": 63.75,
            "payable": -63.75,
            "byRate": []
          },
          {
            "label": "3. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": []
          },
          {
            "label": "4. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": []
          }
        ],
        "year": {
          "label": "Koko vuosi",
          "output": 0,
          "input": 63.75,
          "nonDeductible": 63.75,
          "payable": -63.75,
          "byRate": [
            {
              "rate": 0,
              "net": 10000,
              "vat": 0
            }
          ]
        }
      },
      "result": {
        "netBeforeDeduction": 7630,
        "entrepreneurDeduction": 306.5,
        "forestryTaxable": 5823.5,
        "saleResult": 0,
        "saleExempt": false,
        "taxable": 5823.5,
        "tax": {
          "low": 1747.05,
          "high": 0,
          "total": 1747.05
        },
        "taxWithoutDeductions": {
          "low": 2889,
          "high": 0,
          "total": 2889
        },
        "saving": 1141.95
      },
      "depreciation": [
        {
          "description": "Kuormain",
          "method": "Menojäännös 25 %",
          "bookValueStart": 8000,
          "amount": 2000,
          "bookValueEnd": 6000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 8000,
          "opening": null
        }
      ],
      "properties": [
        {
          "name": "Kuusikko",
          "remainingBefore": 21600,
          "deduction": 1500
        }
      ],
      "transactions": [
        {
          "bookedOn": "2025-03-03",
          "category": "Pystykauppa",
          "net": 10000,
          "gross": 10000,
          "sharePct": 100,
          "shareNet": 10000
        },
        {
          "bookedOn": "2025-04-04",
          "category": "Muut vuosimenot",
          "net": 500,
          "gross": 627.5,
          "sharePct": 50,
          "shareNet": 250
        },
        {
          "bookedOn": "2025-05-05",
          "category": "Matkakulut",
          "net": 120,
          "gross": 120,
          "sharePct": 100,
          "shareNet": 120
        }
      ]
    },
    "c2": {
      "fields": [
        [
          "603",
          10000
        ],
        [
          "690",
          10000
        ],
        [
          "615",
          1500
        ],
        [
          "618",
          1500
        ],
        [
          "623",
          120
        ],
        [
          "624",
          313.75
        ],
        [
          "693",
          433.75
        ],
        [
          "660",
          8000
        ],
        [
          "642",
          2000
        ],
        [
          "694",
          2000
        ],
        [
          "626",
          6000
        ],
        [
          "635",
          6066.25
        ],
        [
          "655",
          21600
        ],
        [
          "715",
          21600
        ],
        [
          "716",
          10000
        ],
        [
          "717",
          1500
        ],
        [
          "720",
          1500
        ]
      ],
      "errors": [],
      "warnings": [
        "Vuosi on avoin, joten luvut voivat vielä muuttua."
      ]
    },
    "file": "000:VSY02C25\r\n198:02102026120000\r\n048:Adepta Skog 2\r\n014:2237131-2_SK\r\n010:131052-308T\r\n603:10000,00\r\n690:10000,00\r\n615:1500,00\r\n618:1500,00\r\n623:120,00\r\n624:313,75\r\n693:433,75\r\n660:8000,00\r\n642:2000,00\r\n694:2000,00\r\n626:6000,00\r\n635:6066,25\r\n655:21600,00\r\n715:21600,00\r\n716:10000,00\r\n717:1500,00\r\n720:1500,00\r\n041:Kirjanpitäjä\r\n044:toimisto@example.test\r\n042:040 000\r\n999:1\r\n",
    "pdfTextSha256": "c1aa8f371d8b0fd9f7b5eb6c731c0b3f27f13c76ddbf3a2d0979ee84edc441c1",
    "pdfLines": 251
  },
  "B2026": {
    "plan": {
      "income": 6000,
      "expense": 150,
      "deliveryWork": 0,
      "investment": 0,
      "withholding": 1500,
      "recordedDeduction": 0,
      "confirmed": false,
      "deductionPool": 25500,
      "transfersOut": [],
      "deductionTracking": {
        "base": 27000,
        "usedBefore": 1500,
        "addedToGains": 0,
        "missing": 0
      },
      "assets": [
        {
          "description": "Kuormain",
          "opening": null,
          "year": {
            "active": true,
            "bookValueStart": 6000,
            "min": 0,
            "max": 1500,
            "mandatory": false,
            "sold": false,
            "salePrice": 0,
            "saleGain": 0,
            "saleLoss": 0,
            "smallBalance": false,
            "transferred": 0,
            "bookValueBase": 6000
          },
          "recorded": null
        }
      ],
      "properties": [
        {
          "name": "Kuusikko",
          "remaining": 25500,
          "recordedThisYear": 0
        }
      ],
      "forestSales": []
    },
    "totals": {
      "depreciation": 1500,
      "saleGain": 0,
      "saleLoss": 0,
      "salePrices": 0
    },
    "limits": {
      "available": 25500,
      "annualPct": 75,
      "annualMax": 4500,
      "max": 4500,
      "min": 1500
    },
    "computed": {
      "netBeforeDeduction": 4350,
      "entrepreneurDeduction": 0,
      "forestryTaxable": -150,
      "saleResult": 0,
      "saleExempt": false,
      "taxable": 0,
      "tax": {
        "low": 0,
        "high": 0,
        "total": 0
      },
      "taxWithoutDeductions": {
        "low": 1755,
        "high": 0,
        "total": 1755
      },
      "saving": 1755
    },
    "report": {
      "categories": [
        {
          "label": "Pystykauppa",
          "kind": "income",
          "net": 6000,
          "vat": 0,
          "gross": 6000
        },
        {
          "label": "Muut vuosimenot",
          "kind": "expense",
          "net": 150,
          "vat": 0,
          "gross": 150
        }
      ],
      "vat": {
        "quarters": [
          {
            "label": "1. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": [
              {
                "rate": 0,
                "net": 6000,
                "vat": 0
              }
            ]
          },
          {
            "label": "2. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": []
          },
          {
            "label": "3. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": []
          },
          {
            "label": "4. neljännes",
            "output": 0,
            "input": 0,
            "nonDeductible": 0,
            "payable": 0,
            "byRate": []
          }
        ],
        "year": {
          "label": "Koko vuosi",
          "output": 0,
          "input": 0,
          "nonDeductible": 0,
          "payable": 0,
          "byRate": [
            {
              "rate": 0,
              "net": 6000,
              "vat": 0
            }
          ]
        }
      },
      "result": {
        "netBeforeDeduction": 5850,
        "entrepreneurDeduction": 292.5,
        "forestryTaxable": 5557.5,
        "saleResult": 0,
        "saleExempt": false,
        "taxable": 5557.5,
        "tax": {
          "low": 1667.25,
          "high": 0,
          "total": 1667.25
        },
        "taxWithoutDeductions": {
          "low": 1755,
          "high": 0,
          "total": 1755
        },
        "saving": 87.75
      },
      "depreciation": [
        {
          "description": "Kuormain",
          "method": "Menojäännös 25 %",
          "bookValueStart": 6000,
          "amount": 0,
          "bookValueEnd": 6000,
          "transferred": 0,
          "sold": false,
          "salePrice": 0,
          "saleGain": 0,
          "saleLoss": 0,
          "acquisitionCost": 8000,
          "opening": null
        }
      ],
      "properties": [
        {
          "name": "Kuusikko",
          "remainingBefore": 25500,
          "deduction": 0
        }
      ],
      "transactions": [
        {
          "bookedOn": "2026-02-02",
          "category": "Pystykauppa",
          "net": 6000,
          "gross": 6000,
          "sharePct": 100,
          "shareNet": 6000
        },
        {
          "bookedOn": "2026-03-03",
          "category": "Muut vuosimenot",
          "net": 200,
          "gross": 200,
          "sharePct": 75,
          "shareNet": 150
        }
      ]
    },
    "c2": {
      "fields": [
        [
          "603",
          6000
        ],
        [
          "690",
          6000
        ],
        [
          "624",
          150
        ],
        [
          "693",
          150
        ],
        [
          "660",
          6000
        ],
        [
          "626",
          6000
        ],
        [
          "635",
          5850
        ],
        [
          "655",
          27000
        ],
        [
          "656",
          1500
        ],
        [
          "715",
          25500
        ],
        [
          "716",
          6000
        ],
        [
          "720",
          1500
        ]
      ],
      "errors": [],
      "warnings": [
        "Verosuunnitelmaa ei ole vahvistettu. Poistot ja metsävähennys puuttuvat tiedostosta.",
        "Vuosi on avoin, joten luvut voivat vielä muuttua."
      ]
    },
    "file": "000:VSY02C26\r\n198:02102026120000\r\n048:Adepta Skog 2\r\n014:2237131-2_SK\r\n010:131052-308T\r\n603:6000,00\r\n690:6000,00\r\n624:150,00\r\n693:150,00\r\n660:6000,00\r\n626:6000,00\r\n635:5850,00\r\n655:27000,00\r\n656:1500,00\r\n715:25500,00\r\n716:6000,00\r\n720:1500,00\r\n041:Kirjanpitäjä\r\n044:toimisto@example.test\r\n042:040 000\r\n999:1\r\n",
    "pdfTextSha256": "d79556151ff3e17e6d253ef135fc06ec574cf86078560fdba6f087700db1a080",
    "pdfLines": 238
  },
  "vatPure": {
    "quarters": [
      {
        "label": "1. neljännes",
        "output": 255,
        "input": 0,
        "nonDeductible": 0,
        "payable": 255,
        "byRate": [
          {
            "rate": 25.5,
            "net": 1000,
            "vat": 255
          }
        ]
      },
      {
        "label": "2. neljännes",
        "output": 204,
        "input": 0,
        "nonDeductible": 0,
        "payable": 204,
        "byRate": [
          {
            "rate": 25.5,
            "net": 800,
            "vat": 204
          }
        ]
      },
      {
        "label": "3. neljännes",
        "output": 0,
        "input": 28.33,
        "nonDeductible": 56.67,
        "payable": -28.33,
        "byRate": []
      },
      {
        "label": "4. neljännes",
        "output": 50,
        "input": 1926.5,
        "nonDeductible": 637.5,
        "payable": -1876.5,
        "byRate": [
          {
            "rate": 10,
            "net": 500,
            "vat": 50
          }
        ]
      }
    ],
    "year": {
      "label": "Koko vuosi",
      "output": 509,
      "input": 1954.83,
      "nonDeductible": 694.17,
      "payable": -1445.83,
      "byRate": [
        {
          "rate": 25.5,
          "net": 1800,
          "vat": 459
        },
        {
          "rate": 10,
          "net": 500,
          "vat": 50
        }
      ]
    }
  },
  "sharePure": [
    {
      "sharePct": 100,
      "net": 1000,
      "vat": 255,
      "gross": 1255,
      "nonDeductibleVat": 0,
      "otherNet": 0,
      "otherGross": 0
    },
    {
      "sharePct": 40,
      "net": 320,
      "vat": 204,
      "gross": 524,
      "nonDeductibleVat": 0,
      "otherNet": 480,
      "otherGross": 480
    },
    {
      "sharePct": 33.33,
      "net": 111.1,
      "vat": 28.33,
      "gross": 139.43,
      "nonDeductibleVat": 56.67,
      "otherNet": 222.23,
      "otherGross": 278.9
    },
    {
      "sharePct": 75,
      "net": 7500,
      "vat": 1912.5,
      "gross": 9412.5,
      "nonDeductibleVat": 637.5,
      "otherNet": 2500,
      "otherGross": 3137.5
    },
    {
      "sharePct": 100,
      "net": 100,
      "vat": 14,
      "gross": 114,
      "nonDeductibleVat": 0,
      "otherNet": 0,
      "otherGross": 0
    },
    {
      "sharePct": 100,
      "net": 500,
      "vat": 50,
      "gross": 550,
      "nonDeductibleVat": 0,
      "otherNet": 0,
      "otherGross": 0
    }
  ],
  "summaryPure": {
    "income": {
      "net": 1820,
      "vat": 509,
      "gross": 2329
    },
    "expense": {
      "net": 211.1,
      "vat": 42.33,
      "gross": 253.43
    },
    "investment": {
      "net": 7500,
      "vat": 1912.5,
      "gross": 9412.5
    },
    "withholding": 60,
    "nonDeductibleVat": 694.17,
    "partialCount": 3,
    "vatPayable": -1445.83,
    "netResult": 1608.9
  }
};
