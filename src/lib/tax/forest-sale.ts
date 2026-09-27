import { DEEMED_COST_LONG_PCT, DEEMED_COST_LONG_YEARS, DEEMED_COST_PCT, forestDeductionPct, forestSaleAdditionPct } from "./rules";

/**
 * Metsätilan luovutus ja verovelvolliskohtainen metsävähennyspohja. Puhdas
 * laskenta, ei kantakutsuja. Lähde: Verohallinnon ohje Metsävähennys, luku 7
 * (docs/verosaannot-selvitys-2026-09-27.md).
 *
 * - Luovutusvoittoon lisätään koko käytetty metsävähennys (kaikilta tiloilta,
 *   myös ennen ohjelmaa käytetty) vähennettynä aiemmin luovutusvoittoihin
 *   lisätyllä, kuitenkin enintään myydystä metsästä saatu vähennysoikeus.
 * - Lisäys tehdään myös luovutustappioon.
 * - Samana vuonna myytyjen tilojen kesken lisäys jaetaan vähennysoikeuksien suhteessa.
 * - Lisäystä ei tehdä vastikkeettomassa tai verovapaassa luovutuksessa eikä,
 *   jos tila on hankittu ja myyty samana vuonna.
 * - Luovutusvoitto: luovutushinta miinus hankintameno tai hankintameno-olettama,
 *   kumpi on edullisempi, plus lisäys. Määräalan myyntiä ei tueta: tila myydään kokonaan.
 */

export interface ForestPropertyInput {
  id: string;
  acquisitionPrice: number | null;
  acquiredOn: string | null;
  forestLandSharePct: number | null;
  usedBefore: number;
  deductions: { taxYear: number; amount: number }[];
  disposedOn: string | null;
  salePrice: number | null;
  noDeductionAddition: boolean;
}

export interface ForestSale {
  id: string;
  year: number;
  salePrice: number;
  /** Vähennettävä hankintameno: todellinen tai olettama, kumpi on suurempi. */
  cost: number;
  deemedCost: boolean;
  /** Luovutusvoittoon lisättävä käytetty metsävähennys. */
  addition: number;
  /** Luovutusvoitto (+) tai -tappio (−) lisäyksen jälkeen. */
  gain: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));

/** Tilalta saatu metsävähennysoikeus luovutusvuoden lisäysprosentilla. */
function additionCap(p: ForestPropertyInput, year: number): number {
  if (p.acquisitionPrice === null || p.forestLandSharePct === null) return 0;
  return round2((p.acquisitionPrice * p.forestLandSharePct * forestSaleAdditionPct(year)) / 10000);
}

function usedUpTo(props: ForestPropertyInput[], year: number): number {
  return round2(props.reduce((s, p) => s + p.usedBefore + p.deductions.filter((d) => d.taxYear <= year).reduce((x, d) => x + d.amount, 0), 0));
}

export function forestSales(props: ForestPropertyInput[]): ForestSale[] {
  const sold = props.filter((p) => p.disposedOn && p.salePrice !== null).sort((a, b) => a.disposedOn!.localeCompare(b.disposedOn!));
  const years = [...new Set(sold.map((p) => yearOf(p.disposedOn!)))];
  const out: ForestSale[] = [];
  let added = 0;
  for (const year of years) {
    const group = sold.filter((p) => yearOf(p.disposedOn!) === year);
    const eligible = group.filter((p) => !p.noDeductionAddition && !(p.acquiredOn && yearOf(p.acquiredOn) === year));
    const caps = new Map(eligible.map((p) => [p.id, additionCap(p, year)]));
    const totalCap = round2([...caps.values()].reduce((s, c) => s + c, 0));
    const total = round2(Math.min(Math.max(0, usedUpTo(props, year) - added), totalCap));
    added = round2(added + total);
    for (const p of group) {
      const cap = caps.get(p.id) ?? 0;
      const addition = totalCap > 0 ? round2((total * cap) / totalCap) : 0;
      const price = p.salePrice!;
      const heldYears = p.acquiredOn ? (Date.parse(p.disposedOn!) - Date.parse(p.acquiredOn)) / (365.25 * 24 * 3600 * 1000) : 0;
      const deemed = round2((price * (heldYears >= DEEMED_COST_LONG_YEARS ? DEEMED_COST_LONG_PCT : DEEMED_COST_PCT)) / 100);
      const actual = p.acquisitionPrice ?? 0;
      const cost = Math.max(actual, deemed);
      out.push({ id: p.id, year, salePrice: price, cost, deemedCost: deemed > actual, addition, gain: round2(price - cost + addition) });
    }
  }
  return out;
}

/**
 * Käyttämätön metsävähennyspohja vuoden alussa verovelvollisen kaikista
 * metsistä: omistettujen metsien pohja miinus käytetty, johon ei ole vielä
 * tehty lisäystä luovutusvoittoon. Myyntivuonna tila on vielä mukana.
 * Tämän vuoden kirjattu vähennys ei vähennä pohjaa, jotta suunnitelman voi tehdä uudelleen.
 */
export function forestDeductionPool(props: ForestPropertyInput[], year: number): number | null {
  const owned = props.filter((p) => !p.disposedOn || yearOf(p.disposedOn) >= year);
  const bases = owned.map((p) =>
    p.acquisitionPrice === null || p.forestLandSharePct === null ? null : (p.acquisitionPrice * p.forestLandSharePct * forestDeductionPct(year)) / 10000,
  );
  if (!bases.some((b) => b !== null)) return null;
  const used = usedUpTo(props, year - 1);
  const added = forestSales(props)
    .filter((s) => s.year < year)
    .reduce((x, s) => x + s.addition, 0);
  return round2(Math.max(0, bases.reduce<number>((s, b) => s + (b ?? 0), 0) - (used - added)));
}
