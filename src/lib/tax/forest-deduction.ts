import { FOREST_DEDUCTION_BASE_PCT } from "./rules";

/**
 * Metsävähennyksen pohja ja jäljellä oleva määrä metsätilalle. Pohja on
 * 60 prosenttia metsämaan hankintamenosta (hankintahinta × metsämaan osuus),
 * kuten vanhassa sovelluksessa (legacy/app/veroraportti). Vuosikohtainen
 * enimmäismäärä lasketaan verosuunnitelmassa (PLAN vaihe 5).
 */
export interface ForestDeductionInput {
  acquisitionPrice: number | null;
  forestLandSharePct: number | null;
  usedBefore: number;
  /** Ohjelmassa kirjatut metsävähennykset. */
  recorded: number[];
}

export interface ForestDeductionBase {
  /** null, jos hankintahinta tai metsämaan osuus puuttuu. */
  base: number | null;
  used: number;
  remaining: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function forestDeductionBase(input: ForestDeductionInput): ForestDeductionBase {
  const used = round2(input.usedBefore + input.recorded.reduce((s, a) => s + a, 0));
  if (input.acquisitionPrice === null || input.forestLandSharePct === null) return { base: null, used, remaining: null };
  const base = round2((input.acquisitionPrice * input.forestLandSharePct * FOREST_DEDUCTION_BASE_PCT) / 10000);
  return { base, used, remaining: round2(Math.max(0, base - used)) };
}
