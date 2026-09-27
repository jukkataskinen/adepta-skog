import { DEEMED_COST_LONG_PCT, DEEMED_COST_LONG_YEARS, DEEMED_COST_PCT, forestDeductionPct, forestSaleAdditionPct } from "./rules";

/**
 * Metsätilan luovutukset ja verovelvolliskohtainen metsävähennyspohja. Puhdas
 * laskenta, ei kantakutsuja. Lähde: Verohallinnon ohje Metsävähennys, luvut
 * 3.4 ja 7 (docs/verosaannot-selvitys-2026-09-27.md, DECISIONS 27.9.2026).
 *
 * Tilasta voi myydä osan (määräala tai määräosa) useita kertoja. Osuus
 * (sharePct) on myydyn osan osuus tilan hankintamenosta. Koko tilan myynti on
 * osuus 100 %.
 *
 * - Luovutusvoittoon lisätään koko käytetty metsävähennys (kaikilta tiloilta,
 *   myös ennen ohjelmaa käytetty, ei luovutusvuoden omaa vähennystä)
 *   vähennettynä aiemmin luovutusvoittoihin lisätyllä, kuitenkin enintään
 *   myydystä osasta saatu vähennysoikeus.
 * - Lisäys tehdään myös luovutustappioon.
 * - Samana vuonna tehtyjen luovutusten kesken lisäys jaetaan vähennysoikeuksien suhteessa.
 * - Lisäystä ei tehdä vastikkeettomassa tai verovapaassa luovutuksessa eikä,
 *   jos tila on hankittu samana vuonna.
 * - Luovutusvoitto: luovutushinta miinus joko hankintameno-olettama tai
 *   todellinen hankintameno (osuus tilan hinnasta ja tien ja ojien poistamaton
 *   arvo) ja myyntikulut, kumpi on suurempi, plus lisäys.
 * - Myyty osuus ei tuo metsävähennyspohjaa enää luovutusvuonna (luku 3.4).
 */

export interface ForestDisposalInput {
  id: string;
  disposedOn: string;
  salePrice: number;
  /** Myydyn osan osuus tilan hankintamenosta, 0 < x ≤ 100. */
  sharePct: number;
  sellingCosts: number;
  noDeductionAddition: boolean;
  /** Myydyn osan poistamattomat tie- ja ojamenot (lasketaan investoinneista). */
  roadDitchCost: number;
}

export interface ForestPropertyInput {
  id: string;
  acquisitionPrice: number | null;
  acquiredOn: string | null;
  forestLandSharePct: number | null;
  usedBefore: number;
  deductions: { taxYear: number; amount: number }[];
  disposals: ForestDisposalInput[];
}

export interface ForestSale {
  /** Luovutuksen tunniste. */
  id: string;
  propertyId: string;
  year: number;
  disposedOn: string;
  salePrice: number;
  sharePct: number;
  /** Myydyn osan osuus tilan hankintamenosta. */
  acquisitionCost: number;
  /** Hankintamenoon lisätyt poistamattomat tie- ja ojamenot. */
  roadDitchCost: number;
  sellingCosts: number;
  /** Hankintameno-olettama (20 tai 40 % kauppahinnasta). */
  deemedCost: number;
  deemedPct: number;
  /** Olettama on suurempi kuin hankintameno, tie- ja ojamenot ja myyntikulut yhteensä. */
  usesDeemedCost: boolean;
  /** Kauppahinnasta vähennetty määrä yhteensä. */
  cost: number;
  /** Luovutusvoittoon lisättävä käytetty metsävähennys. */
  addition: number;
  /** Luovutusvoitto (+) tai -tappio (−) lisäyksen jälkeen. */
  gain: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));

/** Tilasta myyty osuus prosentteina vuoden loppuun mennessä. */
export function soldSharePct(p: { disposals: Pick<ForestDisposalInput, "disposedOn" | "sharePct">[] }, year: number): number {
  return Math.min(100, round2(p.disposals.filter((d) => yearOf(d.disposedOn) <= year).reduce((s, d) => s + d.sharePct, 0)));
}

/**
 * Luovutusvuosittain se osa tilan jäljellä olevasta arvosta, joka lähtee
 * luovutuksissa (1 = kaikki). Tien tai ojan poistamaton arvo jaetaan samassa
 * suhteessa kuin tilan hankintameno, koska sijaintia ei tiedetä.
 */
