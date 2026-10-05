import { describe, expect, it } from "vitest";
import {
  amountClose,
  dayInYear,
  expectedKey,
  expectedStatus,
  findExpected,
  normalizeDescription,
  similarity,
  summarizeExpected,
  type CurrentEntry,
  type HistoryEntry,
} from "@/lib/ledger/expected";

/** Odotetut kirjaukset (src/lib/ledger/expected.ts). Kuvitteellinen aineisto. */

let n = 0;
function h(bookedOn: string, category: string, description: string, amountGross: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `h${n++}`,
    year: Number(bookedOn.slice(0, 4)),
    bookedOn,
    category,
    kind: category === "standing_sale" ? "income" : "expense",
    activity: category.startsWith("agri_") ? "agriculture" : "forestry",
    description,
    amountGross,
    vatRate: 0,
    businessSharePct: 100,
    otherSharePct: 0,
    farmId: null,
    forestPropertyId: null,
    ...extra,
  };
}
function c(bookedOn: string, category: string, description: string, amountGross: number): CurrentEntry {
  return { id: `c${n++}`, bookedOn, category, activity: category.startsWith("agri_") ? "agriculture" : "forestry", description, amountGross };
}
const opts = { year: 2026, vatRegistered: false };

describe("selitteen normalisointi", () => {
  it("poistaa numerot, päivät, viitteet, vuodet ja kuukaudet", () => {
    expect(normalizeDescription("Metsänhoitomaksu 2025, lasku 12345 eräpäivä 15.3.2025")).toEqual(["eräpäivä", "metsänhoitomaksu"]);
    expect(normalizeDescription("Sähkö tammikuu 2024 viite RF18 5390 0754")).toEqual(["sähkö"]);
    expect(normalizeDescription("Sähkö helmikuun 2024")).toEqual(["sähkö"]);
    expect(normalizeDescription("Vakuutus Oy Esimerkki Ab")).toEqual(["esimerkki", "vakuutus"]);
    expect(normalizeDescription("")).toEqual([]);
  });

  it("samankaltaisuus sanoista, taivutus sallitaan", () => {
    expect(similarity(["metsänhoitomaksu"], ["metsänhoitomaksut"])).toBe(1);
    expect(similarity(["tiemaksu", "yksityistie"], ["tiemaksu"])).toBe(0.5);
    expect(similarity(["sähkö"], ["vakuutus"])).toBe(0);
    expect(similarity([], [])).toBe(1);
    expect(similarity([], ["sähkö"])).toBe(0);
  });

  it("tunniste on vakaa ja ei sisällä selitettä", () => {
    const k = expectedKey("forestry", "other_expense", ["metsänhoitomaksu"]);
    expect(k).toMatch(/^[0-9a-f]{8}$/);
    expect(expectedKey("forestry", "other_expense", ["metsänhoitomaksu"])).toBe(k);
    expect(expectedKey("forestry", "travel", ["metsänhoitomaksu"])).not.toBe(k);
  });

  it("summien läheisyys", () => {
    expect(amountClose(100, 115, 0.2)).toBe(true);
    expect(amountClose(100, 130, 0.2)).toBe(false);
    expect(amountClose(-100, 100, 0.2)).toBe(false);
    expect(amountClose(0, 0, 0.2)).toBe(false);
  });

  it("päivä tänä vuonna siirtyy kuukauden viimeiseen", () => {
    expect(dayInYear(2026, 2, 29)).toBe("2026-02-28");
    expect(dayInYear(2026, 4, 31)).toBe("2026-04-30");
    expect(dayInYear(2028, 2, 29)).toBe("2028-02-29");
  });
});

