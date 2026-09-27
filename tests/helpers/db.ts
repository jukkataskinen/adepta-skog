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
  /** Asiakas, jonka vastuukirjanpitäjä on staff. */
  client: string;
  /** Asiakas ilman vastuukirjanpitäjää: vain pääkäyttäjä näkee. */
  otherClient: string;
  property: string;
  asset: string;
  transaction: string;
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

/**
 * Organisaatio (kirjanpitotoimisto), jossa on pääkäyttäjä ja kirjanpitäjä sekä
 * kaksi asiakasta. Kirjanpitäjä on vain ensimmäisen asiakkaan vastuukirjanpitäjä.
 * Ensimmäisellä asiakkaalla on metsätila, investointi, kirjaus, verovuosi 2025,
 * poisto, metsävähennys ja tosite.
 */
export async function seedOrg(db: Database, name: string): Promise<OrgFixture> {
  const owner = await createUser(db);
  const staff = await createUser(db);
  return db.asService(async (tx) => {
    const id = (await one<{ id: string }>(tx, "insert into sk_organizations (name) values ($1) returning id", [name])).id;
    await tx.query("insert into sk_org_members (organization_id, user_id, role) values ($1,$2,'owner'),($1,$3,'staff')", [id, owner.id, staff.id]);
    const client = (
      await one<{ id: string }>(
        tx,
        "insert into sk_clients (organization_id, first_name, last_name, responsible_user_id, vat_registered) values ($1, 'Aino', 'Metsänen', $2, true) returning id",
        [id, staff.id],
      )
    ).id;
    const otherClient = (
      await one<{ id: string }>(tx, "insert into sk_clients (organization_id, first_name, last_name) values ($1, 'Eero', 'Kuusinen') returning id", [id])
    ).id;
    const property = (
      await one<{ id: string }>(
        tx,
        `insert into sk_forest_properties (organization_id, client_id, name, property_code, area_ha, acquisition_price, acquired_on, forest_land_share_pct)
         values ($1, $2, 'Kotimetsä', '172-401-3-45', 42.5, 120000, '2018-05-01', 80) returning id`,
        [id, client],
      )
    ).id;
    const asset = (
      await one<{ id: string }>(
        tx,
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct)
         values ($1, $2, 'Metsätraktori', '2024-03-01', 30000, 'declining_balance', 25) returning id`,
        [id, client],
      )
    ).id;
    const transaction = (
      await one<{ id: string }>(
        tx,
        `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, withholding)
         values ($1, $2, '2025-06-15', 'income', 'standing_sale', 'Pystykauppa', 15000, 25.5, 0) returning id`,
        [id, client],
      )
    ).id;
    await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, 2025)", [id, client]);
    await tx.query("insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1, $2, 2025, 7500, 22500)", [id, asset]);
    await tx.query("insert into sk_forest_deductions (organization_id, forest_property_id, tax_year, amount) values ($1, $2, 2025, 3000)", [id, property]);
    await tx.query(
      `insert into sk_documents (organization_id, client_id, tax_year, kind, transaction_id, file_name, content_type, size_bytes, storage_path)
       values ($1, $2, 2025, 'receipt', $3, 'kuitti.pdf', 'application/pdf', 1024, $4)`,
      [id, client, transaction, `${id}/${client}/2025/${transaction}.pdf`],
    );
    await tx.query(
      "insert into sk_feature_requests (organization_id, created_by, feature, title, description) values ($1, $2, 'kirjanpito', 'Toive', 'Kuvaus')",
      [id, staff.id],
    );
    return { id, owner, staff, client, otherClient, property, asset, transaction };
  });
}
