import { describe, expect, it } from "vitest";
import { annotateAgriLine, lineNotes, SUBSIDY_TYPES, subsidyType, vatRateNote, type AnnotatableLine } from "@/lib/ai/receipts/agri";
import { documentBalance } from "@/lib/ai/receipts/reconcile";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { agriExampleByName } from "@/lib/ai/receipts/mock-agri";
import { receiptSystemPrompt } from "@/lib/ai/receipts/anthropic";
import { AGRI_DOCUMENT_TYPES, DOCUMENT_TYPE_LABEL, recognitionOutputSchemaFor, validateRecognition, type SuggestionLine } from "@/lib/ai/receipts/schema";
import { chunkParallel } from "@/lib/ai/receipts/config";
import { estimateText, planChunks } from "@/lib/ai/receipts/chunks";
import { category, type Activity } from "@/lib/tax/rules";
import { deferredSuggestionLines, rowsFromSuggestion, suggestionGroups } from "@/lib/ledger/grid";

/**
 * Maatalouden tositteiden tunnistus (DECISIONS 2.10.2026): asiakirjalajit,
 * tukilajien luokitus, huomautukset, vuosikohtainen alv-kanta, täsmäytys,
 * ryhmittely ja testitilan esimerkit. Kaikki tiedot ovat kuvitteellisia.
 */

const FARM: Activity[] = ["agriculture"];
const BOTH: Activity[] = ["forestry", "agriculture"];
const ctx = (activities: Activity[]) => ({ activities, defaultActivity: "agriculture" as const });

const raw = (over: Record<string, unknown> = {}) => ({
  document_index: 1, source_document: "Maksuilmoitus, Ruokavirasto", document_type: "subsidy_payment", pages: [1], contract_number: null, invoice_number: null,
  document_total: null, date: "2025-10-15", description: "Ruokavirasto, perustulotuki", amount_gross: 7380, vat_rate: 0, category: "agri_state_subsidy",
  withholding: 0, confidence: 0.9, reasoning: "testi", note: null, subsidy_type: null, asset_class: null, ...over,
});

async function recognize(name: string, activities: Activity[] = FARM): Promise<SuggestionLine[]> {
  const res = await mockRecognizer().recognize({ bytes: Buffer.from("x"), contentType: "application/pdf", fileName: name }, undefined, undefined, ctx(activities));
  if (!res.ok) throw new Error(`ei tunnistettu: ${name}`);
  return res.lines;
}

const balanceOf = (lines: SuggestionLine[]) =>
  documentBalance(
    lines.map((l) => ({ kind: category(l.category)?.kind ?? "", amountGross: l.amountGross, withholding: l.withholding })),
    lines.find((l) => l.documentTotal)?.documentTotal ?? null,
  );

describe("skeema", () => {
  it("maatalouden skeemassa ovat uudet asiakirjalajit, huomautus, tukilaji ja poistoryhmä", () => {
    const schema = JSON.stringify(recognitionOutputSchemaFor(BOTH).toJSONSchema());
    for (const word of [...AGRI_DOCUMENT_TYPES, "subsidy_type", "asset_class", "note", "basic_income", "investment_aid", "agri_machinery"]) expect(schema).toContain(word);
    for (const t of AGRI_DOCUMENT_TYPES) expect(DOCUMENT_TYPE_LABEL[t]).toBeTruthy();
    const forest = JSON.stringify(recognitionOutputSchemaFor(["forestry"]).toJSONSchema());
    expect(forest).not.toContain("subsidy_type");
    expect(forest).not.toContain("dairy_settlement");
  });

  it("puuttuvat lisäkentät ja tuntematon tukilaji eivät kaada vastausta", () => {
    const { note, subsidy_type, asset_class, ...bare } = raw();
    void note;
    void subsidy_type;
    void asset_class;
    const a = validateRecognition({ lines: [bare] }, FARM);
    expect(a.ok && a.lines[0].category).toBe("agri_state_subsidy");
    const b = validateRecognition({ lines: [raw({ subsidy_type: "tuntematon", asset_class: "ei-ryhmä" })] }, FARM);
    expect(b.ok && [b.lines[0].subsidyType, b.lines[0].assetClass]).toEqual([null, null]);
  });

  it("metsäasiakkaalle maatalouden asiakirjalaji ei kelpaa", () => {
    expect(validateRecognition({ lines: [raw({ category: "other_expense" })] }, ["forestry"]).ok).toBe(false);
  });
});

