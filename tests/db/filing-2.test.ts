import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { buildFilingDownload, type FilingResult } from "@/lib/filing/download";
import { saveTransaction } from "@/lib/ledger/write";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Lomake 2 ja 2C samassa ilmoitustiedostossa (DECISIONS 2.10.2026).
 * Henkilötunnus on Verohallinnon yleiskuvauksen esimerkki.
 */

const FILER = "011073-998R";
let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
});
afterAll(async () => {
  await db.close();
});

const run = () => {
  const f = new FormData();
  f.set("filerPersonalId", FILER);
  return db.asUser(a.staff.sub, (tx) => buildFilingDownload(tx, { organizationId: a.id, userId: a.staff.id, userName: "Kaisa Kirjanpitäjä" }, a.client, 2025, f));
};
const text = (r: FilingResult) => (r.ok ? Buffer.from(r.bytes).toString("latin1") : "");
const records = (t: string) => t.split("\r\n").filter((l) => l.startsWith("000:"));

describe("ilmoitustiedosto maatalousasiakkaalle", () => {
  it("metsäasiakas saa 2C:n kuten ennen", async () => {
    const r = await run();
    expect(r.ok && r.fileName).toBe("2C_2025_Metsanen.txt");
    expect(records(text(r))).toEqual(["000:VSY02C25"]);
  });

  it("molemmat toiminnot: ensin lomake 2, sitten 2C, ja loki ilman tunnuksia", async () => {
    await db.asService((tx) => tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]));
    await db.asUser(a.staff.sub, (tx) =>
      saveTransaction(tx, { organizationId: a.id, userId: a.staff.id }, a.client, null, {
        bookedOn: "2025-03-31", category: "agri_crops", kind: null, description: "Vilja", amountGross: 11400, vatRate: 14, withholding: 0, businessSharePct: 100,
        forestPropertyId: null, assetRatePct: null, saleAssetId: null,
      }),
    );
    const r = await run();
    expect(r.ok && r.fileName).toBe("2_2C_2025_Metsanen.txt");
    const t = text(r);
    expect(records(t)).toEqual(["000:VSY00225", "000:VSY02C25"]);
    expect(t).toContain("215:10000,00");
    // Kumpikin tietue päättyy loppumerkkiin.
    expect(t.split("\r\n").filter((l) => l === "999:1")).toHaveLength(2);
    const logs = await db.asService((tx) =>
      tx.query<{ action: string; details: Record<string, unknown> }>("select action, details from sk_audit_log where action like 'filing.%' order by created_at"),
    );
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["filing.2.download", "filing.2c.download"]));
    expect(JSON.stringify(logs)).not.toContain(FILER);
  });

  it("pelkkä maatalous: vain lomake 2", async () => {
    await db.asService((tx) => tx.query("update sk_clients set has_forestry = false where id = $1", [a.client]));
    const r = await run();
    expect(r.ok && r.fileName).toBe("2_2025_Metsanen.txt");
    expect(records(text(r))).toEqual(["000:VSY00225"]);
  });
});
