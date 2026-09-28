import { round2 } from "./amounts";
import { forestryShare } from "./share";
import type { TransactionKind } from "./rules";

/**
 * Arvonlisäveron yhteenveto neljänneksittäin ja vuodelta. Metsätalouden
 * ilmoitusjakso on yleensä kalenterivuosi, mutta neljännekset auttavat, jos
 * asiakas ilmoittaa useammin.
 *
 * Myynnin vero on koko myynnistä, ostojen verosta vähennetään vain
 * metsätalouden osuus (src/lib/tax/share.ts). Muun toiminnan osuus ostojen
 * verosta näytetään erikseen (nonDeductible).
 */

export interface VatRow {
  bookedOn: string;
  kind: TransactionKind;
  amountNet: number;
  amountGross: number;
  /** Myynnit ryhmitellään verokannoittain. */
  vatRate: number;
  /** Metsätalouden osuus prosentteina. Puuttuva = 100. */
  businessSharePct?: number | null;
}

export interface VatPeriod {
  label: string;
  /** Myynnin vero (tulot). */
  output: number;
  /** Ostojen vero (menot ja investoinnit). */
  input: number;
  /** Ostojen vero, joka kuuluu muulle toiminnalle eikä vähennetä. */
  nonDeductible: number;
  payable: number;
  /** Veron määrä verokannoittain myynneistä. */
  byRate: { rate: number; net: number; vat: number }[];
}

function period(label: string, rows: VatRow[]): VatPeriod {
  let output = 0;
  let input = 0;
  let nonDeductible = 0;
  const rates = new Map<number, { net: number; vat: number }>();
  for (const r of rows) {
    const s = forestryShare(r);
    if (r.kind === "income") {
      // Myynnin veron peruste on koko myynti, vaikka tulosta osa kuuluisi muulle toiminnalle.
      output += s.vat;
      const e = rates.get(r.vatRate) ?? { net: 0, vat: 0 };
      e.net += r.amountNet;
      e.vat += s.vat;
      rates.set(r.vatRate, e);
    } else {
      input += s.vat;
      nonDeductible += s.nonDeductibleVat;
    }
  }
  return {
    label,
    output: round2(output),
    input: round2(input),
    nonDeductible: round2(nonDeductible),
    payable: round2(output - input),
    byRate: [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([rate, e]) => ({ rate, net: round2(e.net), vat: round2(e.vat) })),
  };
}

export function vatSummary(rows: VatRow[]): { quarters: VatPeriod[]; year: VatPeriod } {
  const quarters = [1, 2, 3, 4].map((q) =>
    period(
      `${q}. neljännes`,
      rows.filter((r) => Math.ceil(Number(r.bookedOn.slice(5, 7)) / 3) === q),
    ),
  );
  return { quarters, year: period("Koko vuosi", rows) };
}
