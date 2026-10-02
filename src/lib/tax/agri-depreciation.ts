import { acceleratedPct, AGRI_ASSET_CLASSES, agriAssetClass, type AgriAssetClass } from "./rules";

/**
 * Maatalouden poistot ryhmittäin (lomake 2: 240–277, 511–527; 2025: 364–584).
 * Puhdas laskenta, ei kantakutsuja (DECISIONS 2.10.2026).
 *
 * Lomake 2 ilmoittaa poistot ryhmittäin, ja koneilla on yhteinen menojäännös,
 * josta myyntihinta vähennetään. Siksi poisto lasketaan ja valitaan ryhmälle:
 *
 *   pohja  = menojäännös vuoden alussa + hankinnat − käytetty tasausvaraus − myyntihinnat − tuet
 *   poisto ≤ pohja × ryhmän prosentti, tai koko pohja, jos se on enintään ryhmän pienen erän raja
 *   loppu  = pohja − poisto
 *
 * Jos myyntihinnat ovat suuremmat kuin menojäännös, ylittävä osa on
 * maatalouden tuloa (excess) ja pohja on nolla (tarkistettava, suunnitelma 2).
 *
 * Menojäännös kulkee vuodesta toiseen: ensimmäisestä vuodesta, jolta Skogissa
 * on investointeja, lasketaan ketjuna kirjatuilla poistoilla. Aiempi
 * investointi (openingYear) tuo menojäännöksensä sen vuoden alkuun.
 *
 * Uuden koneen korotettu poisto (50 %, käyttöön 2020–2025) on oma ryhmänsä
 * vuoteen 2025 asti. Vuonna 2026 sen menojäännös siirtyy koneiden ja kaluston
 * ryhmään (tarkistettava, suunnitelma 1.5).
 */

export const ACCELERATED_POOL = "agri_machinery_accelerated" as const;
export type AgriPool = AgriAssetClass | typeof ACCELERATED_POOL;

export const AGRI_POOLS: AgriPool[] = [
  "agri_production_building", "agri_dwelling", "agri_greenhouse", "agri_environmental", "agri_machinery", ACCELERATED_POOL, "agri_bridges", "agri_drainage",
];

export function poolLabel(pool: AgriPool): string {
  return pool === ACCELERATED_POOL ? "Uudet koneet, korotettu poisto" : (agriAssetClass(pool)?.label ?? pool);
}

export interface AgriAssetInput {
  id: string;
  description: string;
  assetClass: AgriAssetClass;
  accelerated: boolean;
  acquiredOn: string;
  acquisitionCost: number;
  /** Aiempi investointi: menojäännös vuoden openingYear alussa. */
  openingYear: number | null;
  openingBookValue: number | null;
  disposedOn: string | null;
  salePrice: number | null;
}

/** Poistopohjaa pienentävä erä: investointituki tai investointiin käytetty tasausvaraus. */
export interface AgriAdjustment {
  assetId: string;
  taxYear: number;
  kind: "grant" | "equalization";
  amount: number;
}

export interface AgriRecorded {
  taxYear: number;
  pool: AgriPool;
  amount: number;
}

export interface AgriPoolYear {
  pool: AgriPool;
  label: string;
  /** Vuoden enimmäisprosentti. */
  pct: number;
  start: number;
  additions: number;
  equalization: number;
  sales: number;
  grants: number;
  /** Pohja, josta poisto lasketaan. */
  base: number;
  max: number;
  smallBalance: boolean;
  /** Valittu tai kirjattu poisto (0 – max). */
  depreciation: number;
  /** Kirjattu poisto tälle vuodelle, jos suunnitelma on vahvistettu. */
  recorded: number | null;
  end: number;
  /** Myyntihinnat, jotka ylittävät menojäännöksen: maatalouden tuloa. */
  excess: number;
  /** Korotetun poiston erittely (vain korotetun ryhmän vuosina 2020–2025): aiempien vuosien hankintamenot (364). */
  priorCost: number;
}

export interface AgriDepreciationResult {
  year: number;
  pools: AgriPoolYear[];
  total: number;
  excess: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string) => Number(d.slice(0, 4));

/** Investoinnin ryhmä vuonna y: korotettu poisto vain sallittuina vuosina. */
export function poolOf(a: { assetClass: AgriAssetClass; accelerated: boolean }, year: number): AgriPool {
  return a.accelerated && acceleratedPct(year) ? ACCELERATED_POOL : a.assetClass;
}

function poolPct(pool: AgriPool, year: number): number {
  if (pool === ACCELERATED_POOL) return acceleratedPct(year) ?? 25;
  return agriAssetClass(pool)?.pct ?? 0;
}

function smallLimit(pool: AgriPool): number | null {
  if (pool === ACCELERATED_POOL) return null;
  return agriAssetClass(pool)?.smallLimit ?? null;
}

/** Ensimmäinen vuosi, jolta ketju lasketaan. */
function firstYearOf(a: AgriAssetInput): number {
  return a.openingYear ?? yearOf(a.acquiredOn);
}

/**
 * Ryhmien poistot vuodelle. `chosen` korvaa vuoden poiston (verosuunnitelma
 * tai Maatalous-sivu ennen tallennusta); muuten käytetään kirjattua poistoa.
 */
