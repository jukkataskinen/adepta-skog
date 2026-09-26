import pg from "pg";
import { openTargetDb } from "./lib/target-db.mts";
import { stripSslMode } from "../src/lib/config/deploy-env.ts";
import { getStorage } from "../src/lib/storage/index.ts";
import type { LegacyAsset, LegacyClient, LegacyDeduction, LegacyDepreciation, LegacyProperty, LegacyTransaction, LegacyUser } from "../src/lib/import/legacy.ts";
import { importLegacyData, type ImportResult, type LegacyArchiveRow } from "../src/lib/import/run.ts";

/**
 * Tiedot vanhasta Skog-kannasta uuteen (PLAN vaihe 2).
 *
 *   npm run tuo:vanha -- --lista
 *   npm run tuo:vanha -- --vanha-org <tunnus> --org "Toimisto Oy" [--luo-org] [--kuiva] [--tuotanto]
 *
 * - Vanha kanta luetaan osoitteesta LEGACY_DATABASE_URL vain lukutilassa.
 *   Vanhaan kantaan ei kirjoiteta (CLAUDE.md).
 * - Kohdeorganisaation on oltava olemassa (npm run kayttaja:lisaa -- --luo-org).
 * - Ajo on toistettava: rivit tunnistetaan vanhalla tunnisteella (legacy_id),
 *   eikä jo tuotuja rivejä kirjoiteta uudelleen.
 * - `--kuiva` ajaa kaiken transaktiossa ja peruu sen lopuksi, eikä tallenna tiedostoja.
 * - Tulostaa vain määriä ja syitä, ei henkilötietoja.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dry = args.includes("--kuiva");

const legacyUrl = process.env.LEGACY_DATABASE_URL;
if (!legacyUrl) {
  console.log("LEGACY_DATABASE_URL puuttuu .env.local-tiedostosta (vanhan Skog-projektin tietokantaosoite).");
  process.exit(1);
}

// Päivät merkkijonoina (1082 = date), jotta aikavyöhyke ei siirrä päivää.
pg.types.setTypeParser(1082, (v: string) => v);

const legacy = new pg.Client({ connectionString: stripSslMode(legacyUrl), ssl: { rejectUnauthorized: false } });
await legacy.connect();
await legacy.query("begin transaction read only");
const q = async <T,>(sql: string, params: unknown[] = []) => (await legacy.query(sql, params)).rows as T[];

if (args.includes("--lista")) {
  // Organisaation nimi voi vanhassa kannassa olla käyttäjän sähköposti, joten tulostetaan vain tunnus ja määrät.
  const rows = await q<{ id: string; asiakkaita: number; kayttajia: number }>(
    `select o.id, (select count(*)::int from asiakkaat a where a.organisaatio_id = o.id) as asiakkaita,
            (select count(*)::int from kayttajat k where k.organisaatio_id = o.id) as kayttajia
       from organisaatiot o order by 2 desc`,
  );
  console.table(rows);
  await legacy.end();
  process.exit(0);
}

const legacyOrg = arg("--vanha-org");
const orgName = arg("--org");
if (!legacyOrg || !orgName) {
  console.log('Käyttö: npm run tuo:vanha -- --vanha-org <tunnus> --org "Toimisto Oy" [--kuiva] [--tuotanto]   (tunnukset: --lista)');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Luku vanhasta kannasta
// ---------------------------------------------------------------------------
const users = await q<LegacyUser>("select * from kayttajat where organisaatio_id = $1", [legacyOrg]);
const clients = await q<LegacyClient>("select * from asiakkaat where organisaatio_id = $1", [legacyOrg]);
const clientIds = clients.map((c) => c.id);
const properties = await q<LegacyProperty>("select * from metsatilat where asiakas_id = any($1)", [clientIds]);
const deductions = await q<LegacyDeduction>("select * from metsavahennykset where metsatila_id = any($1)", [properties.map((p) => p.id)]);
const assets = await q<LegacyAsset>("select * from investoinnit where asiakas_id = any($1)", [clientIds]);
const depreciations = await q<LegacyDepreciation>("select * from poistot where investointi_id = any($1)", [assets.map((a) => a.id)]);
const transactions = await q<LegacyTransaction>("select * from tapahtumat where asiakas_id = any($1)", [clientIds]);
const archive = await q<LegacyArchiveRow>(
  "select id, asiakas_id, verovuosi, liite_nimi, liite_data from arkisto where asiakas_id = any($1) and liite_data is not null",
  [clientIds],
);
await legacy.query("rollback");
await legacy.end();

console.log(
  `Vanha kanta: ${users.length} käyttäjää, ${clients.length} asiakasta, ${properties.length} metsätilaa, ${assets.length} investointia, ` +
    `${transactions.length} kirjausta, ${depreciations.length} poistoa, ${deductions.length} metsävähennystä, ${archive.length} liitettä.`,
);

// ---------------------------------------------------------------------------
// Kirjoitus uuteen kantaan
// ---------------------------------------------------------------------------
class DryRun extends Error {}

let result: ImportResult | null = null;
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    result = await importLegacyData(tx, { orgName, createOrg: args.includes("--luo-org") }, { users, clients, properties, deductions, assets, depreciations, transactions, archive });
    if (dry) throw new DryRun();
    // Tiedostot ennen transaktion päättymistä: jos tallennus epäonnistuu, rivit perutaan.
    // Perutun ajon tiedostot jäävät ämpäriin orvoiksi, mutta ne eivät näy kenellekään.
    const storage = getStorage();
    for (const f of result.files) await storage.put(f.path, f.body, f.contentType);
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
} finally {
  await db.close();
}

const { counts, skipped, guessedCategories } = result as unknown as ImportResult;
console.log(dry ? "Kuiva ajo, mitään ei tallennettu:" : "Tuotu:");
console.table(counts);
if (guessedCategories) console.log(`Kirjauksia, joiden luokka pääteltiin tyypistä: ${guessedCategories}. Tarkista ne.`);
if (skipped.length) {
  const byReason: Record<string, number> = {};
  for (const s of skipped) byReason[`${s.table}: ${s.reason}`] = (byReason[`${s.table}: ${s.reason}`] ?? 0) + 1;
  console.log("Jätettiin pois:");
  console.table(byReason);
}
