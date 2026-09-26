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

  // Asiakkaat: kirjanpitäjän asiakas, pääkäyttäjän oma asiakas ja toisen toimiston asiakas.
  const client = async (org: string, first: string, last: string, city: string, responsible: string | null, vat: boolean) =>
    (
      await tx.query<{ id: string }>(
        "insert into sk_clients (organization_id, first_name, last_name, municipality, city, responsible_user_id, vat_registered) values ($1,$2,$3,$4,$4,$5,$6) returning id",
        [org, first, last, city, responsible, vat],
      )
    )[0].id;
  const aino = await client(orgA, "Aino", "Esimerkki", "Demola", kirjanpitaja, true);
  const eero = await client(orgA, "Eero", "Kuvitelma", "Kuvitelma", null, false);
  const helmi = await client(orgB, "Helmi", "Malli", "Mallila", toinen, true);

  for (const [org, c, name, price, share] of [
    [orgA, aino, "Kotimetsä", 120000, 80],
    [orgA, aino, "Järvenrannan palsta", 45000, 90],
    [orgA, eero, "Harjun tila", 80000, 75],
    [orgB, helmi, "Mäkelän metsä", 60000, 85],
  ] as const) {
    await tx.query(
      `insert into sk_forest_properties (organization_id, client_id, name, property_code, area_ha, acquisition_price, acquired_on, forest_land_share_pct)
       values ($1,$2,$3,'999-401-1-1',$4,$5,'2018-05-01',$6)`,
      [org, c, name, Math.round(price / 2800), price, share],
    );
  }

  const [{ id: tractor }] = await tx.query<{ id: string }>(
    `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct)
     values ($1,$2,'Metsätraktori','2024-03-01',30000,'declining_balance',25) returning id`,
    [orgA, aino],
  );
  await tx.query("insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1,$2,2024,7500,22500)", [orgA, tractor]);

  // Kirjaukset: [asiakas, päivä, tyyppi, luokka, kuvaus, summa ilman alv:tä, alv %, ennakonpidätys]
  const rows: [string, string, string, string, string, number, number, number][] = [
    [aino, "2024-02-20", "income", "standing_sale", "Pystykauppa, harvennus", 18400, 24, 0],
    [aino, "2024-03-01", "investment", "asset_purchase", "Metsätraktori", 30000, 24, 0],
    [aino, "2024-10-05", "expense", "other_expense", "Taimikonhoito", 1250, 25.5, 0],
    [aino, "2025-01-28", "income", "delivery_sale", "Hankintakauppa, kuitu", 6200, 25.5, 0],
    [aino, "2025-04-12", "expense", "travel", "Matkat palstalle", 340, 0, 0],
    [aino, "2025-06-15", "income", "standing_sale", "Pystykauppa, päätehakkuu", 42000, 25.5, 0],
    [aino, "2025-08-30", "income", "forestry_subsidy", "Kemera-tuki", 900, 0, 0],
    [eero, "2025-03-03", "income", "standing_sale", "Pystykauppa", 9500, 0, 3325],
    [eero, "2025-05-20", "expense", "other_expense", "Metsänhoitoyhdistyksen jäsenmaksu", 180, 0, 0],
    [helmi, "2025-02-14", "income", "firewood_sale", "Polttopuut", 1200, 25.5, 0],
  ];
  for (const [c, date, kind, cat, desc, net, vat, wh] of rows) {
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, withholding, asset_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c === helmi ? orgB : orgA, c, date, kind, cat, desc, net, vat, wh, cat === "asset_purchase" ? tractor : null, c === helmi ? toinen : kirjanpitaja],
    );
  }

  // Verovuodet: 2024 suljettu Ainolta, 2025 avoin kaikilta. Suljetaan viimeisenä, koska lukitus estää lisäykset.
  for (const [org, c] of [
    [orgA, aino],
    [orgA, eero],
    [orgB, helmi],
  ] as const) {
    await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1,$2,2025)", [org, c]);
  }
  await tx.query("insert into sk_tax_years (organization_id, client_id, year, status, closed_at, closed_by) values ($1,$2,2024,'closed',now(),$3)", [
    orgA,
    aino,
    paakayttaja,
  ]);
});

console.log("Demodata luotu: 2 toimistoa, 3 käyttäjää, 3 asiakasta, 4 metsätilaa, 10 kirjausta.");
await db.close();
