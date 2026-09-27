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
 */

export interface AssetInput {
  acquiredOn: string;
  acquisitionCost: number;
  method: "straight_line" | "declining_balance";
  usefulLifeYears: number | null;
  decliningRatePct: number | null;
  openingBookValue: number | null;
  disposedOn: string | null;
  salePrice: number | null;
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
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));

export function assetYear(asset: AssetInput, recorded: RecordedDepreciation[], year: number): AssetYear {
  const acquiredYear = yearOf(asset.acquiredOn);
  const soldYear = asset.disposedOn ? yearOf(asset.disposedOn) : null;
  const inactive: AssetYear = {
    active: false, bookValueStart: 0, min: 0, max: 0, mandatory: false, sold: false, salePrice: 0, saleGain: 0, saleLoss: 0, smallBalance: false,
  };
  if (year < acquiredYear || (soldYear !== null && year > soldYear)) return inactive;

  const previous = recorded.filter((r) => r.taxYear < year).sort((a, b) => b.taxYear - a.taxYear);
  const start = asset.openingBookValue ?? asset.acquisitionCost;
  const bookValueStart = round2(
    previous.length && previous[0].taxYear === year - 1 ? previous[0].bookValueEnd : Math.max(0, start - previous.reduce((s, r) => s + r.amount, 0)),
  );

  if (soldYear === year) {
    const price = asset.salePrice ?? 0;
    return {
      ...inactive, active: true, bookValueStart, sold: true, salePrice: price,
      saleGain: round2(Math.max(0, price - bookValueStart)), saleLoss: round2(Math.max(0, bookValueStart - price)),
    };
  }

  const smallBalance = bookValueStart > 0 && bookValueStart <= SMALL_ASSET_LIMIT;
  let max: number;
  if (smallBalance) max = bookValueStart;
  else if (asset.method === "declining_balance") max = round2((bookValueStart * (asset.decliningRatePct ?? 0)) / 100);
  else max = round2(Math.min(bookValueStart, asset.usefulLifeYears ? asset.acquisitionCost / asset.usefulLifeYears : bookValueStart));
  return { ...inactive, active: true, bookValueStart, max, smallBalance };
}