export function agriDepreciation(
  assets: AgriAssetInput[],
  adjustments: AgriAdjustment[],
  recorded: AgriRecorded[],
  year: number,
  chosen: Partial<Record<AgriPool, number>> = {},
): AgriDepreciationResult {
  const empty = (): AgriDepreciationResult => ({ year, pools: [], total: 0, excess: 0 });
  if (!assets.length) return empty();
  const first = Math.min(...assets.map(firstYearOf));
  let carry = new Map<AgriPool, number>();
  let result = empty();
  for (let y = Math.min(first, year); y <= year; y++) {
    // Korotetun ryhmän menojäännös siirtyy koneisiin, kun korotettu poisto päättyy.
    if (!acceleratedPct(y) && carry.has(ACCELERATED_POOL)) {
      carry.set("agri_machinery", round2((carry.get("agri_machinery") ?? 0) + (carry.get(ACCELERATED_POOL) ?? 0)));
      carry.delete(ACCELERATED_POOL);
    }
    const rows = new Map<AgriPool, AgriPoolYear>();
    const row = (pool: AgriPool): AgriPoolYear => {
      let r = rows.get(pool);
      if (!r) {
        r = {
          pool, label: poolLabel(pool), pct: poolPct(pool, y), start: carry.get(pool) ?? 0, additions: 0, equalization: 0, sales: 0, grants: 0, base: 0, max: 0,
          smallBalance: false, depreciation: 0, recorded: null, end: 0, excess: 0, priorCost: 0,
        };
        rows.set(pool, r);
      }
      return r;
    };
    for (const pool of carry.keys()) row(pool);
    for (const a of assets) {
      const pool = poolOf(a, y);
      const acquiredYear = yearOf(a.acquiredOn);
      if (a.openingYear !== null && a.openingYear === y) row(pool).start += a.openingBookValue ?? 0;
      if (a.openingYear === null && acquiredYear === y) row(pool).additions += a.acquisitionCost;
      if (a.disposedOn && yearOf(a.disposedOn) === y) row(pool).sales += a.salePrice ?? 0;
      if (pool === ACCELERATED_POOL && acquiredYear < y && firstYearOf(a) <= y) row(pool).priorCost += a.acquisitionCost;
      for (const adj of adjustments.filter((x) => x.assetId === a.id && x.taxYear === y)) {
        if (adj.kind === "grant") row(pool).grants += adj.amount;
        else row(pool).equalization += adj.amount;
      }
    }
    const next = new Map<AgriPool, number>();
    for (const r of rows.values()) {
      for (const k of ["start", "additions", "equalization", "sales", "grants", "priorCost"] as const) r[k] = round2(r[k]);
      const raw = round2(r.start + r.additions - r.equalization - r.sales - r.grants);
      r.excess = raw < 0 ? round2(-raw) : 0;
      r.base = Math.max(0, raw);
      const limit = smallLimit(r.pool);
      r.smallBalance = limit !== null && r.base > 0 && r.base <= limit;
      r.max = r.smallBalance ? r.base : round2((r.base * r.pct) / 100);
      const rec = recorded.find((x) => x.taxYear === y && x.pool === r.pool);
      r.recorded = rec ? rec.amount : null;
      const wanted = y === year && chosen[r.pool] !== undefined ? chosen[r.pool]! : (rec?.amount ?? 0);
      // Valinta rajataan enimmäismäärään; aiemmilta vuosilta luotetaan kirjattuun, mutta ei yli pohjan.
      r.depreciation = round2(Math.min(Math.max(0, wanted), y === year ? r.max : r.base));
      r.end = round2(r.base - r.depreciation);
      if (r.end > 0 || r.base > 0) next.set(r.pool, r.end);
    }
    carry = next;
    if (y === year) {
      const pools = AGRI_POOLS.map((p) => rows.get(p)).filter((r): r is AgriPoolYear => !!r && (r.start || r.additions || r.sales || r.grants || r.equalization || r.end || r.depreciation) !== 0);
      result = {
        year,
        pools,
        total: round2(pools.reduce((s, p) => s + p.depreciation, 0)),
        excess: round2(pools.reduce((s, p) => s + p.excess, 0)),
      };
    }
  }
  return result;
}

/** Ryhmät, joille vuodelle voi valita poiston (pohja yli nollan). */
export function choosablePools(r: AgriDepreciationResult): AgriPoolYear[] {
  return r.pools.filter((p) => p.base > 0);
}

/** Ryhmien tunnukset lomakkeella 2: alku, lisäys, tasausvaraus, myynti, tuki, poisto, loppu. */
export const POOL_FIELDS: Record<AgriAssetClass, { start: string; add: string; eq: string; sale: string; grant: string; dep: string; end: string }> = {
  agri_production_building: { start: "240", add: "241", eq: "242", sale: "528", grant: "243", dep: "524", end: "244" },
  agri_dwelling: { start: "245", add: "246", eq: "247", sale: "529", grant: "248", dep: "525", end: "249" },
  agri_greenhouse: { start: "250", add: "251", eq: "252", sale: "530", grant: "253", dep: "526", end: "254" },
  agri_environmental: { start: "255", add: "256", eq: "257", sale: "531", grant: "258", dep: "527", end: "259" },
  agri_machinery: { start: "260", add: "261", eq: "262", sale: "263", grant: "264", dep: "511", end: "265" },
  agri_bridges: { start: "266", add: "267", eq: "268", sale: "269", grant: "270", dep: "513", end: "271" },
  agri_drainage: { start: "272", add: "273", eq: "274", sale: "275", grant: "276", dep: "515", end: "277" },
};

export const AGRI_CLASS_CODES = AGRI_ASSET_CLASSES.map((c) => c.code);
