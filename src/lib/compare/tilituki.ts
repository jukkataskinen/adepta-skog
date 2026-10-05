import { FORM2_ORDER } from "@/lib/filing/vsy002-fields";

/**
 * Lomakkeen 2 vertailu Tilitukin lukuihin kentittäin (tilituki:vertaa).
 * Puhdas funktio: Tilitukin lomake (LOMAKE2_YYYY, tietuetunnuksittain) ja
 * Skogin laskema lomake sisään, kentittäiset erot ulos. Ei henkilötietoja.
 */

export interface FieldDiff {
  code: string;
  tilituki: number;
  skog: number;
  /** Skog − Tilituki. */
  diff: number;
}

export interface Form2Comparison {
  matching: string[];
  differing: FieldDiff[];
  /** Tilitukin kentät, joita Skogin lomake 2 ei tunne (esim. 7L:n vuokratulot 737–742). */
  unsupported: FieldDiff[];
}

/** Kentät, joita ei verrata: Tilituki antaa jako-osuudet aina, Skog vain kun ne on syötetty, ja tyhjä tarkoittaa samaa (100 / 0). */
const SAME_WHEN_EMPTY: Record<string, number> = { "413": 100, "415": 100, "414": 0, "416": 0 };

const TOLERANCE = 0.005;

export function compareForm2(tilituki: Record<string, number>, skog: Record<string, number>): Form2Comparison {
  const known = new Set(FORM2_ORDER);
  const codes = [...new Set([...Object.keys(tilituki), ...Object.keys(skog)])].sort((a, b) => {
    const ia = FORM2_ORDER.indexOf(a);
    const ib = FORM2_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  const out: Form2Comparison = { matching: [], differing: [], unsupported: [] };
  for (const code of codes) {
    const empty = SAME_WHEN_EMPTY[code] ?? 0;
    const t = tilituki[code] ?? empty;
    const s = skog[code] ?? empty;
    const diff = Math.round((s - t) * 100) / 100;
    if (!known.has(code)) {
      if (t) out.unsupported.push({ code, tilituki: t, skog: s, diff });
      continue;
    }
    if (Math.abs(diff) <= TOLERANCE) {
      if (t || s) out.matching.push(code);
    } else out.differing.push({ code, tilituki: t, skog: s, diff });
  }
  return out;
}

/** Yhteenveto usealta asiakkaalta: kokonaan täsmäävät ja yleisimmät poikkeavat kentät. */
export function summarizeComparisons(rows: { folder: string; result: Form2Comparison }[]) {
  const fieldCounts = new Map<string, number>();
  for (const r of rows) for (const d of r.result.differing) fieldCounts.set(d.code, (fieldCounts.get(d.code) ?? 0) + 1);
  return {
    total: rows.length,
    // Kenttä, jota Skogin lomake 2 ei tunne, on poikkeama siinä missä eri summakin.
    identical: rows.filter((r) => !r.result.differing.length && !r.result.unsupported.length).length,
    partial: rows.filter((r) => r.result.differing.length || r.result.unsupported.length).length,
    commonFields: [...fieldCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}
