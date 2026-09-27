import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { confirmYearReceipts, listYearReceipts, planYearReceipts } from "@/lib/documents/year-receipts";
import { archiveReport } from "@/lib/reports/archive";
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
  dir = await mkdtemp(path.join(tmpdir(), "skog-receipts-"));
  process.chdir(dir);
});
afterAll(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
  await db.close();
});

const file = { name: "tositteet 2025.pdf", size: 1000, type: "application/pdf" };

describe("vuoden tositteet", () => {
  it("latausosoite, tallennus ja kirjaus kantaan", async () => {
    const [p] = await db.asUser(a.staff.sub, (tx) => planYearReceipts(tx, { organizationId: a.id, clientId: a.client, year: 2025, files: [file] }));
    expect(p.url).toContain("/api/tositteet/lataus?t=");
    const bytes = Buffer.from(await (await PDFDocument.create()).save());
    await getStorage().put(p.storagePath, bytes, "application/pdf");
    const saved = await db.asUser(a.staff.sub, (tx) =>
      confirmYearReceipts(tx, { organizationId: a.id, clientId: a.client, year: 2025, userId: a.staff.id, uploads: [{ id: p.id, fileName: p.fileName, contentType: p.contentType }] }),
    );
    expect(saved).toBe(1);
    const list = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(list.map((r) => [r.file_name, r.size_bytes])).toEqual([[file.name, bytes.length]]);
  });

  it("lataamatonta tiedostoa ei kirjata", async () => {
    const [p] = await db.asUser(a.staff.sub, (tx) => planYearReceipts(tx, { organizationId: a.id, clientId: a.client, year: 2025, files: [file] }));
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        confirmYearReceipts(tx, { organizationId: a.id, clientId: a.client, year: 2025, userId: a.staff.id, uploads: [{ id: p.id, fileName: p.fileName, contentType: p.contentType }] }),
      ),
    ).rejects.toThrow(/ei tallentunut/);
  });

  it("väärä tiedostotyyppi ja toisen toimiston asiakas torjutaan", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => planYearReceipts(tx, { organizationId: a.id, clientId: a.client, year: 2025, files: [{ ...file, type: "text/html" }] })),
    ).rejects.toThrow(/PDF, JPG tai PNG/);
    await expect(
      db.asUser(a.staff.sub, (tx) => planYearReceipts(tx, { organizationId: a.id, clientId: b.client, year: 2025, files: [file] })),
    ).rejects.toThrow(/Asiakasta ei löytynyt/);
  });

  it("sulkeminen liittää tositteet lopulliseen raporttiin, ja suljetulle vuodelle ei voi lisätä", async () => {
    const id = await db.asUser(a.owner.sub, async (tx) => {
      await tx.query("update sk_tax_years set status = 'closed', closed_at = now(), closed_by = $2 where client_id = $1 and year = 2025", [a.client, a.owner.id]);
      return archiveReport(tx, { organizationId: a.id, clientId: a.client, year: 2025, userId: a.owner.id });
    });
    const [doc] = await db.asService((tx) => tx.query<{ storage_path: string }>("select storage_path from sk_documents where id = $1", [id]));
    const pdf = await PDFDocument.load(await getStorage().get(doc.storage_path));
    // Raportti + liiteluettelo + yhden sivun tositeaineisto (kirjauksen tositetta ei ole tallennuksessa, se mainitaan luettelossa).
    expect(pdf.getPageCount()).toBeGreaterThan(8);
    await expect(
      db.asUser(a.staff.sub, (tx) => planYearReceipts(tx, { organizationId: a.id, clientId: a.client, year: 2025, files: [file] })),
    ).rejects.toThrow(/suljettu/);
  });
});
