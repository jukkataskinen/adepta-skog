import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { saveTransactionBatch } from "@/lib/ledger/batch";
import { emptyBatchRow, type BatchRowInput } from "@/lib/ledger/transaction-input";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
});
afterAll(async () => {
  await db.close();
});

const row = (key: string, over: Partial<BatchRowInput>): BatchRowInput => ({ ...emptyBatchRow(key), ...over });

function save(clientId: string, year: number, rows: BatchRowInput[]) {
  return db.asUser(a.staff.sub, (tx) => saveTransactionBatch(tx, { organizationId: a.id, userId: a.staff.id, clientId, year, rows }));
}

async function count(): Promise<number> {
  const [r] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_transactions where client_id = $1", [a.client]));
  return r.n;
}

describe("taulukkosyötön tallennus", () => {
  it("tallentaa kaikki rivit ja lokimerkinnän jokaisesta", async () => {
    const before = await count();
    const res = await save(a.client, 2025, [
      row("a", { bookedOn: "1.3.2025", category: "standing_sale", description: "Leimikko", amountNet: "10 000", withholding: "500", forestPropertyId: a.property }),
      row("b", { bookedOn: "2025-04-02", category: "other_expense", amountNet: "80,25", reference: "T-2" }),
      emptyBatchRow("c", "5.5.2025"),
    ]);
    expect(res).toEqual({ status: "saved", count: 2 });
    expect(await count()).toBe(before + 2);
    const rows = await db.asService((tx) =>
      tx.query(
        `select category, amount_net, vat_rate, withholding, forest_property_id, reference, tax_year
           from sk_transactions where client_id = $1 and created_by = $2 order by booked_on`,
        [a.client, a.staff.id],
      ),
    );
    expect(rows).toEqual([
      { category: "standing_sale", amount_net: "10000.00", vat_rate: "25.50", withholding: "500.00", forest_property_id: a.property, reference: null, tax_year: 2025 },
      { category: "other_expense", amount_net: "80.25", vat_rate: "25.50", withholding: "0.00", forest_property_id: null, reference: "T-2", tax_year: 2025 },
    ]);
    const [log] = await db.asService((tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from sk_audit_log where action = 'transaction.create' and details->>'source' = 'table'"),
    );
    expect(log.n).toBe(2);
  });

  it("yksikin virheellinen rivi estää koko tallennuksen", async () => {
    const before = await count();
    const res = await save(a.client, 2025, [
      row("ok", { bookedOn: "1.3.2025", category: "travel", amountNet: "10" }),
      row("bad", { bookedOn: "1.3.2025", category: "asset_purchase", amountNet: "5000" }),
    ]);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(Object.keys(res.rowErrors)).toEqual(["bad"]);
    expect(await count()).toBe(before);
  });

  it("avaamaton tai suljettu vuosi estää", async () => {
    const r1 = await save(a.client, 2024, [row("x", { bookedOn: "1.3.2024", category: "travel", amountNet: "10" })]);
    expect(r1).toMatchObject({ status: "error", message: "Verovuotta 2024 ei ole avattu. Avaa vuosi asiakkaan sivulla." });
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]));
    const before = await count();
    const r2 = await save(a.client, 2025, [row("x", { bookedOn: "1.3.2025", category: "travel", amountNet: "10" })]);
    expect(r2).toMatchObject({ status: "error", message: "Verovuosi 2025 on suljettu. Pääkäyttäjä voi avata vuoden." });
    expect(await count()).toBe(before);
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'open', closed_at = null where client_id = $1 and year = 2025", [a.client]));
  });

  it("kirjanpitäjä ei voi tallentaa asiakkaalle, joka ei ole hänen", async () => {
    await db.asService((tx) => tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2025)", [a.id, a.otherClient]));
    const res = await save(a.otherClient, 2025, [row("x", { bookedOn: "1.3.2025", category: "travel", amountNet: "10" })]);
    // RLS piilottaa vuoden, joten mitään ei tallennu.
    expect(res.status).toBe("error");
    const [r] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_transactions where client_id = $1", [a.otherClient]));
    expect(r.n).toBe(0);
  });
});
