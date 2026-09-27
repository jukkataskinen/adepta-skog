import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { ReportData } from "@/lib/reports/data";
import { renderTaxReport } from "@/lib/reports/pdf";
import { computePlan } from "@/lib/tax/plan";
import { vatSummary } from "@/lib/tax/vat";

function sample(status: "open" | "closed", transactions = 3): ReportData {
  const tx = Array.from({ length: transactions }, (_, i) => ({
    bookedOn: `2025-0${(i % 9) + 1}-15`, kind: "income" as const, category: "Pystykauppa", description: `Leimikko ${i} – kuusikko`, net: 1000 + i, vatRate: 25.5, gross: 1255 + i, withholding: 0,
  }));
  return {
    year: 2025,
    status,
    closedAt: status === "closed" ? "2026-02-01T10:00:00Z" : null,
    generatedAt: "2026-02-01T10:00:00Z",
    office: { name: "Demometsä Tilitoimisto Oy", businessId: "1234567-1", email: "toimisto@example.test", phone: null, address: "Tie 1, 99990 Demola" },
    client: { name: "Aino Esimerkki", businessId: null, address: "Metsätie 2, 99990 Demola", municipality: "Demola", vatRegistered: true },
    categories: [{ label: "Pystykauppa", kind: "income", net: 42000, vat: 10710, gross: 52710 }],
    transactions: tx,
    vat: vatSummary([{ bookedOn: "2025-06-15", kind: "income", amountNet: 42000, vatRate: 25.5 }]),
    plan: { income: 42000, expense: 340, deliveryWork: 0, investment: 0, withholding: 0, assets: [], properties: [], deductionPool: null, forestSales: [], recordedDeduction: 0, confirmed: false },
    result: computePlan({ year: 2025, income: 42000, expense: 340, depreciation: 0, saleGain: 0, saleLoss: 0, salePrices: 0, forestDeduction: 0 }),
    depreciation: [{ description: "Metsätraktori", method: "Menojäännöspoisto", bookValueStart: 22500, amount: 5625, bookValueEnd: 16875, transferred: 0, sold: false, salePrice: 0, saleGain: 0, saleLoss: 0 }],
    properties: [{ name: "Kotimetsä", remainingBefore: 57600, deduction: 0 }],
    confirmed: false,
  };
}

describe("veroraportti PDF:nä", () => {
  it("kansilehti ja viisi osaa", async () => {
    const bytes = await renderTaxReport(sample("closed"));
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(7);
    expect(doc.getTitle()).toBe("Veroraportti 2025");
  });

  it("pitkä kirjausluettelo jatkuu seuraavalle sivulle", async () => {
    const doc = await PDFDocument.load(await renderTaxReport(sample("open", 120)));
    expect(doc.getPageCount()).toBeGreaterThan(7);
  });

  it("metsätilan osan myynti ja tien siirtyvä arvo mahtuvat raporttiin", async () => {
    const s = sample("open");
    s.plan.forestSales = [
      {
        id: "d1", propertyId: "p1", name: "Kotimetsä", year: 2025, disposedOn: "2025-08-15", salePrice: 40000, sharePct: 25, acquisitionCost: 30000,
        roadDitchCost: 2125, sellingCosts: 1500, deemedCost: 8000, deemedPct: 20, usesDeemedCost: false, cost: 33625, addition: 3000, gain: 9375,
      },
    ];
    s.depreciation = [{ ...s.depreciation[0], description: "Metsätie", transferred: 2125 }];
    const doc = await PDFDocument.load(await renderTaxReport(s));
    expect(doc.getPageCount()).toBe(7);
  });

  it("merkit, joita vakiofontti ei tunne, eivät kaada raporttia", async () => {
    const s = sample("open");
    s.client.name = "Ōkami 名前 Ääkkönen";
    await expect(renderTaxReport(s)).resolves.toBeInstanceOf(Uint8Array);
  });
});
