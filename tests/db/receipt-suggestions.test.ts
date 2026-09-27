import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { GridSaveError, saveLedgerGrid } from "@/lib/ledger/grid-save";
import { rowsFromSuggestion, type GridRow } from "@/lib/ledger/grid";
import { listYearReceipts } from "@/lib/documents/year-receipts";
import {
  dismissSuggestion,
  listPendingSuggestions,
  recognizableDocument,
  storeSuggestion,
  SuggestionError,
} from "@/lib/documents/receipt-suggestions";
import { mockRecognizer } from "@/lib/ai/receipts/mock";
import { listAttachmentDocuments } from "@/lib/reports/attachments";
import { loadReportData } from "@/lib/reports/data";
import { listTransactions } from "@/lib/ledger/queries";
import { rowFromStored } from "@/lib/ledger/grid";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Tositteiden tunnistus kannassa: ehdotuksen tallennus, hyväksyntä taulukon
 * tallennuksessa (tosite liittyy kirjaukseen), hylkäys, suljettu vuosi ja eristys.
 */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
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
    [org.id, org.client, fileName, `${org.id}/${org.client}/2025/${counter++}-${fileName}`, org.staff.id],
  );
  return d.id;
}

async function recognize(org: OrgFixture, documentId: string): Promise<string> {
  const actor = { organizationId: org.id, userId: org.staff.id };
  const doc = await db.asUser(org.staff.sub, (tx) => recognizableDocument(tx, { clientId: org.client, year: 2025, documentId }));
  const res = await mockRecognizer().recognize({ bytes: Buffer.from("x"), contentType: doc.content_type, fileName: doc.file_name });
  if (!res.ok) throw new Error("tunnistus epäonnistui");
  return db.asUser(org.staff.sub, (tx) => storeSuggestion(tx, { actor, clientId: org.client, year: 2025, documentId, lines: res.lines, model: "mock" }));
}

async function suggestionRows(org: OrgFixture): Promise<GridRow[]> {
  const list = await db.asUser(org.staff.sub, (tx) => listPendingSuggestions(tx, org.client, 2025));
  return list.flatMap((s) => rowsFromSuggestion(s, { vatRegistered: true, defaultDate: "1.6.2025" }));
}

async function save(rows: GridRow[], dismissedSuggestionIds: string[] = []) {
  return db.asUser(a.staff.sub, (tx) =>
    saveLedgerGrid(tx, { actor: { organizationId: a.id, userId: a.staff.id }, clientId: a.client, year: 2025, rows, deletedIds: [], dismissedSuggestionIds }),
  );
}