export function disposalFractions(disposals: Pick<ForestDisposalInput, "disposedOn" | "sharePct">[]): { year: number; fraction: number }[] {
  const years = [...new Set(disposals.map((d) => yearOf(d.disposedOn)))].sort((a, b) => a - b);
  let before = 0;
  return years.map((year) => {
    const inYear = disposals.filter((d) => yearOf(d.disposedOn) === year).reduce((s, d) => s + d.sharePct, 0);
    const left = 100 - before;
    before += inYear;
    return { year, fraction: left <= 0 ? 0 : Math.min(1, inYear / left) };
  });
}

/** Myydystä osasta saatu metsävähennysoikeus luovutusvuoden lisäysprosentilla. */
function additionCap(p: ForestPropertyInput, d: ForestDisposalInput, year: number): number {
  if (p.acquisitionPrice === null || p.forestLandSharePct === null) return 0;
  return round2((p.acquisitionPrice * p.forestLandSharePct * d.sharePct * forestSaleAdditionPct(year)) / 1e6);
}

/** Ennen vuotta käytetty metsävähennys kaikilta tiloilta. */
function usedBefore(props: ForestPropertyInput[], year: number): number {
  return round2(props.reduce((s, p) => s + p.usedBefore + p.deductions.filter((d) => d.taxYear < year).reduce((x, d) => x + d.amount, 0), 0));
}

export function forestSales(props: ForestPropertyInput[]): ForestSale[] {
  const all = props
    .flatMap((p) => p.disposals.map((d) => ({ p, d })))
    .sort((a, b) => a.d.disposedOn.localeCompare(b.d.disposedOn) || a.d.id.localeCompare(b.d.id));
  const years = [...new Set(all.map((x) => yearOf(x.d.disposedOn)))];
  const out: ForestSale[] = [];
  let added = 0;
  for (const year of years) {
    const group = all.filter((x) => yearOf(x.d.disposedOn) === year);
    const eligible = group.filter(({ p, d }) => !d.noDeductionAddition && !(p.acquiredOn && yearOf(p.acquiredOn) === year));
    const caps = new Map(eligible.map(({ p, d }) => [d.id, additionCap(p, d, year)]));
    const totalCap = round2([...caps.values()].reduce((s, c) => s + c, 0));
    const total = round2(Math.min(Math.max(0, usedBefore(props, year) - added), totalCap));
    added = round2(added + total);
    for (const { p, d } of group) {
      const cap = caps.get(d.id) ?? 0;
      const addition = totalCap > 0 ? round2((total * cap) / totalCap) : 0;
      const heldYears = p.acquiredOn ? (Date.parse(d.disposedOn) - Date.parse(p.acquiredOn)) / (365.25 * 24 * 3600 * 1000) : 0;
      const deemedPct = heldYears >= DEEMED_COST_LONG_YEARS ? DEEMED_COST_LONG_PCT : DEEMED_COST_PCT;
      const deemedCost = round2((d.salePrice * deemedPct) / 100);
      const acquisitionCost = round2(((p.acquisitionPrice ?? 0) * d.sharePct) / 100);
      // Myyntikulut vähennetään vain todellisen hankintamenon kanssa; olettaman lisäksi ei vähennetä mitään (TVL 46 § 2 mom.).
      const actual = round2(acquisitionCost + d.roadDitchCost + d.sellingCosts);
      const usesDeemedCost = deemedCost > actual;
      const cost = usesDeemedCost ? deemedCost : actual;
      out.push({
        id: d.id, propertyId: p.id, year, disposedOn: d.disposedOn, salePrice: d.salePrice, sharePct: d.sharePct,
        acquisitionCost, roadDitchCost: d.roadDitchCost, sellingCosts: d.sellingCosts, deemedCost, deemedPct, usesDeemedCost, cost,
        addition, gain: round2(d.salePrice - cost + addition),
      });
    }
  }
  return out;
}

/**
 * Käyttämätön metsävähennyspohja verovuonna verovelvollisen kaikista metsistä:
 * vuoden lopussa omistettujen metsien pohja (myyty osuus pois jo luovutusvuonna)
 * miinus ennen vuotta käytetty vähennys, josta vähennetään luovutusvoittoihin
 * vuoden loppuun mennessä lisätty. Tämän vuoden kirjattu vähennys ei vähennä
 * pohjaa, jotta suunnitelman voi tehdä uudelleen. null, jos yhdenkään
 * omistetun tilan tietoja ei ole.
 */
