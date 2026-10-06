import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { countClientPendingReceipts, listClientPendingOverview, pendingSuggestionHref } from "@/lib/documents/pending-overview";
import { listClients } from "@/lib/clients/queries";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Odottavat tulkinnat (DECISIONS 6.10.2026): asiakkaan kaikki odottavat
 * ehdotukset kootaan kaikilta vuosilta ja kummastakin toiminnosta. Vain asiakkaan
 * omat, ja RLS rajaa kirjanpitäjän vastuuasiakkaisiinsa ja toimiston omiin.
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
let n = 0;

const line = (category: string, amountGross: number, pages: number[]) => ({
  date: "2025-03-15", description: "Testirivi", category, amountGross, vatRate: 25.5, withholding: 0, confidence: 0.9, reasoning: "testi", pages,
});

async function pending(org: OrgFixture, client: string, input: { year: number; activity: "forestry" | "agriculture"; lines: unknown[]; createdAt: string; status?: string; fileName?: string }) {
  const [d] = await q<{ id: string }>(
    `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path)
     values ($1, $2, $3, 'receipt', $4, 'application/pdf', 100, $5) returning id`,
    [org.id, client, input.year, input.fileName ?? `nippu-${n}.pdf`, `${org.id}/${client}/${input.year}/${n++}.pdf`],
  );
  const [s] = await q<{ id: string }>(
    `insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model, status, activity, created_at)
     values ($1, $2, $3, $4, $5, 'mock', $6, $7, $8) returning id`,
    [org.id, client, d.id, input.year, JSON.stringify(input.lines), input.status ?? "pending", input.activity, input.createdAt],
  );
  return { documentId: d.id, suggestionId: s.id };
}

describe("odottavat tulkinnat", () => {
  let forest2025: { suggestionId: string };
  let agri2026: { suggestionId: string; documentId: string };

  beforeAll(async () => {
    await q("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2026)", [a.id, a.client]);
    await q("update sk_clients set has_agriculture = true where id = $1", [a.client]);
    forest2025 = await pending(a, a.client, { year: 2025, activity: "forestry", lines: [line("other_expense", 100, [2]), line("other_expense", 24.5, [1, 2])], createdAt: "2026-10-01T08:00:00Z" });
    agri2026 = await pending(a, a.client, { year: 2026, activity: "agriculture", lines: [line("agri_other_sales", 50, [])], createdAt: "2026-10-05T08:00:00Z", fileName: "maatila.pdf" });
    // Käsitellyt eivät ole odottavia.
    await pending(a, a.client, { year: 2025, activity: "forestry", lines: [line("other_expense", 10, [])], createdAt: "2026-10-06T08:00:00Z", status: "dismissed" });
    // Toinen asiakas samassa toimistossa ja toinen toimisto.
    await pending(a, a.otherClient, { year: 2025, activity: "forestry", lines: [line("other_expense", 10, [])], createdAt: "2026-10-06T09:00:00Z" });
    await pending(b, b.client, { year: 2025, activity: "forestry", lines: [line("other_expense", 10, [])], createdAt: "2026-10-06T09:00:00Z" });
  });

  it("kokoaa asiakkaan odottavat kaikilta vuosilta ja kummastakin toiminnosta, uusin ensin", async () => {
    const list = await db.asUser(a.staff.sub, (tx) => listClientPendingOverview(tx, a.client));
    expect(list.map((i) => [i.suggestionId, i.year, i.activity, i.lineCount, i.totalGross])).toEqual([
      [agri2026.suggestionId, 2026, "agriculture", 1, 50],
      [forest2025.suggestionId, 2025, "forestry", 2, 124.5],
    ]);
    expect(list[0].fileName).toBe("maatila.pdf");
    expect(list[1].pages).toEqual([1, 2]);
    expect(Date.parse(list[0].createdAt)).toBe(Date.parse("2026-10-05T08:00:00Z"));
    expect(await db.asUser(a.staff.sub, (tx) => countClientPendingReceipts(tx, a.client))).toBe(2);
  });

  it("kirjaukseen liitetty tosite ei ole enää odottava", async () => {
    const extra = await pending(a, a.client, { year: 2025, activity: "forestry", lines: [line("other_expense", 5, [])], createdAt: "2026-10-02T08:00:00Z" });
    expect((await db.asUser(a.staff.sub, (tx) => listClientPendingOverview(tx, a.client))).some((i) => i.suggestionId === extra.suggestionId)).toBe(true);
    await q("update sk_documents set transaction_id = $1 where id = $2", [a.transaction, extra.documentId]);
    expect((await db.asUser(a.staff.sub, (tx) => listClientPendingOverview(tx, a.client))).some((i) => i.suggestionId === extra.suggestionId)).toBe(false);
  });

  it("RLS: kirjanpitäjä ei näe muiden asiakkaiden eikä toisen toimiston tulkintoja", async () => {
    expect(await db.asUser(a.staff.sub, (tx) => listClientPendingOverview(tx, a.otherClient))).toEqual([]);
    expect(await db.asUser(a.staff.sub, (tx) => countClientPendingReceipts(tx, a.otherClient))).toBe(0);
    expect(await db.asUser(a.owner.sub, (tx) => countClientPendingReceipts(tx, a.otherClient))).toBe(1);
    expect(await db.asUser(a.owner.sub, (tx) => listClientPendingOverview(tx, b.client))).toEqual([]);
    expect(await db.asUser(b.owner.sub, (tx) => listClientPendingOverview(tx, a.client))).toEqual([]);
  });

  it("asiakaslistassa on odottavien tositteiden määrä", async () => {
    const rows = await db.asUser(a.owner.sub, (tx) => listClients(tx, a.id));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.pending_receipts]))).toEqual({ [a.client]: 2, [a.otherClient]: 1 });
  });

  it("linkki vie oikeaan vuoteen, toimintoon ja ehdotuksen kohdalle", () => {
    expect(pendingSuggestionHref("c1", { year: 2026, activity: "agriculture", suggestionId: "s1" }, true)).toBe("/asiakkaat/c1/kirjanpito?vuosi=2026&toiminta=maatalous#ehdotus-s1");
    expect(pendingSuggestionHref("c1", { year: 2025, activity: "forestry", suggestionId: "s2" }, true)).toBe("/asiakkaat/c1/kirjanpito?vuosi=2025#ehdotus-s2");
    // Pelkkä maatalousasiakas: näkymä on aina maatalous, joten parametria ei tarvita.
    expect(pendingSuggestionHref("c1", { year: 2025, activity: "agriculture", suggestionId: "s3" }, false)).toBe("/asiakkaat/c1/kirjanpito?vuosi=2025#ehdotus-s3");
  });
});
