import { SMALL_ASSET_LIMIT } from "./rules";

/**
 * Investoinnin poisto verovuodelle. Puhdas laskenta, ei kantakutsuja.
 * Lähteet: docs/verosaannot-selvitys-2026-09-27.md.
 *
 * - Poistamaton arvo vuoden alussa: edellisen vuoden kirjattu loppuarvo, tai
 *   jos sitä ei ole, lähtöarvo (hankintameno tai tuotu poistamaton arvo)
 *   miinus aiemmat poistot. Hankintavuonna koko hankintameno, joten poiston
 *   voi tehdä jo ostovuonna.
 * - Menojäännöspoisto hyödykekohtaisesti, enintään lajin prosentti (kone 25 %,
 *   tie tai oja 15 %, rakennus 10 %). Poisto on aina vapaaehtoinen.
 * - Enintään 600 euron menojäännös saa poistaa kerralla.
 * - Tasapoistoa metsätaloudessa ei ole. Vanhasta sovelluksesta tuoduille
 *   tasapoistoille lasketaan sama vuosiosuus kuin ennen, mutta vapaaehtoisena.
 * - Myyntivuonna poistoa ei tehdä. Myyntihinta miinus poistamaton arvo on
 *   luovutusvoitto tai -tappio, joka ei ole metsätalouden tuloa.
 * - Metsätie tai oja siirtyy metsätilan luovutuksessa: myydyn osuuden
 *   poistamaton arvo vuoden alussa lisätään metsän hankintamenoon
 *   (transferred), ja vuoden poisto lasketaan jäljelle jäävästä arvosta. Kun
 *   koko tila on myyty, investointia ei enää poisteta.
 * - Aiemmin hankittu investointi (openingYear): openingBookValue on
 *   menojäännös vuoden openingYear alussa eli edellisen vuoden lopussa.
 *   Laskenta alkaa siitä vuodesta, ja aiemmat vuodet ovat inaktiivisia, jotta
 *   niille ei näy poistoa. Ilman openingYearia (vanhan sovelluksen tuonti)
 *   openingBookValue on arvo hankintavuoden alussa kuten ennen.
 */

export interface AssetInput {
  acquiredOn: string;
  acquisitionCost: number;
  method: "straight_line" | "declining_balance";
  usefulLifeYears: number | null;
  decliningRatePct: number | null;
  openingBookValue: number | null;
  /** Vuosi, jonka alun arvo openingBookValue on (aiempi investointi). Tyhjä vanhoilla riveillä. */
  openingYear?: number | null;
  disposedOn: string | null;
  salePrice: number | null;
  /** Metsätilan luovutukset: vuosi ja osa vuoden alun arvosta, joka siirtyy (1 = kaikki). */
  transferFractions?: { year: number; fraction: number }[];
}

export interface RecordedDepreciation {
  taxYear: number;
  amount: number;
  bookValueEnd: number;
}

export interface AssetYear {
  /** Investointi ei kuulu tälle vuodelle (hankittu myöhemmin tai myyty aiemmin). */
  active: boolean;
  bookValueStart: number;
  min: number;
  max: number;
  /** Ei enää käytössä: metsätalouden poistot ovat vapaaehtoisia. Pidetään rajapinnassa aina false. */
  mandatory: boolean;
  sold: boolean;
  salePrice: number;
  saleGain: number;
  saleLoss: number;
  /** Enintään 600 euron jäännös, jonka saa poistaa kerralla. */
  smallBalance: boolean;
  /** Metsätilan luovutuksessa metsän hankintamenoon siirtyvä poistamaton arvo. */
  transferred: number;
  /** Arvo, josta vuoden poisto lasketaan: vuoden alun arvo miinus siirretty. */
  bookValueBase: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));

/** Poistamaton arvo vuoden alussa ilman luovutuksia (kirjatut loppuarvot tai poistot). */
function valueAtStart(asset: AssetInput, recorded: RecordedDepreciation[], year: number): number {
  // Aiemman investoinnin menojäännöksessä on jo kaikki ennen openingYearia tehdyt poistot.
  const from = asset.openingYear ?? -Infinity;
  const previous = recorded.filter((r) => r.taxYear >= from && r.taxYear < year).sort((a, b) => b.taxYear - a.taxYear);
  const start = asset.openingBookValue ?? asset.acquisitionCost;
  return round2(previous.length && previous[0].taxYear === year - 1 ? previous[0].bookValueEnd : Math.max(0, start - previous.reduce((s, r) => s + r.amount, 0)));
}

export function assetYear(asset: AssetInput, recorded: RecordedDepreciation[], year: number): AssetYear {
  // Ensimmäinen vuosi, jonka poisto lasketaan: hankintavuosi tai aiemman investoinnin avausvuosi.
  const firstYear = Math.max(yearOf(asset.acquiredOn), asset.openingYear ?? -Infinity);
  const soldYear = asset.disposedOn ? yearOf(asset.disposedOn) : null;
  const inactive: AssetYear = {
    active: false, bookValueStart: 0, min: 0, max: 0, mandatory: false, sold: false, salePrice: 0, saleGain: 0, saleLoss: 0, smallBalance: false,
    transferred: 0, bookValueBase: 0,
  };
  if (year < firstYear || (soldYear !== null && year > soldYear)) return inactive;

  // Luovutusten jälkeen arvo lasketaan ketjuna ensimmäisestä luovutusvuodesta:
  // siirretty osuus pois ja kirjattu poisto pois vuosittain. Kirjattuun
  // loppuarvoon ei luoteta, koska luovutus on voitu kirjata vahvistuksen jälkeen.
  const fraction = (y: number) => (asset.transferFractions ?? []).filter((t) => t.year === y).reduce((s, t) => s + t.fraction, 0);
  const transfers = (asset.transferFractions ?? []).filter((t) => t.year >= firstYear && t.year < year && t.fraction > 0);
  let bookValueStart: number;
  if (!transfers.length) bookValueStart = valueAtStart(asset, recorded, year);
  else {
    const first = Math.min(...transfers.map((t) => t.year));
    let v = valueAtStart(asset, recorded, first);
    for (let y = first; y < year; y++) {
      const f = Math.min(1, fraction(y));
      if (f >= 1) return inactive;
      v = Math.max(0, v * (1 - f) - (recorded.find((r) => r.taxYear === y)?.amount ?? 0));
    }
    bookValueStart = round2(v);
  }

  if (soldYear === year) {
    const price = asset.salePrice ?? 0;
    return {
      ...inactive, active: true, bookValueStart, sold: true, salePrice: price,
      saleGain: round2(Math.max(0, price - bookValueStart)), saleLoss: round2(Math.max(0, bookValueStart - price)),
    };
  }

  const f = Math.min(1, fraction(year));
  // Koko tila myyty: arvo siirtyy hankintamenoon, eikä poistoa enää tehdä.
  if (f >= 1) return { ...inactive, bookValueStart, transferred: bookValueStart };
  const transferred = round2(bookValueStart * f);
  const base = round2(bookValueStart - transferred);

  const smallBalance = base > 0 && base <= SMALL_ASSET_LIMIT;
  let max: number;
  if (smallBalance) max = base;
  else if (asset.method === "declining_balance") max = round2((base * (asset.decliningRatePct ?? 0)) / 100);
  else max = round2(Math.min(base, asset.usefulLifeYears ? asset.acquisitionCost / asset.usefulLifeYears : base));
  return { ...inactive, active: true, bookValueStart, max, smallBalance, transferred, bookValueBase: base };
}
