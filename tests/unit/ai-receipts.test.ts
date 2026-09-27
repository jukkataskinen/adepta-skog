import { afterEach, describe, expect, it, vi } from "vitest";
import { validateRecognition, parseStoredLines } from "@/lib/ai/receipts/schema";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { anthropicRecognizer, RECEIPT_SYSTEM_PROMPT, type MessagesClient } from "@/lib/ai/receipts/anthropic";
import { receiptRecognizer, recognizeReceipt, type ReceiptRecognizer } from "@/lib/ai/receipts";
import { rowsFromSuggestion, suggestionDateWarning } from "@/lib/ledger/grid";

const line = (over: Record<string, unknown> = {}) => ({
  document_index: 1,
  source_document: "Puukaupan tilitys, Metsä Oy",
  document_type: "timber_settlement",
  pages: [1],
  contract_number: "10432",
  invoice_number: null,
  document_total: null,
  date: "2025-03-15",
  description: "Metsä Oy, pystykauppa",
  amount_gross: 12550,
  vat_rate: 25.5,
  category: "standing_sale",
  withholding: 3000,
  confidence: 0.9,
  reasoning: "Tilityksen loppusumma ja päivä.",
  ...over,
});

const pdf = { bytes: Buffer.from("%PDF-1.4 testi"), contentType: "application/pdf", fileName: "puukauppa 15.3.2025 12550.pdf" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("tunnistuksen tarkistus", () => {
  it("kelvollinen vastaus muuttuu ehdotusriveiksi", () => {
    const res = validateRecognition({ lines: [line(), line({ category: "other_expense", description: "Mittauskulut", amount_gross: 124, withholding: 0 })] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const doc = { documentIndex: 1, sourceDocument: "Puukaupan tilitys, Metsä Oy", documentType: "timber_settlement", pages: [1], contractNumber: "10432", invoiceNumber: null };
    expect(res.lines).toEqual([
      { date: "2025-03-15", description: "Metsä Oy, pystykauppa", category: "standing_sale", amountGross: 12550, vatRate: 25.5, withholding: 3000, confidence: 0.9, reasoning: "Tilityksen loppusumma ja päivä.", ...doc },
      { date: "2025-03-15", description: "Mittauskulut", category: "other_expense", amountGross: 124, vatRate: 25.5, withholding: 0, confidence: 0.9, reasoning: "Tilityksen loppusumma ja päivä.", ...doc },
    ]);
  });

  it("rikkinäinen vastaus on epäonnistuminen", () => {
    expect(validateRecognition(null)).toEqual({ ok: false });
    expect(validateRecognition("teksti")).toEqual({ ok: false });
    expect(validateRecognition({})).toEqual({ ok: false });
    expect(validateRecognition({ lines: [] })).toEqual({ ok: false });
    expect(validateRecognition({ lines: [line({ category: "tuntematon" })] })).toEqual({ ok: false });
    expect(validateRecognition({ lines: [line({ amount_gross: "12550" })] })).toEqual({ ok: false });
    expect(validateRecognition({ lines: [line({ amount_gross: 0 })] })).toEqual({ ok: false });
  });

  it("korjaa rajat: päivä, ennakonpidätys, varmuus ja pituudet", () => {
    const res = validateRecognition({
      lines: [
        line({ date: "2025-02-30", confidence: 1.7, description: "x".repeat(500) }),
        line({ category: "other_expense", withholding: 50, amount_gross: -86.5, confidence: -1 }),
        line({ withholding: 99999 }),
        line({ amount_gross: 0 }),
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines).toHaveLength(3);
    expect(res.lines[0]).toMatchObject({ date: null, confidence: 1 });
    expect(res.lines[0].description).toHaveLength(200);
    // Menorivillä ei ole ennakonpidätystä, ja hyvityksen etumerkki poistetaan.
    expect(res.lines[1]).toMatchObject({ withholding: 0, amountGross: 86.5, confidence: 0 });
    // Pidätys ei voi olla kauppasummaa suurempi.
    expect(res.lines[2].withholding).toBe(0);
  });

  it("kannasta luetut rikkinäiset rivit ohitetaan", () => {
    const ok = validateRecognition({ lines: [line()] });
    if (!ok.ok) throw new Error("odotettiin rivejä");
    expect(parseStoredLines([...ok.lines, { date: null }, "x"])).toEqual(ok.lines);
    expect(parseStoredLines(null)).toEqual([]);
  });
});

describe("testitila", () => {
  it("puukauppa tiedostonimestä: tulo, pidätys ja mittauskulu", async () => {
    const res = await mockRecognizer().recognize(pdf);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines.map((l) => [l.category, l.date, l.amountGross])).toEqual([
      ["standing_sale", "2025-03-15", 12550],
      ["other_expense", "2025-03-15", 124],
    ]);
    expect(res.lines[0].withholding).toBe(3000);
  });

  it("tavallinen kuitti ja rikki-niminen tiedosto", async () => {
    const res = await mockRecognizer().recognize({ ...pdf, fileName: "polttoaine 2025-04-02 86,50.jpg", contentType: "image/jpeg" });
    expect(res.ok && res.lines).toEqual([expect.objectContaining({ date: "2025-04-02", amountGross: 86.5, category: "other_expense", description: "polttoaine" })]);
    expect(await mockRecognizer().recognize({ ...pdf, fileName: "rikki.pdf" })).toEqual({ ok: false });
  });

  it("tila ympäristömuuttujista: ilman avainta aina testitila", () => {
    expect(receiptRecognizer({}).mode).toBe("mock");
    expect(receiptRecognizer({ AI_MODE: "anthropic" }).mode).toBe("mock");
    const r = receiptRecognizer({ AI_MODE: "anthropic", ANTHROPIC_API_KEY: "testiavain" });
    expect(r.mode).toBe("anthropic");
    expect(r.model).toBe("claude-opus-5-5");
    expect(receiptRecognizer({ AI_MODE: "anthropic", ANTHROPIC_API_KEY: "testiavain", AI_RECEIPTS_MODEL: "claude-sonnet-5" }).model).toBe("claude-sonnet-5");
  });
});

describe("Anthropic-toteutus ilman verkkoa", () => {
  function fakeClient(respond: (params: Record<string, unknown>) => unknown) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return respond(params);
        },
      },
    } as unknown as MessagesClient;
    return { client, calls };
  }

  it("lähettää vain tiedoston ja ohjeen, ja palauttaa tarkistetut rivit", async () => {
    const { client, calls } = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: { lines: [line()] } }));
    const res = await anthropicRecognizer({ apiKey: "testiavain", client }).recognize(pdf);
    expect(res.ok).toBe(true);
    const params = calls[0] as { model: string; system: string; messages: { content: { type: string; source?: { media_type: string } }[] }[]; output_config: { effort: string; format: { type: string } } };
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.system).toBe(RECEIPT_SYSTEM_PROMPT);
    const content = params.messages[0].content;
    expect(content.map((c) => c.type)).toEqual(["document", "text"]);
    expect(content[0].source?.media_type).toBe("application/pdf");
    // Tiedostonimeä (voi sisältää asiakkaan nimen) ei lähetetä.
    expect(JSON.stringify(params)).not.toContain("puukauppa 15.3.2025");
  });

  it("ohje ja skeema: kokoomatiedosto, vuosi-ilmoitus ja maksutiedot", async () => {
    for (const phrase of ["Go through every page", "tilisiirtolomake", "vuosi-ilmoitus", "menekinedistämismaksu", "YYYY-12-31", "Do not list the same invoice twice"]) {
      expect(RECEIPT_SYSTEM_PROMPT).toContain(phrase);
    }
    const { client, calls } = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: { lines: [line()] } }));
    await anthropicRecognizer({ apiKey: "k", client }).recognize(pdf);
    const schema = JSON.stringify((calls[0] as { output_config: { format: { schema: unknown } } }).output_config.format.schema);
    for (const field of ["document_index", "source_document", "document_type", "pages", "contract_number", "invoice_number", "document_total", "timber_annual_summary"]) {
      expect(schema).toContain(field);
    }
  });

  it("kuva lähtee kuvana", async () => {
    const { client, calls } = fakeClient(() => ({ stop_reason: "end_turn", parsed_output: { lines: [line()] } }));
    await anthropicRecognizer({ apiKey: "k", client }).recognize({ ...pdf, contentType: "image/png" });
    expect((calls[0] as { messages: { content: { type: string }[] }[] }).messages[0].content[0].type).toBe("image");
  });

  it("kieltäytyminen, katkennut vastaus ja virhe ovat epäonnistumisia eikä avain näy lokissa", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const respond of [
      () => ({ stop_reason: "refusal", parsed_output: null }),
      () => ({ stop_reason: "max_tokens", parsed_output: null }),
      () => ({ stop_reason: "end_turn", parsed_output: { lines: "rikki" } }),
      () => {
        throw new Error("salainen-avain-123 tositteen sisältö");
      },
    ]) {
      const { client } = fakeClient(respond);
      expect(await anthropicRecognizer({ apiKey: "salainen-avain-123", client }).recognize(pdf)).toEqual({ ok: false });
    }
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/salainen|sisältö/);
  });
});