describe("tositteen tunnistus", () => {
  it("ehdotus tallentuu ja näkyy taulukon riveinä", async () => {
    const doc = await yearReceipt(a, "puukauppa 15.3.2025 12550.pdf");
    const id = await recognize(a, doc);
    const rows = (await suggestionRows(a)).filter((r) => r.suggestionId === id);
    expect(rows.map((r) => [r.category, r.bookedOn, r.amountGross, r.withholding])).toEqual([
      ["standing_sale", "15.3.2025", "12 550,00", "3 000,00"],
      ["other_expense", "15.3.2025", "124,00", ""],
    ]);
    const receipts = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(receipts.find((r) => r.id === doc)?.pending_suggestion).toBe(true);
    const [log] = await q<{ details: Record<string, unknown> }>("select details from sk_audit_log where action = 'receipt_suggestion.create' and entity_id = $1", [id]);
    // Lokiin ei tule summia eikä selitteitä.
    expect(Object.keys(log.details).sort()).toEqual(["document", "lines", "model"]);
  });

  it("uusi tunnistus korvaa odottavan ehdotuksen", async () => {
    const doc = await yearReceipt(a, "kuitti 86,50.pdf");
    const first = await recognize(a, doc);
    const second = await recognize(a, doc);
    const rows = await q<{ id: string; status: string }>("select id, status from sk_receipt_suggestions where document_id = $1 order by created_at", [doc]);
    expect(rows).toEqual([
      { id: first, status: "dismissed" },
      { id: second, status: "pending" },
    ]);
  });

  it("tallennus luo kirjaukset ja liittää tositteen ensimmäiseen", async () => {
    const doc = await yearReceipt(a, "tilitys 2.4.2025 5020.pdf");
    const id = await recognize(a, doc);
    const rows = (await suggestionRows(a)).filter((r) => r.suggestionId === id);
    // Kirjanpitäjä muokkaa selitettä ennen tallennusta.
    rows[0] = { ...rows[0], description: "Puukauppa, tarkistettu" };
    const res = await save(rows);
    expect(res.created).toBe(2);
    const created = await q<{ id: string; description: string; category: string; withholding: string }>(
      "select id, description, category, withholding from sk_transactions where client_id = $1 and booked_on = '2025-04-02' order by amount_gross desc",
      [a.client],
    );
    expect(created.map((t) => [t.description, t.category, t.withholding])).toEqual([
      ["Puukauppa, tarkistettu", "standing_sale", "1200.00"],
      ["Puunostaja, mittauskulut", "other_expense", "0.00"],
    ]);
    const [d] = await q<{ transaction_id: string }>("select transaction_id from sk_documents where id = $1", [doc]);
    expect(d.transaction_id).toBe(created[0].id);
    // Saman tiedoston toinen kirjaus saa viittauksen tiedostoon ja sivuun.
    const refs = await q<{ id: string; source_document_id: string | null; source_pages: string | null }>(
      "select id, source_document_id, source_pages::text from sk_transactions where id = any($1::uuid[])",
      [created.map((t) => t.id)],
    );
    expect(refs.find((r) => r.id === created[0].id)).toMatchObject({ source_document_id: null, source_pages: null });
    expect(refs.find((r) => r.id === created[1].id)).toMatchObject({ source_document_id: doc, source_pages: "{1}" });
    const [s] = await q<{ status: string; decided_by: string }>("select status, decided_by from sk_receipt_suggestions where id = $1", [id]);
    expect(s).toEqual({ status: "accepted", decided_by: a.staff.id });
    // Tosite on nyt kirjauksen tosite, ei vuoden tosite, eikä sitä voi tunnistaa uudelleen.
    const receipts = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(receipts.some((r) => r.id === doc)).toBe(false);
    await expect(db.asUser(a.staff.sub, (tx) => recognizableDocument(tx, { clientId: a.client, year: 2025, documentId: doc }))).rejects.toThrow(SuggestionError);
    // Samaa ehdotusta ei voi hyväksyä toista kertaa (esimerkiksi toisesta välilehdestä).
    await expect(save(rows)).rejects.toThrow(/jo käsitelty/);
  });

  it("virheellinen ehdotusrivi estää koko tallennuksen", async () => {
    const doc = await yearReceipt(a, "vanha 3.12.2024 50.pdf");
    const id = await recognize(a, doc);
    const rows = (await suggestionRows(a)).filter((r) => r.suggestionId === id);
    const err = await save(rows).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GridSaveError);
    expect((err as GridSaveError).rowErrors[rows[0].key].bookedOn).toMatch(/vuonna 2025/);
    const [s] = await q<{ status: string }>("select status from sk_receipt_suggestions where id = $1", [id]);
    expect(s.status).toBe("pending");
  });

  it("taulukosta tyhjennetty ehdotus hylätään tallennuksessa, ja hylkäys onnistuu myös suoraan", async () => {
    const doc1 = await yearReceipt(a, "hylattava 10.pdf");
    const doc2 = await yearReceipt(a, "hylattava2 20.pdf");
    const id1 = await recognize(a, doc1);
    const id2 = await recognize(a, doc2);
    await save([], [id1]);
    const actor = { organizationId: a.id, userId: a.staff.id };
    expect(await db.asUser(a.staff.sub, (tx) => dismissSuggestion(tx, { actor, clientId: a.client, suggestionId: id2 }))).toBe(true);
    expect(await db.asUser(a.staff.sub, (tx) => dismissSuggestion(tx, { actor, clientId: a.client, suggestionId: id2 }))).toBe(false);
    const rows = await q<{ status: string }>("select status from sk_receipt_suggestions where id = any($1::uuid[])", [[id1, id2]]);
    expect(rows.map((r) => r.status)).toEqual(["dismissed", "dismissed"]);
    const docs = await q<{ transaction_id: string | null }>("select transaction_id from sk_documents where id = any($1::uuid[])", [[doc1, doc2]]);
    expect(docs.every((d) => d.transaction_id === null)).toBe(true);
  });
});

