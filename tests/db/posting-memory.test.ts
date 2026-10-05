import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { loadClientMemory, loadOfficeMemory, loadPostingHints, suggestForEntry } from "@/lib/ledger/posting-memory-load";
import { loadSuggestionRows } from "@/lib/ledger/suggestion-rows";
import { storeSuggestion } from "@/lib/documents/receipt-suggestions";
import type { SuggestionLine } from "@/lib/ai/receipts/schema";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Tiliöintimuisti kannassa (DECISIONS 6.10.2026): asiakkaan oma historia,
 * toimiston varahaku vain saman organisaation ja käyttäjälle näkyvien
 * asiakkaiden kirjauksista, ei koskaan toisen organisaation dataa, eikä
 * mitään tallennu ehdotuksista. Kuvitteellinen data.
 */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

const q = <T,>(text: string, params: unknown[] = []) => db.asService((tx) => tx.query<T>(text, params));

async function book(org: OrgFixture, client: string, date: string, description: string, category = "other_expense", share = 100) {
  await q(
    `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, amount_gross, vat_rate, business_share_pct)
     values ($1, $2, $3, 'expense', $4, $5, 100, 100, 0, $6)`,
    [org.id, client, date, category, description, share],
  );
}

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
  for (const y of [2023, 2024]) {
    await q("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, $3)", [a.id, a.client, y]);
    await q("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, $3)", [a.id, a.otherClient, y]);
    await q("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, $3)", [b.id, b.client, y]);
  }
  await book(a, a.client, "2023-04-10", "Esimerkkitie tiemaksu 2023", "other_expense", 50);
  await book(a, a.client, "2024-04-12", "Esimerkkitie tiemaksu 2024", "other_expense", 50);
  // Toimiston toinen asiakas (vain pääkäyttäjä näkee) ja toinen toimisto samalla vastapuolella.
  await book(a, a.otherClient, "2024-02-01", "Metsänhoitoyhdistys jäsenmaksu", "other_expense", 70);
  await book(b, b.client, "2024-03-01", "Salainen vastapuoli palvelu", "travel");
  await book(b, b.client, "2024-03-02", "Metsänhoitoyhdistys jäsenmaksu", "travel");
});
afterAll(async () => {
  await db.close();
});

const input = (over: Partial<Parameters<typeof suggestForEntry>[2]> = {}) => ({
  clientId: a.client, description: "Esimerkkitie tiemaksu", date: "2025-04-01", activity: null, ...over,
});