describe("tukilajien luokitus", () => {
  it("jokaisella tukilajilla on luokka, ja luokan lomakkeen 2 kenttä vastaa lajin kenttää", () => {
    const codes = new Set<string>();
    for (const t of SUBSIDY_TYPES) {
      expect(codes.has(t.code)).toBe(false);
      codes.add(t.code);
      const c = category(t.category);
      expect(c?.activity).toBe("agriculture");
      expect(c?.kind).toBe("income");
      if (t.field) expect(c?.form2).toBe(t.field);
    }
    // CAP-tuet ja kansalliset tuet kohtaan 217, ostajan kautta 218, vahingot 220, energiaveron palautus 222.
    const field = (code: string) => subsidyType(code)?.field;
    for (const code of ["basic_income", "redistributive", "young_farmer", "coupled", "eco_scheme", "natural_constraint", "environmental", "animal_welfare", "northern", "southern_national", "national_other"]) {
      expect(field(code)).toBe("217");
    }
    expect([field("via_buyer"), field("damage"), field("energy_tax_refund"), field("investment_aid"), field("other")]).toEqual(["218", "220", "222", null, "218"]);
  });

  it("luokka tulee tukilajista, alv on 0 ja epävarma laji saa matalan varmuuden ja huomautuksen", () => {
    const res = validateRecognition(
      {
        lines: [
          raw({ subsidy_type: "natural_constraint", vat_rate: 14, description: "Ruokavirasto, luonnonhaittakorvaus" }),
          raw({ subsidy_type: "investment_aid", amount_gross: 12000, description: "Ruokavirasto, investointituki" }),
          raw({ subsidy_type: "energy_tax_refund", category: "agri_state_subsidy", description: "Verohallinto, energiaveron palautus" }),
          raw({ subsidy_type: "damage", description: "Ruokavirasto, riistavahinkokorvaus" }),
        ],
      },
      FARM,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.lines.map((l) => [l.category, l.vatRate, l.subsidyType])).toEqual([
      ["agri_state_subsidy", 0, "natural_constraint"],
      ["agri_other_subsidy", 0, "investment_aid"],
      ["agri_additions", 0, "energy_tax_refund"],
      ["agri_other_income", 0, "damage"],
    ]);
    expect(res.lines[1].confidence).toBeLessThanOrEqual(0.4);
    expect(res.lines[1].note).toMatch(/Investointituki ei ole tuloa/);
    expect(res.lines[3].confidence).toBeLessThanOrEqual(0.6);
  });

  it("tukipäätös on aina epävarma ja huomauttaa maksuperusteesta", () => {
    const res = validateRecognition({ lines: [raw({ document_type: "subsidy_decision", subsidy_type: "basic_income", confidence: 0.9 })] }, FARM);
    expect(res.ok && res.lines[0].confidence).toBe(0.3);
    expect(res.ok && res.lines[0].note).toMatch(/Tukipäätös ei ole maksu/);
  });

  it("metsätalouden rivi metsä- ja maatalousasiakkaalla jää ennalleen", () => {
    const res = validateRecognition({ lines: [raw({ category: "forestry_subsidy", document_type: "subsidy_payment", subsidy_type: "basic_income", vat_rate: 0 })] }, BOTH);
    expect(res.ok && [res.lines[0].category, res.lines[0].subsidyType, res.lines[0].note]).toEqual(["forestry_subsidy", null, null]);
  });
});

