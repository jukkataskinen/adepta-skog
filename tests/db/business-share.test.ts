import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { GridSaveError, saveLedgerGrid } from "@/lib/ledger/grid-save";
import { emptyGridRow, rowFromStored, type GridRow } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
import { SMALL_ASSET_MESSAGE } from "@/lib/ledger/transaction-input";
import { loadPlanData } from "@/lib/tax/load";
import { loadReportData } from "@/lib/reports/data";
import { loadFilingSource } from "@/lib/filing/load";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

// Metsätalouden osuus kirjauksesta (0013): tallennus, laskenta ja suljetun vuoden lukitus.

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

async function save(rows: GridRow[], deletedIds: string[] = []): Promise<Outcome> {
  try {
    const r = await db.asUser(a.staff.sub, (tx) =>
      saveLedgerGrid(tx, { actor: { organizationId: a.id, userId: a.staff.id }, clientId: a.client, year: 2025, rows, deletedIds }),
    );
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof GridSaveError) return { ok: false, message: err.message, rowErrors: err.rowErrors };
    throw err;
  }
}

const load = async () => (await db.asUser(a.staff.sub, (tx) => listTransactions(tx, a.client, 2025))).map(rowFromStored);
const q = <T,>(text: string, params: unknown[] = []) => db.asService((tx) => tx.query<T>(text, params));
const newRow = (key: string, over: Partial<GridRow>): GridRow => ({ ...emptyGridRow(key, "1.5.2025"), ...over });
const ROAD = "Tiemaksu, Metsäyhtymä Heralahti";

async function roadRow() {
  const [t] = await q<{ id: string; business_share_pct: string; amount_net: string; amount_gross: string }>(
    "select id, business_share_pct, amount_net, amount_gross from sk_transactions where description = $1",
    [ROAD],
  );
  return t;
}

describe("migraatio 0013", () => {
  it("ei kaadu suljetun vuoden kirjauksiin, ja vanhat rivit saavat 100 % muuttumatta", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, undefined, "0012_receipt_recognition_chunks.sql");
      const o = await seedOrg(old, "Vanha toimisto");
      await old.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [o.client]));
      const before = await old.asService((tx) => tx.query<{ updated_at: string }>("select updated_at::text from sk_transactions where id = $1", [o.transaction]));
      expect(await migrateLocal(old)).toEqual(["0013_business_share.sql"]);
      const [t] = await old.asService((tx) =>
        tx.query<{ business_share_pct: string; amount_net: string; updated_at: string }>(
          "select business_share_pct, amount_net, updated_at::text from sk_transactions where id = $1",
          [o.transaction],
        ),
      );
      expect(t).toEqual({ business_share_pct: "100.00", amount_net: "15000.00", updated_at: before[0].updated_at });
    } finally {
      await old.close();
    }
  });
});

describe("metsätalouden osuus kannassa", () => {
  it("olemassa oleva kirjaus on 100 %", async () => {
    const [t] = await q<{ business_share_pct: string }>("select business_share_pct from sk_transactions where id = $1", [a.transaction]);
    expect(t.business_share_pct).toBe("100.00");
  });

  it("kanta hylkää nollan ja yli sadan", async () => {
    for (const pct of [0, 100.01]) {
      await expect(q("update sk_transactions set business_share_pct = $2 where id = $1", [a.transaction, pct])).rejects.toThrow();
    }
  });

  it("taulukon osuus tallentuu, summat ovat koko tositteen ja osuuden muutos päivittää rivin", async () => {
    const res = await save([...(await load()), newRow("r", { description: ROAD, category: "other_expense", amountGross: "251,00", vatRate: "25,5", businessSharePct: "50" })]);
    expect(res).toMatchObject({ ok: true, created: 1 });
    expect(await roadRow()).toMatchObject({ business_share_pct: "50.00", amount_net: "200.00", amount_gross: "251.00" });

    const rows = await load();
    expect(rows.find((r) => r.description === ROAD)?.businessSharePct).toBe("50");
    // Tallennettu 100 % näkyy tyhjänä.
    expect(rows.find((r) => r.id === a.transaction)?.businessSharePct).toBe("");

    const changed = rows.map((r) => (r.description === ROAD ? { ...r, businessSharePct: "33,33" } : r));
    expect(await save(changed)).toMatchObject({ ok: true, updated: 1, created: 0 });
    expect((await roadRow()).business_share_pct).toBe("33.33");
    // Tyhjä osuus palauttaa 100 %:n.
    expect(await save((await load()).map((r) => (r.description === ROAD ? { ...r, businessSharePct: "" } : r)))).toMatchObject({ ok: true, updated: 1 });
    expect((await roadRow()).business_share_pct).toBe("100.00");
    await save((await load()).map((r) => (r.description === ROAD ? { ...r, businessSharePct: "50" } : r)));
  });

  it("kelvoton osuus palautetaan rivin virheenä, eikä mitään tallenneta", async () => {
    for (const v of ["0", "101", "33,333", "puolet"]) {
      const res = await save([...(await load()), newRow("bad", { description: "Virhe", category: "travel", amountGross: "10", businessSharePct: v })]);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.rowErrors.bad?.businessSharePct).toMatch(/osuus/);
    }
  });
});

