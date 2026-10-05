import type { Sql } from "@/lib/db/types";
import type { Activity } from "@/lib/tax/rules";
import { listPendingSuggestions } from "@/lib/documents/receipt-suggestions";
import { rowsFromSuggestion, withDuplicateWarnings, type GridRow, type StoredTransaction } from "@/lib/ledger/grid";
import { loadClientMemory, loadOfficeMemory } from "@/lib/ledger/posting-memory-load";
import { suggestPosting, type PostingLookup, type PostingMemory } from "@/lib/ledger/posting-memory";
import type { SuggestionLine } from "@/lib/ai/receipts/schema";

/**
 * Tunnistuksen odottavat ehdotukset taulukon riveiksi tiliöintimuistin kanssa
 * (DECISIONS 6.10.2026). Sama funktio palvelee sivua ja taulukon tallennusta,
 * jotta tallennuksen jälkeen palaavat ehdotusrivit näyttävät samalta.
 * Muisti luetaan vain, jos ehdotuksia on, ja toimiston muisti vain riveille,
 * joille asiakkaan omasta historiasta ei löytynyt mitään.
 */
export async function loadSuggestionRows(
  tx: Sql,
  input: {
    organizationId: string;
    clientId: string;
    year: number;
    view: Activity | null;
    vatRegistered: boolean;
    /** p.k.vvvv */
    defaultDate: string;
  },
  stored: Pick<StoredTransaction, "booked_on" | "category" | "amount_gross" | "description" | "reference">[],
): Promise<GridRow[]> {
  const pending = await listPendingSuggestions(tx, input.clientId, input.year, input.view);
  if (!pending.length) return [];
  const scope = { organizationId: input.organizationId, clientId: input.clientId };
  const own = await loadClientMemory(tx, scope);
  const lookups = new Map<SuggestionLine, PostingLookup>();
  const query = (l: SuggestionLine, activity: Activity) => ({
    description: l.description,
    amountGross: l.amountGross,
    date: l.date ?? `${input.year}-12-31`,
    activities: [activity],
  });
  const misses: { line: SuggestionLine; activity: Activity }[] = [];
  for (const sg of pending) {
    for (const l of sg.lines) {
      const res = suggestPosting(own, query(l, sg.activity));
      if (res.best) lookups.set(l, res);
      else misses.push({ line: l, activity: sg.activity });
    }
  }
  if (misses.length) {
    const office: PostingMemory | null = await loadOfficeMemory(tx, scope, misses.map((m) => m.line.description));
    if (office) for (const m of misses) lookups.set(m.line, suggestPosting(office, query(m.line, m.activity)));
  }
  return withDuplicateWarnings(
    pending.flatMap((sg) => rowsFromSuggestion(sg, { vatRegistered: input.vatRegistered, defaultDate: input.defaultDate, year: input.year, posting: (l) => lookups.get(l) ?? null })),
    stored,
  );
}
