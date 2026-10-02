import type { TransactionKind } from "@/lib/tax/rules";

/**
 * Monikirjauksisen tositteen täsmäytys (DECISIONS 2.10.2026, maatalouden
 * tositteiden tunnistus). Puhdas funktio: hyväksyntänäkymä laskee sen
 * taulukon nykyisistä riveistä, joten kirjanpitäjän muutos näkyy heti.
 *
 * Kaava on sama kaikille asiakirjoille: tulot − ennakonpidätys − menot.
 * Tilityksessä (meijeri, teurastamo, vilja, puukauppa, tuet) se on tilille
 * maksettu summa, laskussa menojen summa (vaihtokone vähentää). Tulos
 * verrataan itseisarvona tositteen loppusummaan, koska tositteet tulostavat
 * maksettavan ja maksetun summan positiivisena.
 */

export interface BalanceLine {
  kind: TransactionKind | "";
  amountGross: number;
  withholding: number;
}

export type BalanceStatus = "ok" | "mismatch" | "no_total";

export interface DocumentBalance {
  income: number;
  /** Menot ja investoinnit (tilityksen vähennykset). */
  costs: number;
  withholding: number;
  /** Tulot − ennakonpidätys − menot. */
  net: number;
  /** Tositteen loppusumma tai maksettu summa, jos se tunnistettiin. */
  total: number | null;
  /** |net| − total, tai null ilman loppusummaa. */
  difference: number | null;
  status: BalanceStatus;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function documentBalance(lines: BalanceLine[], total: number | null | undefined): DocumentBalance {
  let income = 0;
  let costs = 0;
  let withholding = 0;
  for (const l of lines) {
    const amount = Number.isFinite(l.amountGross) ? l.amountGross : 0;
    if (l.kind === "income") {
      income += amount;
      withholding += Number.isFinite(l.withholding) ? l.withholding : 0;
    } else if (l.kind === "expense" || l.kind === "investment") {
      costs += amount;
    }
  }
  income = round2(income);
  costs = round2(costs);
  withholding = round2(withholding);
  const net = round2(income - withholding - costs);
  if (total === null || total === undefined || !Number.isFinite(total) || total <= 0) {
    return { income, costs, withholding, net, total: null, difference: null, status: "no_total" };
  }
  const difference = round2(Math.abs(net) - total);
  return { income, costs, withholding, net, total, difference, status: Math.abs(difference) < 0.005 ? "ok" : "mismatch" };
}
