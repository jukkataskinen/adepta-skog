import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mergeLinePosting } from "@/lib/ai/receipts/posting";
import { chunkInstruction, postingHintText } from "@/lib/ai/receipts/anthropic";
import { FORESTRY_CONTEXT } from "@/lib/ai/receipts";
import type { SuggestionLine } from "@/lib/ai/receipts/schema";
import { applyPostingChoice, choosePostingOption, emptyGridRow, hintKeyAction, rowsFromSuggestion } from "@/lib/ledger/grid";
import { buildPostingMemory, suggestPosting, type PostingEntry } from "@/lib/ledger/posting-memory";

/** Tiliöintimuisti tunnistuksessa ja syötössä (DECISIONS 6.10.2026). Kuvitteellinen data. */

const line = (over: Partial<SuggestionLine> = {}): SuggestionLine => ({
  date: "2025-04-10",
  description: "Esimerkkitie tiekunta, tiemaksu",
  category: "travel",
  amountGross: 125.5,
  vatRate: 25.5,
  withholding: 0,
  confidence: 0.7,
  reasoning: "Laskun summa.",
  documentIndex: 1,
  sourceDocument: "Lasku 12, Esimerkkitie tiekunta",
  documentType: "invoice",
  pages: [1],
  contractNumber: null,
  invoiceNumber: "12",
  documentTotal: 125.5,
  ...over,
});

const entry = (over: Partial<PostingEntry> = {}): PostingEntry => ({
  bookedOn: "2024-04-15",
  category: "other_expense",
  kind: "expense",
  description: "Esimerkkitie tiekunta tiemaksu",
  amountGross: 120,
  vatRate: 24,
  businessSharePct: 50,
  otherSharePct: 0,
  farmId: null,
  ...over,
});

const strongMemory = buildPostingMemory([entry({ bookedOn: "2023-04-01" }), entry()]);
const lookup = (l: SuggestionLine, m = strongMemory) => suggestPosting(m, { description: l.description, amountGross: l.amountGross, date: l.date!, activities: ["forestry"] });

describe("tunnistuksen rivi ja tiliöintimuisti", () => {
  it("vahva osuma ohittaa tekoälyn luokan, tekoälyn arvaus jää vaihtoehdoksi ja alv tulee tositteelta", () => {
    const l = line();
    const p = mergeLinePosting(l, lookup(l), { vatRegistered: true });
    expect(p).toMatchObject({ applied: "memory", category: "other_expense", businessSharePct: 50, vatRate: 25.5 });
    expect(p.basis).toMatch(/^Tiliöity kuten 4\/2024: 9 Muut vuosimenot, alv 25,5 %, osuus 50 %; 2 kertaa vuosina 2023–2024\./);
    expect(p.options).toEqual([expect.objectContaining({ source: "ai", category: "travel", businessSharePct: 100 })]);
    expect(p.note).toBeNull();
  });

  it("kertoo, jos tositteen alv poikkeaa aiemmasta", () => {
    const m = buildPostingMemory([entry({ vatRate: 0, bookedOn: "2023-04-01" }), entry({ vatRate: 0 })]);
    const l = line();
    const p = mergeLinePosting(l, lookup(l, m), { vatRegistered: true });
    expect(p.vatRate).toBe(25.5);
    expect(p.note).toBe("Aiemmin alv 0 %, tositteella 25,5 %. Rivillä on tositteen kanta: tarkista.");
  });

  it("heikko osuma ei muuta riviä, vaan näkyy vaihtoehtona", () => {
    const m = buildPostingMemory([entry({ bookedOn: "2024-04-01" }), entry({ bookedOn: "2024-05-01", category: "wages" }), entry({ bookedOn: "2024-06-01", category: "wages" })]);
    const l = line();
    const res = lookup(l, m);
    expect(res.best?.strong).toBe(false);
    const p = mergeLinePosting(l, res, { vatRegistered: true });
    expect(p).toMatchObject({ applied: "ai", category: "travel", businessSharePct: 100 });
    expect(p.options.map((o) => o.source)).toEqual(["memory", "memory"]);
  });

  it("puukauppa ennakonpidätyksineen pitää tekoälyn tiliöinnin", () => {
    const m = buildPostingMemory([entry({ description: "Metsäyhtiö pystykauppa", category: "other_expense" }), entry({ description: "Metsäyhtiö pystykauppa", bookedOn: "2023-01-01" })]);
    const l = line({ description: "Metsäyhtiö pystykauppa", category: "standing_sale", withholding: 1000, amountGross: 10000 });
    expect(mergeLinePosting(l, lookup(l, m), { vatRegistered: true }).applied).toBe("ai");
  });

  it("taulukon rivi saa muistin tiliöinnin, ja vaihtoehdon voi ottaa käyttöön ja perua", () => {
    const [row] = rowsFromSuggestion(
      { id: "s1", document_id: "d1", file_name: "lasku.pdf", lines: [line()] },
      { vatRegistered: true, defaultDate: "1.6.2025", year: 2025, posting: (l) => lookup(l) },
    );
    expect(row).toMatchObject({ category: "other_expense", kind: "expense", vatRate: "25,5", businessSharePct: "50", amountGross: "125,50", id: null });
    expect(row.suggestion?.posting?.applied).toBe("memory");
    const ai = choosePostingOption(row, 0, 2025, { vatRegistered: true });
    expect(ai).toMatchObject({ category: "travel", businessSharePct: "", vatRate: "25,5", amountGross: "125,50", bookedOn: "10.4.2025" });
    expect(ai.suggestion?.posting?.applied).toBe("ai");
    const back = choosePostingOption(ai, 0, 2025, { vatRegistered: true });
    expect(back).toMatchObject({ category: "other_expense", businessSharePct: "50" });
  });

  it("ilman muistia rivi on ennallaan", () => {
    const [row] = rowsFromSuggestion({ id: "s1", document_id: "d1", file_name: "lasku.pdf", lines: [line()] }, { vatRegistered: true, defaultDate: "1.6.2025" });
    expect(row).toMatchObject({ category: "travel", businessSharePct: "" });
    expect(row.suggestion?.posting).toBeUndefined();
  });
});