describe("toistuvien tunnistus", () => {
  it("vuosittainen: kahtena kolmesta vuodesta riittää, kuukausi ja päivä tuoreimmasta", () => {
    const history = [
      h("2023-03-10", "other_expense", "Metsänhoitomaksu 2023", 180),
      h("2025-03-14", "other_expense", "Metsänhoitomaksu 2025", 200),
    ];
    const [e, ...rest] = findExpected(history, opts);
    expect(rest).toHaveLength(0);
    expect(e.perYear).toBe(1);
    expect(e.instances).toEqual([{ index: 0, month: 3, date: "2026-03-14" }]);
    expect(e.estimate).toBe(200);
    expect([e.min, e.max]).toEqual([180, 200]);
    expect(e.description).toBe("Metsänhoitomaksu 2026");
    expect(e.recentYears).toBe(2);
    expect(e.lookbackYears).toBe(3);
    expect(e.confidence).toBe("medium");
  });

  it("joka vuosi = korkea luotettavuus", () => {
    const history = [2023, 2024, 2025].map((y) => h(`${y}-11-02`, "other_expense", "Vakuutus metsä", 300 + y - 2023));
    const [e] = findExpected(history, opts);
    expect(e.confidence).toBe("high");
    expect(e.yearsSeen).toEqual([2025, 2024, 2023]);
    expect(e.estimate).toBe(302);
  });

  it("neljännesvuosittainen: neljä kertaa vuodessa omina kuukausinaan", () => {
    const history = [2024, 2025].flatMap((y) => [3, 6, 9, 12].map((m) => h(`${y}-${String(m).padStart(2, "0")}-28`, "other_expense", `Tiemaksu Q${m / 3}`, 50)));
    const [e] = findExpected(history, opts);
    expect(e.perYear).toBe(4);
    expect(e.instances.map((i) => i.month)).toEqual([3, 6, 9, 12]);
  });

  it("epäsäännöllinen ei ole toistuva: vain yhtenä kolmesta vuodesta", () => {
    const history = [
      h("2023-05-01", "other_expense", "Vakuutus", 300),
      h("2024-05-01", "other_expense", "Vakuutus", 300),
      h("2025-05-01", "other_expense", "Vakuutus", 300),
      h("2024-08-12", "standing_sale", "Pystykauppa harvennus", 12000),
    ];
    const list = findExpected(history, opts);
    expect(list.map((e) => e.category)).toEqual(["other_expense"]);
  });

  it("eri luokka tai eri selite on eri ryhmä", () => {
    const history = [2024, 2025].flatMap((y) => [
      h(`${y}-02-01`, "other_expense", "Sähkö", 40),
      h(`${y}-02-01`, "other_expense", "Puhelin", 900),
      h(`${y}-02-01`, "travel", "Sähkö", 40),
    ]);
    expect(findExpected(history, opts)).toHaveLength(3);
  });

  it("vaihtuva selite yhdistyy saman luokan läheiseen summaan", () => {
    const history = [h("2024-04-02", "other_expense", "Lasku Alfa", 1000), h("2025-04-03", "other_expense", "Beeta", 1080)];
    const [e] = findExpected(history, opts);
    expect(e.recentYears).toBe(2);
    expect(findExpected(history, { ...opts, amountTolerance: 0 })).toHaveLength(0);
  });

  it("investoinnin hankinta ja myynti eivät ole toistuvia", () => {
    const history = [2024, 2025].map((y) => h(`${y}-04-02`, "asset_purchase", "Kone", 5000));
    expect(findExpected(history, opts)).toHaveLength(0);
  });

  it("uusi asiakas: ei historiaa, ei ennustetta; yksi vuosi = heikko ennuste", () => {
    expect(findExpected([], opts)).toHaveLength(0);
    const [e] = findExpected([h("2025-06-01", "other_expense", "Tiemaksu", 80)], opts);
    expect(e.confidence).toBe("low");
    expect(e.lookbackYears).toBe(1);
  });

  it("verokanta seuraa uutta oletusta, jos edellinen oli silloinen oletus", () => {
    const history = [2023, 2024].map((y) => h(`${y}-05-01`, "other_expense", "Huolto", 124, { vatRate: 24 }));
    const [e] = findExpected(history, { year: 2025, vatRegistered: true });
    expect(e.vatRate).toBe(25.5);
    const [kept] = findExpected(history.map((x) => ({ ...x, vatRate: 14 })), { year: 2025, vatRegistered: true });
    expect(kept.vatRate).toBe(14);
  });
});

describe("tämän vuoden tila", () => {
  const history = [2024, 2025].flatMap((y) => [
    h(`${y}-03-14`, "other_expense", `Metsänhoitomaksu ${y}`, 200),
    ...[3, 6, 9, 12].map((m) => h(`${y}-${String(m).padStart(2, "0")}-28`, "other_expense", "Tiemaksu", 50)),
  ]);
  const entries = findExpected(history, opts);
  const fee = entries.find((e) => e.perYear === 1)!;
  const road = entries.find((e) => e.perYear === 4)!;

  it("kirjattu, myöhässä ja tulossa", () => {
    const current = [c("2026-03-20", "other_expense", "Metsänhoitomaksut 2026", 210), c("2026-04-02", "other_expense", "Tiemaksu", 50)];
    const st = expectedStatus(entries, current, { year: 2026, today: "2026-08-15" });
    const f = st.find((s) => s.key === fee.key)!;
    expect(f.booked).toBe(1);
    expect(f.states[0].transactionId).toBe(current[0].id);
    const r = st.find((s) => s.key === road.key)!;
    expect(r.states.map((s) => s.status)).toEqual(["booked", "late", "upcoming", "upcoming"]);
    expect(r.next?.month).toBe(6);
    expect(summarizeExpected(st)).toEqual({ expected: 5, booked: 2, late: 1, upcoming: 2, skipped: 0 });
  });

  it("kirjaus tunnistetaan summasta, kun selite on eri", () => {
    const st = expectedStatus(entries, [c("2026-03-02", "other_expense", "Laskun teksti", 205)], { year: 2026, today: "2026-12-31" });
    expect(st.find((s) => s.key === fee.key)!.booked).toBe(1);
    const other = expectedStatus(entries, [c("2026-03-02", "travel", "Metsänhoitomaksu", 200)], { year: 2026, today: "2026-12-31" });
    expect(other.find((s) => s.key === fee.key)!.booked).toBe(0);
  });

  it("ohitettu ei ole myöhässä; aiempi vuosi on kokonaan mennyt", () => {
    const st = expectedStatus(entries, [], { year: 2026, today: "2026-12-31", skipped: [road.key] });
    expect(st.find((s) => s.key === road.key)!.states.every((s) => s.status === "skipped")).toBe(true);
    expect(st.find((s) => s.key === fee.key)!.late).toBe(1);
    const future = expectedStatus(entries, [], { year: 2026, today: "2025-12-01" });
    expect(summarizeExpected(future).upcoming).toBe(5);
  });
});
