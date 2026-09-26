import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import type { Database, Sql } from "@/lib/db/types";

/** Tuore muistikanta, johon on ajettu kaikki migraatiot. */
export async function freshDb(): Promise<Database> {
  const db = await createPgliteDatabase();
  await migrateLocal(db);
  return db;
}

export interface TestUser {
  id: string;
  sub: string;
}

export interface OrgFixture {
  id: string;
  owner: TestUser;
  staff: TestUser;
}

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function one<T>(tx: Sql, text: string, params: unknown[] = []): Promise<T> {
  const rows = await tx.query<T>(text, params);
  if (rows.length !== 1) throw new Error(`odotettiin 1 rivi, saatiin ${rows.length}: ${text}`);
  return rows[0];
}

export async function createUser(db: Database, email?: string): Promise<TestUser> {
  const sub = `test|${uniq()}`;
  const row = await db.asService((tx) =>
    one<{ id: string }>(tx, "insert into sk_users (auth_sub, email) values ($1, $2) returning id", [
      sub,
      email ?? `${sub.replace("|", "-")}@example.test`,
    ]),
  );
  return { id: row.id, sub };
}

/** Organisaatio (kirjanpitotoimisto), jossa on pääkäyttäjä ja kirjanpitäjä. Tietomallin taulut lisätään tähän vaiheessa 2. */
export async function seedOrg(db: Database, name: string): Promise<OrgFixture> {
  const owner = await createUser(db);
  const staff = await createUser(db);
  return db.asService(async (tx) => {
    const id = (await one<{ id: string }>(tx, "insert into sk_organizations (name) values ($1) returning id", [name])).id;
    await tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1,$2,'owner'),($1,$3,'staff')", [id, owner.id, staff.id]);
    return { id, owner, staff };
  });
}
