import { openLocalDb } from "./lib/local-db.mts";

/**
 * Kuvitteellinen demodata paikalliseen kantaan: kaksi kirjanpitotoimistoa ja
 * käyttäjät molemmille rooleille. Asiakkaat, metsätilat ja kirjaukset
 * lisätään, kun niiden taulut tehdään (PLAN.md vaihe 2). Kaikki nimet ovat keksittyjä.
 *
 *   npm run db:seed:demo
 */

const db = await openLocalDb();

const existing = await db.asService((tx) => tx.query("select 1 from sk_organizations limit 1"));
if (existing.length) {
  console.log("Kannassa on jo organisaatioita. Aja ensin npm run db:reset, jos haluat aloittaa alusta.");
  await db.close();
  process.exit(0);
}

await db.asService(async (tx) => {
  const user = async (email: string, name: string) =>
    (await tx.query<{ id: string }>("insert into sk_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [`dev|${email}`, email, name]))[0].id;
  const paakayttaja = await user("paakayttaja@example.test", "Pää Käyttäjä");
  const kirjanpitaja = await user("kirjanpitaja@example.test", "Kirsi Kirjanpitäjä");
  const toinen = await user("toinen@example.test", "Toisen Toimiston Kirjanpitäjä");

  const org = async (name: string) => (await tx.query<{ id: string }>("insert into sk_organizations (name) values ($1) returning id", [name]))[0].id;
  const orgA = await org("Demometsä Tilitoimisto Oy");
  const orgB = await org("Kuvitelman Kirjanpito");
  await tx.query(
    "insert into sk_org_members (organization_id, user_id, role) values ($1, $3, 'owner'), ($1, $4, 'staff'), ($2, $5, 'owner')",
    [orgA, orgB, paakayttaja, kirjanpitaja, toinen],
  );
});

console.log("Demodata luotu: 2 toimistoa, 3 käyttäjää.");
await db.close();
