import { forestDeductionPct } from "./rules";

/**
 * Metsävähennyksen pohja ja jäljellä oleva määrä metsätilalle. Pohja on
 * vuoden prosentti (60 % tai vuodesta 2026 75 %) metsän hankintamenosta.
 * Metsän hankintameno on metsämaan ja puuston yhteinen osuus hankintahinnasta
 * (kenttä forestLandSharePct); rakennukset, pelto, tiet ja ojat eivät kuulu siihen.
 *
 * Verotuksessa kaikki metsävähennysmetsät ovat yksi kokonaisuus. Tilakohtainen
 * luku on apu kirjanpitäjälle ja tallennukselle, ei verotuksen jako.
 */
export interface ForestDeductionInput {
  acquisitionPrice: number | null;
  forestLandSharePct: number | null;
  usedBefore: number;
  /** Ohjelmassa kirjatut metsävähennykset. */
  recorded: number[];
}

export interface ForestDeductionBase {
  /** null, jos hankintahinta tai metsän osuus puuttuu. */
  base: number | null;
  used: number;
  remaining: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function forestDeductionBase(input: ForestDeductionInput, year: number): ForestDeductionBase {
  const used = round2(input.usedBefore + input.recorded.reduce((s, a) => s + a, 0));
  if (input.acquisitionPrice === null || input.forestLandSharePct === null) return { base: null, used, remaining: null };
  const base = round2((input.acquisitionPrice * input.forestLandSharePct * forestDeductionPct(year)) / 10000);
  return { base, used, remaining: round2(Math.max(0, base - used)) };
}
