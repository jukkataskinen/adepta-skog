import { describe, expect, it } from "vitest";
import { estimateText, failedPagesText, mapChunkPages, planChunks, validateChunkRecognition } from "@/lib/ai/receipts/chunks";
import { CHUNK_MAX_TOKENS, CHUNK_OVERLAP, CHUNK_PAGES } from "@/lib/ai/receipts/config";
import { mergeChunkResults, type ChunkResult } from "@/lib/ai/receipts/merge";
import { anthropicRecognizer, chunkInstruction, type MessagesClient } from "@/lib/ai/receipts/anthropic";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { recognizeChunk } from "@/lib/ai/receipts";
import { blankPdf, countPdfPages, extractPdfPages } from "@/lib/ai/receipts/pdf";
import type { ChunkLine } from "@/lib/ai/receipts/schema";

/** Tunnistus osissa: jako, sivujen muunnos, yhdistäminen ja testitila. */

const raw = (over: Record<string, unknown> = {}) => ({
  document_index: 1,
  source_document: "Lasku 1182, Metsäpalvelu",
  document_type: "invoice",
  pages: [1],
  contract_number: null,
  invoice_number: "1182",
  document_total: 500,
  date: "2025-05-14",
  description: "Metsäpalvelu, taimet",
  amount_gross: 500,
  vat_rate: 25.5,
  category: "other_expense",
  withholding: 0,
  confidence: 0.8,
  reasoning: "Laskun loppusumma.",
  ...over,
});

const line = (over: Partial<ChunkLine> = {}): ChunkLine => ({
  date: "2025-05-14",
  description: "Metsäpalvelu, taimet",
  category: "other_expense",
  amountGross: 500,
  vatRate: 25.5,
  withholding: 0,
  confidence: 0.8,
  reasoning: "",
  documentIndex: 1,
  sourceDocument: "Lasku",
  documentType: "invoice",
  pages: [1],
  contractNumber: null,
  invoiceNumber: null,
  documentTotal: null,
  ...over,
});

describe("jako paloihin", () => {
  it("vakiot: 8 sivua ja 1 sivun limitys", () => {
    expect(CHUNK_PAGES).toBe(8);
    expect(CHUNK_OVERLAP).toBe(1);
  });

  it("1 ja 8 sivua ovat yksi pala kuten ennen", () => {
    expect(planChunks(1)).toEqual([{ first: 1, last: 1, total: 1 }]);
    expect(planChunks(8)).toEqual([{ first: 1, last: 8, total: 8 }]);
  });

  it("9 sivua: toinen pala alkaa ensimmäisen viimeiseltä sivulta", () => {
    expect(planChunks(9)).toEqual([
      { first: 1, last: 8, total: 9 },
      { first: 8, last: 9, total: 9 },
    ]);
  });

  it("40 sivua: jokainen sivu on mukana ja peräkkäiset palat jakavat yhden sivun", () => {
    const chunks = planChunks(40);
    expect(chunks.map((c) => [c.first, c.last])).toEqual([
      [1, 8],
      [8, 15],
      [15, 22],
      [22, 29],
      [29, 36],
      [36, 40],
    ]);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].first).toBe(chunks[i - 1].last);
    const covered = new Set(chunks.flatMap((c) => Array.from({ length: c.last - c.first + 1 }, (_, k) => c.first + k)));
    expect(covered.size).toBe(40);
    expect(chunks.every((c) => c.last - c.first + 1 <= CHUNK_PAGES)).toBe(true);
  });

  it("tuntematon sivumäärä on yksi pala koko tiedostosta", () => {
    expect(planChunks(0)).toEqual([{ first: 1, last: 1, total: 0 }]);
  });
});

