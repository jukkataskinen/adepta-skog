import { round2 } from "./amounts";
import { REPLACEMENT_RESERVE } from "./rules";

/**
 * Maatalouden jälleenhankintavarauksen laskuri (MVL 17 §, DECISIONS 2.10.2026).
 * Puhdas funktio: Lomake 2 -välilehden laskuri ja palvelimen tarkistus
 * käyttävät samaa sääntöä, jotta selaimen näyttämä enimmäismäärä ja
 * tallennuksen raja eivät voi erota.
 */

export type ReplacementEvent = "sale" | "damage";

export const REPLACEMENT_EVENT_LABEL: Record<ReplacementEvent, string> = {
  sale: "Luovutus (myynti)",
  damage: "Vahinko (vakuutus- tai muu korvaus)",
};

export interface ReplacementReserveInput {
  /** Luovutushinta tai saatu vahingon-, vakuutus- tai muu korvaus. */
  proceeds: number;
  /** Rakennuksen tai rakennelman hankintamenon poistamatta oleva osa. */
  undepreciated: number;
}

export interface ReplacementReserveResult {
  max: number;
  /** Viimeinen vuosi, jona varaus on käytettävä tai tuloutettava. */
  deadline: number;
}

/** Enimmäismäärä: vain se osa, joka ylittää poistamatta olevan hankintamenon. */
export function replacementReserveMax(i: ReplacementReserveInput): number {
  return Math.max(0, round2(Math.max(0, i.proceeds) - Math.max(0, i.undepreciated)));
}

export function replacementReserveDeadline(madeYear: number): number {
  return madeYear + REPLACEMENT_RESERVE.useYears;
}

export function computeReplacementReserve(i: ReplacementReserveInput, madeYear: number): ReplacementReserveResult {
  return { max: replacementReserveMax(i), deadline: replacementReserveDeadline(madeYear) };
}

/** Tarkistus ennen tallennusta. Palauttaa virheen tekstinä tai null. */
export function validateReplacementReserve(amount: number, i: ReplacementReserveInput): string | null {
  const max = replacementReserveMax(i);
  if (max <= 0) return "Korvaus tai luovutushinta ei ylitä poistamatta olevaa hankintamenoa. Varausta ei voi tehdä.";
  if (!(amount > 0)) return "Anna varauksen määrä.";
  if (amount > max + 0.005) return `Varaus voi olla enintään ${max.toFixed(2).replace(".", ",")} €.`;
  return null;
}
