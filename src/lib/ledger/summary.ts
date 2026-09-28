import type { TransactionKind } from "@/lib/tax/rules";
import { round2 } from "@/lib/tax/amounts";
import { forestryShare } from "@/lib/tax/share";

/**
 * Kirjausten summat. Kannassa on bruttosumma (kuitin summa) ja siitä laskettu
 * veroton summa, ja vero on niiden erotus (src/lib/tax/amounts.ts). Sama sääntö
 * koskee taulukkoa, arvonlisäveroyhteenvetoa ja veroraporttia.
 *
 * Summat ovat metsätalouden osuuksia (src/lib/tax/share.ts): jos kirjauksesta
 * vain osa kuuluu metsätaloudelle, loppu ei ole tuloa, menoa eikä vähennettävää veroa.
 */

export interface LedgerRow {
  kind: TransactionKind;
  amountNet: number;
  amountGross: number;
  withholding: number;
  /** Metsätalouden osuus prosentteina. Puuttuva = 100. */
  businessSharePct?: number | null;
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
  /** Ostojen vero, joka kuuluu muulle toiminnalle eikä vähennetä tässä. */
  nonDeductibleVat: number;
  /** Kirjaukset, joista vain osa kuuluu metsätaloudelle. */
  partialCount: number;
  /** Myynnin vero miinus ostojen vero. Negatiivinen = palautettavaa. */
  vatPayable: number;
  /** Tulot miinus menot ilman investointeja (ne poistetaan, vaihe 5). */
  netResult: number;
}

export function summarize(rows: LedgerRow[]): LedgerSummary {
  const empty = (): KindTotals => ({ net: 0, vat: 0, gross: 0 });
  const t = { income: empty(), expense: empty(), investment: empty() };
  let withholding = 0;
  let nonDeductibleVat = 0;
  let partialCount = 0;
  for (const r of rows) {
    const s = forestryShare(r);
    t[r.kind].net += s.net;
    t[r.kind].vat += s.vat;
    t[r.kind].gross += s.gross;
    nonDeductibleVat += s.nonDeductibleVat;
    if (s.sharePct < 100) partialCount++;
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
    nonDeductibleVat: round2(nonDeductibleVat),
    partialCount,
    vatPayable: round2(t.income.vat - t.expense.vat - t.investment.vat),
    netResult: round2(t.income.net - t.expense.net),
  };
}
