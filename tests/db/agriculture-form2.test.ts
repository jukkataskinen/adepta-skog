import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Sql } from "@/lib/db/types";
import { saveTransaction } from "@/lib/ledger/write";
import { savePriorAsset } from "@/lib/assets/prior";
import { addDeferral, addReserve, saveAgriDepreciations, saveAgriYear, EMPTY_AGRI_YEAR } from "@/lib/agriculture/year";
import { loadForm2 } from "@/lib/tax/agri-form-load";
import { loadReportData } from "@/lib/reports/data";
import { renderTaxReport } from "@/lib/reports/pdf";
import { PDFDocument } from "pdf-lib";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Lomake 2 kannan tiedoista: kirjaukset, osuudet, poistot, varaukset ja jaksotukset (DECISIONS 2.10.2026). */

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
const asStaff = <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(a.staff.sub, fn);
const base = { kind: null, description: "", withholding: 0, businessSharePct: 100, forestPropertyId: null, assetRatePct: null, saleAssetId: null };

describe("lomake 2 kannasta", () => {
  it("kirjaukset, toisen toiminnon osuus, poistot, varaus ja jaksotus kentiksi", async () => {
    await asStaff(async (tx) => {
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-03-31", category: "agri_livestock_products", amountGross: 22800, vatRate: 14 });
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-10-15", category: "agri_state_subsidy", amountGross: 15000, vatRate: 0 });
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-05-10", category: "agri_myel", amountGross: 3500, vatRate: 0 });
      // Sähkö 70 % maatalous, 20 % metsätalous: maatalouteen 1 000,08 € ilman alv:tä.
      await saveTransaction(tx, actor(), a.client, null, {
        ...base, bookedOn: "2025-06-30", category: "agri_energy", amountGross: 1793, vatRate: 25.5, businessSharePct: 70, otherSharePct: 20,
      });
      // Metsätalouden kulu, josta 50 % maataloudelle: maatalouteen 100 € kohtaan 226.
      await saveTransaction(tx, actor(), a.client, null, {
        ...base, bookedOn: "2025-07-01", category: "other_expense", amountGross: 251, vatRate: 25.5, businessSharePct: 50, otherSharePct: 50,
      });
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-09-01", category: "agri_livestock_sale_deferred", amountGross: 3765, vatRate: 25.5 });
      await savePriorAsset(tx, actor(), a.client, {
        description: "Koneet ja kalusto", ratePct: 0, agriChoice: "agri_machinery", balanceYear: 2024, acquiredOn: null, acquisitionCost: 100000,
        accumulatedDepreciation: 60000, forestPropertyId: null,
      });
      await saveAgriDepreciations(tx, actor(), a.client, 2025, { agri_machinery: 10000 });
      await addReserve(tx, actor(), a.client, { kind: "equalization", madeYear: 2025, amount: 3000, farmId: null, note: null });
      await addDeferral(tx, actor(), a.client, { year: 2024, kind: "livestock_sale", amount: 1500, split: null, note: null });
      await saveAgriYear(tx, actor(), a.client, 2025, { ...EMPTY_AGRI_YEAR, liabilities: 50000 });
    });
    const f = (await asStaff((tx) => loadForm2(tx, a.client, 2025)))!;
    expect(f.errors).toEqual([]);
    expect(f.fields).toMatchObject({
      "214": 20000, "217": 15000, "211": 3000, "212": 1500, "226": 1100.08, "230": 3500, "231": 10000, "232": 3000, "172": 3000,
      "260": 40000, "511": 10000, "265": 30000, "467": 30000, "731": 30000, "732": 50000, "736": 20000,
    });
    expect(f.fields["332"]).toBe(20000 + 15000 + 1500);
    expect(f.fields["357"]).toBe(17600.08);
    expect(f.result).toBe(18899.92);
  });

  it("veroraportissa on maatalousosa, ja pelkän maatalousasiakkaan raportista puuttuvat metsän osat", async () => {
    const data = (await asStaff((tx) => loadReportData(tx, a.id, a.client, 2025)))!;
    expect(data.agri?.form2.fields["214"]).toBe(20000);
    expect(data.agri?.categories.find((c) => c.label === "MYEL-maksut")?.net).toBe(3500);
    const both = await PDFDocument.load(await renderTaxReport(data));
    const onlyAgri = await PDFDocument.load(await renderTaxReport({ ...data, client: { ...data.client, hasForestry: false } }));
    expect(onlyAgri.getPageCount()).toBeLessThan(both.getPageCount());
    // Pelkkä metsäasiakas: ei maatalousosaa.
    const forestOnly = await PDFDocument.load(await renderTaxReport({ ...data, agri: null, client: { ...data.client, hasAgriculture: false } }));
    expect(forestOnly.getPageCount()).toBeLessThan(both.getPageCount());
  });
});
