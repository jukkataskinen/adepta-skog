import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { addMember, changeMemberRole, removeMember } from "@/lib/members";
import { resolveUser } from "@/lib/auth/resolve-user";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
});
afterAll(async () => {
  await db.close();
});

describe("käyttäjien hallinta", () => {
  it("pääkäyttäjä lisää uuden käyttäjän, joka yhdistyy ensimmäisellä kirjautumisella", async () => {
    const res = await addMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, email: "Uusi.Kayttaja@Example.test", fullName: "Uusi Käyttäjä", role: "staff" });
    expect(res.created).toBe(true);
    const user = await db.asService((tx) => resolveUser(tx, { sub: "auth0|uusi", email: "uusi.kayttaja@example.test", emailVerified: true }));
    expect(user?.id).toBe(res.userId);
    const [m] = await db.asUser("auth0|uusi", (tx) => tx.query<{ role: string }>("select role from sk_org_members where organization_id = $1 and user_id = $2", [a.id, res.userId]));
    expect(m.role).toBe("staff");
  });

  it("sama henkilö voi kuulua kahteen organisaatioon", async () => {
    const res = await addMember(db, b.owner.sub, { organizationId: b.id, actorId: b.owner.id, email: "uusi.kayttaja@example.test", fullName: null, role: "staff" });
    expect(res.created).toBe(false);
  });

  it("kirjanpitäjä ei voi lisätä käyttäjiä", async () => {
    await expect(
      addMember(db, a.staff.sub, { organizationId: a.id, actorId: a.staff.id, email: "toinen@example.test", fullName: null, role: "owner" }),
    ).rejects.toThrow(/Vain pääkäyttäjä/);
    const orphan = await db.asService((tx) => tx.query("select 1 from sk_users where email = 'toinen@example.test'"));
    expect(orphan).toHaveLength(0);
  });

  it("toisen organisaation pääkäyttäjä ei voi lisätä jäseniä tähän organisaatioon", async () => {
    await expect(
      addMember(db, b.owner.sub, { organizationId: a.id, actorId: b.owner.id, email: "kolmas@example.test", fullName: null, role: "owner" }),
    ).rejects.toThrow(/Vain pääkäyttäjä/);
  });

  it("viimeistä pääkäyttäjää ei voi alentaa eikä poistaa", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.owner.id, role: "staff" })),
    ).rejects.toThrow(/vähintään yksi pääkäyttäjä/);
    await expect(
      db.asUser(a.owner.sub, (tx) => removeMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.owner.id })),
    ).rejects.toThrow(/itseäsi/);
  });

  it("kirjanpitäjä ei voi muuttaa rooleja", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.staff.id, userId: a.staff.id, role: "owner" })),
    ).rejects.toThrow(/Vain pääkäyttäjä/);
  });

  it("pääkäyttäjä muuttaa roolin ja poistaa jäsenen", async () => {
    await db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, role: "owner" }));
    await db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, role: "staff" }));
    await db.asUser(a.owner.sub, (tx) => removeMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id }));
    const rows = await db.asService((tx) => tx.query("select 1 from sk_org_members where organization_id = $1 and user_id = $2", [a.id, a.staff.id]));
    expect(rows).toHaveLength(0);
  });
});
