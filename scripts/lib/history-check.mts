import type { Sql } from "../../src/lib/db/types.ts";
import { tilitukiId, isTilitukiId } from "../../src/lib/import/origin.ts";
import { buildForestHistory, tilitukiEndOf } from "../../src/lib/import/tilituki/history.ts";
import { loadPlanData } from "../../src/lib/tax/load.ts";
import { agriDepreciation, POOL_FIELDS } from "../../src/lib/tax/agri-depreciation.ts";
import { loadAgriDepreciationSource } from "../../src/lib/tax/agri-load.ts";
import { checkAgri, checkForest, checkForestForm, skogEndOf, type HistoryCheck, type SkogForestAsset } from "../../src/lib/compare/tilituki-history.ts";
import { buildYearPlan, dataYearRange, type TtFolder } from "../../src/lib/import/tilituki/map.ts";
import { checkEntriesAgainstForm, checkImportedLedger } from "../../src/lib/compare/tilituki-ledger.ts";
import { compareForm2 } from "../../src/lib/compare/tilituki.ts";
import { loadForm2 } from "../../src/lib/tax/agri-form-load.ts";
import { VSY002_SPECS } from "../../src/lib/filing/vsy002.ts";
import { TILITUKI_ID_SQL } from "../../src/lib/import/origin.ts";

/** Tarkistuksen laji vuosittaiseen yhteenvetoon. */
type Kind = "kirjaukset" | "viennit" | "investoinnit" | "lomake2";
const KINDS: Kind[] = ["kirjaukset", "viennit", "investoinnit", "lomake2"];
const kindOf = (item: string): Kind =>
  item.startsWith("kirjaukset") ? "kirjaukset" : item.startsWith("viennit") ? "viennit" : item.startsWith("lomake 2 kenttä") ? "lomake2" : "investoinnit";

/**
 * Ristiintarkistus Skogissa Tilitukia vasten vuosittain (tilituki:tarkista ja tilituki:tuo --tarkista):
 * - kirjaukset: Skogin tuodut kirjaukset luokittain = tuontisuunnitelma (määrä ja summa);
 * - viennit: Tilitukin viennit veronumeroittain = Tilitukin lomakkeen luku (kartoitus vuosittain);
 * - investoinnit: metsän kortit, 2C:n ryhmät ja maatalouden ryhmät menojäännöksinä;
 * - lomake 2: Skogin laskema lomake Tilitukin lomaketta vasten vuosille, joille Skogissa on lomake (VSY002_SPECS).
 * Tulostaa kansion numeron, tunnuksen ja eurot, ei nimiä.
 */
