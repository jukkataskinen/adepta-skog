import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { addMember, buildInviteEmail, changeMemberRole, deactivateMember, inviteMember, reactivateMember } from "@/lib/members";
import { resolveUser } from "@/lib/auth/resolve-user";
import { EmailError, mockEmail } from "@/lib/email";
import { mockAccounts, type AccountProvisioner } from "@/lib/accounts";
import { createUser, freshDb, seedOrg, type OrgFixture } from "../helpers/db";

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

const deps = () => ({ email: mockEmail(), accounts: mockAccounts(), appUrl: "https://skog.example.test/" });

async function isInvited(orgId: string, userId: string): Promise<boolean> {
  const [m] = await db.asService((tx) =>
    tx.query<{ invited: boolean }>("select invited_at is not null as invited from sk_org_members where organization_id = $1 and user_id = $2", [orgId, userId]),
  );
  return m.invited;
}

describe("käyttäjien lisäys ja kutsu", () => {
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

  it("samaa käyttäjää ei lisätä kahdesti", async () => {
    await expect(
      addMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, email: "uusi.kayttaja@example.test", fullName: null, role: "staff" }),
    ).rejects.toThrow(/jo tämän organisaation jäsen/);
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

  it("kutsu lähtee sähköpostiin ja kirjataan jäsenyyteen ja lokiin", async () => {
    const { userId } = await addMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, email: "kutsuttu@example.test", fullName: null, role: "staff" });
    const d = deps();
    await inviteMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, userId }, d);
    expect(d.email.sent).toHaveLength(1);
    expect(d.email.sent[0].to).toBe("kutsuttu@example.test");
    expect(d.email.sent[0].fromName).toBe("Toimisto A");
    expect(d.email.sent[0].text).toContain("https://skog.example.test/kirjaudu");
    expect(d.accounts.calls).toBe(1);
    expect(await isInvited(a.id, userId)).toBe(true);
    const log = await db.asService((tx) => tx.query("select 1 from sk_audit_log where action = 'member.invite' and entity_id = $1", [userId]));
    expect(log).toHaveLength(1);
  });

  it("uuden tunnuksen kutsussa on linkki salasanan asettamiseen", async () => {
    const { userId } = await addMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, email: "salasana@example.test", fullName: "Sala Sana", role: "staff" });
    const accounts: AccountProvisioner = { mode: "mock", ensureAccount: async () => ({ created: true, setPasswordUrl: "https://auth.example.test/ticket?x=1" }) };
    const d = { ...deps(), accounts };
    const res = await inviteMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, userId }, d);
    expect(res.accountCreated).toBe(true);
    expect(d.email.sent[0].text).toContain("https://auth.example.test/ticket?x=1");
  });

  it("epäonnistunut lähetys ei merkitse kutsua lähetetyksi", async () => {
    const { userId } = await addMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, email: "hukassa@example.test", fullName: null, role: "staff" });
    const email = {
      mode: "mock" as const,
      send: async (): Promise<{ id: string | null }> => {
        throw new EmailError("Sähköpostipalvelu hylkäsi viestin (500).");
      },
    };
    await expect(inviteMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, userId }, { ...deps(), email })).rejects.toThrow(
      /Kutsua ei voitu lähettää/,
    );
    expect(await isInvited(a.id, userId)).toBe(false);
  });

  it("kirjanpitäjä ei voi lähettää kutsuja", async () => {
    await expect(inviteMember(db, a.staff.sub, { organizationId: a.id, actorId: a.staff.id, userId: a.staff.id }, deps())).rejects.toThrow(/Vain pääkäyttäjä/);
  });

  it("kutsuviestin HTML ei tulkitse nimiä merkinnöiksi", () => {
    const m = buildInviteEmail({
      email: "x@example.test", organizationName: "<b>Toimisto</b>", inviterName: "Pää", role: "owner",
      loginUrl: "https://skog.example.test/kirjaudu", setPasswordUrl: null, replyTo: null,
    });
    expect(m.html).not.toContain("<b>Toimisto</b>");
    expect(m.html).toContain("&lt;b&gt;");
    expect(m.text).toContain("pääkäyttäjä");
  });
});

