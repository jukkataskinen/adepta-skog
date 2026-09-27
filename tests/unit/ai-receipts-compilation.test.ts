import { describe, expect, it } from "vitest";
import {
  cleanPages,
  documentHref,
  isCompilation,
  isPaymentLike,
  pageLabel,
  parsePagesColumn,
  parseStoredLines,
  sourceDocumentLabel,
  validateRecognition,
} from "@/lib/ai/receipts/schema";
import { duplicateWarnings, normalizeNumber, type DuplicateCandidate } from "@/lib/ai/receipts/duplicates";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { rowsFromSuggestion, withDuplicateWarnings } from "@/lib/ledger/grid";

/**
 * Kokoomatiedosto, puukaupan vuosi-ilmoitus, maksutiedot ja päällekkäisyys
 * (DECISIONS 28.9.2026). Kaikki kuvitteellista aineistoa.
 */

const base = {
  document_index: 1,
  source_document: "Lasku 1182, Metsäpalvelu",
  document_type: "invoice",
  pages: [3],
  contract_number: null,
  invoice_number: "1182",
  document_total: 1882.5,
  date: "2025-05-14",
  description: "Metsäpalvelu, taimet",
  amount_gross: 1882.5,
  vat_rate: 25.5,
  category: "other_expense",
  withholding: 0,
  confidence: 0.8,
  reasoning: "Laskun loppusumma.",
};
const line = (over: Record<string, unknown> = {}) => ({ ...base, ...over });

describe("tarkistus: sivut, laji ja lähdeasiakirja", () => {
  it("sivut siivotaan ja laji säilyy", () => {
    const res = validateRecognition({ lines: [line({ pages: [4, 3, 3, 0, -1, 5000] })] });
    expect(res.ok && res.lines[0]).toMatchObject({ pages: [3, 4], documentType: "invoice", documentIndex: 1, sourceDocument: "Lasku 1182, Metsäpalvelu", invoiceNumber: "1182" });
  });

  it("tuntematon laji on epäonnistuminen, virheellinen järjestysnumero on 1", () => {
    expect(validateRecognition({ lines: [line({ document_type: "lasku" })] })).toEqual({ ok: false });
    const res = validateRecognition({ lines: [line({ document_index: 0 })] });
    expect(res.ok && res.lines[0].documentIndex).toBe(1);
  });

  it("tilinumeron näköistä laskunumeroa ei tallenneta", () => {
    const res = validateRecognition({ lines: [line({ invoice_number: "FI21 1234 5600 0007 85" })] });
    expect(res.ok && res.lines[0].invoiceNumber).toBeNull();
  });

  it("vanhat tallennetut rivit saavat oletukset", () => {
    const old = { date: "2025-01-02", description: "x", category: "other_expense", amountGross: 10, vatRate: 0, withholding: 0, confidence: 0.5, reasoning: "r" };
    expect(parseStoredLines([old])).toEqual([{ ...old, documentIndex: 1, sourceDocument: "", documentType: "other", pages: [], contractNumber: null, invoiceNumber: null }]);
  });

  it("sivumerkinnät ja osoite", () => {
    expect(pageLabel([3])).toBe("s. 3");
    expect(pageLabel([3, 4, 5])).toBe("s. 3–5");
    expect(pageLabel([1, 3, 4])).toBe("s. 1, 3–4");
    expect(pageLabel([])).toBe("");
    expect(sourceDocumentLabel([3])).toBe("Tosite (s. 3)");
    expect(documentHref("c", "d", [3, 4])).toBe("/asiakkaat/c/tositteet/d#page=3");
    expect(documentHref("c", "d", [])).toBe("/asiakkaat/c/tositteet/d");
    expect(parsePagesColumn("{3,4}")).toEqual([3, 4]);
    expect(parsePagesColumn([2, 1])).toEqual([1, 2]);
    expect(parsePagesColumn(null)).toEqual([]);
    expect(cleanPages("3")).toEqual([]);
  });
});

