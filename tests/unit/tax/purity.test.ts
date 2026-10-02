import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Verolaskenta on puhtaita funktioita (CLAUDE.md). Sallittu poikkeus
 * (DECISIONS 2.10.2026): *load.ts-tiedostot hakevat syötteen kutsujan
 * transaktiosta (tx välitetään), eivätkä ne avaa omaa transaktiota eivätkä
 * käytä kantakerrosta suoraan.
 */
describe("src/lib/tax: kantakutsut vain load-tiedostoissa", () => {
  const dir = join(process.cwd(), "src/lib/tax");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("muut tiedostot eivät tee kyselyjä", () => {
    const offenders = files.filter((f) => !f.endsWith("load.ts") && /\.query\s*[<(]/.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("load-tiedostot saavat transaktion kutsujalta", () => {
    for (const f of files.filter((x) => x.endsWith("load.ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/asUser|asService|from "@\/lib\/db"/);
      expect(src, f).toMatch(/tx: Sql/);
    }
  });
});
