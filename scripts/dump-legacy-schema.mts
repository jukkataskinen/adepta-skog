import { writeFile } from "node:fs/promises";
import pg from "pg";
import { stripSslMode } from "../src/lib/config/deploy-env.ts";

/**
 * Vanhan Skog-kannan taulujen rakenne tiedostoon legacy/schema.sql vertailua
 * varten. Vain sarakkeet ja tyypit, ei tietoja. Luku lukutilassa.
 *
 *   npx tsx --env-file=.env.local scripts/dump-legacy-schema.mts
 */
const TABLES = ["organisaatiot", "kayttajat", "asiakkaat", "metsatilat", "metsavahennykset", "investoinnit", "poistot", "tapahtumat", "arkisto"];
const client = new pg.Client({ connectionString: stripSslMode(process.env.LEGACY_DATABASE_URL!), ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("begin transaction read only");
const { rows } = await client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
  `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = any($1) order by table_name, ordinal_position`,
  [TABLES],
);
await client.query("rollback");
await client.end();
let out = "-- Vanhan Skog-kannan rakenne (vain sarakkeet), luettu " + new Date().toISOString().slice(0, 10) + ".\n-- Lähde: scripts/dump-legacy-schema.mts. Ei tietoja.\n";
for (const t of TABLES) {
  const cols = rows.filter((r) => r.table_name === t);
  out += `\ncreate table ${t} (\n` + cols.map((c) => `  ${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " not null" : ""}${c.column_default ? ` default ${c.column_default}` : ""}`).join(",\n") + "\n);\n";
}
await writeFile("legacy/schema.sql", out);
console.log(`Tallennettu legacy/schema.sql: ${TABLES.length} taulua, ${rows.length} saraketta.`);