describe("osuus verolaskennassa", () => {
  it("verosuunnitelman menoihin vain metsätalouden osuus", async () => {
    const plan = await db.asUser(a.staff.sub, (tx) => loadPlanData(tx, a.client, 2025));
    expect(plan.expense).toBe(100);
    expect(plan.income).toBe(15000);
  });

  it("veroraportti: luokkasummassa osuus, kirjausluettelossa koko summa ja osuus, ostojen verosta vain osuus", async () => {
    const r = (await db.asUser(a.staff.sub, (tx) => loadReportData(tx, a.id, a.client, 2025)))!;
    expect(r.categories.find((c) => c.label === "Muut vuosimenot")).toEqual({ label: "Muut vuosimenot", kind: "expense", net: 100, vat: 25.5, gross: 125.5 });
    expect(r.transactions.find((t) => t.description === ROAD)).toMatchObject({ net: 200, gross: 251, sharePct: 50, shareNet: 100 });
    expect(r.vat.year).toMatchObject({ output: 3825, input: 25.5, nonDeductible: 25.5, payable: 3799.5 });
  });

  it("2C:hen metsätalouden osuus", async () => {
    const src = (await db.asUser(a.staff.sub, (tx) => loadFilingSource(tx, a.id, a.client, 2025)))!;
    expect(src.data.categories.other_expense).toEqual({ net: 100, gross: 125.5 });
    expect(src.data.categories.standing_sale).toEqual({ net: 15000, gross: 18825 });
  });
});

describe("investointi osuudella", () => {
  it("hankintameno on metsätalouden osuus, ja 600 euron raja koskee osuutta", async () => {
    const small = await save([...(await load()), newRow("s", { description: "Mönkijä", category: "asset_purchase", amountGross: "1 255,00", businessSharePct: "50", assetRatePct: "25" })]);
    expect(!small.ok && small.rowErrors.s?.category).toBe(SMALL_ASSET_MESSAGE);

    const res = await save([...(await load()), newRow("i", { description: "Metsäauto", category: "asset_purchase", amountGross: "25 100,00", businessSharePct: "40", assetRatePct: "25" })]);
    expect(res).toMatchObject({ ok: true, created: 1 });
    const [asset] = await q<{ acquisition_cost: string }>("select acquisition_cost from sk_assets where description = 'Metsäauto'");
    expect(asset.acquisition_cost).toBe("8000.00");

    // Osuuden muutos päivittää hankintamenon.
    await save((await load()).map((r) => (r.description === "Metsäauto" ? { ...r, businessSharePct: "50" } : r)));
    const [after] = await q<{ acquisition_cost: string }>("select acquisition_cost from sk_assets where description = 'Metsäauto'");
    expect(after.acquisition_cost).toBe("10000.00");
  });

  it("myyntihinta on metsätalouden osuus", async () => {
    const [asset] = await q<{ id: string }>("select id from sk_assets where description = 'Metsäauto'");
    const res = await save([
      ...(await load()),
      newRow("m", { bookedOn: "1.10.2025", description: "Metsäauton myynti", category: "asset_sale", amountGross: "12 550,00", businessSharePct: "50", saleAssetId: asset.id }),
    ]);
    expect(res).toMatchObject({ ok: true, created: 1 });
    const [sold] = await q<{ sale_price: string; disposed_on: string }>("select sale_price, disposed_on::text from sk_assets where id = $1", [asset.id]);
    expect(sold).toEqual({ sale_price: "5000.00", disposed_on: "2025-10-01" });
  });
});

describe("suljettu vuosi", () => {
  it("osuutta ei voi muuttaa suljetulle vuodelle", async () => {
    await q("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]);
    const t = await roadRow();
    await expect(q("update sk_transactions set business_share_pct = 25 where id = $1", [t.id])).rejects.toThrow(/suljettu/);
    const res = await save((await load()).map((r) => (r.description === ROAD ? { ...r, businessSharePct: "25" } : r)));
    expect(!res.ok && res.message).toBe("Verovuosi 2025 on suljettu. Pääkäyttäjä voi avata vuoden.");
    expect((await roadRow()).business_share_pct).toBe("50.00");
    await q("update sk_tax_years set status = 'open', closed_at = null where client_id = $1 and year = 2025", [a.client]);
  });
});
