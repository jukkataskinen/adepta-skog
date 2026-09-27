import type { Database, Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { EmailError, type EmailMessage, type EmailSender } from "@/lib/email";
import { AccountError, type AccountProvisioner } from "@/lib/accounts";

export type MemberRole = "owner" | "staff";

// Oma kopio ROLE_LABEL:sta, koska current-user.ts on vain palvelimelle eikä sitä voi tuoda testeihin.
const ROLE_NAME: Record<MemberRole, string> = { owner: "pääkäyttäjä", staff: "kirjanpitäjä" };

export class MemberError extends Error {}

/**
 * Käyttäjän lisäys organisaatioon sähköpostilla ennen ensimmäistä
 * kirjautumista. Käyttäjärivi luodaan palvelun roolilla tunnisteella
 * `pending|<sähköposti>`, koska kirjautumaton käyttäjä ei ole vielä minkään
 * organisaation jäsen eikä RLS salli rivin luontia. Tunniste vaihtuu
 * ensimmäisellä kirjautumisella, kun Auth0 on varmentanut saman osoitteen
 * (src/lib/auth/resolve-user.ts). Jäsenyys luodaan pääkäyttäjän omassa
 * RLS-transaktiossa, joten vain pääkäyttäjä voi lisätä jäseniä.
 */
export async function addMember(
  db: Database,
  actorSub: string,
  input: { organizationId: string; actorId: string; email: string; fullName: string | null; role: MemberRole },
): Promise<{ userId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  // Oikeus tarkistetaan ennen käyttäjärivin luontia, jottei kantaan jää orpoja rivejä.
  const [{ ok }] = await db.asUser(actorSub, (tx) =>
    tx.query<{ ok: boolean }>("select sk_has_org_role($1, array['owner']) as ok", [input.organizationId]),
  );
  if (!ok) throw new MemberError("Vain pääkäyttäjä voi lisätä käyttäjiä.");
  const { id: userId, created } = await db.asService(async (tx) => {
    const [existing] = await tx.query<{ id: string }>("select id from sk_users where lower(email) = $1", [email]);
    if (existing) return { id: existing.id, created: false };
    const [row] = await tx.query<{ id: string }>("insert into sk_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [
      `pending|${email}`,
      email,
      input.fullName,
    ]);
    return { id: row.id, created: true };
  });
  await db.asUser(actorSub, async (tx) => {
    const [member] = await tx.query<{ deactivated: boolean }>(
      "select deactivated_at is not null as deactivated from sk_org_members where organization_id = $1 and user_id = $2",
      [input.organizationId, userId],
    );
    if (member?.deactivated) throw new MemberError("Käyttäjä on jo lisätty, mutta hänet on poistettu käytöstä. Ota hänet takaisin käyttöön listasta.");
    if (member) throw new MemberError("Käyttäjä on jo tämän organisaation jäsen.");
    await tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1, $2, $3)", [input.organizationId, userId, input.role]);
    await audit(tx, {
      organizationId: input.organizationId, userId: input.actorId, action: "member.add", entity: "sk_org_members", entityId: userId,
      details: { role: input.role, newUser: created },
    });
  });
  return { userId, created };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Kutsuviesti. Puhdas funktio, jotta sisällön voi testata ilman lähetystä. */
