import { round2 } from "@/lib/tax/amounts";
import { accountForYear, mapAccount, yearEntries, yearRemaps, type TtFolder, type YearPlan } from "@/lib/import/tilituki/map";
import type { HistoryCheck } from "./tilituki-history";

/**
 * Kirjanpidon ristiintarkistus Tilitukia vasten vuosittain (tilituki:tarkista).
 * Puhtaat funktiot: kutsuja lataa Skogin kirjaukset.
 *
 * - Tilitukin viennit veronumeroittain = Tilitukin lomakkeen luku samalla
 *   veronumerolla. Tämä tarkistaa, että tilin nykyinen veronumero vie vanhankin
 *   vuoden viennit samaan lomakkeen kohtaan kuin Tilituki silloin (kartoitus
 *   vuosittain). Ero on Tilitukin oma (esim. tilin oletuspuoli, käsin annettu
 *   luku), ei tuonnin virhe.
 * - Skogin tuodut kirjaukset luokittain = tuontisuunnitelma (buildYearPlan):
 *   jokainen kartoitettu vienti on Skogissa kerran ja oikealla summalla.
 */

/** Vuoden viennit (ei vastakirjauksia eikä esimerkkiaineistoa) veronumeroittain vuoden kartoituksella: debet − kredit. */
export function entriesByTaxCode(f: TtFolder, year: number): Record<string, number> {
  const accounts = new Map(f.accounts.map((a) => [a.number, a]));
  const remaps = yearRemaps(f, year);
  const out: Record<string, number> = {};
  for (const e of yearEntries(f, year)) {
    if (e.row !== null && e.row < 0) continue;
    const code = accountForYear(accounts.get(e.account), year, remaps)?.taxCode ?? "";
    if (!code) continue;
    out[code] = round2((out[code] ?? 0) + e.debit - e.credit);
  }
  return out;
}

/** Tuonnin käyttämät veronumerot: luokka tai maatalouden investointi. */
function imported(f: TtFolder, code: string): boolean {
  const a = f.accounts.find((x) => x.taxCode === code);
  const m = mapAccount(a);
  return m.type === "category" || m.type === "agri_asset";
}

/**
 * Viennit veronumeroittain Tilitukin lomakkeen lukua vasten. Verrataan itseisarvoja, koska Tilituki
 * tulostaa tulot ja menot positiivisina. Vain vuodet, joilta Tilitukin lomake on (ei esimerkkiä).
 */
export function checkEntriesAgainstForm(f: TtFolder, year: number): HistoryCheck[] {
  const raw = { ...(f.form2Raw[String(year)] ?? {}), ...(f.form2cRaw?.[String(year)] ?? {}) };
  if (!Object.keys(raw).length) return [];
  const sums = entriesByTaxCode(f, year);
  const codes = [...new Set([...Object.keys(sums), ...Object.keys(raw)])].filter((c) => imported(f, c) && (sums[c] || raw[c]));
  return codes.sort().map((code) => {
    const tt = round2(Math.abs(raw[code] ?? 0));
    const sk = round2(Math.abs(sums[code] ?? 0));
    return { item: `viennit ${code}`, year, tilituki: tt, skog: sk, ok: Math.abs(tt - sk) < 0.02 };
  });
}

export interface SkogLedgerRow {
  category: string;
  n: number;
  sum: number;
}

/** Skogin Tilitukista tuodut kirjaukset luokittain tuontisuunnitelmaa vasten. */
export function checkImportedLedger(plan: YearPlan, skog: SkogLedgerRow[]): HistoryCheck[] {
  const want = new Map<string, { n: number; sum: number }>();
  for (const t of plan.transactions) {
    const w = want.get(t.category) ?? { n: 0, sum: 0 };
    w.n++;
    w.sum = round2(w.sum + t.amountNet);
    want.set(t.category, w);
  }
  const have = new Map(skog.map((r) => [r.category, r]));
  const out: HistoryCheck[] = [];
  for (const cat of [...new Set([...want.keys(), ...have.keys()])].sort()) {
    const w = want.get(cat) ?? { n: 0, sum: 0 };
    const h = have.get(cat) ?? { n: 0, sum: 0 };
    const ok = w.n === h.n && Math.abs(w.sum - h.sum) < 0.005;
    out.push({ item: `kirjaukset ${cat}`, year: plan.year, tilituki: w.sum, skog: round2(h.sum), ok, note: ok || w.n === h.n ? undefined : `rivejä Tilituki ${w.n}, Skog ${h.n}` });
  }
  return out;
}
