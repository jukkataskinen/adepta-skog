import { openLocalDb } from "./lib/local-db.mts";
import type { Sql } from "../src/lib/db/types.ts";

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

  await seedFarm(tx, orgA, kirjanpitaja);
});

/**
 * Kuvitteellinen maatila-asiakas vuodelle 2025 (DECISIONS 2.10.2026): maitotila,
 * jolla on myös metsää. Pohjaluvut ovat vuoden 2024 lopusta kuten oikeassa
 * käyttöönotossa: koneiden, navetan ja salaojien menojäännökset, tasausvaraus
 * ja kotieläinten jaksotus. Kaikki nimet ja luvut ovat keksittyjä.
 */
async function seedFarm(tx: Sql, org: string, staff: string) {
  const [{ id: c }] = await tx.query<{ id: string }>(
    `insert into sk_clients (organization_id, first_name, last_name, municipality, city, responsible_user_id, vat_registered, has_forestry, has_agriculture)
     values ($1, 'Maija', 'Peltola', 'Kuvitelma', 'Kuvitelma', $2, true, true, true) returning id`,
    [org, staff],
  );
  await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1,$2,2025)", [org, c]);
  await tx.query(
    `insert into sk_forest_properties (organization_id, client_id, name, property_code, area_ha, acquisition_price, acquired_on, forest_land_share_pct)
     values ($1,$2,'Takametsä','999-402-2-2',30,70000,'2012-04-01',80)`,
    [org, c],
  );
  const [{ id: farm }] = await tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name, farm_code) values ($1,$2,'Peltolan tila','999000111') returning id", [org, c]);

  // Aiemmat investoinnit: menojäännös 31.12.2024 ryhmittäin (lomake 2, vuosi 2024).
  const prior = async (description: string, cls: string, rate: number, cost: number, accumulated: number) =>
    (
      await tx.query<{ id: string }>(
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_book_value, opening_year,
                                opening_accumulated_depreciation, activity, asset_class)
         values ($1,$2,$3,'2024-12-31',$4,'declining_balance',$5,$6,2025,$7,'agriculture',$8) returning id`,
        [org, c, description, cost, rate, cost - accumulated, accumulated, cls],
      )
    )[0].id;
  await prior("Koneet ja kalusto yhteensä", "agri_machinery", 25, 180000, 120000);
  await prior("Navetta", "agri_production_building", 10, 400000, 160000);
  await prior("Salaojat", "agri_drainage", 20, 20000, 8000);
  // Uusi traktori 2025: korotettu poisto 50 %.
  const [{ id: tractor }] = await tx.query<{ id: string }>(
    `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, activity, asset_class, accelerated)
     values ($1,$2,'Traktori','2025-04-15',60000,'declining_balance',25,'agriculture','agri_machinery',true) returning id`,
    [org, c],
  );

  // Kirjaukset 2025: [päivä, tyyppi, luokka, selite, summa sis. alv, alv %, oma osuus %, toisen toiminnon osuus %]
  const rows: [string, string, string, string, number, number, number, number][] = [
    ["2025-01-31", "income", "agri_livestock_products", "Maitotilit tammi–maaliskuu", 41040, 14, 100, 0],
    ["2025-04-30", "income", "agri_livestock_products", "Maitotilit huhti–kesäkuu", 42750, 14, 100, 0],
    ["2025-08-31", "income", "agri_livestock_products", "Maitotilit heinä–syyskuu", 41895, 14, 100, 0],
    ["2025-10-15", "income", "agri_crops", "Ohran myynti", 9120, 14, 100, 0],
    ["2025-06-10", "income", "agri_livestock_sale", "Teurasnaudat", 6275, 25.5, 100, 0],
    ["2025-09-20", "income", "agri_livestock_sale_deferred", "Karjan myynti, jaksotettava", 15060, 25.5, 100, 0],
    ["2025-04-25", "income", "agri_state_subsidy", "Perustulotuki ja luonnonhaittakorvaus", 38500, 0, 100, 0],
    ["2025-12-15", "income", "agri_coop_surplus", "Meijerin ylijäämä", 2400, 0, 100, 0],
    ["2025-03-12", "expense", "agri_fertilizers", "Lannoitteet", 8785, 25.5, 100, 0],
    ["2025-05-05", "expense", "agri_feed", "Rehut", 17100, 14, 100, 0],
    ["2025-06-30", "expense", "agri_fuels", "Polttoöljy ja diesel", 5020, 25.5, 100, 0],
    ["2025-07-31", "expense", "agri_energy", "Sähkö, maatila ja koti", 4518, 25.5, 70, 10],
    ["2025-09-15", "expense", "agri_veterinary", "Eläinlääkäri", 1255, 25.5, 100, 0],
    ["2025-02-28", "expense", "agri_myel", "MYEL-maksut", 6800, 0, 100, 0],
    ["2025-03-31", "expense", "agri_insurance", "Maatilan vakuutukset", 2150, 0, 100, 0],
    ["2025-11-30", "expense", "agri_interest", "Navettalainan korot", 4200, 0, 100, 0],
    ["2025-12-20", "expense", "agri_wages", "Kesäapulaisen palkka", 3600, 0, 100, 0],
    ["2025-05-20", "income", "standing_sale", "Pystykauppa, harvennus", 25100, 25.5, 100, 0],
    ["2025-08-10", "expense", "other_expense", "Metsätien kunnossapito", 1004, 25.5, 100, 0],
  ];
  for (const [date, kind, cat, desc, gross, vat, share, other] of rows) {
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_gross, vat_rate, business_share_pct, other_share_pct, activity, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [org, c, date, kind, cat, desc, gross, vat, share, other, cat.startsWith("agri_") ? "agriculture" : "forestry", staff],
    );
  }
  await tx.query(
    `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_gross, vat_rate, asset_id, activity, created_by)
     values ($1,$2,'2025-04-15','investment','agri_asset_purchase','Traktori',75300,25.5,$3,'agriculture',$4)`,
    [org, c, tractor, staff],
  );

  // Tasausvaraus 2023 tuloutetaan 2025, ja vuodelta 2025 tehdään uusi. Jaksotus 2024 kotieläinten myynnistä.
  const [{ id: old }] = await tx.query<{ id: string }>(
    "insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount) values ($1,$2,$3,'equalization',2023,3000) returning id",
    [org, c, farm],
  );
  await tx.query("insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,2025,'income',3000)", [org, c, old]);
  await tx.query("insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount) values ($1,$2,$3,'equalization',2025,4000)", [org, c, farm]);
  await tx.query(
    "insert into sk_agri_deferrals (organization_id, client_id, tax_year, kind, amount, year1, year2, year3) values ($1,$2,2024,'livestock_sale',2400,800,800,800)",
    [org, c],
  );
  await tx.query(
    // Edellisen vuoden (2024) nettovarallisuus syötetään, koska vuotta 2024 ei ole Skogissa: verosuunnitelma jakaa yritystulon sen mukaan.
    `insert into sk_agri_years (organization_id, client_id, tax_year, liabilities, shares_value, wages_subject_to_withholding, prior_net_wealth)
     values ($1,$2,2025,150000,8000,3000,180000)`,
    [org, c],
  );
  // Poistot 2025 enimmäismäärin, jotta raportissa ja tiedostossa on luvut heti.
  for (const [pool, amount] of [
    ["agri_machinery", 15000],
    ["agri_machinery_accelerated", 30000],
    ["agri_production_building", 24000],
    ["agri_drainage", 2400],
  ] as const) {
    await tx.query("insert into sk_agri_depreciations (organization_id, client_id, tax_year, pool, amount) values ($1,$2,2025,$3,$4)", [org, c, pool, amount]);
  }
}

console.log("Demodata luotu: 2 toimistoa, 3 käyttäjää, 4 asiakasta (yksi maatila), 5 metsätilaa, 10 metsäkirjausta ja maatilan vuosi 2025.");
await db.close();
