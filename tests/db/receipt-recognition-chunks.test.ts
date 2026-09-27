import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { recognizeChunk } from "@/lib/ai/receipts";
import { planChunks } from "@/lib/ai/receipts/chunks";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { blankPdf } from "@/lib/ai/receipts/pdf";
import { listPendingSuggestions, recognizableDocument } from "@/lib/documents/receipt-suggestions";
import {
  cancelRecognitionJob,
  findRecognitionJob,
  finishRecognitionJob,
  jobChunk,
  startRecognitionJob,
  storeChunkResult,
} from "@/lib/documents/recognition-jobs";
import { listYearReceipts } from "@/lib/documents/year-receipts";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Tunnistus osissa kannassa (0012): kesken oleva tunnistus, jatkaminen
 * keskeytyksestä, epäonnistuneen palan uusinta, yhdistäminen yhdeksi
 * ehdotukseksi, eristys ja suljettu vuosi.
 */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;
let pdf: Buffer;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
  pdf = await blankPdf(20);
});
afterAll(async () => {
  await db.close();
});

const q = <T,>(text: string, params: unknown[] = []) => db.asService((tx) => tx.query<T>(text, params));
let counter = 0;

async function yearReceipt(org: OrgFixture, fileName: string): Promise<string> {
  const [d] = await q<{ id: string }>(
    `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path, created_by)
     values ($1, $2, 2025, 'receipt', $3, 'application/pdf', 100, $4, $5) returning id`,
    [org.id, org.client, fileName, `${org.id}/${org.client}/2025/c${counter++}-${fileName}`, org.staff.id],
  );
  return d.id;
}

const actorOf = (org: OrgFixture) => ({ organizationId: org.id, userId: org.staff.id });

async function start(org: OrgFixture, documentId: string, restart = false) {
  return db.asUser(org.staff.sub, async (tx) => {
    await recognizableDocument(tx, { clientId: org.client, year: 2025, documentId });
    return startRecognitionJob(tx, { actor: actorOf(org), clientId: org.client, year: 2025, documentId, pageCount: 20, chunks: planChunks(20), model: "mock", restart });
  });
}

/** Palan luku kuten palvelimen toiminto: palan tiedot kannasta, tunnistus ilman transaktiota, tulos kantaan. */
async function readChunk(org: OrgFixture, jobId: string, index: number, fileName: string, fail = false) {
  const { chunk } = await db.asUser(org.staff.sub, (tx) => jobChunk(tx, { clientId: org.client, jobId, index }));
  const res = fail ? ({ ok: false } as const) : await recognizeChunk(mockRecognizer(), { bytes: pdf, contentType: "application/pdf", fileName }, chunk);
  return db.asUser(org.staff.sub, (tx) => storeChunkResult(tx, { clientId: org.client, jobId, index, result: res.ok ? { ok: true, lines: res.lines } : { ok: false } }));
}