describe("alv-kanta vuoden mukaan", () => {
  const l = (date: string, vatRate: number, cat = "agri_livestock_products") => ({ date, vatRate, category: cat });
  it("alennettu kanta: 14 % vuonna 2025 ja 13,5 % vuodesta 2026", () => {
    expect(vatRateNote(l("2025-12-15", 14))).toBeNull();
    expect(vatRateNote(l("2026-01-15", 13.5))).toBeNull();
    expect(vatRateNote(l("2026-01-15", 14))).toMatch(/13,5 % päivänä 15.1.2026, tositteella 14 %/);
    expect(vatRateNote(l("2025-06-01", 13.5))).toMatch(/14 % päivänä 1.6.2025/);
  });

  it("yleinen kanta: 24 % ennen syyskuuta 2024, sen jälkeen 25,5 %", () => {
    expect(vatRateNote(l("2024-08-31", 24, "agri_fuels"))).toBeNull();
    expect(vatRateNote(l("2025-03-01", 25.5, "agri_fuels"))).toBeNull();
    expect(vatRateNote(l("2025-03-01", 24, "agri_fuels"))).toMatch(/25,5 %/);
    expect(vatRateNote({ date: null, vatRate: 14, category: "agri_feed" })).toBeNull();
    expect(vatRateNote(l("2026-03-01", 0, "agri_myel"))).toBeNull();
  });

  it("testitilan maitotilitys käyttää vuoden kantaa, eikä kantaa muuteta tositteelta", async () => {
    expect((await recognize("meijeri 2025.pdf"))[0].vatRate).toBe(14);
    expect((await recognize("meijeri 2026.pdf"))[0].vatRate).toBe(13.5);
    const res = validateRecognition({ lines: [raw({ document_type: "dairy_settlement", category: "agri_livestock_products", vat_rate: 14, date: "2026-01-20", subsidy_type: null })] }, FARM);
    expect(res.ok && res.lines[0].vatRate).toBe(14);
    expect(res.ok && res.lines[0].note).toMatch(/edellisen vuoden toimituksia/);
  });
});

describe("huomautukset asiakirjalajeittain", () => {
  const base: AnnotatableLine = { date: "2025-05-01", description: "", category: "", amountGross: 100, vatRate: 25.5, withholding: 0, confidence: 0.8, reasoning: "", documentType: "invoice" };
  it("sähkö, polttoaine, kotieläinkauppa, investointi, vaihtokone ja ylijäämä", () => {
    expect(lineNotes({ ...base, category: "agri_energy", description: "Energia, sähkö" }).join(" ")).toMatch(/Osuus-sarakkeeseen/);
    expect(lineNotes({ ...base, category: "agri_fuels" }).join(" ")).toMatch(/Energiaveron palautus kirjataan erikseen/);
    expect(lineNotes({ ...base, category: "agri_livestock_sale", documentType: "livestock_trade" }).join(" ")).toMatch(/jaksottaa kolmelle vuodelle/);
    expect(lineNotes({ ...base, category: "agri_livestock_sale", documentType: "slaughter_settlement" })).toEqual([]);
    expect(lineNotes({ ...base, category: "agri_asset_sale" }).join(" ")).toMatch(/myytävä kone/);
    expect(lineNotes({ ...base, category: "agri_coop_surplus" }).join(" ")).toMatch(/327 ja 328/);
  });

  it("investointi saa oletuksena koneiden poistoryhmän, ja muu rivi ei saa ryhmää", () => {
    expect(annotateAgriLine({ ...base, category: "agri_asset_purchase" }).assetClass).toBe("agri_machinery");
    expect(annotateAgriLine({ ...base, category: "agri_asset_purchase", assetClass: "agri_drainage" }).assetClass).toBe("agri_drainage");
    expect(annotateAgriLine({ ...base, category: "agri_fuels", assetClass: "agri_machinery" }).assetClass).toBeNull();
    expect(annotateAgriLine({ ...base, category: "agri_asset_purchase" }).note).toMatch(/Koneet ja kalusto \(25 %\)/);
  });
});

