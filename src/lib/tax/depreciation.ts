/**
 * Investoinnin poisto verovuodelle. Puhdas laskenta, ei kantakutsuja.
 *
 * - Poistamaton arvo vuoden alussa: edellisen vuoden kirjattu loppuarvo, tai
 *   jos sitä ei ole, lähtöarvo (hankintameno tai tuotu poistamaton arvo)
 *   miinus aiemmat poistot. Hankintavuonna koko hankintameno.
 * - Menojäännöspoisto: vapaaehtoinen, enintään prosentti poistamattomasta arvosta.
 * - Tasapoisto: hankintameno jaettuna poistoajalla, kunnes arvo on nolla. Pakollinen.
 * - Myyntivuonna poistoa ei tehdä. Myyntihinta yli poistamattoman arvon on
 *   myyntivoittoa (tuloa), alle jäävä osa myyntitappiota (vähennys).
 *
 * Säännöt vahvistetaan (BLOCKERS 4). Vanha sovellus laski menojäännöspoiston
 * pohjaksi hankintahinnan miinus jäännösarvon joka vuosi.
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
  mandatory: boolean;
  sold: boolean;
  saleGain: number;
  saleLoss: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));

export function assetYear(asset: AssetInput, recorded: RecordedDepreciation[], year: number): AssetYear {
  const acquiredYear = yearOf(asset.acquiredOn);
  const soldYear = asset.disposedOn ? yearOf(asset.disposedOn) : null;
  const inactive: AssetYear = { active: false, bookValueStart: 0, min: 0, max: 0, mandatory: false, sold: false, saleGain: 0, saleLoss: 0 };
  if (year < acquiredYear || (soldYear !== null && year > soldYear)) return inactive;

  const previous = recorded.filter((r) => r.taxYear < year).sort((a, b) => b.taxYear - a.taxYear);
  const start = asset.openingBookValue ?? asset.acquisitionCost;
  const bookValueStart = round2(
    previous.length && previous[0].taxYear === year - 1 ? previous[0].bookValueEnd : Math.max(0, start - previous.reduce((s, r) => s + r.amount, 0)),
  );

  if (soldYear === year) {
    const price = asset.salePrice ?? 0;
    return {
      active: true, bookValueStart, min: 0, max: 0, mandatory: false, sold: true,
      saleGain: round2(Math.max(0, price - bookValueStart)), saleLoss: round2(Math.max(0, bookValueStart - price)),
    };
  }

  if (asset.method === "declining_balance") {
    const max = round2((bookValueStart * (asset.decliningRatePct ?? 0)) / 100);
    return { active: true, bookValueStart, min: 0, max, mandatory: false, sold: false, saleGain: 0, saleLoss: 0 };
  }
  const annual = asset.usefulLifeYears ? asset.acquisitionCost / asset.usefulLifeYears : bookValueStart;
  const amount = round2(Math.min(bookValueStart, annual));
  return { active: true, bookValueStart, min: amount, max: amount, mandatory: true, sold: false, saleGain: 0, saleLoss: 0 };
}