describe("tarkistus: maksutiedot eivät ole kuluja", () => {
  it("tilisiirtolomakkeen rivi samalla summalla poistetaan", () => {
    const res = validateRecognition({
      lines: [line(), line({ pages: [4], description: "Tilisiirto, maksettava yhteensä", confidence: 0.3 })],
    });
    expect(res.ok && res.lines.map((l) => l.description)).toEqual(["Metsäpalvelu, taimet"]);
  });

  it("maksurivi, joka on muiden rivien summa, poistetaan", () => {
    const res = validateRecognition({
      lines: [
        line({ description: "Taimet", amount_gross: 1500, document_total: null }),
        line({ description: "Istutustyö", amount_gross: 382.5, document_total: null }),
        line({ description: "Eräpäivä 30.5., viitenumero", amount_gross: 1882.5, document_total: null }),
      ],
    });
    expect(res.ok && res.lines.map((l) => l.description)).toEqual(["Taimet", "Istutustyö"]);
  });

  it("asiakirjan ainoaa riviä ei poisteta, eikä toisen asiakirjan riviä verrata", () => {
    const only = validateRecognition({ lines: [line({ description: "Tilisiirto, Metsäpalvelu" })] });
    expect(only.ok && only.lines).toHaveLength(1);
    const two = validateRecognition({ lines: [line(), line({ document_index: 2, invoice_number: null, description: "Maksettava yhteensä, toinen lasku" })] });
    expect(two.ok && two.lines).toHaveLength(2);
  });

  it("menekinedistämismaksu ja metsänhoitomaksu ovat kuluja eivätkä maksutietoja", () => {
    expect(isPaymentLike("Esimerkkipuu, menekinedistämismaksu")).toBe(false);
    expect(isPaymentLike("Metsänhoitomaksu")).toBe(false);
    expect(isPaymentLike("Viitenumero 12345")).toBe(true);
    const res = validateRecognition({
      lines: [
        line({ document_type: "timber_annual_summary", invoice_number: null, document_total: null, category: "standing_sale", amount_gross: 36.8, description: "Pystykauppa" }),
        line({ document_type: "timber_annual_summary", invoice_number: null, document_total: null, amount_gross: 36.8, vat_rate: 0, description: "Menekinedistämismaksu" }),
      ],
    });
    expect(res.ok && res.lines).toHaveLength(2);
  });

  it("sama lasku kahdesti eri asiakirjana: jälkimmäinen pois", () => {
    const res = validateRecognition({ lines: [line(), line({ document_index: 2, pages: [5] })] });
    expect(res.ok && res.lines.map((l) => l.pages)).toEqual([[3]]);
  });
});

