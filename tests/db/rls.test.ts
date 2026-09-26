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

const TABLES = ["sk_organizations", "sk_org_members", "sk_audit_log"];

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

  it("roolia reader ei ole", async () => {
    await expect(
      db.asService((tx) => tx.query("update sk_org_members set role = 'reader' where user_id = $1", [a.staff.id])),
    ).rejects.toThrow(/sk_org_members_role_check/);
  });
});
