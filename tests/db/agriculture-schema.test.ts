import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Maatalouden tietomalli (migraatio 0015, DECISIONS 2.10.2026). */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
});
afterAll(async () => {
  await db.close();
});

const insertTx = (category: string, extra = "", values: unknown[] = []) =>
  db.asUser(a.staff.sub, (tx) =>
    tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_gross, vat_rate${extra ? `, ${extra.split("=")[0]}` : ""})
       values ($1, $2, '2025-05-05', 'expense', $3, 100, 0${extra ? ", $4" : ""}) returning id`,
      [a.id, a.client, category, ...values],
    ),
  );

describe("migraatio 0015", () => {
  it("ei kaadu suljettuun vuoteen, ja vanhat rivit ovat metsätaloutta", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, undefined, "0014_prior_assets.sql");
      const o = await seedOrg(old, "Vanha toimisto");
      await old.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [o.client]));
      expect(await migrateLocal(old, undefined, "0015_agriculture.sql")).toEqual(["0015_agriculture.sql"]);
      const [t] = await old.asService((tx) =>
        tx.query<{ activity: string; other_share_pct: string; business_share_pct: string }>(
          "select activity, other_share_pct, business_share_pct from sk_transactions where id = $1",
          [o.transaction],
        ),
      );
      expect(t).toEqual({ activity: "forestry", other_share_pct: "0.00", business_share_pct: "100.00" });
      const [asset] = await old.asService((tx) => tx.query<{ activity: string; asset_class: string | null }>("select activity, asset_class from sk_assets where id = $1", [o.asset]));
      expect(asset).toEqual({ activity: "forestry", asset_class: null });
      const [c] = await old.asService((tx) => tx.query<{ has_forestry: boolean; has_agriculture: boolean }>("select has_forestry, has_agriculture from sk_clients where id = $1", [o.client]));
      expect(c).toEqual({ has_forestry: true, has_agriculture: false });
    } finally {
      await old.close();
    }
  });
});

describe("kirjauksen toiminto ja osuudet", () => {
  it("maatalouden luokka vaatii toiminnon agriculture ja päinvastoin", async () => {
    await expect(insertTx("agri_fertilizers")).rejects.toThrow(/sk_transactions_activity_category/);
    await expect(insertTx("other_expense", "activity=", ["agriculture"])).rejects.toThrow(/sk_transactions_activity_category/);
    const rows = await insertTx("agri_fertilizers", "activity=", ["agriculture"]);
    expect(rows).toHaveLength(1);
  });

  it("oma ja toisen toiminnon osuus ovat yhteensä enintään 100 %", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        tx.query(
          `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_gross, business_share_pct, other_share_pct)
           values ($1, $2, '2025-05-05', 'expense', 'other_expense', 100, 60, 50)`,
          [a.id, a.client],
        ),
      ),
    ).rejects.toThrow(/sk_transactions_shares/);
    const ok = await db.asUser(a.staff.sub, (tx) =>
      tx.query(
        `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_gross, business_share_pct, other_share_pct)
         values ($1, $2, '2025-05-05', 'expense', 'other_expense', 100, 40, 40) returning id`,
        [a.id, a.client],
      ),
    );
    expect(ok).toHaveLength(1);
  });

  it("toisen toiminnon osuus on vain menoilla", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        tx.query(
          `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_gross, business_share_pct, other_share_pct)
           values ($1, $2, '2025-05-05', 'income', 'standing_sale', 100, 50, 50)`,
          [a.id, a.client],
        ),
      ),
    ).rejects.toThrow(/sk_transactions_other_share_expense/);
  });
});

describe("maatalouden investoinnit", () => {
  it("maatalouden investoinnilla on ryhmä, metsätalouden investoinnilla ei", async () => {
    const insert = (activity: string, cls: string | null, accelerated = false) =>
      db.asUser(a.staff.sub, (tx) =>
        tx.query(
          `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, activity, asset_class, accelerated)
           values ($1, $2, 'Kone', '2025-03-01', 10000, 'declining_balance', 25, $3, $4, $5) returning id`,
          [a.id, a.client, activity, cls, accelerated],
        ),
      );
    await expect(insert("agriculture", null)).rejects.toThrow(/sk_assets_activity_class/);
    await expect(insert("forestry", "agri_machinery")).rejects.toThrow(/sk_assets_activity_class/);
    await expect(insert("agriculture", "agri_drainage", true)).rejects.toThrow(/sk_assets_accelerated/);
    expect(await insert("agriculture", "agri_machinery", true)).toHaveLength(1);
  });
});

describe("varaukset ja lukitus", () => {
  it("varauksesta ei voi käyttää enempää kuin se on", async () => {
    const [reserve] = await db.asUser(a.staff.sub, (tx) =>
      tx.query<{ id: string }>(
        "insert into sk_agri_reserves (organization_id, client_id, kind, made_year, amount) values ($1, $2, 'equalization', 2024, 2000) returning id",
        [a.id, a.client],
      ),
    );
    const use = (amount: number, year = 2025) =>
      db.asUser(a.staff.sub, (tx) =>
        tx.query(
          "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1, $2, $3, $4, 'income', $5)",
          [a.id, a.client, reserve.id, year, amount],
        ),
      );
    await use(1500);
    await expect(use(600)).rejects.toThrow(/enemmän kuin se on/);
    await expect(use(100, 2023)).rejects.toThrow(/ennen sen tekovuotta/);
  });

  it("suljetun vuoden maatalouden tietoja ei voi muuttaa", async () => {
    await db.asUser(a.staff.sub, (tx) =>
      tx.query("insert into sk_agri_years (organization_id, client_id, tax_year, land_value) values ($1, $2, 2025, 1000)", [a.id, a.client]),
    );
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]));
    try {
      await expect(db.asUser(a.owner.sub, (tx) => tx.query("update sk_agri_years set land_value = 2 where client_id = $1", [a.client]))).rejects.toThrow(/suljettu/);
      await expect(
        db.asUser(a.owner.sub, (tx) =>
          tx.query("insert into sk_agri_depreciations (organization_id, client_id, tax_year, pool, amount) values ($1, $2, 2025, 'agri_machinery', 1)", [a.id, a.client]),
        ),
      ).rejects.toThrow(/suljettu/);
      await expect(
        db.asUser(a.owner.sub, (tx) =>
          tx.query("insert into sk_agri_reserves (organization_id, client_id, kind, made_year, amount) values ($1, $2, 'equalization', 2025, 1)", [a.id, a.client]),
        ),
      ).rejects.toThrow(/suljettu/);
    } finally {
      await db.asService((tx) => tx.query("update sk_tax_years set status = 'open', closed_at = null where client_id = $1 and year = 2025", [a.client]));
    }
  });

  it("varaus ei voi viitata toisen asiakkaan maatilaan", async () => {
    const [farm] = await db.asService((tx) =>
      tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name) values ($1, $2, 'Toisen tila') returning id", [a.id, a.otherClient]),
    );
    await expect(
      db.asUser(a.owner.sub, (tx) =>
        tx.query("insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount) values ($1, $2, $3, 'equalization', 2025, 1)", [
          a.id, a.client, farm.id,
        ]),
      ),
    ).rejects.toThrow(/toisen asiakkaan/);
  });
});
