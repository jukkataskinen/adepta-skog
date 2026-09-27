import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { GridSaveError, saveLedgerGrid } from "@/lib/ledger/grid-save";
import { emptyGridRow, rowFromStored, type GridRow } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
import { freshDb, seedOrg, type OrgFixture, type TestUser } from "../helpers/db";

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
});
afterAll(async () => {
  await db.close();
});

type Outcome = { ok: true; created: number; updated: number; deleted: number } | { ok: false; message: string; rowErrors: Record<string, Record<string, string>> };

async function save(rows: GridRow[], deletedIds: string[] = [], opts: { user?: TestUser; clientId?: string; year?: number } = {}): Promise<Outcome> {
  const user = opts.user ?? a.staff;
  try {
    const r = await db.asUser(user.sub, (tx) =>
      saveLedgerGrid(tx, { actor: { organizationId: a.id, userId: user.id }, clientId: opts.clientId ?? a.client, year: opts.year ?? 2025, rows, deletedIds }),
    );
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof GridSaveError) return { ok: false, message: err.message, rowErrors: err.rowErrors };
    throw err;
  }
}

async function load(clientId = a.client, user: TestUser = a.staff): Promise<GridRow[]> {
  return (await db.asUser(user.sub, (tx) => listTransactions(tx, clientId, 2025))).map(rowFromStored);
}

const q = <T,>(text: string, params: unknown[] = []) => db.asService((tx) => tx.query<T>(text, params));
const newRow = (key: string, over: Partial<GridRow>): GridRow => ({ ...emptyGridRow(key, "1.3.2025"), ...over });

