import { round2 } from "@/lib/tax/amounts";
import { tilitukiId } from "@/lib/import/origin";
import type { TtMachine, TtMachineYear } from "./map";

/**
 * Metsätalouden investointien koko historia Tilitukin kalustokortistosta
 * (KALUSTO.DBF + KALUSPOI.DBF), DECISIONS 5.10.2026 "Tilitukin investointihistoria".
 * Puhdas muunnos ilman kantakutsuja; kirjoitus on run.ts:ssä (syncForestHistory).
 *
 * Tilitukissa jokainen metsätalouden kone, tie tai oja ja rakennus on oma
 * korttinsa, ja kortilla on rivi jokaiselta vuodelta, jonka Tilituki on
 * laskenut: arvo alussa, lisäys, vähennys (myynti), poisto ja arvo lopussa.
 * Kortit täsmäävät lomakkeen 2C ryhmiin (660–626, 670–627, 680–628) vuosina
 * 2012–2025; sitä vanhemmilla lomakkeilla tietuetunnusten merkitys oli toinen.
 *
 * Malli Skogissa:
 * - Kortti, joka on hankittu Tilitukin historian aikana (ensimmäinen vuosi on
 *   hankintavuosi), on tavallinen investointi: hankintapäivä ja -meno, ja
 *   hankintavuoden alun arvo on hankintameno. Näin hankintavuosi näkyy Skogin
 *   laskelmassa, jos se on Skogin verovuosi.
 * - Kortti, jonka historia alkaa myöhemmin kuin hankinta, on aiempi
 *   investointi (opening_year): lähtöarvo on ensimmäisen vuoden alun menojäännös.
 * - Jokainen Tilitukin vuosi tallennetaan poistoriviksi (sk_depreciations),
 *   myös hankintavuosi ja vuodet ilman poistoa. Laskematta jäänyt vuosi
 *   (aukko) saa nollapoiston, jotta arvo kulkee ketjuna. Historiallisia
 *   verovuosia ei luoda: poistorivi ei tarvitse verovuotta, ja Skogin laskenta
 *   alkaa lähtövuodesta (depreciation.ts valueAtStart).
 * - Myyty kortti (vähennys ja arvo sen jälkeen nolla) merkitään myydyksi
 *   myyntivuoden lopussa; myyntivuodelta ei tallenneta poistoriviä.
 */

export type CardKind = "machinery" | "road" | "building";

/** Kortin laji (KALUSTO.PKTYYPPI) ja Skogin menojäännöspoiston prosentti, joka kertoo lajin (rules.ts ASSET_CLASSES). */
export function cardKind(type: string): { kind: CardKind; ratePct: number } {
  const t = (type || "").toLowerCase();
  if (t.includes("tie") || t.includes("oja")) return { kind: "road", ratePct: 15 };
  if (t.includes("rakennus")) return { kind: "building", ratePct: 10 };
  return { kind: "machinery", ratePct: 25 };
}

export interface HistoryYear {
  year: number;
  start: number;
  additions: number;
  disposals: number;
  depreciation: number;
  end: number;
  /** Tilituki ei laskenut vuotta; arvo siirtyy sellaisenaan. */
  gap: boolean;
}

export interface HistoryAsset {
  key: string;
  legacyId: string;
  cardId: string;
  kind: CardKind;
  description: string;
  ratePct: number;
  acquiredOn: string;
  acquisitionCost: number;
  /** Aiempi investointi (hankittu ennen kortin ensimmäistä vuotta): lähtövuosi ja sen alun menojäännös. Muuten tyhjä. */
  openingYear: number | null;
  openingBookValue: number | null;
  openingAccumulated: number | null;
  disposedOn: string | null;
  salePrice: number | null;
  years: HistoryYear[];
  /** Poistorivit Skogiin: kaikki vuodet paitsi myyntivuosi. */
  depreciations: { taxYear: number; amount: number; bookValueEnd: number }[];
  /** Tilitukin viimeisen vuoden loppuarvo (myydyllä voi olla negatiivinen: myyntivoitto). */
  lastEnd: number;
  lastYear: number;
  notes: string[];
}

