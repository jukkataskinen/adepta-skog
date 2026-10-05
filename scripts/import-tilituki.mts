import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openTargetDb } from "./lib/target-db.mts";
import { checkHistory } from "./lib/history-check.mts";
import { closeImportedYears, importTilituki, summarizeUnmapped, type TilitukiImportResult } from "../src/lib/import/tilituki/run.ts";
import { parseYears, type TtFolder } from "../src/lib/import/tilituki/map.ts";

/**
 * Tilituki Pro -aineisto Skogiin (PLAN 9, BLOCKERS 12).
 *
 *   python scripts/tilituki/parse.py <Tilitukin datakansio>      → data/private/tilituki/<kansio>.json
 *   npm run tilituki:tuo -- [--kansio N] [--vuosi 2002-2025] [--org "Nimi"] [--luo] [--metsa] [--sulje 2024] [--avaa 2026] [--tarkista] [--laaja]
 *                           [--kuiva] [--tuotanto]
 *
 * - Tuo maatalousasiakkaat (lomake 2): asiakas, vuoden viennit maatalouden ja
 *   metsätalouden luokille, aiemmat investoinnit ja ryhmien menojäännökset
 *   edellisen vuoden lopussa, Tilitukissa valitut poistot, vuoden tiedot,
 *   varaukset ja jaksotukset. `--metsa` tuo myös pelkät metsäasiakkaat.
 * - `--luo` luo puuttuvan organisaation ja asiakkaat. Ilman sitä päivitetään vain
 *   asiakkaat, jotka ovat jo Skogissa (Y-tunnus tai aiempi tuonti).
 * - Metsätalouden kalustokortit tuodaan joka ajossa koko historiana (hankinta,
 *   poistot vuosittain, myynti), riippumatta --vuosi-valinnasta.
 * - `--vuosi 2023,2024,2025` tai `--vuosi 2002-2025` tuo vuodet järjestyksessä samassa transaktiossa.
 *   Asiakkaalle tuodaan vain vuodet hänen ensimmäisestä viimeiseen Tilituki-vuoteensa, ja Tilitukin
 *   esimerkkiaineisto (vuoden 2001 viennit, 2002 lomake) ohitetaan.
 * - `--sulje 2024` sulkee lopuksi tuodut verovuodet tähän vuoteen asti. Tuonnin sulkema vuosi avataan
 *   uusintatuonnissa ja suljetaan uudelleen; käyttäjän sulkemaan vuoteen ei kosketa.
 * - `--avaa 2026` avaa viimeisen vuoden jälkeen verovuoden tuoduille asiakkaille, jos sitä ei ole.
 * - `--tarkista` vertaa lopuksi kirjaukset, menojäännökset ja tuetut lomakkeet Tilitukiin (tilituki:tarkista)
 *   samassa transaktiossa. `--laaja` tulostaa myös kansioittaiset rivit vuosittain.
 * - Ajo on toistettava. Aja ensin `--kuiva`, joka peruu kaiken lopuksi.
 * - Tulostaa vain määriä sekä kartoittamattomat tilit tilikartan numerolla ja
 *   nimellä. Asiakkaan nimiä, tunnuksia tai vientien selitteitä ei tulosteta.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dry = args.includes("--kuiva");
// --vuosi 2023,2024,2025 tai 2002-2025: vuodet järjestyksessä samassa transaktiossa (ensimmäinen vuosi tuo aloitusarvot).
const years = parseYears(arg("--vuosi") ?? "2025") ?? [];
// --sulje 2024: tuodut vuodet tähän asti suljetaan lopuksi.
const closeThrough = arg("--sulje") ? Number(arg("--sulje")) : null;
const verbose = args.includes("--laaja");
const folderArg = arg("--kansio");
const orgName = arg("--org") ?? "Adepta Tilit Oy";
// --avaa 2026: avaa verovuoden tuoduille asiakkaille (useampi pilkulla), jotta kirjanpito voi jatkua tuodusta historiasta.
const openYears = (arg("--avaa") ?? "").split(",").filter(Boolean).map(Number);
const dir = arg("--aineisto") ?? path.join("data", "private", "tilituki");
if (
  !years.length || openYears.some((y) => !Number.isInteger(y) || y < 2000 || y > 2100) ||
  (closeThrough !== null && (!Number.isInteger(closeThrough) || closeThrough < 2000))
) {
  console.log(
    'Käyttö: npm run tilituki:tuo -- [--kansio N,M] [--vuosi 2002-2025] [--org "Nimi"] [--luo] [--metsa] [--sulje 2024] [--avaa 2026] [--tarkista] [--laaja] [--kuiva] [--tuotanto]',
  );
  process.exit(1);
}

let files: string[];
try {
  // --kansio 9,11,14: useampi kansio pilkulla.
  const wantedFolders = folderArg ? new Set(folderArg.split(",").map((x) => `${x.trim()}.json`)) : null;
  files = (await readdir(dir)).filter((f) => /^\d+\.json$/.test(f) && (!wantedFolders || wantedFolders.has(f)));
} catch {
  console.log(`Kansiota ${dir} ei ole. Aja ensin: python scripts/tilituki/parse.py <Tilitukin datakansio>`);
  process.exit(1);
}
if (!files.length) {
  console.log(folderArg ? `Kansiota ${folderArg} ei ole jäsennetty.` : "Jäsennettyjä kansioita ei ole.");
  process.exit(1);
}
const data: TtFolder[] = [];
for (const f of files.sort((a, b) => Number.parseInt(a) - Number.parseInt(b))) data.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));

class DryRun extends Error {}
const results: { year: number; result: TilitukiImportResult }[] = [];
let closed = 0;
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    for (const year of years) {
      const last = year === years[years.length - 1];
      const result = await importTilituki(
        tx,
        { orgName, createOrg: args.includes("--luo"), createClients: args.includes("--luo"), year, includeForestOnly: args.includes("--metsa"), openYears: last ? openYears : [] },
        data,
      );
      results.push({ year, result });
    }
    if (closeThrough !== null) {
      const [org] = await tx.query<{ id: string }>("select id from sk_organizations where name = $1", [orgName]);
      const imported = results.flatMap(({ year, result }) => result.folders.filter((f) => f.status === "imported" && f.clientId).map((f) => ({ clientId: f.clientId!, year })));
      closed = await closeImportedYears(tx, org.id, imported, closeThrough);
    }
    // --tarkista: menojäännökset Tilitukia vasten saman transaktion sisällä, joten kuiva-ajokin näyttää lopputuloksen.
    if (args.includes("--tarkista")) {
      console.log("\nTarkistus tuonnin jälkeen:");
      const c = await checkHistory(tx, data, years, { verbose });
      console.log(`Tarkistus: täsmää ${c.okFolders} kansiota, eroja ${c.diffFolders} kansiossa.\n`);
    }
    if (dry) throw new DryRun();
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
} finally {
  await db.close();
}

if (verbose) for (const { year, result } of results) report(year, result);
summary();

/** Koko ajon yhteenveto: vuosittain tuodut kansiot ja kirjaukset, sitten määrät, ohitetut ja kartoittamattomat yhteensä. */
function summary() {
  console.log(`${dry ? "Kuiva ajo, mitään ei tallennettu" : "Tuotu"}: verovuodet ${years[0]}–${years[years.length - 1]}, ${data.length} kansiota.`);
  const perYear = results.map(({ year, result }) => ({
    vuosi: year,
    kansioita: result.folders.filter((f) => f.status === "imported").length,
    kirjauksia: result.counts["kirjauksia"] ?? 0,
    "verovuosia avattu": result.counts["verovuosia avattu"] ?? 0,
    ryhmäpoistoja: result.counts["ryhmäpoistoja"] ?? 0,
  }));
  console.table(perYear);
  const totals: Record<string, number> = {};
  for (const { result } of results) for (const [k, v] of Object.entries(result.counts)) if (!k.startsWith("asiakkaita")) totals[k] = (totals[k] ?? 0) + v;
  if (closeThrough !== null) totals[`verovuosia suljettu (≤ ${closeThrough})`] = closed;
  console.log("Yhteensä:");
  console.table(totals);
  const skipped: Record<string, number> = {};
  for (const { result } of results) for (const f of result.folders) if (f.status === "skipped") skipped[f.reason ?? ""] = (skipped[f.reason ?? ""] ?? 0) + 1;
  if (Object.keys(skipped).length) {
    console.log("Ohitetut kansiovuodet syittäin:");
    console.table(skipped);
  }
  const ignored: Record<string, number> = {};
  const notes: Record<string, number> = {};
  for (const { result } of results) {
    for (const f of result.folders) {
      for (const [k, v] of Object.entries(f.ignored)) ignored[k] = (ignored[k] ?? 0) + v;
      for (const [k, v] of Object.entries(f.notes)) notes[k] = (notes[k] ?? 0) + v;
    }
  }
  if (Object.keys(ignored).length) {
    console.log("Ohitetut viennit syittäin (eivät kuulu lomakkeille 2 tai 2C):");
    console.table(ignored);
  }
  if (Object.keys(notes).length) {
    console.log("Huomautukset:");
    console.table(notes);
  }
  const unmapped = summarizeUnmapped(results.flatMap((r) => r.result.folders));
  if (unmapped.length) {
    console.log("Kartoittamattomat tilit kaikilta vuosilta (kirjaa käsin tai täydennä kartoitus):");
    console.table(unmapped.map((u) => ({ tili: u.account, nimi: u.name, veronumero: u.taxCode, syy: u.reason, vientejä: u.rows, asiakkaita: u.clients })));
  }
}