describe("sivujen muunnos ja tarkistus", () => {
  const chunk = { first: 9, last: 16, total: 40 };

  it("koko tiedoston sivut säilyvät, palan ulkopuoliset jäävät pois", () => {
    const out = mapChunkPages([{ pages: [9, 10] }, { pages: [16, 17, 3] }], chunk);
    expect(out.map((l) => l.pages)).toEqual([[9, 10], [16]]);
  });

  it("liitteen oma numerointi (1–8) siirretään palan alkuun", () => {
    const out = mapChunkPages([{ pages: [1, 2] }, { pages: [8] }], chunk);
    expect(out.map((l) => l.pages)).toEqual([[9, 10], [16]]);
  });

  it("epäselvässä tapauksessa koko tiedoston numerointi voittaa", () => {
    const out = mapChunkPages([{ pages: [8] }], { first: 8, last: 15, total: 40 });
    expect(out[0].pages).toEqual([8]);
  });

  it("palan vastaus: rivit tarkistetaan, loppusumma säilyy yhdistämistä varten", () => {
    const res = validateChunkRecognition({ lines: [raw({ pages: [12] }), raw({ amount_gross: -0, pages: [13] })] }, chunk);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0]).toMatchObject({ pages: [12], documentTotal: 500, invoiceNumber: "1182" });
  });
});

describe("yhdistäminen", () => {
  const c1: ChunkResult = {
    first: 1,
    last: 8,
    total: 15,
    lines: [
      line({ documentIndex: 1, pages: [2], amountGross: 100, invoiceNumber: "A1" }),
      line({ documentIndex: 2, pages: [7, 8], amountGross: 800, invoiceNumber: "B2", date: "2025-06-01" }),
      line({ documentIndex: 3, pages: [8], amountGross: 55, date: "2025-07-01", description: "Toinen kuitti rajasivulla" }),
    ],
  };
  const c2: ChunkResult = {
    first: 8,
    last: 15,
    total: 15,
    lines: [
      line({ documentIndex: 1, pages: [8, 9], amountGross: 800, invoiceNumber: "B 2", date: "2025-06-01", confidence: 0.9 }),
      line({ documentIndex: 1, pages: [9], amountGross: 40, description: "Samasta laskusta toinen rivi", category: "travel", date: null }),
      line({ documentIndex: 2, pages: [8], amountGross: 56, date: "2025-07-02", description: "Eri kuitti, eri summa" }),
      line({ documentIndex: 3, pages: [12], amountGross: 300, invoiceNumber: "C3" }),
    ],
  };

  it("limityssivun sama rivi on kerran, sivut yhdistetään ja asiakirja saa yhden numeron", () => {
    const out = mergeChunkResults([c2, c1]);
    const b2 = out.filter((l) => l.amountGross === 800);
    expect(b2).toHaveLength(1);
    expect(b2[0].pages).toEqual([7, 8, 9]);
    expect(b2[0].confidence).toBe(0.9);
    // Toisen palan saman laskun toinen rivi kuuluu samaan asiakirjaan.
    const second = out.find((l) => l.amountGross === 40);
    expect(second?.documentIndex).toBe(b2[0].documentIndex);
  });

  it("eri asiakirjat säilyvät ja numerot ovat koko tiedostossa yksilöllisiä sivujärjestyksessä", () => {
    const out = mergeChunkResults([c1, c2]);
    expect(out.map((l) => l.amountGross)).toEqual([100, 800, 40, 55, 56, 300]);
    const byAmount = Object.fromEntries(out.map((l) => [l.amountGross, l.documentIndex]));
    expect(byAmount[100]).toBe(1);
    expect(byAmount[800]).toBe(2);
    expect(new Set([byAmount[55], byAmount[56], byAmount[300]]).size).toBe(3);
    expect(byAmount[300]).toBeGreaterThan(byAmount[56]);
    // Loppusumma säilyy täsmäytystä varten (DECISIONS 2.10.2026).
    expect(out.every((l) => l.documentTotal === null || typeof l.documentTotal === "number")).toBe(true);
  });

  it("sama summa ilman yhteistä päivää tai numeroa ei ole sama rivi", () => {
    const a: ChunkResult = { first: 1, last: 8, total: 9, lines: [line({ pages: [8], amountGross: 70, date: "2025-01-01" })] };
    const b: ChunkResult = { first: 8, last: 9, total: 9, lines: [line({ pages: [8], amountGross: 70, date: "2025-02-01" })] };
    expect(mergeChunkResults([a, b])).toHaveLength(2);
  });

  it("maksurivien poisto koskee yhdistettyä tulosta", () => {
    const a: ChunkResult = { first: 1, last: 8, total: 9, lines: [line({ pages: [8], amountGross: 900, invoiceNumber: "77", documentTotal: 900 })] };
    const b: ChunkResult = {
      first: 8,
      last: 9,
      total: 9,
      lines: [
        line({ pages: [8], amountGross: 900, invoiceNumber: "77" }),
        line({ pages: [9], amountGross: 900, description: "Tilisiirto, maksettava yhteensä" }),
      ],
    };
    const out = mergeChunkResults([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].pages).toEqual([8]);
  });
});

