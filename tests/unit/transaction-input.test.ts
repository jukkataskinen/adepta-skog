import { describe, expect, it } from "vitest";
import {
  applyPaste,
  emptyBatchRow,
  normalizeDate,
  parseAmount,
  parseClipboard,
  previewRow,
  resolveCategory,
  transactionFieldsSchema,
  validateBatch,
  validateBatchRow,
  INVESTMENT_HINT,
  type BatchRowInput,
} from "@/lib/ledger/transaction-input";

const PROP = "11111111-1111-4111-8111-111111111111";
const opts = { year: 2025, propertyIds: [PROP] };
const row = (over: Partial<BatchRowInput>): BatchRowInput => ({ ...emptyBatchRow("k1"), ...over });

describe("summat ja päivät", () => {
  it("suomalainen summa", () => {
    expect(parseAmount("1 234,56")).toBe(1234.56);
    expect(parseAmount("1.234,56 €")).toBe(1234.56);
    expect(parseAmount("25,5 %")).toBe(25.5);
    expect(parseAmount("-12,00")).toBe(-12);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNaN();
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
  it("lomakkeen kentät: tyhjä verokanta jää tyhjäksi, suomalainen päivä muunnetaan", () => {
    const r = transactionFieldsSchema.parse({ bookedOn: "15.6.2025", category: "standing_sale", amountNet: "1 000,50", vatRate: "", withholding: "" });
    expect(r).toMatchObject({ bookedOn: "2025-06-15", amountNet: 1000.5, vatRate: null, withholding: null, reference: null, description: "" });
  });
});

describe("taulukon rivin tarkistus", () => {
  it("kelvollinen rivi saa luokan oletusverokannan päivän mukaan", () => {
    const a = validateBatchRow(row({ bookedOn: "1.8.2024", category: "other_expense", amountNet: "100" }), { ...opts, year: 2024 });
    const b = validateBatchRow(row({ bookedOn: "1.9.2024", category: "other_expense", amountNet: "100" }), { ...opts, year: 2024 });
    expect(a.ok && a.value.vatRate).toBe(24);
    expect(b.ok && b.value).toMatchObject({ vatRate: 25.5, kind: "expense", withholding: 0 });
  });

  it("annettu verokanta ja tila säilyvät", () => {
    const r = validateBatchRow(
      row({ bookedOn: "2.5.", category: "standing_sale", amountNet: "5000", vatRate: "0", withholding: "1 500", forestPropertyId: PROP }),
      opts,
    );
    expect(r.ok && r.value).toMatchObject({ bookedOn: "2025-05-02", vatRate: 0, withholding: 1500, forestPropertyId: PROP, kind: "income" });
  });

  it("virheet kentittäin", () => {
    const r = validateBatchRow(row({ bookedOn: "31.2.2025", category: "", amountNet: "x", vatRate: "120" }), opts);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual({ bookedOn: "Tarkista päivä.", category: "Valitse luokka.", amountNet: "Tarkista summa.", vatRate: "Tarkista verokanta." });
    }
  });

  it("puuttuva summa", () => {
    const r = validateBatchRow(row({ bookedOn: "1.1.2025", category: "travel" }), opts);
    expect(!r.ok && r.errors.amountNet).toBe("Anna summa ilman arvonlisäveroa.");
  });

  it("päivän on oltava taulukon vuonna", () => {
    const r = validateBatchRow(row({ bookedOn: "1.1.2024", category: "travel", amountNet: "10" }), opts);
    expect(!r.ok && r.errors.bookedOn).toBe("Päivän on oltava vuonna 2025.");
  });

  it("investoinnit eivät käy taulukossa", () => {
    for (const c of ["asset_purchase", "asset_sale"]) {
      const r = validateBatchRow(row({ bookedOn: "1.1.2025", category: c, amountNet: "5000" }), opts);
      expect(!r.ok && r.errors.category).toBe(INVESTMENT_HINT);
    }
  });

  it("toisen asiakkaan metsätila hylätään", () => {
    const r = validateBatchRow(
      row({ bookedOn: "1.1.2025", category: "travel", amountNet: "10", forestPropertyId: "22222222-2222-4222-8222-222222222222" }),
      opts,
    );
    expect(!r.ok && r.errors.forestPropertyId).toBe("Valitse asiakkaan metsätila.");
  });

  it("koko taulukko: tyhjät rivit ohitetaan, virheet rivin avaimella", () => {
    const res = validateBatch(
      [
        { ...row({ bookedOn: "1.1.2025", category: "travel", amountNet: "10" }), key: "a" },
        emptyBatchRow("b"),
        { ...row({ bookedOn: "1.1.2025", category: "travel" }), key: "c" },
      ],
      opts,
    );
    expect(res.valid.map((v) => v.key)).toEqual(["a"]);
    expect(Object.keys(res.rowErrors)).toEqual(["c"]);
    expect(res.hasErrors).toBe(true);
  });

  it("esikatselu laskee verollisen summan oletuskannalla", () => {
    expect(previewRow(row({ bookedOn: "1.1.2025", category: "other_expense", amountNet: "100" }), 2025)).toEqual({ defaultVat: 25.5, gross: 125.5 });
    expect(previewRow(row({ category: "forestry_subsidy", amountNet: "100" }), 2025)).toEqual({ defaultVat: 0, gross: 100 });
    expect(previewRow(row({ amountNet: "100" }), 2025).gross).toBeNull();
  });
});

describe("liittäminen Excelistä", () => {
  let n = 0;
  const pasteOpts = { year: 2025, properties: [{ id: PROP, name: "Kotimetsä" }], newKey: () => `n${n++}` };

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

  it("rivit taulukkoon: otsikkorivi ohitetaan, päivä, luokka ja tila tulkitaan, rivejä lisätään", () => {
    const text = [
      "Päivä\tLuokka\tSelite\tSumma\tAlv\tEnnakko\tViite\tTila",
      "2025-03-01\tPystykauppa\tLeimikko 1\t12 000,00\t25,5\t\tL-1\tKotimetsä",
      "15.4.2025\tMatkakulut\tAjot\t120,50\t\t\t\t",
    ].join("\n");
    const out = applyPaste([emptyBatchRow("r0", "1.1.2025")], 0, 0, parseClipboard(text), pasteOpts);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      key: "r0", bookedOn: "1.3.2025", category: "standing_sale", description: "Leimikko 1", amountNet: "12 000,00", vatRate: "25,5", reference: "L-1",
      forestPropertyId: PROP,
    });
    expect(out[1]).toMatchObject({ bookedOn: "15.4.2025", category: "travel", amountNet: "120,50" });
    expect(validateBatch(out, opts).hasErrors).toBe(false);
  });

  it("liitos keskelle alkaa valitusta sarakkeesta, tuntematon luokka jää näkyviin", () => {
    const rows = [emptyBatchRow("r0", "1.1.2025"), emptyBatchRow("r1", "1.1.2025")];
    const out = applyPaste(rows, 1, 1, parseClipboard("Tuntematon\tSelite\t50"), pasteOpts);
    expect(out[0]).toEqual(rows[0]);
    expect(out[1]).toMatchObject({ bookedOn: "1.1.2025", category: "Tuntematon", description: "Selite", amountNet: "50" });
    expect(validateBatch(out, opts).rowErrors.r1.category).toBe("Valitse luokka.");
  });
});