describe("tunnistus osissa", () => {
  it("jatkuu keskeytyksestä, epäonnistunut pala uusitaan ja tulos on yksi ehdotus", async () => {
    const name = "vuoden tositteet 2025.pdf";
    const doc = await yearReceipt(a, name);
    const first = await start(a, doc);
    expect(first.resumed).toBe(false);
    expect(first.job.chunks.map((c) => [c.first, c.last, c.status])).toEqual([
      [1, 8, "waiting"],
      [8, 15, "waiting"],
      [15, 20, "waiting"],
    ]);
    await readChunk(a, first.job.id, 0, name);

    // Keskeytys: sivu suljettiin. Uusi aloitus jatkaa samaa tunnistusta.
    const again = await start(a, doc);
    expect(again.resumed).toBe(true);
    expect(again.job.id).toBe(first.job.id);
    expect(again.job.chunks.map((c) => c.status)).toEqual(["done", "waiting", "waiting"]);
    const listed = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    const row = listed.find((r) => r.id === doc);
    expect(row?.recognition?.chunks.map((c) => c.status)).toEqual(["done", "waiting", "waiting"]);
    expect(row?.pending_suggestion).toBe(false);
    // Palojen rivit eivät tule selaimelle listan mukana.
    expect(JSON.stringify(row)).not.toContain("Metsäpalvelu");

    // Toinen pala epäonnistuu (myös uusinta), kolmas onnistuu.
    await readChunk(a, first.job.id, 1, name, true);
    const failed = await readChunk(a, first.job.id, 1, name, true);
    expect(failed).toMatchObject({ status: "failed", attempts: 2 });
    await readChunk(a, first.job.id, 2, name);

    const incomplete = await db.asUser(a.staff.sub, (tx) => finishRecognitionJob(tx, { actor: actorOf(a), clientId: a.client, jobId: first.job.id }));
    expect(incomplete.status).toBe("incomplete");
    expect(await db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025))).toHaveLength(0);

    // Uusinta onnistuu, ja palat yhdistetään.
    await readChunk(a, first.job.id, 1, name);
    const done = await db.asUser(a.staff.sub, (tx) => finishRecognitionJob(tx, { actor: actorOf(a), clientId: a.client, jobId: first.job.id }));
    expect(done.status).toBe("done");
    const pending = await db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025));
    expect(pending).toHaveLength(1);
    const lines = pending[0].lines;
    // Rajasivut 8 ja 15 tunnistettiin kahdessa palassa, mutta ehdotuksessa ne ovat kerran.
    expect(lines.filter((l) => l.pages.includes(8))).toHaveLength(1);
    expect(lines.filter((l) => l.pages.includes(15))).toHaveLength(1);
    expect(new Set(lines.map((l) => l.documentIndex)).size).toBe(lines.length);
    expect(lines.every((l) => l.pages.every((p) => p >= 1 && p <= 20))).toBe(true);
    const [stored] = await q<{ chunks: unknown; status: string }>("select chunks, status from sk_receipt_suggestions where id = $1", [first.job.id]);
    expect(stored).toMatchObject({ chunks: null, status: "pending" });
    expect(await db.asUser(a.staff.sub, (tx) => findRecognitionJob(tx, a.client, doc))).toBeNull();
    const [log] = await q<{ n: number }>("select count(*)::int as n from sk_audit_log where entity_id = $1 and action = 'receipt_suggestion.create'", [first.job.id]);
    expect(log.n).toBe(1);
  });

  it("ehdotuksen voi tehdä luetuista sivuista, ja uusi tunnistus korvaa vanhan ehdotuksen", async () => {
    const name = "osittain 2025.pdf";
    const doc = await yearReceipt(a, name);
    const { job } = await start(a, doc);
    await readChunk(a, job.id, 0, name);
    await readChunk(a, job.id, 1, name, true);
    await readChunk(a, job.id, 2, name);
    const partial = await db.asUser(a.staff.sub, (tx) => finishRecognitionJob(tx, { actor: actorOf(a), clientId: a.client, jobId: job.id, allowPartial: true }));
    expect(partial.status).toBe("done");
    const lines = (await db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025))).find((s) => s.document_id === doc)!.lines;
    expect(lines.some((l) => l.pages.includes(12))).toBe(false);

    const next = await start(a, doc);
    expect(next.resumed).toBe(false);
    for (let i = 0; i < 3; i++) await readChunk(a, next.job.id, i, name);
    await db.asUser(a.staff.sub, (tx) => finishRecognitionJob(tx, { actor: actorOf(a), clientId: a.client, jobId: next.job.id }));
    const [dismissed] = await q<{ status: string }>("select status from sk_receipt_suggestions where id = $1", [job.id]);
    expect(dismissed.status).toBe("dismissed");
  });

  it("alusta aloitus poistaa kesken olevan, ja peruutus poistaa sen", async () => {
    const doc = await yearReceipt(a, "alusta.pdf");
    const { job } = await start(a, doc);
    await readChunk(a, job.id, 0, "alusta.pdf");
    const restarted = await start(a, doc, true);
    expect(restarted.resumed).toBe(false);
    expect(restarted.job.id).not.toBe(job.id);
    expect(restarted.job.chunks.every((c) => c.status === "waiting")).toBe(true);
    expect(await q("select 1 from sk_receipt_suggestions where id = $1", [job.id])).toHaveLength(0);
    expect(await db.asUser(a.staff.sub, (tx) => cancelRecognitionJob(tx, { clientId: a.client, jobId: restarted.job.id }))).toBe(true);
    expect(await db.asUser(a.staff.sub, (tx) => findRecognitionJob(tx, a.client, doc))).toBeNull();
  });

  it("kesken olevalla tunnistuksella ei ole rivejä, valmiilla on; enintään 400 riviä", async () => {
    const doc = await yearReceipt(a, "rajat.pdf");
    const insert = (status: string, lines: string, chunks: string | null) =>
      q("insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, status, model, chunks) values ($1,$2,$3,2025,$4::jsonb,$5,'mock',$6::jsonb)", [
        a.id, a.client, doc, lines, status, chunks,
      ]);
    await expect(insert("pending", "[]", null)).rejects.toThrow();
    await expect(insert("pending", "[{}]", '[{"first":1,"last":8,"status":"waiting"}]')).rejects.toThrow();
    await expect(insert("processing", "[]", null)).rejects.toThrow();
    await expect(insert("pending", JSON.stringify(Array.from({ length: 401 }, () => ({}))), null)).rejects.toThrow();
    await insert("pending", JSON.stringify(Array.from({ length: 400 }, () => ({}))), null);
  });
});

describe("rajaukset", () => {
  it("toisen toimiston kesken olevaa tunnistusta ei näe eikä sitä voi jatkaa", async () => {
    const doc = await yearReceipt(b, "b-vuosi.pdf");
    const { job } = await start(b, doc);
    expect(await db.asUser(a.owner.sub, (tx) => tx.query("select id from sk_receipt_suggestions where id = $1", [job.id]))).toHaveLength(0);
    await expect(db.asUser(a.staff.sub, (tx) => jobChunk(tx, { clientId: b.client, jobId: job.id, index: 0 }))).rejects.toThrow();
    await expect(
      db.asUser(a.staff.sub, (tx) => storeChunkResult(tx, { clientId: b.client, jobId: job.id, index: 0, result: { ok: false } })),
    ).rejects.toThrow();
  });

  it("suljetulle vuodelle ei jatketa", async () => {
    const doc = await yearReceipt(b, "b-suljettu.pdf");
    const { job } = await start(b, doc);
    await db.asUser(b.owner.sub, (tx) =>
      tx.query("update sk_tax_years set status = 'closed', closed_at = now(), closed_by = $2 where client_id = $1 and year = 2025", [b.client, b.owner.id]),
    );
    await expect(readChunk(b, job.id, 0, "b-suljettu.pdf")).rejects.toThrow(/suljettu/);
  });
});