describe("täsmäytys", () => {
  it("tilitys: tulot − vähennykset = maksettu summa", () => {
    const b = documentBalance(
      [
        { kind: "income", amountGross: 6840, withholding: 0 },
        { kind: "expense", amountGross: 1230.4, withholding: 0 },
        { kind: "income", amountGross: 312.5, withholding: 0 },
      ],
      5922.1,
    );
    expect(b).toMatchObject({ income: 7152.5, costs: 1230.4, net: 5922.1, status: "ok", difference: 0 });
  });

  it("lasku vaihtokoneella, puukauppa ennakonpidätyksellä, ero ja puuttuva summa", () => {
    expect(documentBalance([{ kind: "investment", amountGross: 68500, withholding: 0 }, { kind: "income", amountGross: 18000, withholding: 0 }], 50500).status).toBe("ok");
    expect(documentBalance([{ kind: "income", amountGross: 12550, withholding: 3000 }, { kind: "expense", amountGross: 124, withholding: 0 }], 9426).status).toBe("ok");
    expect(documentBalance([{ kind: "income", amountGross: 100, withholding: 0 }], 90)).toMatchObject({ status: "mismatch", difference: 10 });
    expect(documentBalance([{ kind: "expense", amountGross: 100, withholding: 0 }], null).status).toBe("no_total");
  });
});

describe("testitilan maatalousesimerkit", () => {
  it("jokainen esimerkki on yksi asiakirja, jonka rivit täsmäävät tositteen summaan", async () => {
    for (const name of ["meijeri 2025.pdf", "teurastamo 2025.pdf", "vilja 2025.pdf", "vipu maksetut tuet 2025.pdf", "konekauppa 2025.pdf", "eläinkauppa 2025.pdf", "sähkö 2025.pdf", "myel 2025.pdf"]) {
      const lines = await recognize(name);
      expect(new Set(lines.map((l) => l.documentIndex)).size, name).toBe(1);
      expect(lines.every((l) => l.category.startsWith("agri_")), name).toBe(true);
      expect(balanceOf(lines).status, name).toBe("ok");
    }
  });

  it("meijeri: maito, vähennykset omina riveinään ja ylijäämä tulona", async () => {
    const lines = await recognize("meijeri 2025.pdf");
    expect(lines.map((l) => [l.category, l.amountGross])).toEqual([
      ["agri_livestock_products", 6840],
      ["agri_feed", 1230.4],
      ["agri_veterinary", 186],
      ["agri_contracting", 212.6],
      ["agri_other_purchases", 48],
      ["agri_coop_surplus", 312.5],
    ]);
    expect(lines[0].documentType).toBe("dairy_settlement");
  });

  it("osuusmaksun pidätys näkyy erona ja huomautuksena", async () => {
    const lines = await recognize("osuusmaksu 2025.pdf");
    expect(balanceOf(lines)).toMatchObject({ status: "mismatch", difference: 200 });
    expect(lines[0].note).toMatch(/osuusmaksu/);
  });

  it("Vipun maksetut tuet: rivi per maksu maksupäivän mukaan, luokka tukilajista", async () => {
    const lines = await recognize("vipu maksetut tuet 2025.pdf");
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.vatRate === 0 && l.documentType === "subsidy_summary")).toBe(true);
    expect(lines.map((l) => l.date)).toContain("2025-12-18");
    const inv = lines.find((l) => l.subsidyType === "investment_aid")!;
    expect([inv.category, inv.confidence <= 0.4]).toEqual(["agri_other_subsidy", true]);
    expect(lines.filter((l) => l.category === "agri_state_subsidy")).toHaveLength(7);
    // Ympäristökorvauksen tukivuosi on edellinen, mutta maksupäivä ratkaisee vuoden.
    expect(lines.find((l) => l.subsidyType === "environmental")).toMatchObject({ date: "2025-04-24" });
    expect(lines.find((l) => l.subsidyType === "environmental")?.description).toMatch(/2024/);
  });

  it("konekauppa: traktori investointina koneiden ryhmään ja vaihtokone myyntinä", async () => {
    const lines = await recognize("konekauppa 2025.pdf");
    expect(lines.map((l) => [l.category, l.assetClass ?? null])).toEqual([
      ["agri_asset_purchase", "agri_machinery"],
      ["agri_asset_sale", null],
      ["agri_other_purchases", null],
    ]);
    const rows = rowsFromSuggestion({ id: "s1", document_id: "d1", file_name: "konekauppa 2025.pdf", lines }, { vatRegistered: true, defaultDate: "1.1.2025", year: 2025 });
    expect(rows[0].assetRatePct).toBe("agri_machinery");
  });

  it("pelkkä metsäasiakas ei saa maatalouden esimerkkiä", async () => {
    const res = await mockRecognizer().recognize({ bytes: Buffer.from("x"), contentType: "application/pdf", fileName: "meijeri 2025.pdf" });
    expect(res.ok && res.lines.every((l) => !l.category.startsWith("agri_"))).toBe(true);
    expect(agriExampleByName("tavallinen kuitti")).toBeNull();
  });
});

