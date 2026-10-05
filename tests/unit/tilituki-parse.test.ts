import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Tilitukin DBF-jäsennin (scripts/tilituki/parse.py) pienellä, käsin tehdyllä
 * kuvitteellisella aineistolla. DBF-tiedostot kirjoitetaan testissä väliaikaiseen
 * kansioon, joten repossa ei ole DBF-tiedostoja (CI-vahti estää ne).
 */

type Field = [name: string, type: "C" | "N" | "D" | "L", length: number, decimals?: number];
type Value = string | number | boolean | null;

/** Pienin mahdollinen dBase/FoxPro-taulu: otsikko, kenttäkuvaukset, 0x0D, rivit, 0x1A. Koodisivu cp1252 (0x03). */
function dbf(fields: Field[], rows: { values: Value[]; deleted?: boolean }[]): Buffer {
  const recordLen = 1 + fields.reduce((s, f) => s + f[2], 0);
  const headerLen = 32 + 32 * fields.length + 1;
  const head = Buffer.alloc(32);
  head[0] = 0x03;
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(headerLen, 8);
  head.writeUInt16LE(recordLen, 10);
  head[29] = 0x03;
  const descs = fields.map(([name, type, len, dec]) => {
    const d = Buffer.alloc(32);
    d.write(name, 0, "latin1");
    d.write(type, 11, "latin1");
    d[16] = len;
    d[17] = dec ?? 0;
    return d;
  });
  const recs = rows.map((r) => {
    const b = Buffer.alloc(recordLen, 0x20);
    b.write(r.deleted ? "*" : " ", 0, "latin1");
    let off = 1;
    fields.forEach(([, type, len, dec], i) => {
      const v = r.values[i];
      let s = "";
      if (v === null || v === undefined) s = "";
      else if (type === "N") s = Number(v).toFixed(dec ?? 0).padStart(len);
      else if (type === "L") s = v ? "T" : "F";
      else s = String(v);
      b.write(s.slice(0, len).padEnd(len), off, "latin1");
      off += len;
    });
    return b;
  });
  return Buffer.concat([head, ...descs, Buffer.from([0x0d]), ...recs, Buffer.from([0x1a])]);
}

function findPython(): string | null {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (r.status === 0) return cmd;
  }
  return null;
}

const python = findPython();
const root = mkdtempSync(path.join(tmpdir(), "tilituki-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function writeFolder() {
  const dir = path.join(root, "data", "7");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "YR.DBF"), dbf([["YRAVAIN", "C", 20], ["YRTIETOC", "C", 60]], [
    { values: ["YRVIRALLINENNIMI", "Koetila Pyykkö"] },
    // Henkilötunnuksen muotoinen tunnus ei saa päätyä tulokseen.
    { values: ["YRLYTUNN", "010170-123A"] },
    { values: ["YRPOSTI", "19650 JOUTSA"] },
    { values: ["KPVEROVUOSI", "2025"] },
  ]));
  writeFileSync(path.join(dir, "KPTILIT.DBF"), dbf(
    [["KTTILI", "C", 16], ["KTTILINIMI", "C", 32], ["KTTILILUOK", "C", 16], ["KTVERONRO", "C", 16], ["KTALVPROS", "N", 6, 2], ["KTOLETUS", "C", 16], ["KTLISATILI", "C", 16]],
    [{ values: ["2500", "Sähkömenot", "TU", "L2_258", 25.5, "D", "3950"] }, { values: ["3950", "Ostojen ALV", "TAALVO", "LALV_307", 0, "D", ""] }],
  ));
  const vf: Field[] = [
    ["KVUNIIKKI", "C", 10], ["KVTOSITE", "N", 10], ["KVTOSLAJI", "C", 2], ["KVRIVINRO", "N", 4], ["KVTOSPVM", "D", 8], ["KVTILINRO", "C", 16],
    ["KVDEBET", "N", 13, 2], ["KVKREDIT", "N", 13, 2], ["KVSELITE", "C", 64], ["KVPERSUMMA", "N", 13, 2], ["KVALVPROS", "N", 13, 2], ["KVMIINUS", "N", 13, 2],
  ];
  writeFileSync(path.join(dir, "KPVIENTI.DBF"), dbf(vf, [
    { values: ["0000000001", 5, "1", 1, "20250131", "2500", 100, 0, "Sähkö tammikuu", 125.5, 25.5, 25.5] },
    { values: ["0000000001", 5, "1", 2, "20250131", "3950", 25.5, 0, "", 125.5, 0, 25.5] },
    { values: ["0000000002", 6, "1", 1, "20250228", "2500", 999, 0, "Poistettu", null, 0, 0], deleted: true },
  ]));
  writeFileSync(path.join(dir, "KPVIHIST.DBF"), dbf(vf, [{ values: ["0000000009", 1, "1", 1, "20241231", "2500", 50, 0, "", null, 0, 0] }]));
  writeFileSync(path.join(dir, "KALUSTO.DBF"), dbf(
    [["PKUNIIKKI", "C", 10], ["PKNIMI", "C", 32], ["PKTYYPPI", "C", 16], ["PKTULOLAHD", "C", 16], ["PKOSTOPVM", "D", 8], ["PKKAYTTOPV", "D", 8], ["PKHHINTA", "N", 12, 2], ["PKMAXPPROS", "N", 12, 2]],
    [{ values: ["0000000001", "Mönkijä", "Kone", "METSÄTALOUS", "20230315", "", 4000, 25] }],
  ));
  const pf: Field[] = [
    ["PKUNIIKKI", "C", 10], ["PPVUOSI", "C", 16], ["PPEVLPROS", "N", 12, 2], ["PPEVLARVOA", "N", 12, 2], ["PPLISAYS", "N", 12, 2], ["PPVAHENNYS", "N", 12, 2],
    ["PPEVLMENOJ", "N", 12, 2], ["PPEVLPSUMM", "N", 12, 2], ["PPEVLARVOL", "N", 12, 2],
  ];
  writeFileSync(path.join(dir, "KALUSPOI.DBF"), dbf(pf, [
    { values: ["0000000001", "2023", 25, 0, 4000, 0, 4000, 1000, 3000] },
    { values: ["0000000001", "2024", 100, 3000, 0, 0, 3000, 3000, 0] },
    // Vuodeton rivi on keskeneräinen tietue, joka ohitetaan.
    { values: ["0000000001", "", 0, 0, 0, 0, 0, 0, 0] },
  ]));
  writeFileSync(path.join(dir, "lomake2_2025.dbf"), dbf([["TYVINRO", "C", 16], ["VERONRO", "C", 16], ["TYYPPI", "C", 1], ["TULOSTA", "C", 128]], [
    { values: ["226", "L2_258", "N", "       100,00"] },
    { values: ["", "L21_102", "N", "     14284,30"] },
    { values: ["", "L21_141", "C", "1234567-8"] },
    { values: ["000", "L2_TYVITUNNUS", "C", "VSY002"] },
    { values: ["603", "L2C_102", "N", "   30000,00"] },
    { values: ["230", "L2_260", "N", "         0,00"] },
  ]));
  return dir;
}

