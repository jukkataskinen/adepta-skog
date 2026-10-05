import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openTargetDb } from "./lib/target-db.mts";
import { checkHistory } from "./lib/history-check.mts";
import type { TtFolder } from "../src/lib/import/tilituki/map.ts";

/**
 * Investointien ja poistoryhmien menojäännökset Skogissa Tilitukia vasten.
 *
 *   npm run tilituki:tarkista -- [--kansio 9,40] [--vuodet 2023,2024,2025] [--tuotanto]
 *
 * - Metsätalouden kortit KALUSPOI:ta, korttien summat lomakkeen 2C ryhmiä ja
 *   maatalouden ryhmät lomakkeen 2 loppukenttiä vasten vuosien lopussa.
 * - Tulostaa kansioittain "täsmää" tai erot sekä menojäännökset 1.1.2026.
 * - Kantaan ei kirjoiteta. Tuloste: kansion numero, kortin tunnus ja eurot, ei nimiä.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const years = (arg("--vuodet") ?? "2023,2024,2025").split(",").map(Number);
const wanted = arg("--kansio") ? new Set(arg("--kansio")!.split(",").map((x) => `${x.trim()}.json`)) : null;
const dir = arg("--aineisto") ?? path.join("data", "private", "tilituki");
const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^\d+\.json$/.test(f) && (!wanted || wanted.has(f)));
const folders: TtFolder[] = [];
for (const f of files.sort((a, b) => Number.parseInt(a) - Number.parseInt(b))) folders.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));

let result = { okFolders: 0, diffFolders: 0 };
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    result = await checkHistory(tx, folders, years);
  });
} finally {
  await db.close();
}
console.log(`
Yhteensä: täsmää ${result.okFolders} kansiota, eroja ${result.diffFolders} kansiossa.`);