describe("bruttosumma kannassa (0009)", () => {
  it("vanha rivi sai brutton verottomasta, veroton säilyi", async () => {
    const [t] = await q<{ amount_net: string; amount_gross: string }>("select amount_net, amount_gross from sk_transactions where id = $1", [a.transaction]);
    expect(t).toEqual({ amount_net: "15000.00", amount_gross: "18825.00" });
  });

  it("veroton lasketaan bruttosta triggerillä, ja pelkän verottoman muutos laskee brutton", async () => {
    const [t] = await q<{ id: string; amount_net: string }>(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_gross, vat_rate)
       values ($1, $2, '2025-02-01', 'expense', 'other_expense', 41.83, 25.5) returning id, amount_net`,
      [a.id, a.client],
    );
    expect(t.amount_net).toBe("33.33");
    const [u] = await q<{ amount_gross: string }>("update sk_transactions set amount_net = 100 where id = $1 returning amount_gross", [t.id]);
    expect(u.amount_gross).toBe("125.50");
    // Verokannan muutos pitää kuitin summan ja laskee verottoman uudelleen.
    const [v] = await q<{ amount_net: string; amount_gross: string }>("update sk_transactions set vat_rate = 0 where id = $1 returning amount_net, amount_gross", [t.id]);
    expect(v).toEqual({ amount_net: "125.50", amount_gross: "125.50" });
    await q("delete from sk_transactions where id = $1", [t.id]);
  });
});

describe("taulukon tallennus", () => {
  it("muuttunut rivi päivitetään paikallaan: tunniste ja tosite säilyvät, loki kirjataan", async () => {
    const rows = await load();
    const target = rows.find((r) => r.id === a.transaction)!;
    const res = await save(rows.map((r) => (r.id === a.transaction ? { ...r, description: "Leimikko 7", amountGross: "20 080,00" } : r)));
    expect(res).toEqual({ ok: true, created: 0, updated: 1, deleted: 0 });
    const [t] = await q<{ id: string; description: string; amount_net: string; amount_gross: string }>(
      "select id, description, amount_net, amount_gross from sk_transactions where id = $1",
      [target.id],
    );
    expect(t).toEqual({ id: a.transaction, description: "Leimikko 7", amount_net: "16000.00", amount_gross: "20080.00" });
    const [doc] = await q<{ transaction_id: string }>("select transaction_id from sk_documents where transaction_id = $1", [a.transaction]);
    expect(doc?.transaction_id).toBe(a.transaction);
    const [log] = await q<{ n: number }>(
      "select count(*)::int as n from sk_audit_log where action = 'transaction.update' and entity_id = $1 and details->>'source' = 'table'",
      [a.transaction],
    );
    expect(log.n).toBe(1);
  });

  it("muuttumattomia rivejä ei kirjoiteta", async () => {
    const before = await q<{ n: number }>("select count(*)::int as n from sk_audit_log");
    const res = await save(await load());
    expect(res).toEqual({ ok: true, created: 0, updated: 0, deleted: 0 });
    const after = await q<{ n: number }>("select count(*)::int as n from sk_audit_log");
    expect(after[0].n).toBe(before[0].n);
  });

  it("uusi hankinta luo investoinnin verottomalla summalla, ja muutos päivittää saman investoinnin", async () => {
    const rows = await load();
    const res = await save([...rows, newRow("h1", { description: "Mönkijä", category: "asset_purchase", amountGross: "12 550,00", vatRate: "25,5", assetRatePct: "25" })]);
    expect(res).toMatchObject({ ok: true, created: 1 });
    const [t] = await q<{ id: string; asset_id: string; kind: string }>("select id, asset_id, kind from sk_transactions where description = 'Mönkijä'");
    expect(t.kind).toBe("investment");
    const [asset] = await q<{ acquisition_cost: string; declining_rate_pct: string }>("select acquisition_cost, declining_rate_pct from sk_assets where id = $1", [t.asset_id]);
    expect(asset).toMatchObject({ acquisition_cost: "10000.00" });
    expect(Number(asset.declining_rate_pct)).toBe(25);

    const again = await load();
    const res2 = await save(again.map((r) => (r.id === t.id ? { ...r, amountGross: "15 060,00" } : r)));
    expect(res2).toMatchObject({ ok: true, updated: 1 });
    const [t2] = await q<{ asset_id: string }>("select asset_id from sk_transactions where id = $1", [t.id]);
    expect(t2.asset_id).toBe(t.asset_id);
    const [asset2] = await q<{ acquisition_cost: string }>("select acquisition_cost from sk_assets where id = $1", [t.asset_id]);
    expect(asset2.acquisition_cost).toBe("12000.00");
  });

  it("myynti merkitsee investoinnin myydyksi ja poisto palauttaa sen", async () => {
    const [p] = await q<{ asset_id: string }>("select asset_id from sk_transactions where description = 'Mönkijä'");
    const res = await save([...(await load()), newRow("m1", { description: "Mönkijä myyty", category: "asset_sale", amountGross: "2 510,00", saleAssetId: p.asset_id })]);
    expect(res).toMatchObject({ ok: true, created: 1 });
    const [a1] = await q<{ disposed_on: string | null; sale_price: string | null }>("select disposed_on::text, sale_price from sk_assets where id = $1", [p.asset_id]);
    expect(a1).toEqual({ disposed_on: "2025-03-01", sale_price: "2000.00" });

    const rows = await load();
    const sale = rows.find((r) => r.description === "Mönkijä myyty")!;
    const del = await save(rows.filter((r) => r.id !== sale.id), [sale.id!]);
    expect(del).toMatchObject({ ok: true, deleted: 1 });
    const [a2] = await q<{ disposed_on: string | null }>("select disposed_on from sk_assets where id = $1", [p.asset_id]);
    expect(a2.disposed_on).toBeNull();
  });

  it("hankinnan poisto poistaa investoinnin, jolla ei ole poistoja", async () => {
    const rows = await load();
    const purchase = rows.find((r) => r.description === "Mönkijä")!;
    const res = await save(rows.filter((r) => r.id !== purchase.id), [purchase.id!]);
    expect(res).toMatchObject({ ok: true, deleted: 1 });
    const left = await q("select 1 from sk_assets where id = $1", [purchase.assetId]);
    expect(left).toHaveLength(0);
  });

  it("investoinnista tehdyt poistot estävät hankinnan poiston, eikä mitään tallenneta", async () => {
    const [t] = await q<{ id: string }>(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, asset_id)
       values ($1, $2, '2025-01-15', 'investment', 'asset_purchase', 'Traktorin hankinta', 30000, 25.5, $3) returning id`,
      [a.id, a.client, a.asset],
    );
    const rows = await load();
    const changed = rows.filter((r) => r.id !== t.id).map((r) => (r.id === a.transaction ? { ...r, description: "Ei saa tallentua" } : r));
    const res = await save(changed, [t.id]);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.message).toMatch(/poistoja/);
    const [still] = await q<{ n: number }>("select count(*)::int as n from sk_transactions where id = $1", [t.id]);
    expect(still.n).toBe(1);
    const [d] = await q<{ description: string }>("select description from sk_transactions where id = $1", [a.transaction]);
    expect(d.description).toBe("Leimikko 7");
  });

  it("yksikin virheellinen rivi estää kaiken ja virhe palautetaan rivin avaimella", async () => {
    const rows = await load();
    const res = await save([
      ...rows.map((r) => (r.id === a.transaction ? { ...r, description: "Ei tallennu" } : r)),
      newRow("ok", { category: "travel", amountGross: "10" }),
      newRow("bad", { category: "asset_purchase", amountGross: "5000" }),
    ]);
    expect(res.ok).toBe(false);
    expect(!res.ok && Object.keys(res.rowErrors)).toEqual(["bad"]);
    const [d] = await q<{ description: string }>("select description from sk_transactions where id = $1", [a.transaction]);
    expect(d.description).toBe("Leimikko 7");
    const [n] = await q<{ n: number }>("select count(*)::int as n from sk_transactions where category = 'travel'");
    expect(n.n).toBe(0);
  });

  it("toisaalla poistettu rivi huomataan", async () => {
    const res = await save([{ ...newRow("x", { category: "travel", amountGross: "10" }), id: "99999999-9999-4999-8999-999999999999", key: "x" }]);
    expect(!res.ok && res.message).toMatch(/muutettu toisaalla/);
  });

  it("suljettu tai avaamaton vuosi estää", async () => {
    const r1 = await save([newRow("x", { bookedOn: "1.3.2024", category: "travel", amountGross: "10" })], [], { year: 2024 });
    expect(!r1.ok && r1.message).toBe("Verovuotta 2024 ei ole avattu. Avaa vuosi asiakkaan sivulla.");
    await q("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]);
    const r2 = await save([newRow("x", { category: "travel", amountGross: "10" })]);
    expect(!r2.ok && r2.message).toBe("Verovuosi 2025 on suljettu. Pääkäyttäjä voi avata vuoden.");
    await q("update sk_tax_years set status = 'open', closed_at = null where client_id = $1 and year = 2025", [a.client]);
  });

  it("arvonlisäverorekisteriin kuulumattoman asiakkaan oletuskanta on 0 %", async () => {
    await q("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2025)", [a.id, a.otherClient]);
    const res = await save([newRow("x", { category: "other_expense", amountGross: "125,50" })], [], { user: a.owner, clientId: a.otherClient });
    expect(res).toMatchObject({ ok: true, created: 1 });
    const [t] = await q<{ vat_rate: string; amount_net: string }>("select vat_rate, amount_net from sk_transactions where client_id = $1", [a.otherClient]);
    expect(t).toEqual({ vat_rate: "0.00", amount_net: "125.50" });
  });

  it("kirjanpitäjä ei voi tallentaa asiakkaalle, joka ei ole hänen", async () => {
    const res = await save([newRow("x", { category: "travel", amountGross: "10" })], [], { clientId: a.otherClient });
    expect(res.ok).toBe(false);
  });
});
