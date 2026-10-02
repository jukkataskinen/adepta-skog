import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { saveLedgerGrid } from "@/lib/ledger/grid-save";
import { deferredSuggestionLines, inView, rowFromStored, rowsFromSuggestion, type GridRow } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
import { recognizeChunk } from "@/lib/ai/receipts";
import { planChunks } from "@/lib/ai/receipts/chunks";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { listPendingSuggestions, recognizableDocument, type PendingSuggestion } from "@/lib/documents/receipt-suggestions";
import { finishRecognitionJob, jobChunk, startRecognitionJob, storeChunkResult } from "@/lib/documents/recognition-jobs";
import { listYearReceipts } from "@/lib/documents/year-receipts";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Maatalouden monikirjauksinen tosite kannassa (DECISIONS 2.10.2026,
 * maatalouden tositteiden tunnistus): tilityksen rivit tallentuvat
 * huomautuksineen ja loppusummineen, hyväksyntä kerralla tai riveittäin, ja
 * odottamaan jätetyt rivit palaavat uudeksi ehdotukseksi.
 */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService((tx) => tx.query("update sk_clients set has_agriculture = true, has_forestry = false where id = $1", [a.client]));
});
afterAll(async () => {
  await db.close();
});

const q = <T,>(text: string, params: unknown[] = []) => db.asService((tx) => tx.query<T>(text, params));
const actor = () => ({ organizationId: a.id, userId: a.staff.id });

async function yearReceipt(fileName: string): Promise<string> {
  const [d] = await q<{ id: string }>(
    `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path, created_by)
     values ($1, $2, 2025, 'receipt', $3, 'application/pdf', 100, $4, $5) returning id`,
    [a.id, a.client, fileName, `${a.id}/${a.client}/2025/v-${fileName}`, a.staff.id],
  );
  return d.id;
}

async function recognize(documentId: string) {
  const job = await db.asUser(a.staff.sub, async (tx) => {
    await recognizableDocument(tx, { clientId: a.client, year: 2025, documentId });
    return startRecognitionJob(tx, { actor: actor(), clientId: a.client, year: 2025, documentId, pageCount: 0, chunks: planChunks(0), model: "mock", activity: "agriculture" });
  });
  const doc = await db.asUser(a.staff.sub, (tx) => recognizableDocument(tx, { clientId: a.client, year: 2025, documentId }));
  const c = await db.asUser(a.staff.sub, (tx) => jobChunk(tx, { clientId: a.client, jobId: job.job.id, index: 0 }));
  const res = await recognizeChunk(mockRecognizer(), { bytes: Buffer.from("x"), contentType: doc.content_type, fileName: doc.file_name }, c.chunk, {
    activities: ["agriculture"], defaultActivity: "agriculture",
  });
  await db.asUser(a.staff.sub, (tx) => storeChunkResult(tx, { clientId: a.client, jobId: job.job.id, index: 0, result: res.ok ? { ok: true, lines: res.lines } : { ok: false } }));
  return db.asUser(a.staff.sub, (tx) => finishRecognitionJob(tx, { actor: actor(), clientId: a.client, jobId: job.job.id }));
}

const pending = () => db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025, "agriculture"));
const current = async () => (await db.asUser(a.staff.sub, (tx) => listTransactions(tx, a.client, 2025))).filter((t) => inView(t.category, "agriculture")).map(rowFromStored);
const toRows = (s: PendingSuggestion) => rowsFromSuggestion(s, { vatRegistered: true, defaultDate: "1.6.2025", year: 2025 });

function save(rows: GridRow[], extra: { keepPending?: { suggestionId: string; lines: number[] }[]; dismissedSuggestionIds?: string[] } = {}) {
  return db.asUser(a.staff.sub, (tx) => saveLedgerGrid(tx, { actor: actor(), clientId: a.client, year: 2025, rows, deletedIds: [], view: "agriculture", ...extra }));
}

