import { assetYear, type AssetInput, type RecordedDepreciation } from "@/lib/tax/depreciation";
import { agriDepreciation, ACCELERATED_POOL, POOL_FIELDS, type AgriPool } from "@/lib/tax/agri-depreciation";
import type { AgriDepreciationSource } from "@/lib/tax/agri-load";
import type { AgriAssetClass } from "@/lib/tax/rules";
import { sameAsManual, tilitukiEndOf, type HistoryAsset } from "@/lib/import/tilituki/history";
import { isTilitukiId } from "@/lib/import/origin";
import { BUILDING_CLASSES, type TtFolder } from "@/lib/import/tilituki/map";

/**
 * Investointien ja poistoryhmien menojäännökset Skogissa Tilitukia vasten
 * (tilituki:tarkista). Puhdas vertailu: kutsuja lataa Skogin tiedot.
 *
 * - Metsätalouden kortit: Skogin arvo vuoden lopussa (kirjattu loppuarvo tai
 *   laskettu) = KALUSPOI:n arvo lopussa. Myyty kortti on Skogissa myyntivuonna
 *   nolla; Tilitukin negatiivinen loppuarvo on myyntivoitto.
 * - Metsätalouden ryhmät: korttien summa lajeittain = lomakkeen 2C kentät 626 / 627 / 628.
 * - Maatalouden ryhmät: Skogin ketju (agriDepreciation) = lomakkeen 2
 *   loppukentät; koneiden 265 sisältää korotetun poiston koneet.
 */

export interface SkogForestAsset {
  legacyId: string | null;
  input: AssetInput;
  recorded: RecordedDepreciation[];
}

