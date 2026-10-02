import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { saveLedgerGrid } from "@/lib/ledger/grid-save";
import { emptyGridRow, inView, rowFromStored, rowsFromSuggestion, viewMessage, type GridRow } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
import { recognizeChunk } from "@/lib/ai/receipts";
import { planChunks } from "@/lib/ai/receipts/chunks";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { listPendingSuggestions, recognizableDocument } from "@/lib/documents/receipt-suggestions";
import { finishRecognitionJob, jobChunk, startRecognitionJob, storeChunkResult } from "@/lib/documents/recognition-jobs";
import { listYearReceipts } from "@/lib/documents/year-receipts";
import { ledgerView, type Activity } from "@/lib/tax/rules";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Kirjanpito toiminnoittain (DECISIONS 2.10.2026, maatalouden kirjanpito):
 * näkymä näyttää ja tallentaa vain oman toimintonsa kirjaukset, uusi rivi saa
 * näkymän toiminnon, ja tunnistus jakaa ehdotuksen toiminnoittain. Pelkän
 * metsäasiakkaan kirjanpito on ennallaan.
 */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
  // A:n asiakkaalla on metsä- ja maataloutta, B:n asiakas on pelkkä metsäasiakas.
  await db.asService((tx) => tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]));
});
afterAll(async () => {
  await db.close();
});

const q = <T,>(text: string, params: unknown[] = []) => db.asService((tx) => tx.query<T>(text, params));
const actorOf = (org: OrgFixture) => ({ organizationId: org.id, userId: org.staff.id });

function save(org: OrgFixture, rows: GridRow[], view: Activity | null, deletedIds: string[] = []) {
  return db.asUser(org.staff.sub, (tx) => saveLedgerGrid(tx, { actor: actorOf(org), clientId: org.client, year: 2025, rows, deletedIds, view }));
}

async function stored(org: OrgFixture) {
  return db.asUser(org.staff.sub, (tx) => listTransactions(tx, org.client, 2025));
}

describe("kirjanpito toiminnoittain", () => {
  it("näkymä valitaan asiakkaan toiminnoista", () => {
    expect(ledgerView({ hasForestry: true, hasAgriculture: false }, "maatalous")).toBeNull();
    expect(ledgerView({ hasForestry: true, hasAgriculture: true }, null)).toBe("forestry");
    expect(ledgerView({ hasForestry: true, hasAgriculture: true }, "maatalous")).toBe("agriculture");
    expect(ledgerView({ hasForestry: false, hasAgriculture: true }, null)).toBe("agriculture");
  });

  it("uusi rivi saa näkymän toiminnon, ja väärän toiminnon luokka hylätään", async () => {
    const wrong = { ...emptyGridRow("w1", "5.3.2025"), category: "other_expense", amountGross: "125,50", vatRate: "25,5" };
    await expect(save(a, [wrong], "agriculture")).rejects.toMatchObject({ rowErrors: { w1: { category: viewMessage("agriculture") } } });

    const milk = { ...emptyGridRow("n1", "15.4.2025"), category: "agri_livestock_products", amountGross: "5 244", vatRate: "14" };
    const res = await save(a, [milk], "agriculture");
    expect(res.created).toBe(1);
    const rows = await stored(a);
    const saved = rows.find((r) => r.category === "agri_livestock_products")!;
    expect(saved.activity).toBe("agriculture");
    expect(Number(saved.vat_rate)).toBe(14);
  });

  it("maatalouden näkymä ei näe eikä muuta metsätalouden kirjauksia", async () => {
    const all = await stored(a);
    const forestRow = all.find((r) => r.activity === "forestry")!;
    const agriRows = all.filter((r) => inView(r.category, "agriculture"));
    expect(agriRows.every((r) => r.activity === "agriculture")).toBe(true);
    expect(agriRows.some((r) => r.id === forestRow.id)).toBe(false);

    // Metsätalouden kirjaus maatalouden taulukossa on vanhentunut tieto: tallennus perutaan.
    const edited = { ...rowFromStored(forestRow), description: "muutettu" };
    await expect(save(a, [edited], "agriculture")).rejects.toThrow(/muutettu toisaalla/);
    await expect(save(a, [], "agriculture", [forestRow.id])).rejects.toThrow(/muutettu toisaalla/);

    // Maatalouden taulukon tallennus ilman metsän rivejä ei poista niitä.
    const agriGrid = agriRows.map(rowFromStored);
    agriGrid[0] = { ...agriGrid[0], description: "Esimerkin Meijeri, maitotilitys" };
    await save(a, agriGrid, "agriculture");
    const after = await stored(a);
    expect(after.find((r) => r.id === forestRow.id)).toMatchObject({ description: forestRow.description, amount_gross: forestRow.amount_gross });
    expect(after.filter((r) => r.activity === "forestry")).toHaveLength(all.filter((r) => r.activity === "forestry").length);
  });

  it("metsätalouden näkymä hylkää maatalouden luokan", async () => {
    const row = { ...emptyGridRow("f1", "5.3.2025"), category: "agri_fuels", amountGross: "86,50", vatRate: "25,5" };
    await expect(save(a, [row], "forestry")).rejects.toMatchObject({ rowErrors: { f1: { category: viewMessage("forestry") } } });
  });

  it("pelkkä metsäasiakas: ei rajausta, tallennus kuten ennen", async () => {
    const before = await stored(b);
    const row = { ...emptyGridRow("m1", "6.3.2025"), category: "other_expense", amountGross: "62,75", vatRate: "25,5" };
    const res = await save(b, [...before.map(rowFromStored), row], null);
    expect(res).toEqual({ created: 1, updated: 0, deleted: 0 });
    const after = await stored(b);
    expect(after).toHaveLength(before.length + 1);
    expect(after.every((r) => r.activity === "forestry")).toBe(true);
  });
});

