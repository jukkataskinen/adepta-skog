import { describe, expect, it } from "vitest";
import {
  effectiveKind,
  effectiveVatRate,
  normalizeDate,
  parseAmount,
  parseClipboard,
  resolveCategory,
  transactionFieldsSchema,
} from "@/lib/ledger/transaction-input";

describe("summat ja päivät", () => {
  it("suomalainen summa", () => {
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(parseAmount("1.234,56 €")).toBe(1234.56);
    expect(parseAmount("25,5 %")).toBe(25.5);
    expect(parseAmount("-12,00")).toBe(-12);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
    // Selaimen fi-FI-muotoilu käyttää sitovaa välilyöntiä ja miinusmerkkiä.
    expect(parseAmount((-1234.5).toLocaleString("fi-FI", { minimumFractionDigits: 2 }))).toBe(-1234.5);
  });

  it("päivä kahdessa muodossa ja vuosi taulukosta", () => {
    expect(normalizeDate("2025-03-01")).toBe("2025-03-01");
    expect(normalizeDate("1.3.2025")).toBe("2025-03-01");
    expect(normalizeDate("01.03.2025")).toBe("2025-03-01");
    expect(normalizeDate("1.3.", 2025)).toBe("2025-03-01");
    expect(normalizeDate("1.3")).toBeNull();
    expect(normalizeDate("30.2.2025")).toBeNull();
    expect(normalizeDate("2025-13-01")).toBeNull();
  });
});

describe("yhteinen skeema", () => {
  it("lomakkeen kentät: summa arvonlisäveron kanssa, tyhjä verokanta jää tyhjäksi, suomalainen päivä muunnetaan", () => {
    const r = transactionFieldsSchema.parse({ bookedOn: "15.6.2025", category: "standing_sale", amountGross: "1 000,50", vatRate: "", withholding: "" });
    expect(r).toMatchObject({ bookedOn: "2025-06-15", amountGross: 1000.5, vatRate: null, withholding: null, reference: null, description: "", kind: null });
  });

  it("puuttuva summa", () => {
    const r = transactionFieldsSchema.safeParse({ bookedOn: "15.6.2025", category: "travel", amountGross: "" });
    expect(!r.success && r.error.issues[0].message).toBe("Anna summa (sis. alv).");
  });

  it("oletusverokanta riippuu asiakkaan arvonlisäverorekisteröinnistä", () => {
    const input = { category: "other_expense", bookedOn: "2025-03-01", vatRate: null };
    expect(effectiveVatRate(input, { vatRegistered: true })).toBe(25.5);
    expect(effectiveVatRate(input, { vatRegistered: false })).toBe(0);
    // Annettu kanta säilyy aina.
    expect(effectiveVatRate({ ...input, vatRate: 14 }, { vatRegistered: false })).toBe(14);
  });

  it("tyyppi: investoinnit luokasta, muut voi kääntää", () => {
    expect(effectiveKind("standing_sale", null)).toBe("income");
    expect(effectiveKind("standing_sale", "expense")).toBe("expense");
    expect(effectiveKind("asset_purchase", "income")).toBe("investment");
    expect(effectiveKind("asset_sale", "expense")).toBe("income");
  });
});

describe("liittäminen Excelistä", () => {
  it("sarkaimet ja rivinvaihdot", () => {
    expect(parseClipboard("a\tb\r\nc\td\r\n\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("luokka nimestä tai tunnuksesta", () => {
    expect(resolveCategory("pystykauppa")).toBe("standing_sale");
    expect(resolveCategory("Muut vuosimenot")).toBe("other_expense");
    expect(resolveCategory("travel")).toBe("travel");
    expect(resolveCategory("Jotain muuta")).toBeNull();
  });
});