describe("maatalouden monikirjauksinen tosite", () => {
  it("tilityksen rivit tallentuvat loppusummineen, huomautuksineen ja tukilajeineen", async () => {
    const doc = await yearReceipt("vipu maksetut tuet 2025.pdf");
    expect(await recognize(doc)).toMatchObject({ status: "done", lines: 8 });
    const [s] = (await pending()).filter((p) => p.document_id === doc);
    expect(s.lines.every((l) => l.documentTotal === 34970)).toBe(true);
    const inv = s.lines.find((l) => l.subsidyType === "investment_aid")!;
    expect(inv.note).toMatch(/Investointituki ei ole tuloa/);
    // Hylkäys siivoaa testin seuraavia varten.
    await db.asService((tx) => tx.query("update sk_receipt_suggestions set status = 'dismissed' where document_id = $1", [doc]));
  });

  it("hyväksyntä riveittäin: odottamaan jätetyt rivit palaavat uudeksi ehdotukseksi", async () => {
    const doc = await yearReceipt("meijeri 2025.pdf");
    expect(await recognize(doc)).toMatchObject({ status: "done", lines: 6 });
    const [s] = (await pending()).filter((p) => p.document_id === doc);
    const rows = toRows(s);
    // Rivit 2 ja 4 (seminointi, jäsenmaksu) jätetään odottamaan; rivi 3 (kuljetus) poistetaan taulukosta.
    const marked = rows.map((r, i) => (i === 2 || i === 4 ? { ...r, deferred: true } : r));
    const keepPending = deferredSuggestionLines(marked);
    const toSave = marked.filter((r) => !r.deferred && r.suggestionLine !== 3);
    const res = await save([...(await current()), ...toSave], { keepPending });
    expect(res.created).toBe(3);

    const [old] = await q<{ status: string }>("select status from sk_receipt_suggestions where id = $1", [s.id]);
    expect(old.status).toBe("accepted");
    const [next] = (await pending()).filter((p) => p.document_id === doc);
    expect(next.id).not.toBe(s.id);
    expect(next.lines.map((l) => l.category)).toEqual(["agri_veterinary", "agri_other_purchases"]);
    expect(next.lines.every((l) => l.documentTotal === 5475.5)).toBe(true);

    // Tiedosto jää vuoden tositteeksi, ja kirjaukset viittaavat siihen sivuineen.
    const [d] = await q<{ transaction_id: string | null }>("select transaction_id from sk_documents where id = $1", [doc]);
    expect(d.transaction_id).toBeNull();
    const linked = await q<{ category: string; source_pages: number[] | string | null }>(
      "select category, source_pages from sk_transactions where source_document_id = $1 order by category",
      [doc],
    );
    expect(linked.map((t) => t.category)).toEqual(["agri_coop_surplus", "agri_feed", "agri_livestock_products"]);
    const receipts = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(receipts.find((r) => r.id === doc)?.pending_activities).toEqual(["agriculture"]);
    const log = await q<{ action: string }>("select action from sk_audit_log where entity_id = $1", [next.id]);
    expect(log.map((l) => l.action)).toContain("receipt_suggestion.requeue");

    // Loput hyväksytään kerralla: mitään ei jää odottamaan.
    const res2 = await save([...(await current()), ...toRows(next)]);
    expect(res2.created).toBe(2);
    expect((await pending()).filter((p) => p.document_id === doc)).toEqual([]);
    expect(await q("select 1 from sk_transactions where source_document_id = $1", [doc])).toHaveLength(5);
  });

  it("kaikki rivit odottamaan: ehdotus säilyy ennallaan eikä sitä hylätä", async () => {
    const doc = await yearReceipt("teurastamo 2025.pdf");
    await recognize(doc);
    const [s] = (await pending()).filter((p) => p.document_id === doc);
    const rows = toRows(s).map((r) => ({ ...r, deferred: true }));
    const res = await save(await current(), { keepPending: deferredSuggestionLines(rows), dismissedSuggestionIds: [s.id] });
    expect(res.created).toBe(0);
    const [again] = (await pending()).filter((p) => p.document_id === doc);
    expect(again.id).toBe(s.id);
  });

  it("selaimen rivinumero ei voi tuoda rivejä toisesta ehdotuksesta tai hyväksytystä rivistä", async () => {
    const doc = await yearReceipt("vilja 2025.pdf");
    await recognize(doc);
    const [s] = (await pending()).filter((p) => p.document_id === doc);
    const rows = toRows(s);
    // Rivi 0 tallennetaan, ja sama rivi sekä olematon rivi 99 pyydetään odottamaan.
    await save([...(await current()), rows[0]], { keepPending: [{ suggestionId: s.id, lines: [0, 2, 99] }] });
    const [next] = (await pending()).filter((p) => p.document_id === doc);
    expect(next.lines.map((l) => l.description)).toEqual([s.lines[2].description]);
  });
});