async function yearReceipt(org: OrgFixture, fileName: string): Promise<string> {
  const [d] = await q<{ id: string }>(
    `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path, created_by)
     values ($1, $2, 2025, 'receipt', $3, 'application/pdf', 100, $4, $5) returning id`,
    [org.id, org.client, fileName, `${org.id}/${org.client}/2025/v-${fileName}`, org.staff.id],
  );
  return d.id;
}

/** Tunnistus näkymästä kuten sivulla: aloitus, palat ja yhdistäminen. */
async function recognizeFrom(org: OrgFixture, documentId: string, activity: Activity, activities: Activity[]) {
  const job = await db.asUser(org.staff.sub, async (tx) => {
    await recognizableDocument(tx, { clientId: org.client, year: 2025, documentId });
    return startRecognitionJob(tx, { actor: actorOf(org), clientId: org.client, year: 2025, documentId, pageCount: 0, chunks: planChunks(0), model: "mock", activity });
  });
  expect(job.job.activity).toBe(activity);
  const doc = await db.asUser(org.staff.sub, (tx) => recognizableDocument(tx, { clientId: org.client, year: 2025, documentId }));
  const c = await db.asUser(org.staff.sub, (tx) => jobChunk(tx, { clientId: org.client, jobId: job.job.id, index: 0 }));
  const res = await recognizeChunk(mockRecognizer(), { bytes: Buffer.from("x"), contentType: doc.content_type, fileName: doc.file_name }, c.chunk, {
    activities, defaultActivity: c.activity,
  });
  await db.asUser(org.staff.sub, (tx) => storeChunkResult(tx, { clientId: org.client, jobId: job.job.id, index: 0, result: res.ok ? { ok: true, lines: res.lines } : { ok: false } }));
  return db.asUser(org.staff.sub, (tx) => finishRecognitionJob(tx, { actor: actorOf(org), clientId: org.client, jobId: job.job.id }));
}