describe("syötön ehdotukset", () => {
  it("kirjanpitäjä saa vastuuasiakkaansa ehdotuksen perusteineen", async () => {
    const res = await db.asUser(a.staff.sub, (tx) => suggestForEntry(tx, a.id, input()));
    expect(res?.[0]).toMatchObject({ source: "client", strong: true, category: "other_expense", businessSharePct: 50 });
    expect(res?.[0].basis).toMatch(/^Tiliöity kuten 4\/2024: 9 Muut vuosimenot, alv 0 %, osuus 50 %; 2 kertaa vuosina 2023–2024\./);
    // Selaimelle ei palauteta selitteitä eikä summia.
    expect(JSON.stringify(res)).not.toMatch(/Esimerkkitie|100,00/);
  });

  it("ei ehdotuksia asiakkaasta, jota käyttäjä ei näe, eikä toisen toimiston asiakkaasta", async () => {
    expect(await db.asUser(a.staff.sub, (tx) => suggestForEntry(tx, a.id, input({ clientId: a.otherClient })))).toBeNull();
    expect(await db.asUser(a.staff.sub, (tx) => suggestForEntry(tx, a.id, input({ clientId: b.client })))).toBeNull();
    expect(await db.asUser(a.owner.sub, (tx) => suggestForEntry(tx, b.id, input({ clientId: b.client })))).toBeNull();
  });

  it("toimiston varahaku: pääkäyttäjä näkee muiden asiakkaiden tiliöinnin, kirjanpitäjä vain omien asiakkaidensa", async () => {
    const owner = await db.asUser(a.owner.sub, (tx) => suggestForEntry(tx, a.id, input({ description: "Metsänhoitoyhdistys jäsenmaksu" })));
    expect(owner?.[0]).toMatchObject({ source: "office", strong: false, category: "other_expense", businessSharePct: 100 });
    expect(owner?.[0].basis).toMatch(/^Toimiston muilta asiakkailta/);
    // Toisen toimiston samaa vastapuolta (travel) ei tule mukaan.
    expect(owner?.some((s) => s.category === "travel")).toBe(false);
    const staff = await db.asUser(a.staff.sub, (tx) => suggestForEntry(tx, a.id, input({ description: "Metsänhoitoyhdistys jäsenmaksu" })));
    expect(staff).toEqual([]);
  });

  it("toisen organisaation kirjauksia ei tule muistiin, vaikka kysely annettaisiin palvelun roolilla", async () => {
    const scope = { organizationId: a.id, clientId: a.client };
    const office = await db.asService((tx) => loadOfficeMemory(tx, scope, ["Salainen vastapuoli palvelu", "Metsänhoitoyhdistys jäsenmaksu"]));
    const descriptions = office?.signatures.flatMap((s) => s.entries.map((e) => e.description)) ?? [];
    expect(descriptions).toEqual(["Metsänhoitoyhdistys jäsenmaksu"]);
    const wrongOrg = await db.asService((tx) => loadClientMemory(tx, { organizationId: b.id, clientId: a.client }));
    expect(wrongOrg.signatures).toEqual([]);
  });

  it("vihje tekoälylle tulee vain asiakkaan omista toistuvista kirjauksista", async () => {
    const hints = await db.asUser(a.staff.sub, (tx) => loadPostingHints(tx, { organizationId: a.id, clientId: a.client }, "2025-12-31"));
    expect(hints).toEqual(["esimerkkitie tiemaksu → other_expense, alv 0, osuus 50"]);
  });
});

describe("tunnistuksen ehdotusrivit", () => {
  it("vahva osuma tulee riville ehdotuksena, eikä mitään tallennu ilman taulukon tallennusta", async () => {
    const [d] = await q<{ id: string }>(
      `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path, created_by)
       values ($1, $2, 2025, 'receipt', 'lasku.pdf', 'application/pdf', 100, $3, $4) returning id`,
      [a.id, a.client, `${a.id}/${a.client}/2025/muisti-lasku.pdf`, a.staff.id],
    );
    const line: SuggestionLine = {
      date: "2025-04-10", description: "Esimerkkitie tiemaksu", category: "travel", amountGross: 120, vatRate: 0, withholding: 0, confidence: 0.6,
      reasoning: "Laskun summa.", documentIndex: 1, sourceDocument: "Lasku", documentType: "invoice", pages: [1], contractNumber: null, invoiceNumber: null,
    };
    const actor = { organizationId: a.id, userId: a.staff.id };
    await db.asUser(a.staff.sub, (tx) => storeSuggestion(tx, { actor, clientId: a.client, year: 2025, documentId: d.id, lines: [line], model: "mock" }));
    const count = async () => (await q<{ n: number }>("select count(*)::int as n from sk_transactions where client_id = $1", [a.client]))[0].n;
    const before = await count();
    const rows = await db.asUser(a.staff.sub, (tx) =>
      loadSuggestionRows(tx, { organizationId: a.id, clientId: a.client, year: 2025, view: null, vatRegistered: true, defaultDate: "1.6.2025" }, []),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: null, category: "other_expense", businessSharePct: "50", amountGross: "120,00" });
    expect(rows[0].suggestion?.posting).toMatchObject({ applied: "memory", options: [expect.objectContaining({ source: "ai", category: "travel" })] });
    expect(await count()).toBe(before);
    const [s] = await q<{ status: string }>("select status from sk_receipt_suggestions where document_id = $1", [d.id]);
    expect(s.status).toBe("pending");
  });
});