export async function checkHistory(
  tx: Sql, folders: TtFolder[], years: number[], opts: { verbose?: boolean } = {},
): Promise<{ okFolders: number; diffFolders: number }> {
  const stats = new Map<number, Record<Kind, { ok: number; diff: number }>>();
  const stat = (year: number, kind: Kind, ok: boolean) => {
    const y = stats.get(year) ?? (Object.fromEntries(KINDS.map((k) => [k, { ok: 0, diff: 0 }])) as Record<Kind, { ok: number; diff: number }>);
    y[kind][ok ? "ok" : "diff"]++;
    stats.set(year, y);
  };
  const eur = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nextYear = Math.max(...years) + 1;
  let okFolders = 0;
  let diffFolders = 0;
  for (const f of folders) {
    const history = buildForestHistory(f.folder, f.machinery);
    const [byClient] = await tx.query<{ id: string }>("select id from sk_clients where legacy_id = $1", [tilitukiId("client", f.folder)]);
    const [byAsset] = byClient
      ? [byClient]
      : await tx.query<{ id: string }>("select client_id as id from sk_assets where legacy_id = any($1::uuid[]) limit 1", [history.map((h) => h.legacyId)]);
    const [byEntry] = byAsset
      ? [byAsset]
      : await tx.query<{ id: string }>("select client_id as id from sk_transactions where legacy_id = any($1::uuid[]) limit 1", [
          Object.values(f.entries).flat().slice(0, 500).map((e) => tilitukiId("entry", f.folder, e.id)),
        ]);
    if (!byEntry) {
      if (history.length) console.log(`kansio ${f.folder}: asiakasta ei ole Skogissa (kortteja ${history.length})`);
      continue;
    }
    const clientId = byEntry.id;
    const rows = await tx.query<{
      legacy_id: string | null; acquired_on: string; acquisition_cost: string; method: "straight_line" | "declining_balance"; useful_life_years: number | null;
      declining_rate_pct: string | null; opening_book_value: string | null; opening_year: number | null; disposed_on: string | null; sale_price: string | null;
      deps: { taxYear: number; amount: string; bookValueEnd: string }[] | null;
    }>(
      `select a.legacy_id::text, a.acquired_on::text, a.acquisition_cost, a.method, a.useful_life_years, a.declining_rate_pct, a.opening_book_value, a.opening_year,
              a.disposed_on::text, a.sale_price,
              (select json_agg(json_build_object('taxYear', d.tax_year, 'amount', d.amount, 'bookValueEnd', d.book_value_end)) from sk_depreciations d where d.asset_id = a.id) as deps
         from sk_assets a where a.client_id = $1 and a.activity = 'forestry'`,
      [clientId],
    );
    const skog: SkogForestAsset[] = rows.map((r) => ({
      legacyId: r.legacy_id,
      input: {
        acquiredOn: r.acquired_on, acquisitionCost: Number(r.acquisition_cost), method: r.method, usefulLifeYears: r.useful_life_years,
        decliningRatePct: r.declining_rate_pct === null ? null : Number(r.declining_rate_pct),
        openingBookValue: r.opening_book_value === null ? null : Number(r.opening_book_value), openingYear: r.opening_year === null ? null : Number(r.opening_year),
        disposedOn: r.disposed_on, salePrice: r.sale_price === null ? null : Number(r.sale_price),
      },
      recorded: (r.deps ?? []).map((d) => ({ taxYear: Number(d.taxYear), amount: Number(d.amount), bookValueEnd: Number(d.bookValueEnd) })),
    }));
    const agriSrc = await loadAgriDepreciationSource(tx, clientId);
    // Vain asiakkaan omat Tilituki-vuodet: muilta vuosilta ei tuoda mitään.
    const range = dataYearRange(f);
    const own = years.filter((y) => range && y >= range.first && y <= range.last);
    const checks: HistoryCheck[] = [
      ...checkForest(history, skog, own),
      ...checkForestForm(f, history, skog, own),
      ...checkAgri(f, agriSrc, own),
    ];
    const importedYears = new Set(
      (await tx.query<{ year: number }>(`select distinct tax_year as year from sk_transactions where client_id = $1 and ${TILITUKI_ID_SQL}`, [clientId]))
        .map((r) => Number(r.year)),
    );
    for (const year of own) {
      const yearPlan = buildYearPlan(f, year);
      if (yearPlan.transactions.length || importedYears.has(year)) {
        const rows = await tx.query<{ category: string; n: number; sum: string }>(
          `select category, count(*)::int as n, sum(amount_net) as sum from sk_transactions
            where client_id = $1 and tax_year = $2 and ${TILITUKI_ID_SQL} group by category`,
          [clientId, year],
        );
        checks.push(...checkImportedLedger(yearPlan, rows.map((r) => ({ category: r.category, n: Number(r.n), sum: Number(r.sum) }))));
      }
      checks.push(...checkEntriesAgainstForm(f, year));
      // Lomake 2 vain vuosille, joille Skogissa on lomake, ja asiakkaille, joilla on maataloutta.
      if (VSY002_SPECS[year] && Object.keys(f.form2[String(year)] ?? {}).some((c) => !["413", "414", "415", "416"].includes(c))) {
        const form = await loadForm2(tx, clientId, year);
        if (form) {
          const cmp = compareForm2(f.form2[String(year)] ?? {}, form.fields);
          for (const d of [...cmp.differing, ...cmp.unsupported]) checks.push({ item: `lomake 2 kenttä ${d.code}`, year, tilituki: d.tilituki, skog: d.skog, ok: false });
          if (!cmp.differing.length && !cmp.unsupported.length) checks.push({ item: "lomake 2 kenttä (kaikki)", year, tilituki: 0, skog: 0, ok: true });
        }
      }
    }
    // Vuosittainen yhteenveto: kansion vuosi on lajissaan kunnossa, jos sen kaikki tarkistukset täsmäävät.
    const byYearKind = new Map<string, boolean>();
    for (const c of checks) {
      if (c.year >= nextYear) continue;
      const key = `${c.year}/${kindOf(c.item)}`;
      byYearKind.set(key, (byYearKind.get(key) ?? true) && c.ok);
    }
    for (const [key, ok] of byYearKind) {
      const [y, k] = key.split("/");
      stat(Number(y), k as Kind, ok);
    }
    // Seuraavan vuoden (2026) alkuarvot verosuunnitelman ja lomakkeiden laskennalla Tilitukin viimeisen vuoden loppuarvoja vasten.
    const last = nextYear - 1;
    const plan = await loadPlanData(tx, clientId, nextYear);
    const planStart = Math.round(plan.assets.reduce((s, a) => s + a.year.bookValueStart, 0) * 100) / 100;
    const ttForest = Math.round(history.filter((h) => !h.disposedOn).reduce((s, h) => s + Math.max(0, tilitukiEndOf(h, last)), 0) * 100) / 100;
    // Muut kuin Tilitukista tuodut metsätalouden investoinnit ovat mukana suunnitelmassa, mutta eivät Tilitukissa.
    const otherForest = skog.some((x) => !isTilitukiId(x.legacyId));
    checks.push({
      item: `metsä: suunnitelman menojäännös 1.1.${nextYear}`, year: nextYear, tilituki: ttForest, skog: planStart, ok: Math.abs(planStart - ttForest) < 0.011 || otherForest,
      note: otherForest && Math.abs(planStart - ttForest) >= 0.011 ? "mukana muita kuin Tilituki-investointeja" : undefined,
    });
    const form = f.form2[String(last)] ?? {};
    if (agriSrc.assets.length && ["332", "357", "362", "363"].some((c) => form[c] !== undefined)) {
      const res = agriDepreciation(agriSrc.assets, agriSrc.adjustments, agriSrc.recorded, nextYear);
      const sk = Math.round(res.pools.reduce((s, p) => s + p.start, 0) * 100) / 100;
      const tt = Math.round(Object.values(POOL_FIELDS).reduce((s, fl) => s + (form[fl.end] ?? 0), 0) * 100) / 100;
      checks.push({ item: `maatalous: ryhmien menojäännös 1.1.${nextYear}`, year: nextYear, tilituki: tt, skog: sk, ok: Math.abs(sk - tt) < 0.05 });
    }
    const others = skog.filter((s) => !isTilitukiId(s.legacyId));
    const diffs = checks.filter((c) => !c.ok);
    const explained = checks.filter((c) => c.ok && c.note && !c.note.startsWith("lomaketta ei laskettu"));
    const forestNext = skog.reduce((s, a) => s + (a.input.disposedOn && Number(a.input.disposedOn.slice(0, 4)) < nextYear ? 0 : skogEndOf(a, nextYear - 1)), 0);
    const summary = `${checks.length} tarkistusta, korttien menojäännös 1.1.${nextYear} ${eur(forestNext)}`;
    const extra = others.length ? `, muita kuin Tilituki-investointeja ${others.length} (tarkista, ettei sama kohde ole kahdesti)` : "";
    if (!diffs.length) {
      okFolders++;
      console.log(`kansio ${f.folder}: täsmää (${summary})${extra}`);
    } else {
      diffFolders++;
      const kinds = KINDS.map((k) => [k, diffs.filter((d) => kindOf(d.item) === k).length] as const).filter(([, n]) => n);
      console.log(`kansio ${f.folder}: ${diffs.length} eroa (${kinds.map(([k, n]) => `${k} ${n}`).join(", ")}; ${summary})${extra}`);
      const shown = opts.verbose ? diffs : diffs.slice(0, 8);
      for (const d of shown) console.log(`  ${d.item} ${d.year}: Tilituki ${eur(d.tilituki)}, Skog ${eur(d.skog)}${d.note ? ` (${d.note})` : ""}`);
      if (shown.length < diffs.length) console.log(`  … ${diffs.length - shown.length} muuta eroa (--laaja näyttää kaikki)`);
    }
    if (opts.verbose) for (const d of explained) console.log(`  selitetty: ${d.item} ${d.year}: Tilituki ${eur(d.tilituki)}, Skog ${eur(d.skog)} (${d.note})`);
  }
  // Vuosi × laji: kansioita, joilla täsmää / eroja.
  console.log("");
  console.log("Ristiintarkistus vuosittain (kansioita täsmää / eroja):");
  console.table(
    [...stats.entries()].sort((a, b) => a[0] - b[0]).map(([year, k]) => ({
      vuosi: year,
      ...Object.fromEntries(KINDS.map((kind) => [kind, k[kind].ok + k[kind].diff ? `${k[kind].ok} / ${k[kind].diff}` : "-"])),
    })),
  );
  return { okFolders, diffFolders };
}
