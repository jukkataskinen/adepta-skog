import type { TransactionKind } from "@/lib/tax/rules";
import { round2, vatOf } from "@/lib/tax/amounts";

/**
 * Kirjausten summat. Kannassa on bruttosumma (kuitin summa) ja siitä laskettu
 * veroton summa, ja vero on niiden erotus (src/lib/tax/amounts.ts). Sama sääntö
 * koskee taulukkoa, arvonlisäveroyhteenvetoa ja veroraporttia.
 */

export interface LedgerRow {
  kind: TransactionKind;
  amountNet: number;
  amountGross: number;
  withholding: number;
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
    t[r.kind].net += r.amountNet;
    t[r.kind].vat += vatOf(r.amountNet, r.amountGross);
    t[r.kind].gross += r.amountGross;
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