export function buildInviteEmail(input: {
  email: string;
  organizationName: string;
  inviterName: string;
  role: MemberRole;
  loginUrl: string;
  setPasswordUrl: string | null;
  replyTo: string | null;
}): EmailMessage {
  const intro = `${input.inviterName} lisäsi sinut toimiston ${input.organizationName} käyttäjäksi Skogiin. Roolisi on ${ROLE_NAME[input.role]}.`;
  const login = `Kirjaudu osoitteessa ${input.loginUrl} sähköpostiosoitteella ${input.email}.`;
  const steps = input.setPasswordUrl
    ? ["Aseta ensin salasana tästä linkistä. Linkki on voimassa seitsemän päivää:", input.setPasswordUrl, `Sen jälkeen: ${login}`]
    : [`${login} Jos sinulla on jo tunnus, käytä sen salasanaa.`];
  const outro = "Tämä on automaattinen viesti. Jos kutsu tuli sinulle vahingossa, voit jättää sen huomiotta.";
  const text = ["Hei,", "", intro, "", ...steps, "", outro].join("\n");

  const link = (url: string) => `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  const loginHtml = `Kirjaudu osoitteessa ${link(input.loginUrl)} sähköpostiosoitteella ${escapeHtml(input.email)}.`;
  const html = [
    "<p>Hei,</p>",
    `<p>${escapeHtml(intro)}</p>`,
    input.setPasswordUrl
      ? `<p>Aseta ensin salasana tästä linkistä. Linkki on voimassa seitsemän päivää:<br>${link(input.setPasswordUrl)}</p>\n<p>Sen jälkeen: ${loginHtml}</p>`
      : `<p>${loginHtml} Jos sinulla on jo tunnus, käytä sen salasanaa.</p>`,
    `<p>${escapeHtml(outro)}</p>`,
  ].join("\n");
  return { to: input.email, subject: `Kutsu Skogiin: ${input.organizationName}`, text, html, fromName: input.organizationName, replyTo: input.replyTo };
}

/**
 * Kutsu sähköpostilla: tunnus Auth0:aan (jos puuttuu) ja viesti, jossa on
 * kirjautumisohje. Ulkoiset kutsut tehdään transaktion ulkopuolella, ettei
 * kantayhteys odota niitä. Kutsun voi lähettää uudelleen, jos viesti hukkui.
 */
export async function inviteMember(
  db: Database,
  actorSub: string,
  input: { organizationId: string; actorId: string; userId: string },
  deps: { email: EmailSender; accounts: AccountProvisioner; appUrl: string },
): Promise<{ accountCreated: boolean }> {
  const target = await db.asUser(actorSub, async (tx) => {
    const [{ ok }] = await tx.query<{ ok: boolean }>("select sk_has_org_role($1, array['owner']) as ok", [input.organizationId]);
    if (!ok) throw new MemberError("Vain pääkäyttäjä voi kutsua käyttäjiä.");
    const [row] = await tx.query<{
      email: string; full_name: string | null; role: MemberRole; deactivated: boolean; org_name: string; reply_to: string | null; inviter: string | null;
    }>(
      `select u.email, u.full_name, m.role, m.deactivated_at is not null as deactivated, o.name as org_name, o.contact_email as reply_to,
              (select coalesce(a.full_name, a.email) from sk_users a where a.id = $3) as inviter
         from sk_org_members m join sk_users u on u.id = m.user_id join sk_organizations o on o.id = m.organization_id
        where m.organization_id = $1 and m.user_id = $2`,
      [input.organizationId, input.userId, input.actorId],
    );
    if (!row) throw new MemberError("Käyttäjää ei löytynyt.");
    if (row.deactivated) throw new MemberError("Käytöstä poistetulle ei lähetetä kutsua. Ota hänet ensin takaisin käyttöön.");
    return row;
  });

  const loginUrl = `${deps.appUrl.replace(/\/$/, "")}/kirjaudu`;
  let accountCreated = false;
  try {
    const account = await deps.accounts.ensureAccount({ email: target.email, fullName: target.full_name, returnUrl: loginUrl });
    accountCreated = account.created;
    await deps.email.send(
      buildInviteEmail({
        email: target.email,
        organizationName: target.org_name,
        inviterName: target.inviter ?? "Pääkäyttäjä",
        role: target.role,
        loginUrl,
        setPasswordUrl: account.setPasswordUrl,
        replyTo: target.reply_to,
      }),
    );
  } catch (err) {
    if (err instanceof EmailError || err instanceof AccountError) throw new MemberError(`Kutsua ei voitu lähettää. ${err.message}`);
    throw err;
  }

  await db.asUser(actorSub, async (tx) => {
    await tx.query("update sk_org_members set invited_at = now() where organization_id = $1 and user_id = $2", [input.organizationId, input.userId]);
    await audit(tx, {
      organizationId: input.organizationId, userId: input.actorId, action: "member.invite", entity: "sk_org_members", entityId: input.userId,
      details: { accountCreated, emailMode: deps.email.mode },
    });
  });
  return { accountCreated };
}

async function activeOwnerCount(tx: Sql, orgId: string): Promise<number> {
  const [row] = await tx.query<{ n: number }>(
    "select count(*)::int as n from sk_org_members where organization_id = $1 and role = 'owner' and deactivated_at is null",
    [orgId],
  );
  return row.n;
}

async function findMember(tx: Sql, orgId: string, userId: string): Promise<{ role: MemberRole; deactivated: boolean } | null> {
  const [row] = await tx.query<{ role: MemberRole; deactivated: boolean }>(
    "select role, deactivated_at is not null as deactivated from sk_org_members where organization_id = $1 and user_id = $2",
    [orgId, userId],
  );
  return row ?? null;
}

async function currentMember(tx: Sql, orgId: string, userId: string): Promise<{ role: MemberRole; deactivated: boolean }> {
  const row = await findMember(tx, orgId, userId);
  if (!row) throw new MemberError("Käyttäjää ei löytynyt.");
  return row;
}

export async function changeMemberRole(tx: Sql, input: { organizationId: string; actorId: string; userId: string; role: MemberRole }): Promise<void> {
  const current = await currentMember(tx, input.organizationId, input.userId);
  if (current.deactivated) throw new MemberError("Ota käyttäjä ensin takaisin käyttöön.");
  if (current.role === "owner" && input.role !== "owner" && (await activeOwnerCount(tx, input.organizationId)) <= 1) {
    throw new MemberError("Organisaatiolla on oltava vähintään yksi pääkäyttäjä.");
  }
  const rows = await tx.query("update sk_org_members set role = $3 where organization_id = $1 and user_id = $2 returning user_id", [
    input.organizationId,
    input.userId,
    input.role,
  ]);
  if (rows.length === 0) throw new MemberError("Vain pääkäyttäjä voi muuttaa rooleja.");
  await audit(tx, { organizationId: input.organizationId, userId: input.actorId, action: "member.role", entity: "sk_org_members", entityId: input.userId, details: { role: input.role } });
}

/** Arkistoimattomat asiakkaat, joiden vastuukirjanpitäjä käyttäjä on. */
export async function responsibleClientCount(tx: Sql, orgId: string, userId: string): Promise<number> {
  const [row] = await tx.query<{ n: number }>(
    "select count(*)::int as n from sk_clients where organization_id = $1 and responsible_user_id = $2 and archived_at is null",
    [orgId, userId],
  );
  return row.n;
}

/**
 * Käytöstä poisto. Jäsenyysriviä ei poisteta, jotta loki ja viittaukset
 * säilyvät. Jos käyttäjä on asiakkaiden vastuukirjanpitäjä, asiakkaat on
 * siirrettävä toiselle samassa toimenpiteessä: muuten kukaan kirjanpitäjä ei
 * näkisi niitä omalla listallaan (DECISIONS 27.9.2026).
 */
export async function deactivateMember(
  tx: Sql,
  input: { organizationId: string; actorId: string; userId: string; transferTo: string | null },
): Promise<{ transferred: number }> {
  if (input.userId === input.actorId) throw new MemberError("Et voi poistaa itseäsi käytöstä.");
  const current = await currentMember(tx, input.organizationId, input.userId);
  if (current.deactivated) throw new MemberError("Käyttäjä on jo poistettu käytöstä.");
  if (current.role === "owner" && (await activeOwnerCount(tx, input.organizationId)) <= 1) {
    throw new MemberError("Organisaatiolla on oltava vähintään yksi pääkäyttäjä.");
  }

  let transferred = 0;
  if (input.transferTo) {
    if (input.transferTo === input.userId) throw new MemberError("Valitse asiakkaille toinen kirjanpitäjä.");
    const target = await findMember(tx, input.organizationId, input.transferTo);
    if (!target || target.deactivated) throw new MemberError("Valitse asiakkaille käytössä oleva kirjanpitäjä.");
    // Myös arkistoidut siirretään, jotta palautettu asiakas ei jää käytöstä poistetulle.
    const moved = await tx.query<{ id: string }>(
      "update sk_clients set responsible_user_id = $3 where organization_id = $1 and responsible_user_id = $2 returning id",
      [input.organizationId, input.userId, input.transferTo],
    );
    transferred = moved.length;
    for (const c of moved) {
      await audit(tx, { organizationId: input.organizationId, userId: input.actorId, action: "client.responsible", entity: "sk_clients", entityId: c.id });
    }
  } else {
    const open = await responsibleClientCount(tx, input.organizationId, input.userId);
    if (open > 0) throw new MemberError(`Käyttäjä on ${open} asiakkaan vastuukirjanpitäjä. Valitse, kenelle asiakkaat siirretään.`);
  }

  const rows = await tx.query(
    "update sk_org_members set deactivated_at = now(), deactivated_by = $3 where organization_id = $1 and user_id = $2 returning user_id",
    [input.organizationId, input.userId, input.actorId],
  );
  if (rows.length === 0) throw new MemberError("Vain pääkäyttäjä voi poistaa käyttäjiä käytöstä.");
  await audit(tx, {
    organizationId: input.organizationId, userId: input.actorId, action: "member.deactivate", entity: "sk_org_members", entityId: input.userId,
    details: { transferredClients: transferred },
  });
  return { transferred };
}

export async function reactivateMember(tx: Sql, input: { organizationId: string; actorId: string; userId: string }): Promise<void> {
  const current = await currentMember(tx, input.organizationId, input.userId);
  if (!current.deactivated) throw new MemberError("Käyttäjä on jo käytössä.");
  const rows = await tx.query(
    "update sk_org_members set deactivated_at = null, deactivated_by = null where organization_id = $1 and user_id = $2 returning user_id",
    [input.organizationId, input.userId],
  );
  if (rows.length === 0) throw new MemberError("Vain pääkäyttäjä voi ottaa käyttäjiä käyttöön.");
  await audit(tx, { organizationId: input.organizationId, userId: input.actorId, action: "member.reactivate", entity: "sk_org_members", entityId: input.userId });
}
