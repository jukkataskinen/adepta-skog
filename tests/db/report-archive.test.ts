import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { archiveReport } from "@/lib/reports/archive";
import { loadReportData } from "@/lib/reports/data";
import { getStorage } from "@/lib/storage";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
let cwd: string;
let dir: string;

beforeAll(async () => {
  // Paikallinen tallennus kirjoittaa työhakemiston .data-kansioon, joten testi ajetaan väliaikaisessa kansiossa.
  cwd = process.cwd();
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
  dir = await mkdtemp(path.join(tmpdir(), "skog-report-"));
  process.chdir(dir);
});
afterAll(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
  await db.close();
});

describe("veroraportti", () => {
  it("tiedot: kirjaukset, vahvistettu poisto ja metsävähennys", async () => {
    const r = await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2025));
    expect(r?.status).toBe("open");
    expect(r?.plan.income).toBe(15000);
    expect(r?.depreciation[0]).toMatchObject({ amount: 7500, bookValueStart: 30000, bookValueEnd: 22500 });
    expect(r?.plan.recordedDeduction).toBe(3000);
    expect(r?.confirmed).toBe(true);
  });

  it("toisen toimiston asiakkaan raporttia ei saa", async () => {
    expect(await db.asUser(a.owner.sub, (tx) => loadReportData(tx, a.id, b.client, 2025))).toBeNull();
  });

  it("sulkeminen arkistoi lopullisen raportin", async () => {
    const id = await db.asUser(a.owner.sub, async (tx) => {
      await tx.query("update sk_tax_years set status = 'closed', closed_at = now(), closed_by = $2 where client_id = $1 and year = 2025", [a.client, a.owner.id]);
      return archiveReport(tx, { organizationId: a.id, clientId: a.client, year: 2025, userId: a.owner.id });
    });
    const [doc] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ kind: string; storage_path: string; file_name: string }>("select kind, storage_path, file_name from sk_documents where id = $1", [id]),
    );
    expect(doc).toMatchObject({ kind: "report", file_name: "veroraportti_2025.pdf" });
    const bytes = await getStorage().get(doc.storage_path);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
