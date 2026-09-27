import { describe, expect, it } from "vitest";
import { compareFigures, legacyFigures, type NewFigures } from "@/lib/compare/legacy-tax";
import type { LegacyAsset, LegacyTransaction } from "@/lib/import/legacy";

const tx = (p: Partial<LegacyTransaction>): LegacyTransaction => ({
  id: "t", asiakas_id: "a", tyyppi: "tulo", kuvaus: null, paivamaara: "2025-06-01", summa_alv0: 0, alv_prosentti: 0,
  kategoria: null, ennakko: 0, viite: null, verovuosi: 2025, ...p,
});
const asset = (p: Partial<LegacyAsset>): LegacyAsset => ({
  id: "i1", asiakas_id: "a", kuvaus: null, hankintapvm: "2024-01-01", hankintahinta: 20000, jaannosarvo: 0,
  poistoaika_vuotta: null, poistotapa: "menojaannos", aktiivinen: true, ...p,
});

const base = legacyFigures({
  year: 2025,
  transactions: [
    tx({ tyyppi: "tulo", summa_alv0: 40000, alv_prosentti: 25.5, ennakko: 1000 }),
    tx({ tyyppi: "meno", summa_alv0: 2000, alv_prosentti: 25.5 }),
    tx({ tyyppi: "investointi", summa_alv0: 20000, alv_prosentti: 25.5, kategoria: "Käyttöomaisuuden hankinta" }),
    tx({ tyyppi: "tulo", summa_alv0: 999, verovuosi: 2024 }),
  ],
  assets: [asset({}), asset({ id: "i2", aktiivinen: false })],
  deductions: [{ metsatila_id: "m", verovuosi: 2025, kaytettava_vahennys: 3000 }],
  depreciations: [{ investointi_id: "i1", verovuosi: 2025, poistomaara: 5000, jaannosarvo_vuoden_lopussa: 15000 }],
});

describe("vanhan veroraportin laskenta", () => {
  it("laskee yhteenvedon kuten vanha sivu", () => {
    // Poisto 25 % hankintahinnasta, vain aktiivisista. Investointi ei ole meno.
    expect(base).toMatchObject({
      income: 40000, expense: 2000, depreciation: 5000, forestDeduction: 3000, taxable: 30000, tax: 9000,
      withholding: 1000, vatOutput: 10200, vatInput: 510, investmentVat: 5100, depreciationRecorded: 5000, transactionCount: 3,
    });
  });

  it("vero ylittää 30 000 euron rajan 34 prosentilla", () => {
    const f = legacyFigures({ year: 2025, transactions: [tx({ summa_alv0: 40000 })], assets: [], deductions: [], depreciations: [] });
    expect(f.tax).toBe(12400);
  });
});

describe("vertailu", () => {
  const current: NewFigures = {
    income: 40000, expense: 2000, depreciation: 5000, forestDeduction: 3000, taxable: 30000, tax: 9000, withholding: 1000,
    vatOutput: 10200, vatInput: 5610, saleGain: 0, saleLoss: 0, linkedAssetSales: 0, transactionCount: 3, confirmed: true,
  };

  it("investointien alv on tunnettu ero", () => {
    const c = compareFigures(base, current);
    expect(c.differing.map((r) => r.key)).toEqual(["vatInput"]);
    expect(c.unexplained).toEqual([]);
  });

  it("vahvistetut poistot selittävät poistoeron ja verotettavan tulon", () => {
    const legacy = { ...base, depreciation: 6000, taxable: 29000, tax: 8700 };
    const c = compareFigures(legacy, current);
    expect(c.unexplained).toEqual([]);
    expect(c.explanations.join(" ")).toContain("vahvistettuja poistoja");
  });

  it("puuttuva kirjaus jää selittämättä", () => {
    const c = compareFigures(base, { ...current, income: 39000, taxable: 29000, tax: 8700, transactionCount: 2 });
    expect(c.unexplained).toEqual(["income", "taxable", "tax"]);
    expect(c.explanations[0]).toContain("eri määrä");
  });
});