const yearOf = (d: string) => Number(d.slice(0, 4));

/** Metsätalouden kortit, joilla on joskus ollut arvoa. Tyhjät kortit ohitetaan. */
export function forestCards(machinery: TtMachine[]): TtMachine[] {
  return machinery.filter((m) => (m.source || "").toUpperCase().startsWith("METS"));
}

export function buildCardHistory(folder: string, m: TtMachine): HistoryAsset | null {
  const { kind, ratePct } = cardKind(m.type);
  const raw = Object.entries(m.years)
    .filter(([y]) => /^\d{4}$/.test(y))
    .map(([y, r]) => ({ year: Number(y), r }))
    .sort((a, b) => a.year - b.year);
  const has = (r: TtMachineYear) => r.start > 0 || r.additions > 0 || r.end !== 0 || r.depreciation > 0 || r.disposals > 0;
  const firstIdx = raw.findIndex((x) => has(x.r));
  if (firstIdx < 0) return null;
  const notes: string[] = [];
  // Rivit ensimmäisestä arvollisesta vuodesta viimeiseen; aukot nollapoistolla.
  const years: HistoryYear[] = [];
  const byYear = new Map(raw.map((x) => [x.year, x.r]));
  const firstYear = raw[firstIdx].year;
  const lastYear = raw[raw.length - 1].year;
  let prevEnd = 0;
  for (let y = firstYear; y <= lastYear; y++) {
    const r = byYear.get(y);
    if (!r) {
      years.push({ year: y, start: prevEnd, additions: 0, disposals: 0, depreciation: 0, end: prevEnd, gap: true });
      continue;
    }
    if (y > firstYear && Math.abs(r.start - prevEnd) > 0.011) notes.push(`arvo alussa ${y} poikkeaa edellisen vuoden lopusta`);
    years.push({ year: y, start: r.start, additions: r.additions, disposals: r.disposals, depreciation: r.depreciation, end: r.end, gap: false });
    prevEnd = r.end;
  }
  if (years.filter((y) => y.gap).length) notes.push("vuosi ilman Tilitukin laskentaa (nollapoisto)");

  // Myynti: vähennys, jonka jälkeen kortilla ei ole arvoa. Osittainen vähennys jää arvon pienennykseksi.
  const saleIdx = years.findIndex((y, i) => y.disposals > 0 && years.slice(i + 1).every((n) => n.start <= 0 && n.end <= 0) && y.end <= 0.005);
  const sale = saleIdx >= 0 ? years[saleIdx] : null;
  if (years.some((y, i) => y.disposals > 0 && i !== saleIdx)) notes.push("osittainen vähennys pienentää arvoa (ei myyntinä)");
  // Myynnin jälkeisiä nollarivejä ei tarvita.
  const kept = sale ? years.slice(0, saleIdx + 1) : years;

  const first = kept[0];
  const laterAdditions = round2(kept.slice(1).reduce((s, y) => s + y.additions, 0));
  const baseCost = m.cost > 0 ? m.cost : round2(first.start + first.additions);
  let acquisitionCost = round2(Math.max(baseCost, first.start + first.additions) + laterAdditions);

  // Hankintapäivä: kortin ostopäivä, jos se sopii historiaan. Ilman ostopäivää kortti on hankittu
  // ensimmäisenä vuonna, jos arvo alkaa lisäyksestä, ja muuten jo ennen ensimmäistä vuotta.
  let acquiredOn = first.start > 0 && first.additions === 0 ? `${first.year - 1}-12-31` : `${first.year}-12-31`;
  if (m.acquiredOn && yearOf(m.acquiredOn) <= first.year) acquiredOn = m.acquiredOn;
  else if (m.acquiredOn) notes.push("ostopäivä on ensimmäisen poistovuoden jälkeen: hankintavuodeksi ensimmäinen vuosi");
  const acquiredYear = yearOf(acquiredOn);
  const saleYear = sale?.year ?? null;

  // Hankittu Tilitukin historian aikana: tavallinen investointi, jonka arvo hankintavuoden alussa on
  // hankintameno, joten hankintavuosikin näkyy Skogin laskelmassa. Ennen historiaa hankittu: aiempi
  // investointi, jonka lähtöarvo on ensimmäisen vuoden alun menojäännös.
  const prior = acquiredYear < first.year;
  const openingYear = prior ? first.year : null;
  const openingBookValue = prior ? round2(Math.max(0, first.start)) : null;
  if (prior) acquisitionCost = round2(Math.max(acquisitionCost, openingBookValue!));
  else acquisitionCost = round2(Math.max(acquisitionCost, first.start + first.additions));
  const openingAccumulated = prior ? round2(acquisitionCost - openingBookValue!) : null;

  const depreciations = kept
    .filter((y) => y.year !== saleYear)
    .map((y) => ({ taxYear: y.year, amount: round2(Math.max(0, y.depreciation)), bookValueEnd: round2(Math.max(0, y.end)) }));
  const last = kept[kept.length - 1];
  const key = `machine-${m.id}`;
  return {
    key,
    legacyId: tilitukiId("asset", folder, key),
    cardId: m.id,
    kind,
    description: `${m.name || m.type || "Investointi"} (Tilituki)`,
    ratePct,
    acquiredOn,
    acquisitionCost,
    openingYear,
    openingBookValue,
    openingAccumulated,
    disposedOn: saleYear !== null ? `${saleYear}-12-31` : null,
    salePrice: sale ? round2(sale.disposals) : null,
    years: kept,
    depreciations,
    lastEnd: last.end,
    lastYear: last.year,
    notes,
  };
}