describe("kokoomatiedosto", () => {
  it("jää vuoden tositteeksi, ja jokaisessa kirjauksessa on viittaus tiedostoon ja sivuihin", async () => {
    const doc = await yearReceipt(a, "kokooma 2025.pdf");
    const id = await recognize(a, doc);
    const rows = (await suggestionRows(a)).filter((r) => r.suggestionId === id);
    expect(rows.every((r) => r.suggestion?.compilation)).toBe(true);
    // Kirjanpitäjä poistaa menekinedistämismaksun rivin ennen tallennusta: rivinumerot pysyvät oikeina.
    const kept = rows.filter((r) => !/menekinedistämismaksu/.test(r.description));
    const res = await save(kept);
    expect(res.created).toBe(3);
    const created = await q<{ id: string; category: string; reference: string | null; source_document_id: string | null; source_pages: string | null }>(
      "select id, category, reference, source_document_id, source_pages::text from sk_transactions where source_document_id = $1 order by amount_gross desc",
      [doc],
    );
    expect(created.map((t) => [t.category, t.reference, t.source_pages])).toEqual([
      ["standing_sale", "Sopimus 10432", "{1,2}"],
      ["delivery_sale", "Sopimus 11875", "{1,2}"],
      ["other_expense", "Lasku 1182", "{3}"],
    ]);
    const [d] = await q<{ transaction_id: string | null }>("select transaction_id from sk_documents where id = $1", [doc]);
    expect(d.transaction_id).toBeNull();
    const [s] = await q<{ status: string }>("select status from sk_receipt_suggestions where id = $1", [id]);
    expect(s.status).toBe("accepted");
    const [log] = await q<{ details: { compilation: boolean } }>("select details from sk_audit_log where action = 'receipt_suggestion.accept' and entity_id = $1", [id]);
    expect(log.details.compilation).toBe(true);

    // Vuoden tositteissa tiedosto näkyy kirjattuna.
    const receipts = await db.asUser(a.staff.sub, (tx) => listYearReceipts(tx, a.client, 2025));
    expect(receipts.find((r) => r.id === doc)).toMatchObject({ pending_suggestion: false, booked_count: 3 });

    // Taulukon rivit näyttävät linkin tiedoston sivulle.
    const stored = await db.asUser(a.staff.sub, (tx) => listTransactions(tx, a.client, 2025));
    const grid = stored.filter((t) => t.source_document_id === doc).map(rowFromStored);
    expect(grid.map((r) => r.sourcePages)).toEqual(expect.arrayContaining([[1, 2], [3]]));

    // Raportin liitteissä tiedosto on kerran, ja kirjausluettelossa on viittaus liitteeseen ja sivuun.
    const docs = await db.asUser(a.staff.sub, (tx) => listAttachmentDocuments(tx, a.client, 2025));
    expect(docs.filter((x) => x.id === doc)).toHaveLength(1);
    const no = docs.findIndex((x) => x.id === doc) + 1;
    const report = await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2025, { attachmentRefs: true }));
    const refs = report!.transactions.filter((t) => t.attachment?.startsWith(`${no},`)).map((t) => t.attachment);
    expect(refs.sort()).toEqual([`${no}, s. 1–2`, `${no}, s. 1–2`, `${no}, s. 3`]);
    const plain = await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2025));
    expect(plain!.transactions.every((t) => t.attachment === null)).toBe(true);
  });

  it("kirjaus ei voi viitata toisen asiakkaan tositteeseen", async () => {
    const other = await q<{ id: string }>(
      `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path)
       values ($1, $2, 2025, 'receipt', 'toinen.pdf', 'application/pdf', 1, $3) returning id`,
      [a.id, a.otherClient, `${a.id}/${a.otherClient}/2025/toinen.pdf`],
    );
    const [t] = await q<{ id: string }>("select id from sk_transactions where client_id = $1 limit 1", [a.client]);
    await expect(q("update sk_transactions set source_document_id = $1 where id = $2", [other[0].id, t.id])).rejects.toThrow(/toisen asiakkaan/);
    await expect(q("update sk_transactions set source_pages = '{0}' where id = $1", [t.id])).rejects.toThrow();
  });
});

describe("rajaukset", () => {
  it("toisen toimiston ehdotuksia ei näe eikä niihin voi viitata", async () => {
    const doc = await yearReceipt(b, "b-kuitti 30.pdf");
    const id = await recognize(b, doc);
    const seen = await db.asUser(a.owner.sub, (tx) => tx.query("select id from sk_receipt_suggestions where id = $1", [id]));
    expect(seen).toHaveLength(0);
    await expect(db.asUser(a.staff.sub, (tx) => recognizableDocument(tx, { clientId: b.client, year: 2025, documentId: doc }))).rejects.toThrow(SuggestionError);
    await expect(
      db.asUser(a.owner.sub, (tx) =>
        tx.query("insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model) values ($1,$2,$3,2025,'[{}]','mock')", [
          a.id, b.client, doc,
        ]),
      ),
    ).rejects.toThrow(/toisen organisaation|row-level security/);
    // Saman toimiston toisen asiakkaan tositteeseen ei voi viitata.
    const other = await yearReceipt(a, "a-kuitti 40.pdf");
    await expect(
      q("insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model) values ($1,$2,$3,2025,'[{}]','mock')", [
        a.id, a.otherClient, other,
      ]),
    ).rejects.toThrow(/toisen asiakkaan/);
  });

  it("suljetulle vuodelle ei tunnisteta", async () => {
    const doc = await yearReceipt(b, "suljettu 50.pdf");
    const pending = await recognize(b, doc);
    await db.asUser(b.owner.sub, (tx) =>
      tx.query("update sk_tax_years set status = 'closed', closed_at = now(), closed_by = $2 where client_id = $1 and year = 2025", [b.client, b.owner.id]),
    );
    await expect(recognize(b, doc)).rejects.toThrow(/suljettu/);
    const actor = { organizationId: b.id, userId: b.staff.id };
    await expect(
      db.asUser(b.staff.sub, (tx) => storeSuggestion(tx, { actor, clientId: b.client, year: 2025, documentId: doc, lines: [], model: "mock" })),
    ).rejects.toThrow(/suljettu/);
    await expect(db.asUser(b.staff.sub, (tx) => dismissSuggestion(tx, { actor, clientId: b.client, suggestionId: pending }))).rejects.toThrow(/suljettu/);
  });
});