describe("hyväksyntänäkymän ryhmät", () => {
  it("asiakirja on ryhmä, ja muokkaus ja odottamaan jättäminen näkyvät täsmäytyksessä", async () => {
    const lines = [...(await recognize("meijeri 2025.pdf")), ...(await recognize("sähkö 2025.pdf")).map((l) => ({ ...l, documentIndex: 2 }))];
    const rows = rowsFromSuggestion({ id: "s1", document_id: "d1", file_name: "kooste.pdf", lines }, { vatRegistered: true, defaultDate: "1.1.2025", year: 2025 });
    let groups = suggestionGroups(rows);
    expect([...groups.values()].map((g) => [g.documentIndex, g.rowKeys.length, g.balance.status])).toEqual([
      [1, 6, "ok"],
      [2, 1, "ok"],
    ]);
    expect(groups.get(rows[0].key)?.balance.total).toBe(5475.5);

    // Rehun summa muutetaan: ero näkyy heti.
    const edited = rows.map((r, i) => (i === 1 ? { ...r, amountGross: "1 200,40" } : r));
    groups = suggestionGroups(edited);
    expect(groups.get(rows[0].key)?.balance).toMatchObject({ status: "mismatch", difference: 30 });

    // Kaksi riviä odottamaan: täsmäytys koskee yhä koko tositetta, tallennukseen lähtevät rivien numerot.
    const deferred = rows.map((r, i) => (i === 2 || i === 4 ? { ...r, deferred: true } : r));
    expect(suggestionGroups(deferred).get(rows[0].key)?.deferredKeys).toHaveLength(2);
    expect(deferredSuggestionLines(deferred)).toEqual([{ suggestionId: "s1", lines: [2, 4] }]);
    expect(rows[0].suggestion?.note ?? null).toBeNull();
    expect(rows[6].suggestion?.note).toMatch(/Osuus-sarakkeeseen/);
  });
});

describe("ohje", () => {
  it("jokaisesta lajista on ohje sudenkuoppineen, ja tukilajit ovat samasta luettelosta", () => {
    const p = receiptSystemPrompt(FARM);
    for (const t of AGRI_DOCUMENT_TYPES) expect(p).toContain(t);
    for (const s of SUBSIDY_TYPES) expect(p).toContain(`${s.code}: ${s.label}`);
    for (const phrase of ["Pitfalls", "net amount paid", "vaihtokone", "energiaveron palautus", "private share", "payment date decides the tax year", "osuusmaksu", "Vipu"]) {
      expect(p).toContain(phrase);
    }
  });
});

describe("pitkän vuosiaineiston osat", () => {
  it("300 sivua: 43 osaa, kolme rinnakkain, arvio minuutteina", () => {
    const chunks = planChunks(300);
    expect(chunks).toHaveLength(43);
    expect(chunkParallel(chunks.length)).toBe(3);
    expect(chunkParallel(6)).toBe(2);
    expect(estimateText(300, chunks.length)).toBe("300 sivua, 43 osaa, noin 8–18 min");
    expect(estimateText(150, planChunks(150).length)).toBe("150 sivua, 22 osaa, noin 4–10 min");
  });
});