describe("testitilan kokoomatiedosto", () => {
  it("vuosi-ilmoitus ja lasku, maksurivi poistuu", async () => {
    const res = await mockRecognizer().recognize({ bytes: Buffer.from("x"), contentType: "application/pdf", fileName: "kokooma 2025.pdf" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines.map((l) => [l.documentIndex, l.documentType, l.category, l.amountGross, l.pages, l.contractNumber])).toEqual([
      [1, "timber_annual_summary", "standing_sale", 23092, [1, 2], "10432"],
      [1, "timber_annual_summary", "other_expense", 36.8, [1, 2], "10432"],
      [1, "timber_annual_summary", "delivery_sale", 7781, [1, 2], "11875"],
      [2, "invoice", "other_expense", 1882.5, [3], null],
    ]);
    expect(res.lines[0]).toMatchObject({ date: "2025-12-31", withholding: 5520 });
    expect(isCompilation(res.lines)).toBe(true);
    expect(isCompilation(res.lines.slice(0, 2))).toBe(false);
  });
});

describe("ehdotusrivit: vuosi-ilmoitus ja viite", () => {
  const suggestion = {
    id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    file_name: "skannaus.pdf",
    model: "mock",
    lines: [
      {
        date: null, description: "Esimerkkipuu, pystykauppa", category: "standing_sale", amountGross: 23092, vatRate: 25.5, withholding: 5520, confidence: 0.6, reasoning: "r",
        documentIndex: 1, sourceDocument: "Vuosi-ilmoitus", documentType: "timber_annual_summary" as const, pages: [1, 2], contractNumber: "10432", invoiceNumber: null,
      },
      {
        date: "2025-05-14", description: "Metsäpalvelu, taimet", category: "other_expense", amountGross: 1882.5, vatRate: 25.5, withholding: 0, confidence: 0.8, reasoning: "r",
        documentIndex: 2, sourceDocument: "Lasku 1182", documentType: "invoice" as const, pages: [3], contractNumber: null, invoiceNumber: "1182",
      },
    ],
  };

  it("vuosi-ilmoitus ilman päivää saa vuoden viimeisen päivän, numero tulee viitteeksi", () => {
    const rows = rowsFromSuggestion(suggestion, { vatRegistered: true, defaultDate: "1.6.2025", year: 2025 });
    expect(rows.map((r) => [r.bookedOn, r.reference, r.suggestionLine, r.suggestion?.pages, r.suggestion?.compilation])).toEqual([
      ["31.12.2025", "Sopimus 10432", 0, [1, 2], true],
      ["14.5.2025", "Lasku 1182", 1, [3], true],
    ]);
  });

  it("päällekkäisyys: sopimusnumero kirjauksen viitteessä, summa ja luokka, toinen ehdotus", () => {
    const rows = rowsFromSuggestion(suggestion, { vatRegistered: true, defaultDate: "1.6.2025", year: 2025 });
    const stored = [
      { booked_on: "2025-03-15", category: "standing_sale", amount_gross: "12000.00", description: "Esimerkkipuu, tilitys", reference: "Sopimus 10 432" },
      { booked_on: "2025-05-20", category: "other_expense", amount_gross: "1882.00", description: "Taimia", reference: null },
    ];
    const [a, b] = withDuplicateWarnings(rows, stored);
    expect(a.suggestion?.duplicateWarning).toBe("Mahdollinen päällekkäisyys: kirjaus 15.3.2025 Esimerkkipuu, tilitys (sama sopimusnumero).");
    expect(b.suggestion?.duplicateWarning).toBe("Mahdollinen päällekkäisyys: kirjaus 20.5.2025 Taimia (sama luokka ja summa).");
    const none = withDuplicateWarnings(rows, []);
    expect(none.every((r) => !r.suggestion?.duplicateWarning)).toBe(true);
  });
});

describe("päällekkäisyys puhtaana funktiona", () => {
  const c = (over: Partial<DuplicateCandidate>): DuplicateCandidate => ({
    key: "k", group: "s1:1", category: "standing_sale", amountGross: 23092, contractNumber: null, invoiceNumber: null, label: "Vuosi-ilmoitus: pystykauppa", ...over,
  });

  it("toisen asiakirjan ehdotus samalla sopimusnumerolla, saman asiakirjan rivejä ei verrata", () => {
    const w = duplicateWarnings(
      [
        c({ key: "a", contractNumber: "10432" }),
        c({ key: "b", group: "s2:1", contractNumber: "10-432", amountGross: 5000, label: "Tilitys: pystykauppa" }),
        c({ key: "c", category: "other_expense", amountGross: 23092 }),
      ],
      [],
    );
    expect(w.get("a")).toBe("Mahdollinen päällekkäisyys: ehdotus Tilitys: pystykauppa (sama sopimusnumero).");
    expect(w.get("b")).toMatch(/sama sopimusnumero/);
    expect(w.has("c")).toBe(false);
  });

  it("laskunumero selitteessä, summan raja euro, useampi osuma", () => {
    const existing = [
      { bookedOn: "2025-05-14", category: "travel", amountGross: 10, description: "Lasku 1182 taimet", reference: null },
      { bookedOn: "2025-06-01", category: "other_expense", amountGross: 1883.5, description: "Muu", reference: null },
      { bookedOn: "2025-06-02", category: "other_expense", amountGross: 1883.6, description: "Kaukana", reference: null },
    ];
    const w = duplicateWarnings([c({ category: "other_expense", amountGross: 1882.5, invoiceNumber: "1182" })], existing);
    expect(w.get("k")).toBe("Mahdollinen päällekkäisyys: kirjaus 14.5.2025 Lasku 1182 taimet (sama laskunumero) ja 1 muu.");
  });

  it("lyhyt numero ei osu sattumalta", () => {
    expect(normalizeNumber(" 10-432 ")).toBe("10432");
    const w = duplicateWarnings([c({ contractNumber: "12", amountGross: 1 })], [{ bookedOn: "2025-01-01", category: "travel", amountGross: 99, description: "Matka 12 km", reference: null }]);
    expect(w.size).toBe(0);
  });
});
