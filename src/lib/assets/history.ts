import { assetYear, type AssetInput, type RecordedDepreciation } from "@/lib/tax/depreciation";
import { agriDepreciation, AGRI_POOLS, poolLabel, type AgriPool } from "@/lib/tax/agri-depreciation";
import type { AgriDepreciationSource } from "@/lib/tax/agri-load";

/**
 * Investoinnin poistohistoria Investoinnit-sivulle. Puhdas laskenta samoilla
 * funktioilla kuin verosuunnitelma, joten sivu ja suunnitelma eivät voi näyttää
 * eri lukuja (DECISIONS 5.10.2026 "Tilitukin investointihistoria").
 *
 * Metsätalouden investointi: rivi jokaiselta vuodelta, jolle poisto on kirjattu
 * (vahvistettu suunnitelma tai tuotu historia). Viimeisin tila on viimeisen
 * kirjatun vuoden loppuarvo. Maatalouden investoinnit poistetaan ryhmittäin,
 * joten niiden historia on ryhmän ketju.
 */

export interface HistoryRow {
  year: number;
  start: number;
  depreciation: number;
  end: number;
  /** Myyntivuosi: poistoa ei tehdä, arvo poistuu myyntihinnalla. */
  sold?: boolean;
  salePrice?: number;
}

export interface AssetHistory {
  rows: HistoryRow[];
  /** Viimeisin kirjattu vuosi ja sen loppuarvo; tyhjä, jos poistoja ei ole kirjattu. */
  latest: { year: number; end: number } | null;
  /** Kertynyt poisto viimeisimmän vuoden loppuun (hankintameno miinus loppuarvo). */
  accumulated: number | null;
  status: "sold" | "fully_depreciated" | "open";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function forestAssetHistory(input: AssetInput, recorded: RecordedDepreciation[]): AssetHistory {
  const rows: HistoryRow[] = [];
  for (const rec of [...recorded].sort((a, b) => a.taxYear - b.taxYear)) {
    const y = assetYear(input, recorded, rec.taxYear);
    if (!y.active || y.sold) continue;
    rows.push({ year: rec.taxYear, start: y.bookValueStart, depreciation: rec.amount, end: rec.bookValueEnd });
  }
  const soldYear = input.disposedOn ? Number(input.disposedOn.slice(0, 4)) : null;
  if (soldYear !== null) {
    const y = assetYear(input, recorded, soldYear);
    if (y.active) rows.push({ year: soldYear, start: y.bookValueStart, depreciation: 0, end: 0, sold: true, salePrice: input.salePrice ?? 0 });
  }
  const last = rows[rows.length - 1] ?? null;
  const latest = last ? { year: last.year, end: last.end } : null;
  const status = soldYear !== null ? "sold" : latest && latest.end <= 0 ? "fully_depreciated" : "open";
  const accumulated = latest && !last?.sold ? r2(input.acquisitionCost - latest.end) : null;
  return { rows, latest, accumulated, status };
}

export interface PoolHistory {
  pool: AgriPool;
  label: string;
  rows: (HistoryRow & { additions: number; deductions: number })[];
  latest: { year: number; end: number } | null;
}

/**
 * Maatalouden poistoryhmien ketju ensimmäisestä vuodesta viimeiseen vuoteen,
 * jolle ryhmäpoisto on kirjattu. Vuodet ilman kirjattua poistoa näytetään
 * nollapoistolla, kuten laskenta ne käsittelee.
 */
export function agriPoolHistory(src: AgriDepreciationSource): PoolHistory[] {
  if (!src.assets.length || !src.recorded.length) return [];
  const first = Math.min(...src.assets.map((a) => a.openingYear ?? Number(a.acquiredOn.slice(0, 4))));
  const last = Math.max(...src.recorded.map((r) => r.taxYear));
  const out = new Map<AgriPool, PoolHistory>();
  for (let y = first; y <= last; y++) {
    const res = agriDepreciation(src.assets, src.adjustments, src.recorded, y);
    for (const p of res.pools) {
      const h = out.get(p.pool) ?? { pool: p.pool, label: poolLabel(p.pool), rows: [], latest: null };
      h.rows.push({
        year: y, start: p.start, additions: p.additions, deductions: r2(p.sales + p.grants + p.equalization), depreciation: p.depreciation, end: p.end,
      });
      h.latest = { year: y, end: p.end };
      out.set(p.pool, h);
    }
  }
  return AGRI_POOLS.map((p) => out.get(p)).filter((h): h is PoolHistory => !!h);
}