function report(year: number, r: TilitukiImportResult) {
  console.log(`${dry ? "Kuiva ajo, mitään ei tallennettu" : "Tuotu"}: verovuosi ${year}, ${data.length} kansiota.`);
  for (const f of r.folders) {
    if (f.status === "skipped") {
      console.log(`kansio ${f.folder}: ohitettu (${f.reason})`);
      continue;
    }
    const parts = Object.entries(f.counts).map(([k, v]) => `${k} ${v}`);
    const unmapped = f.unmapped.reduce((s, u) => s + u.count, 0);
    if (unmapped) parts.push(`kartoittamattomia vientejä ${unmapped}`);
    for (const [k, v] of Object.entries(f.notes)) parts.push(`${k} ${v}`);
    console.log(`kansio ${f.folder}: ${parts.join(", ") || "ei muutoksia"}`);
  }
  console.log("\nYhteensä:");
  console.table(r.counts);
  const ignored: Record<string, number> = {};
  for (const f of r.folders) for (const [k, v] of Object.entries(f.ignored)) ignored[k] = (ignored[k] ?? 0) + v;
  if (Object.keys(ignored).length) {
    console.log("Ohitetut viennit (eivät kuulu lomakkeille 2 tai 2C):");
    console.table(ignored);
  }
  const unmapped = summarizeUnmapped(r.folders);
  if (unmapped.length) {
    console.log("Kartoittamattomat tilit (kirjaa käsin tai täydennä kartoitus):");
    console.table(unmapped.map((u) => ({ tili: u.account, nimi: u.name, veronumero: u.taxCode, syy: u.reason, vientejä: u.rows, asiakkaita: u.clients })));
  }
}