describe("palvelu palalle", () => {
  it("ohje kertoo palan sivut koko tiedostossa, pieni tiedosto saa entisen ohjeen", () => {
    expect(chunkInstruction({ first: 9, last: 16, total: 40 })).toContain("sivut 9–16 kokonaisuudesta 40");
    expect(chunkInstruction({ first: 1, last: 5, total: 5 })).toBe("Tunnista tämän tiedoston kaikki asiakirjat ja niiden kirjausehdotukset.");
  });

  it("palan kutsu: palan mitoitus ja sivut koko tiedoston numeroinnissa", async () => {
    const calls: Record<string, unknown>[] = [];
    const client = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return { stop_reason: "end_turn", parsed_output: { lines: [raw({ pages: [2] })] } };
        },
      },
    } as unknown as MessagesClient;
    const pdf = await blankPdf(8);
    const res = await anthropicRecognizer({ apiKey: "testiavain", client }).recognize({ bytes: pdf, contentType: "application/pdf", fileName: "x.pdf" }, undefined, { first: 9, last: 16, total: 40 });
    expect(res.ok && res.lines[0].pages).toEqual([10]);
    expect(calls[0].max_tokens).toBe(CHUNK_MAX_TOKENS);
    expect(JSON.stringify(calls[0].messages)).toContain("sivut 9–16 kokonaisuudesta 40");
  });
});

describe("PDF:n jako ja testitila", () => {
  it("pdf-lib laskee sivut ja erottaa palan", async () => {
    const pdf = await blankPdf(20);
    expect(await countPdfPages(pdf)).toBe(20);
    expect(await countPdfPages(Buffer.from("ei pdf"))).toBeNull();
    const part = await extractPdfPages(pdf, 8, 15);
    expect(await countPdfPages(part)).toBe(8);
  });

  it("testitila tekee limityssivulle saman rivin molempiin paloihin, ja yhdistäminen poistaa toisen", async () => {
    const pdf = await blankPdf(20);
    const file = { bytes: pdf, contentType: "application/pdf", fileName: "vuoden tositteet 2025.pdf" };
    const results: ChunkResult[] = [];
    for (const c of planChunks(20)) {
      const res = await recognizeChunk(mockRecognizer(), file, c);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.lines.every((l) => l.pages.every((p) => p >= c.first && p <= c.last))).toBe(true);
      results.push({ ...c, lines: res.lines as ChunkLine[] });
    }
    const page8 = results.flatMap((r) => r.lines).filter((l) => l.pages.includes(8));
    expect(page8).toHaveLength(2);
    const merged = mergeChunkResults(results);
    expect(merged.filter((l) => l.pages.includes(8))).toHaveLength(1);
    expect(merged.filter((l) => l.pages.includes(15))).toHaveLength(1);
    const docs = merged.map((l) => l.documentIndex);
    expect(new Set(docs).size).toBe(docs.length);
  });

  it("testitila: nimi osavirhe kaataa sivun 17 palan kahdesti", async () => {
    const file = { bytes: await blankPdf(20), contentType: "application/pdf", fileName: "osavirhe testi.pdf" };
    const chunk = { first: 15, last: 20, total: 20 };
    expect((await recognizeChunk(mockRecognizer(), file, chunk)).ok).toBe(false);
    expect((await recognizeChunk(mockRecognizer(), file, chunk)).ok).toBe(false);
    expect((await recognizeChunk(mockRecognizer(), file, chunk)).ok).toBe(true);
  });
});

describe("tekstit", () => {
  it("aika-arvio ja epäonnistuneet sivut", () => {
    expect(estimateText(40, 6)).toBe("40 sivua, 6 osaa, noin 2–4 min");
    expect(estimateText(3, 1)).toBe("3 sivua, 1 osa, noin 30–70 s");
    expect(failedPagesText([{ first: 15, last: 22, status: "failed" }, { first: 22, last: 29, status: "failed" }, { first: 1, last: 8, status: "done" }])).toBe("Sivuja 15–29 ei voitu lukea.");
    expect(failedPagesText([{ first: 1, last: 8, status: "done" }])).toBeNull();
  });
});
