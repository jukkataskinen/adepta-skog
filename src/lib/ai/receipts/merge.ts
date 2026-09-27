import type { ChunkRange } from "./chunks";
import { normalizeNumber } from "./duplicates";
import { MAX_SUGGESTION_LINES, removeDuplicatePaymentLines, type ChunkLine, type SuggestionLine } from "./schema";

/**
 * Palojen tulosten yhdistäminen yhdeksi ehdotukseksi (DECISIONS 28.9.2026).
 *
 * 1. Limityssivun kaksoiskappaleet: kun peräkkäiset palat ovat molemmat
 *    tunnistaneet saman rivin yhteiseltä sivulta (sama sivu, sama summa ja sama
 *    päivä, laskunumero tai sopimusnumero), pidetään aiemman palan rivi ja
 *    yhdistetään sivut. Samalla palojen asiakirjat yhdistetään yhdeksi.
 * 2. Asiakirjojen numerot tehdään koko tiedostossa yksilöllisiksi sivujärjestyksessä.
 * 3. Maksurivien ja saman laskun toistojen poisto (schema.ts) koko tiedostolle,
 *    koska tilisiirtolomake voi osua eri palaan kuin itse lasku.
 * Puhdas funktio.
 */

export interface ChunkResult extends ChunkRange {
  lines: ChunkLine[];
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
const sameNumber = (a: string | null, b: string | null) => {
  const x = normalizeNumber(a);
  return x.length > 0 && x === normalizeNumber(b);
};

/** Sama rivi kahdesta palasta: summa ja vähintään yksi tunniste täsmäävät. */
export function sameOverlapLine(a: ChunkLine, b: ChunkLine): boolean {
  if (!near(a.amountGross, b.amountGross)) return false;
  return (a.date !== null && a.date === b.date) || sameNumber(a.invoiceNumber, b.invoiceNumber) || sameNumber(a.contractNumber, b.contractNumber);
}

interface Item {
  chunk: number;
  order: number;
  doc: string;
  line: ChunkLine;
}

export function mergeChunkResults(chunks: ChunkResult[]): SuggestionLine[] {
  const sorted = [...chunks].sort((a, b) => a.first - b.first);
  const items: Item[] = [];
  sorted.forEach((c, ci) => c.lines.forEach((line, order) => items.push({ chunk: ci, order, doc: `${ci}:${line.documentIndex}`, line: { ...line, pages: [...line.pages] } })));

  // Asiakirjojen yhdistäminen (union-find): limityksen yli jatkuva asiakirja saa yhden numeron.
  const parent = new Map<string, string>();
  const root = (k: string): string => {
    const p = parent.get(k);
    if (!p || p === k) return k;
    const r = root(p);
    parent.set(k, r);
    return r;
  };

  const removed = new Set<Item>();
  for (let ci = 0; ci + 1 < sorted.length; ci++) {
    const shared = sorted[ci].last;
    if (sorted[ci + 1].first > shared) continue;
    const before = items.filter((i) => i.chunk === ci && i.line.pages.includes(shared));
    const after = items.filter((i) => i.chunk === ci + 1 && i.line.pages.includes(shared));
    const used = new Set<Item>();
    for (const b of after) {
      const a = before.find((x) => !used.has(x) && !removed.has(x) && sameOverlapLine(x.line, b.line));
      if (!a) continue;
      used.add(a);
      removed.add(b);
      a.line.pages = [...new Set([...a.line.pages, ...b.line.pages])].sort((x, y) => x - y);
      a.line.confidence = Math.max(a.line.confidence, b.line.confidence);
      if (a.line.documentTotal === null) a.line.documentTotal = b.line.documentTotal;
      const ra = root(a.doc);
      const rb = root(b.doc);
      if (ra !== rb) parent.set(rb, ra);
    }
  }

  const kept = items.filter((i) => !removed.has(i));
  // Asiakirjan numero sen ensimmäisen sivun mukaan; sivuton rivi palan järjestyksessä.
  const docStart = new Map<string, [number, number, number]>();
  for (const i of kept) {
    const r = root(i.doc);
    const firstPage = i.line.pages[0] ?? sorted[i.chunk].first;
    const key: [number, number, number] = [firstPage, i.chunk, i.order];
    const cur = docStart.get(r);
    if (!cur || key[0] < cur[0] || (key[0] === cur[0] && (key[1] < cur[1] || (key[1] === cur[1] && key[2] < cur[2])))) docStart.set(r, key);
  }
  const docOrder = [...docStart.entries()].sort(([, x], [, y]) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).map(([k]) => k);
  const docIndex = new Map(docOrder.map((k, n) => [k, n + 1]));

  const ordered = kept
    .map((i) => ({ i, doc: docIndex.get(root(i.doc)) ?? 1 }))
    .sort((x, y) => x.doc - y.doc || x.i.chunk - y.i.chunk || x.i.order - y.i.order)
    .map(({ i, doc }) => ({ ...i.line, documentIndex: Math.min(doc, 1000) }));

  return removeDuplicatePaymentLines(ordered).slice(0, MAX_SUGGESTION_LINES);
}