describe.skipIf(!python)("Tilitukin DBF-jäsennin", () => {
  it("lukee perustiedot, tilikartan, viennit ja lomakkeen ilman henkilötunnusta", () => {
    writeFolder();
    const out = path.join(root, "out");
    const r = spawnSync(python!, [path.join("scripts", "tilituki", "parse.py"), path.join(root, "data"), "--ulos", out], {
      encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    expect(r.status, r.stderr).toBe(0);
    // Tuloste on vain määriä: ei nimeä eikä selitteitä.
    expect(r.stdout).toContain("kansio 7: tilejä 2, vientejä 3");
    expect(r.stdout).not.toMatch(/Pyykkö|Sähkö tammikuu/);
    const data = JSON.parse(readFileSync(path.join(out, "7.json"), "utf8"));
    expect(data.client).toMatchObject({ name: "Koetila Pyykkö", businessId: null, postalCode: "19650", city: "JOUTSA", openYear: 2025 });
    expect(JSON.stringify(data)).not.toContain("010170-123A");
    expect(data.accounts[0]).toEqual({ number: "2500", name: "Sähkömenot", class: "TU", taxCode: "L2_258", vatPct: 25.5, side: "D", vatAccount: "3950" });
    expect(Object.keys(data.entries).sort()).toEqual(["2024", "2025"]);
    expect(data.entries["2025"]).toHaveLength(2);
    expect(data.entries["2025"][0]).toMatchObject({ id: "0000000001-1", voucher: "15", row: 1, date: "2025-01-31", account: "2500", debit: 100, vatPct: 25.5, vat: 25.5 });
    expect(data.form2["2025"]).toEqual({ "226": 100 });
    expect(data.form2c["2025"]).toEqual({ "603": 30000 });
    expect(data.form2Raw["2025"]).toEqual({ L2_258: 100, L21_102: 14284.3 });
    // Kalusto koko historiana: kortin tiedot ja vuosirivit, vuodeton rivi ohitettu.
    expect(data.machinery).toEqual([{
      id: "0000000001", name: "Mönkijä", type: "Kone", source: "METSÄTALOUS", acquiredOn: "2023-03-15", usedFrom: null, cost: 4000, maxPct: 25,
      years: {
        "2023": { pct: 25, start: 0, additions: 4000, disposals: 0, base: 4000, depreciation: 1000, end: 3000 },
        "2024": { pct: 100, start: 3000, additions: 0, disposals: 0, base: 3000, depreciation: 3000, end: 0 },
      },
    }]);
  });
});