describe("tositteiden tunnistus maataloudelle", () => {
  it("maatilan kokooma jaetaan toiminnoittain, ja maatalouden ehdotus hyväksytään maatalouden taulukossa", async () => {
    const doc = await yearReceipt(a, "maatila 2025.pdf");
    const out = await recognizeFrom(a, doc, "agriculture", ["forestry", "agriculture"]);
    expect(out).toMatchObject({ status: "done", lines: 6, byActivity: { agriculture: 5, forestry: 1 } });

    const agri = await db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025, "agriculture"));
    const forest = await db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025, "forestry"));
    expect(agri.map((s) => s.activity)).toEqual(["agriculture"]);
    expect(agri[0].lines.map((l) => [l.category, l.vatRate])).toEqual([
      ["agri_livestock_products", 14],
      ["agri_contracting", 25.5],
      ["agri_state_subsidy", 0],
      ["agri_fertilizers", 25.5],
      ["agri_myel", 0],
    ]);
    expect(forest.map((s) => s.lines.map((l) => l.category))).toEqual([["other_expense"]]);
    let receipts = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(receipts.find((r) => r.id === doc)?.pending_activities.sort()).toEqual(["agriculture", "forestry"]);

    // Hyväksyntä maatalouden taulukossa: rivit tallentuvat maatalouteen.
    const current = (await stored(a)).filter((r) => inView(r.category, "agriculture")).map(rowFromStored);
    const suggestionRows = rowsFromSuggestion(agri[0], { vatRegistered: true, defaultDate: "1.6.2025", year: 2025 });
    const res = await save(a, [...current, ...suggestionRows], "agriculture");
    expect(res.created).toBe(5);
    const fromDoc = await q<{ activity: string; category: string; source_document_id: string | null }>(
      "select activity, category, source_document_id from sk_transactions where client_id = $1 and source_document_id = $2 order by category",
      [a.client, doc],
    );
    expect(fromDoc).toHaveLength(5);
    expect(fromDoc.every((t) => t.activity === "agriculture")).toBe(true);
    const [status] = await q<{ status: string }>("select status from sk_receipt_suggestions where id = $1", [agri[0].id]);
    expect(status.status).toBe("accepted");

    // Tiedosto jää vuoden tositteeksi, koska siitä odottaa vielä metsätalouden ehdotus.
    receipts = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(receipts.find((r) => r.id === doc)?.pending_activities).toEqual(["forestry"]);

    // Metsätalouden ehdotus hyväksytään metsätalouden taulukossa.
    const forestCurrent = (await stored(a)).filter((r) => inView(r.category, "forestry")).map(rowFromStored);
    const forestRows = rowsFromSuggestion(forest[0], { vatRegistered: true, defaultDate: "1.6.2025", year: 2025 });
    expect((await save(a, [...forestCurrent, ...forestRows], "forestry")).created).toBe(1);
    const linked = await q<{ activity: string }>("select activity from sk_transactions where source_document_id = $1", [doc]);
    expect(linked.map((t) => t.activity).sort()).toEqual(["agriculture", "agriculture", "agriculture", "agriculture", "agriculture", "forestry"]);
  });

  it("epäselvä tosite saa näkymän toiminnon, ja pelkkä metsäasiakas saa metsätalouden luokan kuten ennen", async () => {
    const both: Activity[] = ["forestry", "agriculture"];
    const agriDoc = await yearReceipt(a, "polttoaine 2025-04-02 86,50.pdf");
    expect(await recognizeFrom(a, agriDoc, "agriculture", both)).toMatchObject({ byActivity: { agriculture: 1 } });
    const forestDoc = await yearReceipt(a, "polttoaine 2025-04-03 70,00.pdf");
    expect(await recognizeFrom(a, forestDoc, "forestry", both)).toMatchObject({ byActivity: { forestry: 1 } });
    const lines = await db.asUser(a.staff.sub, (tx) => listPendingSuggestions(tx, a.client, 2025));
    expect(lines.find((s) => s.document_id === agriDoc)?.lines[0].category).toBe("agri_fuels");
    expect(lines.find((s) => s.document_id === forestDoc)?.lines[0].category).toBe("other_expense");

    const bDoc = await yearReceipt(b, "maatila 2025.pdf");
    const out = await recognizeFrom(b, bDoc, "forestry", ["forestry"]);
    expect(out).toMatchObject({ status: "done", byActivity: { forestry: 1 } });
    const [s] = await db.asUser(b.staff.sub, (tx) => listPendingSuggestions(tx, b.client, 2025, null));
    expect(s.activity).toBe("forestry");
  });

  it("pelkkä maatalousasiakas: metsän rivit jäävät pois", async () => {
    await db.asService((tx) => tx.query("update sk_clients set has_forestry = false where id = $1", [a.client]));
    const doc = await yearReceipt(a, "maatila 2025 b.pdf");
    const out = await recognizeFrom(a, doc, "agriculture", ["agriculture"]);
    expect(out).toMatchObject({ status: "done", lines: 5, byActivity: { agriculture: 5 } });
    await db.asService((tx) => tx.query("update sk_clients set has_forestry = true where id = $1", [a.client]));
  });
});
