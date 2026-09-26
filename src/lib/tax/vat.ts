import { vatAmount } from "@/lib/ledger/summary";
import type { TransactionKind } from "./rules";

/**
 * Arvonlisäveron yhteenveto neljänneksittäin ja vuodelta. Metsätalouden
 * ilmoitusjakso on yleensä kalenterivuosi, mutta neljännekset auttavat, jos
 * asiakas ilmoittaa useammin.
 */

export interface VatRow {
  bookedOn: string;
  kind: TransactionKind;
  amountNet: number;
  vatRate: number;
}

export interface VatPeriod {
  label: string;
  /** Myynnin vero (tulot). */
  output: number;
  /** Ostojen vero (menot ja investoinnit). */
  input: number;
  payable: number;
  /** Veron määrä verokannoittain myynneistä. */
  byRate: { rate: number; net: number; vat: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function period(label: string, rows: VatRow[]): VatPeriod {
  let output = 0;
  let input = 0;
  const rates = new Map<number, { net: number; vat: number }>();
  for (const r of rows) {
    const vat = vatAmount(r.amountNet, r.vatRate);
    if (r.kind === "income") {
      output += vat;
      const e = rates.get(r.vatRate) ?? { net: 0, vat: 0 };
      e.net += r.amountNet;
      e.vat += vat;
      rates.set(r.vatRate, e);
    } else input += vat;
  }
  return {
    label,
    output: round2(output),
    input: round2(input),
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