describe("tunnistus aikarajalla", () => {
  it("aikarajan ylitys ja heitetty virhe eivät kaada", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const slow: ReceiptRecognizer = { mode: "mock", model: "mock", recognize: () => new Promise(() => {}) };
    expect(await recognizeReceipt(slow, pdf, 20)).toEqual({ ok: false });
    const broken: ReceiptRecognizer = { mode: "mock", model: "mock", recognize: async () => Promise.reject(new Error("x")) };
    expect(await recognizeReceipt(broken, pdf, 1000)).toEqual({ ok: false });
  });

  it("liian suuri tai väärä tiedosto torjutaan lähettämättä", async () => {
    const spy = vi.fn();
    const r: ReceiptRecognizer = { mode: "mock", model: "mock", recognize: spy };
    expect(await recognizeReceipt(r, { ...pdf, contentType: "image/jpeg", bytes: Buffer.alloc(6 * 1024 * 1024) })).toEqual({ ok: false, reason: "too_large" });
    expect(await recognizeReceipt(r, { ...pdf, contentType: "text/html" })).toEqual({ ok: false, reason: "unsupported" });
    expect(spy).not.toHaveBeenCalled();
  });
});

const docFields = {
  documentIndex: 1, sourceDocument: "Tilitys", documentType: "timber_settlement" as const, pages: [1], contractNumber: "10432", invoiceNumber: null,
};