describe("roolit ja käytöstä poisto", () => {
  it("viimeistä pääkäyttäjää ei voi alentaa eikä itseään poistaa käytöstä", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.owner.id, role: "staff" })),
    ).rejects.toThrow(/vähintään yksi pääkäyttäjä/);
    await expect(
      db.asUser(a.owner.sub, (tx) => deactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.owner.id, transferTo: null })),
    ).rejects.toThrow(/itseäsi/);
  });

  it("kirjanpitäjä ei voi muuttaa rooleja eikä poistaa käytöstä", async () => {
    await expect(
      db.asUser(a.staff.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.staff.id, userId: a.staff.id, role: "owner" })),
    ).rejects.toThrow(/Vain pääkäyttäjä/);
    await expect(
      db.asUser(a.staff.sub, (tx) => deactivateMember(tx, { organizationId: a.id, actorId: a.staff.id, userId: a.owner.id, transferTo: null })),
    ).rejects.toThrow();
  });

  it("vastuuasiakkaat estävät käytöstä poiston, kunnes ne siirretään", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => deactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, transferTo: null })),
    ).rejects.toThrow(/1 asiakkaan vastuukirjanpitäjä/);
    const [m] = await db.asService((tx) =>
      tx.query<{ d: boolean }>("select deactivated_at is not null as d from sk_org_members where organization_id = $1 and user_id = $2", [a.id, a.staff.id]),
    );
    expect(m.d).toBe(false);
  });

  it("asiakkaita ei voi siirtää toisen toimiston käyttäjälle", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => deactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, transferTo: b.staff.id })),
    ).rejects.toThrow(/käytössä oleva kirjanpitäjä/);
  });

  it("käytöstä poisto siirtää asiakkaat, säilyttää rivin ja estää pääsyn", async () => {
    const res = await db.asUser(a.owner.sub, (tx) =>
      deactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, transferTo: a.owner.id }),
    );
    expect(res.transferred).toBe(1);
    const [client] = await db.asService((tx) => tx.query<{ responsible_user_id: string }>("select responsible_user_id from sk_clients where id = $1", [a.client]));
    expect(client.responsible_user_id).toBe(a.owner.id);
    const [m] = await db.asService((tx) =>
      tx.query<{ deactivated_by: string }>("select deactivated_by from sk_org_members where organization_id = $1 and user_id = $2", [a.id, a.staff.id]),
    );
    expect(m.deactivated_by).toBe(a.owner.id);

    // Käytöstä poistettu ei näe toimiston tietoja eikä ole minkään säännön silmissä jäsen.
    expect(await db.asUser(a.staff.sub, (tx) => tx.query("select id from sk_organizations"))).toHaveLength(0);
    expect(await db.asUser(a.staff.sub, (tx) => tx.query("select id from sk_clients"))).toHaveLength(0);
    expect(await db.asUser(a.staff.sub, (tx) => tx.query("select id from sk_transactions"))).toHaveLength(0);
    const [{ ok }] = await db.asUser(a.staff.sub, (tx) => tx.query<{ ok: boolean }>("select sk_has_org_role($1, array['owner','staff']) as ok", [a.id]));
    expect(ok).toBe(false);

    const log = await db.asService((tx) =>
      tx.query<{ action: string }>("select action from sk_audit_log where organization_id = $1 and action in ('member.deactivate', 'client.responsible')", [a.id]),
    );
    expect(log.map((l) => l.action).sort()).toEqual(["client.responsible", "member.deactivate"]);
  });

  it("käytöstä poistettua ei voi valita vastuukirjanpitäjäksi eikä hänen rooliaan vaihtaa", async () => {
    await expect(
      db.asUser(a.owner.sub, (tx) => tx.query("update sk_clients set responsible_user_id = $2 where id = $1", [a.otherClient, a.staff.id])),
    ).rejects.toThrow(/poistettu käytöstä/);
    await expect(
      db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, role: "owner" })),
    ).rejects.toThrow(/takaisin käyttöön/);
  });

  it("käytöstä poistettua ei lisätä uudelleen eikä hänelle lähetetä kutsua", async () => {
    const [{ email }] = await db.asService((tx) => tx.query<{ email: string }>("select email from sk_users where id = $1", [a.staff.id]));
    await expect(addMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, email, fullName: null, role: "staff" })).rejects.toThrow(/poistettu käytöstä/);
    await expect(inviteMember(db, a.owner.sub, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id }, deps())).rejects.toThrow(/Käytöstä poistetulle/);
  });

  it("arkistoitu asiakas ei estä käytöstä poistoa, ja sen muu muokkaus onnistuu edelleen", async () => {
    const other = await createUser(db);
    await db.asService(async (tx) => {
      await tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1, $2, 'staff')", [b.id, other.id]);
      await tx.query("update sk_clients set responsible_user_id = $2, archived_at = now() where id = $1", [b.otherClient, other.id]);
    });
    await db.asUser(b.owner.sub, (tx) => deactivateMember(tx, { organizationId: b.id, actorId: b.owner.id, userId: other.id, transferTo: null }));
    const rows = await db.asUser(b.owner.sub, (tx) => tx.query("update sk_clients set first_name = 'Eetu' where id = $1 returning id", [b.otherClient]));
    expect(rows).toHaveLength(1);
  });

  it("käyttöön otto palauttaa pääsyn", async () => {
    await db.asUser(a.owner.sub, (tx) => reactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id }));
    expect(await db.asUser(a.staff.sub, (tx) => tx.query("select id from sk_organizations"))).toHaveLength(1);
    await expect(
      db.asUser(a.owner.sub, (tx) => reactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id })),
    ).rejects.toThrow(/jo käytössä/);
  });

  it("toisen pääkäyttäjän voi poistaa käytöstä, ja sen jälkeen jäljellä oleva on viimeinen", async () => {
    await db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, role: "owner" }));
    await db.asUser(a.owner.sub, (tx) => deactivateMember(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.staff.id, transferTo: null }));
    // Käytöstä poistettua pääkäyttäjää ei lasketa.
    await expect(
      db.asUser(a.owner.sub, (tx) => changeMemberRole(tx, { organizationId: a.id, actorId: a.owner.id, userId: a.owner.id, role: "staff" })),
    ).rejects.toThrow(/vähintään yksi pääkäyttäjä/);
  });
});
