import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openTargetDb } from "./lib/target-db.mts";
import { loadForm2 } from "../src/lib/tax/agri-form-load.ts";
import { form2Label } from "../src/lib/filing/vsy002-fields.ts";
import { tilitukiId } from "../src/lib/import/origin.ts";
import { compareForm2, summarizeComparisons, type Form2Comparison } from "../src/lib/compare/tilituki.ts";
import type { TtFolder } from "../src/lib/import/tilituki/map.ts";

/**
 * Skogin lomake 2 Tilitukin lomaketta vasten (PLAN 9, Tilituki-tuonti).
 *
 *   npm run tilituki:vertaa -- [--vuosi 2025] [--kansio N] [--tuotanto]
 *
 * - Laskee lomakkeen 2 jokaiselle Tilitukista tuodulle asiakkaalle ja vertaa
 *   kentittäin Tilitukin LOMAKE2_YYYY-taulun lukuihin (data/private/tilituki).
 * - Kantaan ei kirjoiteta: transaktio perutaan aina.
 * - Tulostaa kansion numeron, kentän tunnuksen ja eurot. Ei nimiä eikä tunnuksia.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const year = Number(arg("--vuosi") ?? 2025);
const folderArg = arg("--kansio");
const dir = arg("--aineisto") ?? path.join("data", "private", "tilituki");

const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json") && (!folderArg || f === `${folderArg}.json`));
if (!files.length) {
  console.log(`Jäsennettyä aineistoa ei löytynyt kansiosta ${dir}.`);
  process.exit(1);
}
const folders: TtFolder[] = [];
for (const f of files.sort((a, b) => Number.parseInt(a) - Number.parseInt(b))) folders.push(JSON.parse(await readFile(path.join(dir, f), "utf8")));

const eur = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const results: { folder: string; result: Form2Comparison }[] = [];
class ReadOnly extends Error {}
const db = await openTargetDb(args);
try {
  await db.asService(async (tx) => {
    for (const f of folders) {
      const [client] = await tx.query<{ id: string }>("select id from sk_clients where legacy_id = $1", [tilitukiId("client", f.folder)]);
      // Y-tunnuksella yhdistetty asiakas: tunnistetaan tuoduista kirjauksista.
      const [byEntry] = client
        ? [client]
        : await tx.query<{ id: string }>(
            "select client_id as id from sk_transactions where legacy_id = any($1::uuid[]) limit 1",
            [(f.entries[String(year)] ?? []).map((e) => tilitukiId("entry", f.folder, e.id))],
          );
      if (!byEntry) continue;
      const form = await loadForm2(tx, byEntry.id, year);
      if (!form) continue;
      const result = compareForm2(f.form2[String(year)] ?? {}, form.fields);
      results.push({ folder: f.folder, result });
      if (!result.differing.length && !result.unsupported.length) {
        console.log(`kansio ${f.folder}: täsmää (${result.matching.length} kenttää)`);
        continue;
      }
      console.log(`kansio ${f.folder}: ${result.matching.length} kenttää täsmää, ${result.differing.length} poikkeaa`);
      for (const d of result.differing) {
        console.log(`  ${d.code} ${form2Label(d.code, year).slice(0, 60)}: Tilituki ${eur(d.tilituki)}, Skog ${eur(d.skog)}, ero ${eur(d.diff)}`);
      }
      for (const d of result.unsupported) console.log(`  ${d.code}: Tilituki ${eur(d.tilituki)}, ei Skogin lomakkeella 2`);
      for (const e of form.errors) console.log(`  Skogin tarkistus: ${e.replace(/\d[\d\s,.]*\s?€/g, "… €")}`);
    }
    throw new ReadOnly();
  });
} catch (err) {
  if (!(err instanceof ReadOnly)) throw err;
} finally {
  await db.close();
}

if (!results.length) {
  console.log("Tilitukista tuotuja asiakkaita ei löytynyt. Aja ensin npm run tilituki:tuo.");
  process.exit(0);
}
const s = summarizeComparisons(results);
console.log(`\nYhteenveto, verovuosi ${year}: ${s.total} asiakasta, ${s.identical} täsmää kokonaan, ${s.partial} osittain.`);
if (s.commonFields.length) console.log(`Yleisimmät poikkeavat kentät: ${s.commonFields.slice(0, 10).map(([c, n]) => `${c} (${n})`).join(", ")}`);
const unsupported = new Set(results.flatMap((r) => r.result.unsupported.map((d) => d.code)));
if (unsupported.size) console.log(`Tilitukin kentät, joita Skogin lomake 2 ei tunne: ${[...unsupported].join(", ")}`);