/** Kansion kaikkien metsätalouden korttien historia. */
export function buildForestHistory(folder: string, machinery: TtMachine[]): HistoryAsset[] {
  return forestCards(machinery)
    .map((m) => buildCardHistory(folder, m))
    .filter((a): a is HistoryAsset => a !== null);
}

/** Tilitukin arvo vuoden lopussa (ketjun aukossa edellinen loppuarvo). Ennen ensimmäistä vuotta 0, viimeisen jälkeen viimeinen. */
export function tilitukiEndOf(a: HistoryAsset, year: number): number {
  if (year < a.years[0].year) return 0;
  const y = [...a.years].reverse().find((x) => x.year <= year);
  return y ? y.end : 0;
}

/** Skogissa käsin lisätty investointi, jonka vertailussa tarvittavat tiedot. */
export interface ManualAsset {
  ratePct: number | null;
  acquiredOn: string;
  acquisitionCost: number;
  openingYear: number | null;
  openingBookValue: number | null;
}

/**
 * Onko käsin lisätty investointi sama kohde kuin Tilitukin kortti: sama laji ja
 * sama menojäännös lähtövuotta edeltävän vuoden lopussa (aiempi investointi) tai
 * sama hankintavuosi ja -hinta. Silloin korttia ei tuoda, jotta kohde ei ole kahdesti.
 */
export function sameAsManual(h: HistoryAsset, m: ManualAsset): boolean {
  if (m.ratePct !== h.ratePct) return false;
  if (m.openingYear !== null && m.openingBookValue !== null) {
    const tt = tilitukiEndOf(h, m.openingYear - 1);
    return tt > 0 && Math.abs(tt - m.openingBookValue) <= 0.011;
  }
  return m.acquiredOn.slice(0, 4) === h.acquiredOn.slice(0, 4) && Math.abs(m.acquisitionCost - h.acquisitionCost) <= 0.011;
}