describe("tekoälyn vihje viestissä", () => {
  it("ilman vihjeitä viesti on ennallaan, vihjeet tulevat loppuun", () => {
    expect(chunkInstruction(undefined, FORESTRY_CONTEXT)).toBe("Tunnista tämän tiedoston kaikki asiakirjat ja niiden kirjausehdotukset.");
    const text = chunkInstruction(undefined, { ...FORESTRY_CONTEXT, postingHints: ["esimerkkitie tiemaksu → other_expense, alv 0, osuus 50"] });
    expect(text).toContain("Asiakkaan aiemmat tiliöinnit vihjeeksi");
    expect(text.endsWith("- esimerkkitie tiemaksu → other_expense, alv 0, osuus 50")).toBe(true);
    expect(postingHintText(Array.from({ length: 40 }, (_, i) => `rivi ${i}`)).split("\n").filter((r) => r.startsWith("- "))).toHaveLength(30);
  });
});

describe("syötön ehdotus", () => {
  it("valinta täyttää luokan, alv:n, osuudet ja maatilan, mutta ei summaa, päivää eikä selitettä", () => {
    const r = { ...emptyGridRow("k", "5.3.2025"), description: "tiemaksu", amountGross: "99,00" };
    const next = applyPostingChoice(r, { category: "other_expense", kind: "expense", vatRate: 0, businessSharePct: 50, otherSharePct: 0, farmId: null }, 2025, { vatRegistered: true });
    expect(next).toMatchObject({ category: "other_expense", kind: "expense", vatRate: "0", businessSharePct: "50", description: "tiemaksu", amountGross: "99,00", bookedOn: "5.3.2025", id: null });
    const agri = applyPostingChoice(r, { category: "agri_fuels", kind: "expense", vatRate: 25.5, businessSharePct: 100, otherSharePct: 0, farmId: "f1" }, 2025, { vatRegistered: false });
    expect(agri).toMatchObject({ category: "agri_fuels", vatRate: "0", farmId: "f1", businessSharePct: "" });
  });

  it("Enter ja Tab siirtävät kuten ennen, kun ehdotusta ei ole valittu", () => {
    const o = { count: 2, highlighted: null };
    expect(hintKeyAction("Enter", o)).toBeNull();
    expect(hintKeyAction("Tab", o)).toBeNull();
    expect(hintKeyAction("ArrowUp", o)).toBeNull();
    expect(hintKeyAction("a", o)).toBeNull();
    expect(hintKeyAction("ArrowDown", o)).toEqual({ type: "highlight", index: 0 });
    expect(hintKeyAction("ArrowDown", { count: 2, highlighted: 1 })).toEqual({ type: "highlight", index: 1 });
    expect(hintKeyAction("ArrowUp", { count: 2, highlighted: 0 })).toEqual({ type: "highlight", index: null });
    expect(hintKeyAction("Enter", { count: 2, highlighted: 1 })).toEqual({ type: "accept", index: 1 });
    expect(hintKeyAction("Tab", { count: 2, highlighted: 0, shift: true })).toBeNull();
    expect(hintKeyAction("Escape", o)).toEqual({ type: "close" });
    expect(hintKeyAction("ArrowDown", { count: 0, highlighted: null })).toBeNull();
  });
});

describe("ehdotusreitti", () => {
  const requireStaff = vi.fn(async () => {
    throw new Error("requireStaff kutsuttiin");
  });
  vi.doMock("@/lib/auth/current-user", () => ({ requireStaff }));
  const request = (headers: Record<string, string>) =>
    new NextRequest("https://skog.example.test/api/tiliointi/ehdotus", { method: "POST", headers, body: "{}" });

  it("hylkää toisesta osoitteesta tulevan pyynnön ennen kirjautumista ja vaatii kirjautumisen", async () => {
    const { POST } = await import("@/app/api/tiliointi/ehdotus/route");
    for (const headers of <Record<string, string>[]>[{ host: "skog.example.test" }, { host: "skog.example.test", origin: "https://evil.example.test" }]) {
      expect((await POST(request(headers))).status).toBe(403);
    }
    expect(requireStaff).not.toHaveBeenCalled();
    await expect(POST(request({ host: "skog.example.test", origin: "https://skog.example.test" }))).rejects.toThrow(/requireStaff/);
  });
});
