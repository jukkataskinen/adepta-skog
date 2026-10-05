import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import { saveAgriPlanChoices } from "@/lib/agriculture/plan";
import { loadAgriPlanData } from "@/lib/tax/agri-form-load";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Katselmointi 2.10.2026: migraatiot 0015–0018 peräkkäin kantaan, jossa on
 * dataa ja suljettu vuosi, sekä varauksen ja sen käyttöjen eheys (0018).
 */

describe("migraatiot 0015–0018 peräkkäin", () => {
  it("ajautuvat kantaan, jossa on suljettu vuosi, odottava ehdotus ja maatalouden tietoja, eikä vanhoja rivejä kirjoiteta uudelleen", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, undefined, "0014_prior_assets.sql");
      const o = await seedOrg(old, "Vanha toimisto");
      // Odottava tunnistuksen ehdotus (0016 vaihtaa sen yksilöivän indeksin).
      await old.asService(async (tx) => {
        const [doc] = await tx.query<{ id: string }>("select id from sk_documents where client_id = $1", [o.client]);
        await tx.query(
          `insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model) values ($1,$2,$3,2025,$4::jsonb,'mock')`,
          [o.id, o.client, doc.id, JSON.stringify([{ category: "other_expense", amountGross: 10 }])],
        );
      });
      // 0015: maatalouden tiedot samalle vuodelle ennen sulkemista.
      await migrateLocal(old, undefined, "0015_agriculture.sql");
      await old.asService(async (tx) => {
        await tx.query("update sk_clients set has_agriculture = true where id = $1", [o.client]);
        await tx.query(
          `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net, vat_rate, activity)
           values ($1,$2,'2025-03-01','income','agri_crops',5000,14,'agriculture')`,
          [o.id, o.client],
        );
        const [farm] = await tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name) values ($1,$2,'Kotitila') returning id", [o.id, o.client]);
        const [res] = await tx.query<{ id: string }>(
          "insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount) values ($1,$2,$3,'equalization',2024,3000) returning id",
          [o.id, o.client, farm.id],
        );
        await tx.query(
          "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,2025,'income',1000)",
          [o.id, o.client, res.id],
        );
        await tx.query("insert into sk_agri_years (organization_id, client_id, tax_year) values ($1,$2,2025)", [o.id, o.client]);
        await tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [o.client]);
      });
      const snapshot = () =>
        old.asService(async (tx) => ({
          transactions: await tx.query("select id, updated_at::text from sk_transactions order by id"),
          suggestions: await tx.query("select id, status, lines from sk_receipt_suggestions order by id"),
          years: await tx.query("select id, updated_at::text from sk_agri_years order by id"),
          reserves: await tx.query("select id, amount from sk_agri_reserves order by id"),
        }));
      const before = await snapshot();
      expect(await migrateLocal(old)).toEqual(["0016_suggestion_activity.sql", "0017_suggestion_lines_limit.sql", "0018_agri_ledger.sql", "0019_expected_skips.sql"]);
      expect(await snapshot()).toEqual(before);
      const [s] = await old.asService((tx) => tx.query<{ activity: string }>("select activity from sk_receipt_suggestions"));
      expect(s.activity).toBe("forestry");
    } finally {
      await old.close();
    }
  });
});

describe("varauksen eheys", () => {
  let db: Database;
  let a: OrgFixture;
  let reserveA: string;
  let reserveOther: string;
  const actor = () => ({ organizationId: a.id, userId: a.staff.id });

  beforeAll(async () => {
    db = await freshDb();
    a = await seedOrg(db, "Toimisto A");
    await db.asService(async (tx) => {
      await tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]);
      await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1,$2,2026)", [a.id, a.client]);
      // Tuloa, jotta tasausvarauksen enimmäismäärä ei rajaa (40 % × 50 000 €).
      await tx.query(
        `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net, vat_rate, activity)
         values ($1,$2,'2025-03-01','income','agri_crops',50000,14,'agriculture')`,
        [a.id, a.client],
      );
      reserveA = (
        await tx.query<{ id: string }>(
          "insert into sk_agri_reserves (organization_id, client_id, kind, made_year, amount) values ($1,$2,'equalization',2025,5000) returning id",
          [a.id, a.client],
        )
      )[0].id;
      reserveOther = (
        await tx.query<{ id: string }>(
          "insert into sk_agri_reserves (organization_id, client_id, kind, made_year, amount) values ($1,$2,'equalization',2025,100) returning id",
          [a.id, a.otherClient],
        )
      )[0].id;
      // Vuoden 2026 tuloutus vuoden 2025 varauksesta.
      await tx.query(
        "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,2026,'income',3000)",
        [a.id, a.client, reserveA],
      );
    });
  });
  afterAll(async () => {
    await db.close();
  });

  it("toisen asiakkaan varausta ei voi käyttää, eikä virhe kerro sen määrästä", async () => {
    await expect(
      db.asService((tx) =>
        tx.query(
          "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,2025,'income',5000)",
          [a.id, a.client, reserveOther],
        ),
      ),
    ).rejects.toThrow(/toisen asiakkaan/);
  });

  it("varausta ei voi pienentää käyttöjä pienemmäksi kannassa eikä verosuunnitelmassa", async () => {
    await expect(db.asService((tx) => tx.query("update sk_agri_reserves set amount = 2000 where id = $1", [reserveA]))).rejects.toThrow(/enemmän kuin se on/);
    await expect(db.asService((tx) => tx.query("update sk_agri_reserves set made_year = 2027 where id = $1", [reserveA]))).rejects.toThrow(/enemmän kuin se on/);
    await db.asService((tx) => tx.query("update sk_agri_reserves set amount = 3000 where id = $1", [reserveA]));
    // Verosuunnitelma vuodelle 2025: myöhemmän vuoden käyttö (3 000 €) estää pienentämisen ja poiston.
    const d = await db.asUser(a.staff.sub, (tx) => loadAgriPlanData(tx, a.client, 2025));
    expect(d!.equalizationThisYear).toMatchObject({ id: reserveA, editable: true, usedThisYear: 0 });
    const choices = (equalization: number) => ({ depreciation: {}, equalization, releases: {}, claim: null, lossToCapital: false });
    for (const amount of [0, 1000]) {
      await expect(db.asUser(a.staff.sub, (tx) => saveAgriPlanChoices(tx, actor(), a.client, { ...d!, equalizationThisYear: { ...d!.equalizationThisYear } }, choices(amount)))).rejects.toThrow(
        /käytetty/,
      );
    }
    const [r] = await db.asService((tx) => tx.query<{ amount: string }>("select amount from sk_agri_reserves where id = $1", [reserveA]));
    expect(r.amount).toBe("3000.00");
  });
});
