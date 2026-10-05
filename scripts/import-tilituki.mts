import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openTargetDb } from "./lib/target-db.mts";
import { importTilituki, summarizeUnmapped, type TilitukiImportResult } from "../src/lib/import/tilituki/run.ts";
import type { TtFolder } from "../src/lib/import/tilituki/map.ts";

/**
 * Tilituki Pro -aineisto Skogiin (PLAN 9, BLOCKERS 12).
 *
 *   python scripts/tilituki/parse.py <Tilitukin datakansio>      → data/private/tilituki/<kansio>.json
 *   npm run tilituki:tuo -- [--kansio N] [--vuosi 2025] [--org "Nimi"] [--luo] [--metsa] [--kuiva] [--tuotanto]
 *
 * - Tuo maatalousasiakkaat (lomake 2): asiakas, vuoden viennit maatalouden ja
 *   metsätalouden luokille, aiemmat investoinnit ja ryhmien menojäännökset
 *   edellisen vuoden lopussa, Tilitukissa valitut poistot, vuoden tiedot,
 *   varaukset ja jaksotukset. `--metsa` tuo myös pelkät metsäasiakkaat.
 * - `--luo` luo puuttuvan organisaation ja asiakkaat. Ilman sitä päivitetään vain
 *   asiakkaat, jotka ovat jo Skogissa (Y-tunnus tai aiempi tuonti).
 * - Ajo on toistettava. Aja ensin `--kuiva`, joka peruu kaiken lopuksi.
 * - Tulostaa vain määriä sekä kartoittamattomat tilit tilikartan numerolla ja
 *   nimellä. Asiakkaan nimiä, tunnuksia tai vientien selitteitä ei tulosteta.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dry = args.includes("--kuiva");
const year = Number(arg("--vuosi") ?? 2025);
const folderArg = arg("--kansio");
const orgName = arg("--org") ?? "Adepta Tilit Oy";
const dir = arg("--aineisto") ?? path.join("data", "private", "tilituki");
if (!Number.isInteger(year) || year < 2000) {
  console.log('Käyttö: npm run tilituki:tuo -- [--kansio N] [--vuosi 2025] [--org "Nimi"] [--luo] [--metsa] [--kuiva] [--tuotanto]');
  process.exit(1);
}

let files: string[];
try {
  files = (await readdir(dir)).filter((f) => f.endsWith(".json") && (!folderArg || f === `${folderArg}.json`));
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
let result: TilitukiImportResult | null = null;
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    result = await importTilituki(tx, { orgName, createOrg: args.includes("--luo"), createClients: args.includes("--luo"), year, includeForestOnly: args.includes("--metsa") }, data);
    if (dry) throw new DryRun();
  });
} catch (err) {
  if (!(err instanceof DryRun)) throw err;
} finally {
  await db.close();
}

const r = result as unknown as TilitukiImportResult;
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