export function forestDeductionPool(props: ForestPropertyInput[], year: number): number | null {
  const owned = props.filter((p) => soldSharePct(p, year) < 100);
  const bases = owned.map((p) =>
    p.acquisitionPrice === null || p.forestLandSharePct === null
      ? null
      : (p.acquisitionPrice * p.forestLandSharePct * forestDeductionPct(year) * (100 - soldSharePct(p, year))) / 1e6,
  );
  if (!bases.some((b) => b !== null)) return null;
  const added = forestSales(props)
    .filter((s) => s.year <= year)
    .reduce((x, s) => x + s.addition, 0);
  return round2(Math.max(0, bases.reduce<number>((s, b) => s + (b ?? 0), 0) - (usedBefore(props, year) - added)));
}

const pct = (n: number) => `${n.toLocaleString("fi-FI", { maximumFractionDigits: 2 })} %`;

/**
 * Luovutusvoittolaskelman rivit näytölle ja raporttiin, jotta molemmat
 * näyttävät saman laskelman. Summa on etumerkillinen (vähennys miinuksena).
 * Huomautus kertoo vaihtoehdon, jota ei käytetty.
 */
export function forestSaleLines(f: ForestSale): { lines: [string, number][]; result: [string, number]; note: string | null } {
  const lines: [string, number][] = [[f.sharePct < 100 ? `Kauppahinta (myyty ${pct(f.sharePct)} tilasta)` : "Kauppahinta", f.salePrice]];
  if (f.usesDeemedCost) lines.push([`Hankintameno-olettama ${f.deemedPct} % kauppahinnasta`, -f.deemedCost]);
  else {
    lines.push([f.sharePct < 100 ? `Hankintameno, ${pct(f.sharePct)} tilan hankintamenosta` : "Hankintameno", -f.acquisitionCost]);
    if (f.roadDitchCost) lines.push(["Poistamattomat tie- ja ojamenot", -f.roadDitchCost]);
    if (f.sellingCosts) lines.push(["Myyntikulut", -f.sellingCosts]);
  }
  lines.push(["Käytetty metsävähennys lisätään (TVL 46 § 8 mom.)", f.addition]);
  const actual = round2(f.acquisitionCost + f.roadDitchCost + f.sellingCosts);
  const note = f.usesDeemedCost
    ? `Olettama on edullisempi kuin hankintameno ${actual.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € (tie- ja ojamenot ja myyntikulut mukana).`
    : null;
  return { lines, result: [f.gain >= 0 ? "Luovutusvoitto" : "Luovutustappio", f.gain], note };
}

/**
 * Metsävähennyksen seurantatiedot veroilmoitukselle (2C, kohdat 14–16 eli
 * tunnukset 655–657). Samat luvut kuin forestDeductionPool, mutta eriteltyinä,
 * koska ilmoitukselle annetaan pohja, aiemmin käytetty ja luovutusvoittoihin
 * lisätty erikseen ja Verohallinto laskee käytettävissä olevan niistä (#1991).
 * - base: vuoden lopussa omistettujen metsien pohja (myyty osuus pois).
 * - usedBefore: ennen verovuotta käytetty vähennys kaikilta tiloilta, myös myydyiltä.
 * - addedToGains: luovutusvoittoihin vuoden loppuun mennessä lisätty.
 * - missing: omistettuja tiloja, joilta puuttuu hankintahinta tai metsän osuus.
 * null, jos yhdenkään omistetun tilan pohjaa ei voi laskea.
 */
export function forestDeductionTracking(
  props: ForestPropertyInput[],
  year: number,
): { base: number; usedBefore: number; addedToGains: number; missing: number } | null {
  const owned = props.filter((p) => soldSharePct(p, year) < 100);
  const bases = owned.map((p) =>
    p.acquisitionPrice === null || p.forestLandSharePct === null
      ? null
      : (p.acquisitionPrice * p.forestLandSharePct * forestDeductionPct(year) * (100 - soldSharePct(p, year))) / 1e6,
  );
  if (!bases.some((b) => b !== null)) return null;
  const addedToGains = forestSales(props)
    .filter((s) => s.year <= year)
    .reduce((x, s) => x + s.addition, 0);
  return {
    base: round2(bases.reduce<number>((s, b) => s + (b ?? 0), 0)),
    usedBefore: usedBefore(props, year),
    addedToGains: round2(addedToGains),
    missing: bases.filter((b) => b === null).length,
  };
}
