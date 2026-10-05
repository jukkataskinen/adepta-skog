import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Sql } from "@/lib/db/types";
import { saveTransaction } from "@/lib/ledger/write";
import { loadExpected, setExpectedSkip } from "@/lib/ledger/expected-load";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Odotetut kirjaukset (0019): historia kannasta, ohitus vuodelle, lukitus,
 * eristys ja lisäys kirjaukseksi normaalin kirjauspolun kautta. Kuvitteellinen data.
 */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
  await db.asService(async (tx) => {
    for (const y of [2023, 2024, 2026]) await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, $3)", [a.id, a.client, y]);
    for (const y of [2023, 2024, 2025]) {
      await tx.query(
        `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_gross, vat_rate)
         values ($1, $2, $3, 'expense', 'other_expense', $4, $5, 25.5)`,
        [a.id, a.client, `${y}-03-12`, `Metsänhoitomaksu ${y}`, 200 + (y - 2023) * 10],
      );
    }
    // Vuosi 2023 suljetaan, kuten vanhat vuodet.
    await tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2023", [a.client]);
  });
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const asStaff = <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(a.staff.sub, fn);
const client = () => ({ id: a.client, vatRegistered: true });

describe("odotetut kirjaukset kannasta", () => {
  it("historia tuottaa odotetun kirjauksen, joka on myöhässä", async () => {
    const v = await asStaff((tx) => loadExpected(tx, client(), 2026, null, "2026-10-05"));
    expect(v.historyYears).toBe(3);
    const fee = v.states.find((s) => s.category === "other_expense")!;
    expect(fee.estimate).toBe(220);
    expect(fee.instances[0].date).toBe("2026-03-12");
    expect(fee.late).toBe(1);
  });

  it("uudella asiakkaalla ei ole historiaa", async () => {
    const v = await db.asUser(a.owner.sub, (tx) => loadExpected(tx, { id: a.otherClient, vatRegistered: false }, 2026, null, "2026-10-05"));
    expect(v).toEqual({ states: [], historyYears: 0 });
  });

  it("ohitus tallentuu vuodelle, lokiin ja palautuu", async () => {
    const key = (await asStaff((tx) => loadExpected(tx, client(), 2026, null, "2026-10-05"))).states[0].key;
    await asStaff((tx) => setExpectedSkip(tx, actor(), a.client, 2026, key, true));
    await asStaff((tx) => setExpectedSkip(tx, actor(), a.client, 2026, key, true)); // toinen kerta ei tuplaa
    let v = await asStaff((tx) => loadExpected(tx, client(), 2026, null, "2026-10-05"));
    expect(v.states[0].skipped).toBe(true);
    expect(v.states[0].late).toBe(0);
    const log = await db.asUser(a.owner.sub, (tx) => tx.query<{ action: string }>("select action from sk_audit_log where entity = 'sk_expected_skips' order by created_at"));
    expect(log.map((l) => l.action)).toEqual(["expected.skip"]);
    // Ohitus koskee vain tätä vuotta.
    const next = await asStaff((tx) => tx.query("select 1 from sk_expected_skips where client_id = $1 and tax_year = 2027", [a.client]));
    expect(next).toHaveLength(0);
    await asStaff((tx) => setExpectedSkip(tx, actor(), a.client, 2026, key, false));
    v = await asStaff((tx) => loadExpected(tx, client(), 2026, null, "2026-10-05"));
    expect(v.states[0].skipped).toBe(false);
  });

  it("suljetun vuoden ohitusta ei voi lisätä", async () => {
    await expect(asStaff((tx) => setExpectedSkip(tx, actor(), a.client, 2023, "0a1b2c3d", true))).rejects.toThrow(/Verovuosi 2023 on suljettu/);
  });

  it("toisen organisaation asiakkaalle ei voi lisätä ohitusta eikä nähdä sitä", async () => {
    await expect(
      asStaff((tx) =>
        tx.query("insert into sk_expected_skips (organization_id, client_id, tax_year, expected_key) values ($1, $2, 2026, '0a1b2c3d')", [a.id, b.client]),
      ),
    ).rejects.toThrow(/toisen organisaation|row-level security/);
    await db.asService((tx) =>
      tx.query("insert into sk_expected_skips (organization_id, client_id, tax_year, expected_key) values ($1, $2, 2026, '0a1b2c3d')", [b.id, b.client]),
    );
    const seen = await asStaff((tx) => tx.query("select 1 from sk_expected_skips where client_id = $1", [b.client]));
    expect(seen).toHaveLength(0);
  });

  it("tunniste on tiiviste, ei selitettä", async () => {
    await expect(
      asStaff((tx) =>
        tx.query("insert into sk_expected_skips (organization_id, client_id, tax_year, expected_key) values ($1, $2, 2026, 'Metsänhoitomaksu')", [a.id, a.client]),
      ),
    ).rejects.toThrow(/check/);
  });

  it("lisäys kirjaukseksi menee normaalin kirjauspolun kautta ja merkitsee kirjatuksi", async () => {
    const before = await asStaff((tx) => loadExpected(tx, client(), 2026, null, "2026-10-05"));
    const e = before.states[0];
    const id = await asStaff((tx) =>
      saveTransaction(
        tx,
        actor(),
        a.client,
        null,
        {
          bookedOn: e.next!.date, category: e.category, kind: null, description: e.description, amountGross: e.estimate, vatRate: e.vatRate, withholding: 0,
          businessSharePct: e.businessSharePct, otherSharePct: e.otherSharePct, forestPropertyId: e.forestPropertyId, assetRatePct: null, saleAssetId: null,
        },
        { expectedKey: e.key },
      ),
    );
    const after = await asStaff((tx) => loadExpected(tx, client(), 2026, null, "2026-10-05"));
    expect(after.states[0].booked).toBe(1);
    expect(after.states[0].states[0].transactionId).toBe(id);
    const [log] = await db.asUser(a.owner.sub, (tx) =>
      tx.query<{ details: { expectedKey: string } }>("select details from sk_audit_log where entity_id = $1 and action = 'transaction.create'", [id]),
    );
    expect(log.details.expectedKey).toBe(e.key);
  });

  it("maatalouden näkymä ei näe metsätalouden odotettuja", async () => {
    const v = await asStaff((tx) => loadExpected(tx, client(), 2026, "agriculture", "2026-10-05"));
    expect(v.states).toHaveLength(0);
  });
});