describe("ehdotus taulukon riveiksi", () => {
  const suggestion = {
    id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    file_name: "tilitys.pdf",
    model: "mock",
    lines: [
      { date: "2025-03-15", description: "Pystykauppa", category: "standing_sale", amountGross: 12550, vatRate: 25.5, withholding: 3000, confidence: 0.9, reasoning: "r", ...docFields },
      { date: null, description: "Mittaus", category: "other_expense", amountGross: 124, vatRate: 25.5, withholding: 0, confidence: 0.4, reasoning: "r", ...docFields },
    ],
  };

  it("rivit ovat uusia, merkittyjä ja pysyvin avaimin", () => {
    const rows = rowsFromSuggestion(suggestion, { vatRegistered: true, defaultDate: "1.1.2025" });
    expect(rows.map((r) => [r.key, r.id, r.bookedOn, r.category, r.kind, r.amountGross, r.vatRate, r.withholding, r.suggestionId, r.suggestion?.first])).toEqual([
      [`s-${suggestion.id}-0`, null, "15.3.2025", "standing_sale", "income", "12 550,00", "25,5", "3 000,00", suggestion.id, true],
      [`s-${suggestion.id}-1`, null, "1.1.2025", "other_expense", "expense", "124,00", "25,5", "", suggestion.id, false],
    ]);
  });

  it("alv 0 %, jos asiakas ei ole arvonlisäverorekisterissä", () => {
    const rows = rowsFromSuggestion(suggestion, { vatRegistered: false, defaultDate: "1.1.2025" });
    expect(rows.map((r) => r.vatRate)).toEqual(["0", "0"]);
  });

  it("varoitus puuttuvasta päivästä ja muun vuoden päivästä", () => {
    const [a, b] = rowsFromSuggestion(suggestion, { vatRegistered: true, defaultDate: "1.1.2025" });
    expect(suggestionDateWarning(a, 2025, a.bookedOn)).toBeNull();
    expect(suggestionDateWarning(b, 2025, b.bookedOn)).toMatch(/ei tunnistettu päivää/);
    expect(suggestionDateWarning({ ...b, bookedOn: "3.2.2025" }, 2025, b.bookedOn)).toBeNull();
    expect(suggestionDateWarning(a, 2026, a.bookedOn)).toMatch(/muulta vuodelta/);
  });
});
