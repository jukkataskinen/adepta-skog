import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Organisaatioiden eristys: kirjanpitotoimisto näkee vain omat tietonsa.
 * Tämä on koko sovelluksen tärkein testi. Vanhassa Skogissa rajaus oli
 * jokaisen reitin varassa ja unohtui (DECISIONS 26.9.2026). Jokainen uusi
 * taulu lisätään tähän listaan.
 */

const TABLES = [
  "sk_organizations",
  "sk_org_members",
  "sk_audit_log",
  "sk_clients",
  "sk_forest_properties",
  "sk_tax_years",
  "sk_assets",
  "sk_depreciations",
  "sk_forest_deductions",
  "sk_transactions",
  "sk_documents",
];

/** Kirjanpitäjälle näkyvät taulut: vastuuasiakkaan rivit (loki on vain pääkäyttäjälle). */
const STAFF_TABLES = TABLES.filter((t) => t !== "sk_audit_log");

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
  for (const org of [a, b]) {
    await db.asUser(org.owner.sub, (tx) =>
      audit(tx, { organizationId: org.id, userId: org.owner.id, action: "test.seed", entity: "sk_organizations", entityId: org.id }),
    );
  }
});

afterAll(async () => {
  await db.close();
});

describe("organisaatioiden eristys", () => {
  for (const table of TABLES) {
    it(`${table}: pääkäyttäjä näkee vain oman organisaationsa rivit`, async () => {
      const col = table === "sk_organizations" ? "id" : "organization_id";
      const rows = await db.asUser(a.owner.sub, (tx) => tx.query<{ org: string }>(`select ${col} as org from ${table}`));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.org === a.id)).toBe(true);
    });
  }

  for (const table of STAFF_TABLES) {
    it(`${table}: kirjanpitäjä näkee vain oman organisaationsa rivit`, async () => {
      const col = table === "sk_organizations" ? "id" : "organization_id";
      const rows = await db.asUser(a.staff.sub, (tx) => tx.query<{ org: string }>(`select ${col} as org from ${table}`));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.org === a.id)).toBe(true);
    });
  }

  it("toisen organisaation asiakkaan alle ei voi lisätä rivejä", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) =>
        tx.query(
          "insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net) values ($1, $2, '2026-01-10', 'expense', 'other_expense', 10)",
          [a.id, b.client],
        ),
      ),
    ).rejects.toThrow(/toisen organisaation|row-level security/);
  });

  it("poistoa ei voi kirjata toisen organisaation investoinnille", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) =>
        tx.query("insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1, $2, 2026, 1, 1)", [a.id, b.asset]),
      ),
    ).rejects.toThrow(/toisen organisaation|row-level security/);
  });

  it("käyttäjä näkee vain oman organisaationsa käyttäjät", async () => {
    const rows = await db.asUser(a.staff.sub, (tx) => tx.query<{ id: string }>("select id from sk_users"));
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([a.owner.id, a.staff.id].sort());
  });

  it("toisen organisaation tietoja ei voi muuttaa", async () => {
    const updated = await db.asUser(a.owner.sub, (tx) => tx.query("update sk_organizations set name = 'Muutettu' where id = $1 returning id", [b.id]));
    expect(updated).toHaveLength(0);
  });

  it("toiseen organisaatioon ei voi lisätä jäsentä", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1, $2, 'owner')", [b.id, a.staff.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("lokiin ei voi kirjoittaa toisen organisaation nimissä", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => audit(tx, { organizationId: b.id, userId: a.owner.id, action: "x", entity: "sk_organizations" })),
    ).rejects.toThrow(/row-level security/);
  });

  it("kirjautumaton rooli ei näe mitään", async () => {
    const rows = await db.asUser("tuntematon|0", (tx) => tx.query("select id from sk_organizations"));
    expect(rows).toHaveLength(0);
  });
});

