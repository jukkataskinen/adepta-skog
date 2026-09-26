import type { TransactionKind } from "@/lib/tax/rules";

/**
 * Kirjausten summat. Kannassa summa on ilman arvonlisäveroa ja verokanta
 * erikseen, joten vero ja bruttosumma lasketaan täällä yhdellä tavalla
 * kaikkialle (taulukko, arvonlisäveroyhteenveto, veroraportti).
 */

export interface LedgerRow {
  kind: TransactionKind;
  amountNet: number;
  vatRate: number;
  withholding: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function vatAmount(amountNet: number, vatRate: number): number {
  return round2((amountNet * vatRate) / 100);
}

export function grossAmount(amountNet: number, vatRate: number): number {
  return round2(amountNet + vatAmount(amountNet, vatRate));
}

export interface KindTotals {
  net: number;
  vat: number;
  gross: number;
}

export interface LedgerSummary {
  income: KindTotals;
  expense: KindTotals;
  investment: KindTotals;
  withholding: number;
  /** Myynnin vero miinus ostojen vero. Negatiivinen = palautettavaa. */
  vatPayable: number;
  /** Tulot miinus menot ilman investointeja (ne poistetaan, vaihe 5). */
  netResult: number;
}

export function summarize(rows: LedgerRow[]): LedgerSummary {
  const empty = (): KindTotals => ({ net: 0, vat: 0, gross: 0 });
  const t = { income: empty(), expense: empty(), investment: empty() };
  let withholding = 0;
  for (const r of rows) {
    const vat = vatAmount(r.amountNet, r.vatRate);
    t[r.kind].net += r.amountNet;
    t[r.kind].vat += vat;
    t[r.kind].gross += r.amountNet + vat;
    withholding += r.withholding;
  }
  for (const k of Object.values(t)) {
    k.net = round2(k.net);
    k.vat = round2(k.vat);
    k.gross = round2(k.gross);
  }
  return {
    ...t,
    withholding: round2(withholding),
    vatPayable: round2(t.income.vat - t.expense.vat - t.investment.vat),
    netResult: round2(t.income.net - t.expense.net),
  };
}