export interface HistoryCheck {
  item: string;
  year: number;
  tilituki: number;
  skog: number;
  ok: boolean;
  note?: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Sentin pyöristysero sallitaan: Tilituki pyöristää kortit ja lomakkeen erikseen. */
const close = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

/** Skogin arvo vuoden lopussa: kirjattu loppuarvo, muuten vuoden alun arvo miinus kirjattu poisto. Myyntivuonna 0. */
export function skogEndOf(a: SkogForestAsset, year: number): number {
  const y = assetYear(a.input, a.recorded, year);
  if (!y.active || y.sold) return 0;
  const rec = a.recorded.find((r) => r.taxYear === year);
  return rec ? rec.bookValueEnd : r2(y.bookValueBase);
}

export function checkForest(history: HistoryAsset[], skog: SkogForestAsset[], years: number[]): HistoryCheck[] {
  const out: HistoryCheck[] = [];
  for (const h of history) {
    const s = skogFor(h, skog);
    const manual = !!s && !isTilitukiId(s.legacyId);
    for (const year of years) {
      const tt = tilitukiEndOf(h, year);
      if (!s) {
        out.push({ item: `kortti ${h.cardId}`, year, tilituki: tt, skog: 0, ok: close(tt, 0), note: "ei Skogissa" });
        continue;
      }
      const sk = skogEndOf(s, year);
      const sold = h.disposedOn !== null && Number(h.disposedOn.slice(0, 4)) <= year;
      // Käsin lisätty vastine alkaa vasta lähtövuodestaan, joten aiempia vuosia ei verrata.
      const manualFrom = manual ? (s.input.openingYear ?? null) : null;
      if (manualFrom !== null && year < manualFrom) continue;
      out.push({
        item: `kortti ${h.cardId}`, year, tilituki: r2(tt), skog: sk, ok: close(tt, sk) || (sold && sk === 0),
        note: sold && !close(tt, sk) ? "myyty: Tilitukin erotus on myyntivoitto tai -tappio" : manual ? "Skogissa käsin lisätty vastine" : undefined,
      });
    }
  }
  return out;
}

/** Skogin investointi kortille: tuotu rivi tai käsin lisätty sama kohde (sameAsManual). */
function skogFor(h: HistoryAsset, skog: SkogForestAsset[]): SkogForestAsset | undefined {
  return (
    skog.find((x) => x.legacyId === h.legacyId) ??
    skog.find((x) => !isTilitukiId(x.legacyId) && sameAsManual(h, {
      ratePct: x.input.decliningRatePct, acquiredOn: x.input.acquiredOn, acquisitionCost: x.input.acquisitionCost, openingYear: x.input.openingYear ?? null,
      openingBookValue: x.input.openingBookValue,
    }))
  );
}

const FOREST_GROUPS: { kind: HistoryAsset["kind"]; field: string; label: string }[] = [
  { kind: "machinery", field: "626", label: "2C koneet 626" },
  { kind: "building", field: "627", label: "2C rakennukset 627" },
  { kind: "road", field: "628", label: "2C tiet ja ojat 628" },
];

/** Korttien summa lajeittain lomakkeen 2C menojäännöstä vasten vuosina, joilta lomake on laskettu. */
export function checkForestForm(f: TtFolder, history: HistoryAsset[], skog: SkogForestAsset[], years: number[]): HistoryCheck[] {
  const out: HistoryCheck[] = [];
  for (const year of years) {
    const form = f.form2c[String(year)];
    if (!form) continue;
    // Laskematta jäänyt vuosi: lomakkeella on vain alkuarvot.
    const computed = ["626", "627", "628", "642", "643", "644"].some((c) => form[c] !== undefined);
    for (const g of FOREST_GROUPS) {
      const ofKind = history.filter((h) => h.kind === g.kind);
      const tt = form[g.field] ?? 0;
      if (!ofKind.length && !tt) continue;
      const sk = r2(ofKind.reduce((s, h) => {
        const a = skogFor(h, skog);
        return s + (a ? skogEndOf(a, year) : 0);
      }, 0));
      if (!computed) {
        out.push({ item: g.label, year, tilituki: tt, skog: sk, ok: true, note: "lomaketta ei laskettu Tilitukissa" });
        continue;
      }
      // Käsin lisätty vastine alkaa myöhemmin kuin Tilitukin historia: aiempien vuosien ryhmä ei ole Skogissa vertailukelpoinen.
      const lateManual = ofKind.some((h) => {
        const a = skogFor(h, skog);
        return !!a && !isTilitukiId(a.legacyId) && (a.input.openingYear ?? 0) > year;
      });
      if (lateManual) {
        out.push({ item: g.label, year, tilituki: tt, skog: sk, ok: true, note: "lomaketta ei verrata: käsin lisätty vastine alkaa myöhemmin" });
        continue;
      }
      const soldGain = r2(ofKind.filter((h) => h.disposedOn && Number(h.disposedOn.slice(0, 4)) === year).reduce((s, h) => s + Math.min(0, h.lastEnd), 0));
      out.push({
        item: g.label, year, tilituki: tt, skog: sk, ok: close(tt, sk, 0.05) || close(tt - soldGain, sk, 0.05),
        note: soldGain ? "myynnin erotus Tilitukin ryhmässä" : undefined,
      });
    }
  }
  return out;
}

/** Maatalouden ryhmien loppuarvot lomakkeen 2 loppukenttiä vasten. */
export function checkAgri(f: TtFolder, src: AgriDepreciationSource, years: number[]): HistoryCheck[] {
  const out: HistoryCheck[] = [];
  if (!src.assets.length) return out;
  const first = Math.min(...src.assets.map((a) => a.openingYear ?? Number(a.acquiredOn.slice(0, 4))));
  for (const year of years) {
    if (year < first) continue;
    const form = f.form2[String(year)] ?? {};
    const computed = ["332", "357", "362", "363"].some((c) => form[c] !== undefined);
    if (!computed) continue;
    const res = agriDepreciation(src.assets, src.adjustments, src.recorded, year);
    const end = (p: AgriPool) => res.pools.find((x) => x.pool === p)?.end ?? 0;
    for (const [cls, fields] of Object.entries(POOL_FIELDS) as [AgriAssetClass, (typeof POOL_FIELDS)[AgriAssetClass]][]) {
      const sk = cls === "agri_machinery" ? r2(end("agri_machinery") + end(ACCELERATED_POOL)) : end(cls);
      const tt = form[fields.end] ?? 0;
      if (!sk && !tt) continue;
      const ok = close(tt, sk, 0.05);
      // Rakennus ilman poistoprosenttia: Tilituki on voinut ottaa sen lomakkeelle vain osana vuosista (BLOCKERS 14 ab).
      const noPct = Object.entries(BUILDING_CLASSES).some(([n, c]) => c === cls && f.buildings.some((b) => b.depreciationClass === Number(n) && !Object.values(b.years).some((y) => y.pct > 0)));
      out.push({ item: `lomake 2 ${fields.end}`, year, tilituki: tt, skog: sk, ok, note: !ok && noPct ? "rakennus ilman poistoprosenttia, Tilituki jätti sen lomakkeelta (BLOCKERS 14 ab)" : undefined });
    }
  }
  return out;
}
