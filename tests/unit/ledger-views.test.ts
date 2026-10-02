import { describe, expect, it } from "vitest";
import { categoryDigit, emptyGridRow, inView, menuCategories, validateGridRow, viewMessage } from "@/lib/ledger/grid";
import { FORESTRY_CATEGORIES, ledgerView, viewCategories } from "@/lib/tax/rules";
import { RECEIPT_SYSTEM_PROMPT, chunkInstruction, receiptSystemPrompt } from "@/lib/ai/receipts/anthropic";
import { recognitionOutputSchema, recognitionOutputSchemaFor, validateLines, validateRecognition, type SuggestionLine } from "@/lib/ai/receipts/schema";
import { splitByActivity } from "@/lib/documents/receipt-suggestions";

/** Kirjanpito toiminnoittain ja maatalouden tunnistus: puhdas logiikka (DECISIONS 2.10.2026). */

const both = { hasForestry: true, hasAgriculture: true };
const forestOnly = { hasForestry: true, hasAgriculture: false };

describe("näkymän luokat", () => {
  it("pelkkä metsäasiakas näkee metsätalouden luokat kuten ennen", () => {
    expect(ledgerView(forestOnly, "maatalous")).toBeNull();
    expect(menuCategories(forestOnly, null)).toEqual(FORESTRY_CATEGORIES);
  });

  it("rajattu näkymä tarjoaa vain oman toimintonsa luokat", () => {
    expect(viewCategories(both, "agriculture").every((c) => c.code.startsWith("agri_"))).toBe(true);
    expect(viewCategories(both, "forestry")).toEqual(FORESTRY_CATEGORIES);
    const agriNos = menuCategories(both, "agriculture").map((c) => c.no);
    // Maatalouden numerot ovat kaksinumeroisia: 2 odottaa toista numeroa, 24 valitsee maidon.
    expect(categoryDigit("", "2", agriNos)).toMatchObject({ select: null });
    expect(categoryDigit("2", "4", agriNos)).toMatchObject({ select: 24 });
  });

  it("rivi kuuluu näkymään luokkansa mukaan", () => {
    expect(inView("agri_feed", "agriculture")).toBe(true);
    expect(inView("standing_sale", "agriculture")).toBe(false);
    expect(inView("agri_feed", null)).toBe(true);
  });

  it("taulukon tarkistus hylkää toisen toiminnon luokan rajatussa näkymässä", () => {
    const opts = { year: 2025, propertyIds: [], vatRegistered: true, saleableAssetIds: () => [], activities: ["forestry", "agriculture"] as const };
    const row = { ...emptyGridRow("r", "1.3.2025"), category: "standing_sale", amountGross: "1000", vatRate: "25,5" };
    expect(validateGridRow(row, { ...opts, activities: [...opts.activities], view: "agriculture" })).toEqual({ ok: false, errors: { category: viewMessage("agriculture") } });
    expect(validateGridRow(row, { ...opts, activities: [...opts.activities], view: "forestry" }).ok).toBe(true);
  });
});

describe("tunnistus maataloudelle", () => {
  it("pelkän metsäasiakkaan ohje ja skeema ovat ennallaan", () => {
    expect(receiptSystemPrompt(["forestry"])).toBe(RECEIPT_SYSTEM_PROMPT);
    expect(recognitionOutputSchemaFor(["forestry"])).toBe(recognitionOutputSchema);
    expect(chunkInstruction()).toBe("Tunnista tämän tiedoston kaikki asiakirjat ja niiden kirjausehdotukset.");
  });

  it("maatalouden ohjeessa ovat tyypilliset tositteet ja alv-kannat, eikä asiakkaan tietoja", () => {
    const p = receiptSystemPrompt(["forestry", "agriculture"]);
    for (const word of ["meijeritilitys", "teurastamo", "Ruokavirasto", "ELY-keskus", "MYEL", "agri_fertilizers", "14 % in 2025", "13.5 % from 1 January 2026", "25.5 %", "standing_sale"]) {
      expect(p).toContain(word);
    }
    expect(receiptSystemPrompt(["agriculture"])).not.toContain("standing_sale");
    expect(chunkInstruction(undefined, { activities: ["forestry", "agriculture"], defaultActivity: "agriculture" })).toMatch(/^Oletustoiminto on maatalous/);
  });

  const line = (category: string, extra: Record<string, unknown> = {}) => ({
    document_index: 1, source_document: "Maitotilitys", document_type: "dairy_settlement", pages: [1], contract_number: null, invoice_number: null, document_total: null,
    date: "2026-02-15", description: "Meijeri, maito", amount_gross: 1135, vat_rate: 13.5, category, withholding: 0, confidence: 0.8, reasoning: "testi", ...extra,
  });

  it("maatalouden luokka ja asiakirjalaji hyväksytään vain maatalousasiakkaalle", () => {
    expect(validateLines({ lines: [line("agri_livestock_products")] }, ["forestry"])).toBeNull();
    const res = validateRecognition({ lines: [line("agri_livestock_products")] }, ["forestry", "agriculture"]);
    expect(res).toMatchObject({ ok: true, lines: [{ category: "agri_livestock_products", vatRate: 13.5, documentType: "dairy_settlement" }] });
  });

  it("ennakonpidätys hyväksytään vain puukaupan riville myös maatalousasiakkaalla", () => {
    const res = validateRecognition({ lines: [line("agri_crops", { withholding: 100 })] }, ["forestry", "agriculture"]);
    expect(res.ok && res.lines[0].withholding).toBe(0);
  });

  it("ehdotus jaetaan toiminnoittain oletustoiminto ensin", () => {
    const l = (category: string) => ({ category }) as SuggestionLine;
    const lines = [l("other_expense"), l("agri_feed"), l("agri_myel")];
    expect(splitByActivity(lines, "agriculture").map((g) => [g.activity, g.lines.length])).toEqual([["agriculture", 2], ["forestry", 1]]);
    expect(splitByActivity(lines, "forestry").map((g) => g.activity)).toEqual(["forestry", "agriculture"]);
    expect(splitByActivity([l("agri_feed")], "forestry").map((g) => g.activity)).toEqual(["agriculture"]);
  });
});