describe("roolit", () => {
  it("vain pääkäyttäjä voi muuttaa organisaation tietoja", async () => {
    const byStaff = await db.asUser(a.staff.sub, (tx) => tx.query("update sk_organizations set contact_email = 'x@example.test' where id = $1 returning id", [a.id]));
    expect(byStaff).toHaveLength(0);
    const byOwner = await db.asUser(a.owner.sub, (tx) => tx.query("update sk_organizations set contact_email = 'x@example.test' where id = $1 returning id", [a.id]));
    expect(byOwner).toHaveLength(1);
  });

  it("kirjanpitäjä ei näe lokia", async () => {
    const rows = await db.asUser(a.staff.sub, (tx) => tx.query("select id from sk_audit_log"));
    expect(rows).toHaveLength(0);
  });

  it("kirjanpitäjä ei voi lisätä jäseniä", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1, $2, 'owner')", [a.id, b.owner.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("kirjanpitäjä näkee vain asiakkaat, joiden vastuukirjanpitäjä hän on", async () => {
    const rows = await db.asUser(a.staff.sub, (tx) => tx.query<{ id: string }>("select id from sk_clients"));
    expect(rows.map((r) => r.id)).toEqual([a.client]);
    const all = await db.asUser(a.owner.sub, (tx) => tx.query<{ id: string }>("select id from sk_clients"));
    expect(all.map((r) => r.id).sort()).toEqual([a.client, a.otherClient].sort());
  });

  it("kirjanpitäjä ei voi kirjata toisen kirjanpitäjän asiakkaalle", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        tx.query(
          "insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net) values ($1, $2, '2026-01-10', 'expense', 'other_expense', 10)",
          [a.id, a.otherClient],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("kirjanpitäjä voi luoda asiakkaan vain itselleen", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => tx.query("insert into sk_clients (organization_id, first_name, last_name) values ($1, 'X', 'Y')", [a.id])),
    ).rejects.toThrow(/row-level security/);
    const rows = await db.asUser(a.staff.sub, (tx) =>
      tx.query("insert into sk_clients (organization_id, first_name, last_name, responsible_user_id) values ($1, 'Oma', 'Asiakas', $2) returning id", [
        a.id,
        a.staff.id,
      ]),
    );
    expect(rows).toHaveLength(1);
  });

  it("kirjanpitäjä ei voi siirtää asiakasta toiselle", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => tx.query("update sk_clients set responsible_user_id = $2 where id = $1", [a.client, a.owner.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("vastuukirjanpitäjän on oltava toimiston jäsen", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => tx.query("update sk_clients set responsible_user_id = $2 where id = $1", [a.otherClient, b.staff.id])),
    ).rejects.toThrow(/ei ole toimiston jäsen/);
  });

  it("vain pääkäyttäjä voi sulkea verovuoden", async () => {
    const byStaff = await db.asUser(a.staff.sub, (tx) =>
      tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 returning id", [a.client]),
    );
    expect(byStaff).toHaveLength(0);
    await expect(
      db.asUser(a.staff.sub, (tx) =>
        tx.query("insert into sk_tax_years (organization_id, client_id, year, status, closed_at) values ($1, $2, 2024, 'closed', now())", [a.id, a.client]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("roolia reader ei ole", async () => {
    await expect(
      db.asService((tx) => tx.query("update sk_org_members set role = 'reader' where user_id = $1", [a.staff.id])),
    ).rejects.toThrow(/sk_org_members_role_check/);
  });
});

describe("suljettu verovuosi", () => {
  beforeAll(async () => {
    await db.asUser(b.owner.sub, (tx) =>
      tx.query("update sk_tax_years set status = 'closed', closed_at = now(), closed_by = $2 where client_id = $1 and year = 2025", [b.client, b.owner.id]),
    );
  });

  it("suljetun vuoden kirjausta ei voi muuttaa eikä poistaa", async () => {
    await expect(db.asUser(b.owner.sub, (tx) => tx.query("update sk_transactions set amount_net = 1 where id = $1", [b.transaction]))).rejects.toThrow(
      /Verovuosi 2025 on suljettu/,
    );
    await expect(db.asUser(b.owner.sub, (tx) => tx.query("delete from sk_transactions where id = $1", [b.transaction]))).rejects.toThrow(/suljettu/);
  });

  it("suljetulle vuodelle ei voi lisätä kirjausta eikä siirtää kirjausta sille", async () => {
    await expect(
      db.asUser(b.owner.sub, (tx) =>
        tx.query(
          "insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net) values ($1, $2, '2025-12-31', 'expense', 'other_expense', 10)",
          [b.id, b.client],
        ),
      ),
    ).rejects.toThrow(/suljettu/);
    const [open] = await db.asUser(b.owner.sub, (tx) =>
      tx.query<{ id: string }>(
        "insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net) values ($1, $2, '2026-01-02', 'expense', 'other_expense', 10) returning id",
        [b.id, b.client],
      ),
    );
    await expect(db.asUser(b.owner.sub, (tx) => tx.query("update sk_transactions set booked_on = '2025-12-30' where id = $1", [open.id]))).rejects.toThrow(
      /suljettu/,
    );
  });

  it("suljetun vuoden poistoja ja metsävähennyksiä ei voi muuttaa", async () => {
    await expect(db.asUser(b.owner.sub, (tx) => tx.query("update sk_depreciations set amount = 1 where asset_id = $1", [b.asset]))).rejects.toThrow(/suljettu/);
    await expect(
      db.asUser(b.owner.sub, (tx) => tx.query("update sk_forest_deductions set amount = 1 where forest_property_id = $1", [b.property])),
    ).rejects.toThrow(/suljettu/);
  });

  it("pääkäyttäjä voi avata vuoden, jonka jälkeen muutos onnistuu", async () => {
    await db.asUser(b.owner.sub, (tx) =>
      tx.query("update sk_tax_years set status = 'open', closed_at = null, closed_by = null where client_id = $1 and year = 2025", [b.client]),
    );
    const rows = await db.asUser(b.owner.sub, (tx) => tx.query("update sk_transactions set amount_net = 14000 where id = $1 returning id", [b.transaction]));
    expect(rows).toHaveLength(1);
  });
});

describe("saman asiakkaan tarkistus", () => {
  it("kirjaus ei voi viitata saman toimiston toisen asiakkaan investointiin", async () => {
    const [asset] = await db.asService((tx) =>
      tx.query<{ id: string }>(
        "insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, useful_life_years) values ($1, $2, 'Mönkijä', '2025-01-01', 8000, 'straight_line', 5) returning id",
        [a.id, a.otherClient],
      ),
    );
    await expect(
      db.asUser(a.owner.sub, (tx) =>
        tx.query(
          "insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net, asset_id) values ($1, $2, '2026-02-01', 'investment', 'asset_purchase', 8000, $3)",
          [a.id, a.client, asset.id],
        ),
      ),
    ).rejects.toThrow(/toisen asiakkaan/);
  });
});
