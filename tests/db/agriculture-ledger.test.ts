import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { saveTransaction, deleteTransaction, LedgerError } from "@/lib/ledger/write";
import { saveLedgerGrid } from "@/lib/ledger/grid-save";
import { emptyGridRow, rowFromStored } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Maatalouden kirjaukset ja investoinnit kirjanpidossa (DECISIONS 2.10.2026). */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const base = { kind: null, description: "", withholding: 0, businessSharePct: 100, forestPropertyId: null, assetRatePct: null, saleAssetId: null };

describe("maatalouden investointi kirjauksesta", () => {
  it("hankinta luo maatalouden investoinnin poistoryhmineen, ja myynti merkitsee sen myydyksi", async () => {
    const purchase = await db.asUser(a.staff.sub, (tx) =>
      saveTransaction(tx, actor(), a.client, null, {
        ...base, bookedOn: "2025-03-10", category: "agri_asset_purchase", description: "Traktori", amountGross: 62750, vatRate: 25.5, agriAssetChoice: "agri_machinery_accelerated",
      }),
    );
    const [asset] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ id: string; activity: string; asset_class: string; accelerated: boolean; acquisition_cost: string; declining_rate_pct: string }>(
        "select a.id, a.activity, a.asset_class, a.accelerated, a.acquisition_cost, a.declining_rate_pct from sk_assets a join sk_transactions t on t.asset_id = a.id where t.id = $1",
        [purchase],
      ),
    );
    expect(asset).toMatchObject({ activity: "agriculture", asset_class: "agri_machinery", accelerated: true, acquisition_cost: "50000.00", declining_rate_pct: "25.00" });

    // Metsän myynnillä ei voi myydä maatalouden investointia.
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-11-10", category: "asset_sale", amountGross: 1255, vatRate: 25.5, saleAssetId: asset.id }),
      ),
    ).rejects.toThrow(LedgerError);
    const sale = await db.asUser(a.staff.sub, (tx) =>
      saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-11-10", category: "agri_asset_sale", amountGross: 1255, vatRate: 25.5, saleAssetId: asset.id }),
    );
    const [sold] = await db.asUser(a.staff.sub, (tx) => tx.query<{ disposed_on: string; sale_price: string }>("select disposed_on::text, sale_price from sk_assets where id = $1", [asset.id]));
    expect(sold).toEqual({ disposed_on: "2025-11-10", sale_price: "1000.00" });
    await db.asUser(a.staff.sub, (tx) => deleteTransaction(tx, actor(), a.client, sale));
    await db.asUser(a.staff.sub, (tx) => deleteTransaction(tx, actor(), a.client, purchase));
    const left = await db.asUser(a.staff.sub, (tx) => tx.query("select 1 from sk_assets where id = $1", [asset.id]));
    expect(left).toHaveLength(0);
  });

  it("korotettu poisto ei ole valittavissa vuonna 2026", async () => {
    await db.asService((tx) => tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2026)", [a.id, a.client]));
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        saveTransaction(tx, actor(), a.client, null, {
          ...base, bookedOn: "2026-03-10", category: "agri_asset_purchase", amountGross: 62750, vatRate: 25.5, agriAssetChoice: "agri_machinery_accelerated",
        }),
      ),
    ).rejects.toThrow(/poistoryhm|investoinnin laji/);
  });
});

describe("taulukko maatalousasiakkaalle", () => {
  it("metsäasiakkaan taulukko ei hyväksy maatalouden luokkaa, maatalousasiakkaan hyväksyy osuuksineen", async () => {
    const row = { ...emptyGridRow("n1", "30.4.2025"), category: "agri_energy", amountGross: "1 255", vatRate: "25,5", businessSharePct: "70", otherSharePct: "20" };
    const save = () => db.asUser(a.staff.sub, (tx) => saveLedgerGrid(tx, { actor: actor(), clientId: a.client, year: 2025, rows: [row], deletedIds: [] }));
    await expect(save()).rejects.toMatchObject({ rowErrors: { n1: { category: expect.stringMatching(/ei harjoita maataloutta/) } } });
    await db.asService((tx) => tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]));
    // Taulukkoon tallennetaan kaikki vuoden rivit: seedin pystykauppa säilyy ennallaan.
    const stored = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ id: string }>("select id from sk_transactions where client_id = $1 and tax_year = 2025", [a.client]),
    );
    expect(stored.length).toBeGreaterThan(0);
    const res = await db.asUser(a.staff.sub, async (tx) => {
      const existing = (await listTransactions(tx, a.client, 2025)).map(rowFromStored);
      return saveLedgerGrid(tx, { actor: actor(), clientId: a.client, year: 2025, rows: [...existing, row], deletedIds: [] });
    });
    expect(res.created).toBe(1);
    const [t] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ activity: string; business_share_pct: string; other_share_pct: string }>(
        "select activity, business_share_pct, other_share_pct from sk_transactions where category = 'agri_energy'",
      ),
    );
    expect(t).toEqual({ activity: "agriculture", business_share_pct: "70.00", other_share_pct: "20.00" });
  });
});
