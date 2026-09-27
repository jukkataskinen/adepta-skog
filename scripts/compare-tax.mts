import pg from "pg";
import { openTargetDb } from "./lib/target-db.mts";
import { stripSslMode } from "../src/lib/config/deploy-env.ts";
import type { LegacyAsset, LegacyDeduction, LegacyDepreciation, LegacyTransaction } from "../src/lib/import/legacy.ts";
import { compareFigures, legacyFigures, newFigures } from "../src/lib/compare/legacy-tax.ts";
import { loadReportData } from "../src/lib/reports/data.ts";

/**
 * Veroraportin luvut vanhaa sovellusta vasten (PLAN vaihe 5).
 *
 *   npm run vertaa:vero -- [--vuosi 2025] [--tuotanto]
 *
 * - Vertaa jokaista uuden kannan asiakasta, joka on tuotu vanhasta (legacy_id).
 * - Vanha kanta luetaan LEGACY_DATABASE_URL-osoitteesta lukutilassa, ja uuden
 *   kannan transaktio perutaan aina. Kumpaankaan ei kirjoiteta.
 * - Tulostaa vain lukuja ja asiakkaan järjestysnumeron ja tunnisteen alun,
 *   ei nimiä (CLAUDE.md, henkilötiedot).
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const year = Number(arg("--vuosi") ?? 2025);
if (!Number.isInteger(year) || year < 2000) {
  console.log("Käyttö: npm run vertaa:vero -- [--vuosi 2025] [--tuotanto]");
  process.exit(1);
}

const legacyUrl = process.env.LEGACY_DATABASE_URL;
if (!legacyUrl) {
  console.log("LEGACY_DATABASE_URL puuttuu .env.local-tiedostosta.");
  process.exit(1);
}

// Uusi kanta: asiakkaat, jotka on tuotu vanhasta, ja niiden raportin tiedot.
const db = await openTargetDb(args);
type Target = { legacyId: string; report: Awaited<ReturnType<typeof loadReportData>> };
let targets: Target[] = [];
// Transaktio perutaan aina lopuksi, jotta vertailu ei voi muuttaa mitään.
class ReadOnly extends Error {}
try {
  await db.asService(async (tx) => {
    const clients = await tx.query<{ id: string; organization_id: string; legacy_id: string }>(
      "select id, organization_id, legacy_id from sk_clients where legacy_id is not null order by created_at",
    );
    const out: Target[] = [];
    for (const c of clients) out.push({ legacyId: c.legacy_id, report: await loadReportData(tx, c.organization_id, c.id, year) });
    targets = out;
    throw new ReadOnly();
  });
} catch (err) {
  if (!(err instanceof ReadOnly)) throw err;
} finally {
  await db.close();
}
if (!targets.length) {
  console.log("Uudessa kannassa ei ole vanhasta tuotuja asiakkaita.");
  process.exit(0);
}

// Vanha kanta vain lukutilassa.
pg.types.setTypeParser(1082, (v: string) => v);
const legacy = new pg.Client({ connectionString: stripSslMode(legacyUrl), ssl: { rejectUnauthorized: false } });
await legacy.connect();
await legacy.query("begin transaction read only");
const q = async <T,>(sql: string, params: unknown[]) => (await legacy.query(sql, params)).rows as T[];
const ids = targets.map((t) => t.legacyId);
const transactions = await q<LegacyTransaction>("select * from tapahtumat where asiakas_id = any($1) and verovuosi = $2", [ids, year]);
const assets = await q<LegacyAsset>("select * from investoinnit where asiakas_id = any($1)", [ids]);
const properties = await q<{ id: string; asiakas_id: string }>("select id, asiakas_id from metsatilat where asiakas_id = any($1)", [ids]);
const deductions = await q<LegacyDeduction>("select * from metsavahennykset where metsatila_id = any($1)", [properties.map((p) => p.id)]);
const depreciations = await q<LegacyDepreciation>("select * from poistot where investointi_id = any($1)", [assets.map((a) => a.id)]);
await legacy.query("rollback");
await legacy.end();

console.log(`Verovuosi ${year}, ${targets.length} asiakasta.\n`);
let identical = 0;
let explainedOnly = 0;
const unexplainedClients: string[] = [];

targets.forEach((t, i) => {
  const tag = `Asiakas ${i + 1} (${t.legacyId.slice(0, 8)})`;
  if (!t.report) {
    console.log(`${tag}: uudessa kannassa ei ole verovuotta ${year}.\n`);
    return;
  }
  const propIds = new Set(properties.filter((p) => p.asiakas_id === t.legacyId).map((p) => p.id));
  const lf = legacyFigures({
    year,
    transactions: transactions.filter((x) => x.asiakas_id === t.legacyId),
    assets: assets.filter((a) => a.asiakas_id === t.legacyId),
    deductions: deductions.filter((d) => propIds.has(d.metsatila_id)),
    depreciations,
  });
  const c = compareFigures(lf, newFigures(t.report));
  if (!c.differing.length) {
    identical++;
    console.log(`${tag}: luvut ovat samat.\n`);
    return;
  }
  if (c.unexplained.length) unexplainedClients.push(tag);
  else explainedOnly++;
  console.log(`${tag}:`);
  console.table(Object.fromEntries(c.rows.map((r) => [r.label, { vanha: r.legacy, uusi: r.current, ero: r.diff || "" }])));
  for (const e of c.explanations) console.log(`  - ${e}`);
  if (c.unexplained.length) console.log(`  Selittämättä: ${c.unexplained.join(", ")}`);
  console.log("");
});

console.log(`Yhteenveto: ${identical} samat, ${explainedOnly} eroavat tunnetuista syistä, ${unexplainedClients.length} selittämättä.`);
if (unexplainedClients.length) console.log(`Selvitettävät: ${unexplainedClients.join(", ")}`);
