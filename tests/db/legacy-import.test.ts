import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { importLegacyData, type LegacyData } from "@/lib/import/run";
import { freshDb } from "../helpers/db";

/**
 * Tiedonsiirto vanhasta kannasta kuvitteellisella aineistolla. Tärkeintä on,
 * että ajon voi toistaa: toinen ajo ei tuplaa rivejä eikä kaadu suljettuihin vuosiin.
 */

const ORG = "Tuontitoimisto Oy";
const U_OWNER = "00000000-0000-4000-8000-000000000001";
const U_STAFF = "00000000-0000-4000-8000-000000000002";
const U_READER = "00000000-0000-4000-8000-000000000003";
const C1 = "00000000-0000-4000-8000-000000000011";
const C2 = "00000000-0000-4000-8000-000000000012";
const P1 = "00000000-0000-4000-8000-000000000021";
const A1 = "00000000-0000-4000-8000-000000000031";

const data: LegacyData = {
  users: [
    { id: U_OWNER, auth_sub: "auth0|vanha1", sahkoposti: "Paa@Example.test", etunimi: "Pää", sukunimi: "Käyttäjä", rooli: "paakayttaja", aktiivinen: true, organisaatio_id: "o" },
    { id: U_STAFF, auth_sub: "auth0|vanha2", sahkoposti: "kirjanpitaja@example.test", etunimi: "Kirsi", sukunimi: "K", rooli: "kirjanpitaja", aktiivinen: true, organisaatio_id: "o" },
    { id: U_READER, auth_sub: null, sahkoposti: "lukija@example.test", etunimi: null, sukunimi: null, rooli: "lukija", aktiivinen: true, organisaatio_id: "o" },
  ],
  clients: [
    {
      id: C1, organisaatio_id: "o", etunimi: "Aino", sukunimi: "Metsänen", y_tunnus: null, kotikunta: "Joutsa", sahkoposti: null, puhelin: null, osoite: null,
      postinumero: "19650", postitoimipaikka: "Joutsa", verotiliviite: null, alv_rekisterissa: true, avoin_vuosi: 2025, vastuukirjanpitaja_id: U_STAFF, poistettu_at: null,
    },
    {
      id: C2, organisaatio_id: "o", etunimi: "Eero", sukunimi: "Kuusinen", y_tunnus: null, kotikunta: null, sahkoposti: null, puhelin: null, osoite: null,
      postinumero: null, postitoimipaikka: null, verotiliviite: null, alv_rekisterissa: false, avoin_vuosi: null, vastuukirjanpitaja_id: null, poistettu_at: null,
    },
  ],
  properties: [
    { id: P1, asiakas_id: C1, nimi: "Kotimetsä", kiinteistotunnus: "172-401-3-45", pinta_ala_ha: 42.5, hankintahinta: 120000, hankintapvm: "2018-05-01", metsämaan_osuus_prosentti: 80, vahennyspohjaa_kaytetty: 5000 },
  ],
  deductions: [{ metsatila_id: P1, verovuosi: 2024, kaytettava_vahennys: 3000 }],
  assets: [
    { id: A1, asiakas_id: C1, kuvaus: "Metsätraktori", hankintapvm: "2023-03-01", hankintahinta: 30000, jaannosarvo: null, poistoaika_vuotta: null, poistotapa: "menojannos", aktiivinen: false },
  ],
  depreciations: [
    { investointi_id: A1, verovuosi: 2023, poistomaara: 7500, jaannosarvo_vuoden_lopussa: 22500 },
    { investointi_id: A1, verovuosi: 2024, poistomaara: 5625, jaannosarvo_vuoden_lopussa: 16875 },
  ],
  transactions: [
    { id: "00000000-0000-4000-8000-000000000041", asiakas_id: C1, tyyppi: "tulo", kuvaus: "Pystykauppa", paivamaara: "2024-06-15", summa_alv0: 15000, alv_prosentti: 24, kategoria: "Pystykauppa", ennakko: 0, viite: null, verovuosi: 2024 },
    { id: "00000000-0000-4000-8000-000000000042", asiakas_id: C1, tyyppi: "meno", kuvaus: "Taimet", paivamaara: "2025-05-02", summa_alv0: 800, alv_prosentti: 25.5, kategoria: "Muut vuosimenot", ennakko: 0, viite: null, verovuosi: 2025 },
    { id: "00000000-0000-4000-8000-000000000043", asiakas_id: C2, tyyppi: "meno", kuvaus: "", paivamaara: "2025-01-10", summa_alv0: 50, alv_prosentti: 0, kategoria: "Tuntematon", ennakko: 0, viite: null, verovuosi: 2025 },
  ],
  archive: [{ id: "00000000-0000-4000-8000-000000000051", asiakas_id: C1, verovuosi: 2024, liite_nimi: "kuitti 1.pdf", liite_data: "data:application/pdf;base64,JVBERi0xLjQK" }],
};

let db: Database;
let orgId: string;

beforeAll(async () => {
  db = await freshDb();
  orgId = (await db.asService((tx) => tx.query<{ id: string }>("insert into sk_organizations (name) values ($1) returning id", [ORG])))[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("tiedonsiirto vanhasta kannasta", () => {
  it("tuo rivit ja sulkee avointa vuotta aiemmat vuodet", async () => {
    const r = await db.asService((tx) => importLegacyData(tx, { orgName: ORG }, data));
    expect(r.counts).toMatchObject({ asiakkaita: 2, metsätiloja: 1, investointeja: 1, poistoja: 2, metsävähennyksiä: 1, kirjauksia: 3, liitteitä: 1 });
    expect(r.skipped.map((s) => s.reason)).toEqual(["rooli lukija ei siirry"]);
    expect(r.guessedCategories).toBe(1);
    expect(r.files).toHaveLength(1);
    expect(r.files[0].contentType).toBe("application/pdf");

    const years = await db.asService((tx) =>
      tx.query<{ year: number; status: string }>(
        "select y.year, y.status from sk_tax_years y join sk_clients c on c.id = y.client_id where c.legacy_id = $1 order by y.year",
        [C1],
      ),
    );
    expect(years).toEqual([
      { year: 2023, status: "closed" },
      { year: 2024, status: "closed" },
      { year: 2025, status: "open" },
    ]);
  });

  it("vastuukirjanpitäjä ja jäsenyydet siirtyvät, ja kirjanpitäjä näkee vain oman asiakkaansa", async () => {
    const members = await db.asService((tx) =>
      tx.query<{ email: string; role: string }>(
        "select u.email, m.role from sk_org_members m join sk_users u on u.id = m.user_id where m.organization_id = $1 order by u.email",
        [orgId],
      ),
    );
    expect(members).toEqual([
      { email: "kirjanpitaja@example.test", role: "staff" },
      { email: "paa@example.test", role: "owner" },
    ]);
    // Kirjanpitäjä kirjautuu ensimmäistä kertaa: tunniste vaihtuu, kun sähköposti on varmennettu.
    await db.asService((tx) => tx.query("update sk_users set auth_sub = 'auth0|uusi2' where email = 'kirjanpitaja@example.test'"));
    const visible = await db.asUser("auth0|uusi2", (tx) => tx.query<{ legacy_id: string }>("select legacy_id from sk_clients"));
    expect(visible.map((v) => v.legacy_id)).toEqual([C1]);
  });

  it("metsätilan aiempi käyttö on erotus ja myydyn kohteen päivä on viimeisen poistovuoden lopussa", async () => {
    const [p] = await db.asService((tx) => tx.query<{ deduction_used_before: string }>("select deduction_used_before from sk_forest_properties where legacy_id = $1", [P1]));
    expect(Number(p.deduction_used_before)).toBe(2000);
    const [a] = await db.asService((tx) => tx.query<{ disposed_on: string }>("select disposed_on::text from sk_assets where legacy_id = $1", [A1]));
    expect(a.disposed_on).toBe("2024-12-31");
  });

  it("toinen ajo ei tuplaa eikä kaadu suljettuihin vuosiin", async () => {
    const r = await db.asService((tx) => importLegacyData(tx, { orgName: ORG }, data));
    expect(r.counts.asiakkaita ?? 0).toBe(0);
    expect(r.counts.kirjauksia ?? 0).toBe(0);
    expect(r.files).toHaveLength(0);
    const [n] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_transactions where organization_id = $1", [orgId]));
    expect(n.n).toBe(3);
  });

  it("tuonti ei tuo eikä poista metsätilan luovutuksia", async () => {
    // Vanhassa sovelluksessa luovutuksia ei ole: ne kirjataan uudessa, ja uusintatuonnin pitää jättää ne ennalleen.
    await db.asService(async (tx) => {
      const [p] = await tx.query<{ id: string; client_id: string }>("select id, client_id from sk_forest_properties where legacy_id = $1", [P1]);
      await tx.query(
        `insert into sk_forest_property_disposals (organization_id, client_id, forest_property_id, disposed_on, sale_price, share_pct)
         values ($1, $2, $3, '2025-08-01', 30000, 20)`,
        [orgId, p.client_id, p.id],
      );
    });
    await db.asService((tx) => importLegacyData(tx, { orgName: ORG }, data));
    const [n] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_forest_property_disposals where organization_id = $1", [orgId]));
    expect(n.n).toBe(1);
  });

  it("myöhemmin lisätyt kentät täydentyvät jo tuotuihin riveihin", async () => {
    const enriched: LegacyData = {
      ...data,
      clients: data.clients.map((c) => (c.id === C1 ? { ...c, alv_numero: "FI12345678" } : c)),
      properties: data.properties.map((p) => ({ ...p, "metsämaa_ha": 38.2 })),
      assets: data.assets.map((a) => ({ ...a, metsatila_id: P1 })),
      transactions: data.transactions.map((t) => (t.asiakas_id === C1 ? { ...t, metsatila_id: P1 } : t)),
    };
    const r = await db.asService((tx) => importLegacyData(tx, { orgName: ORG }, enriched));
    // 2024 on suljettu, joten sen kirjaukseen tilaa ei voi lisätä.
    expect(r.counts).toMatchObject({ "kirjauksen tila täydennetty": 1, "kirjauksen tila jäi suljetulle vuodelle": 1 });
    const [c] = await db.asService((tx) => tx.query<{ vat_number: string }>("select vat_number from sk_clients where legacy_id = $1", [C1]));
    expect(c.vat_number).toBe("FI12345678");
    const [p] = await db.asService((tx) =>
      tx.query<{ id: string; forest_land_ha: string }>("select id, forest_land_ha from sk_forest_properties where legacy_id = $1", [P1]),
    );
    expect(Number(p.forest_land_ha)).toBe(38.2);
    const [a] = await db.asService((tx) => tx.query<{ forest_property_id: string }>("select forest_property_id from sk_assets where legacy_id = $1", [A1]));
    expect(a.forest_property_id).toBe(p.id);
  });

  it("kirjauksen tila ei voi olla toisen asiakkaan", async () => {
    await expect(
      db.asService((tx) =>
        tx.query(
          `update sk_transactions set forest_property_id = (select id from sk_forest_properties where legacy_id = $1)
            where legacy_id = '00000000-0000-4000-8000-000000000043'`,
          [P1],
        ),
      ),
    ).rejects.toThrow(/toisen asiakkaan/);
  });

  it("vanhan sovelluksen uudelleen tallentama avoin vuosi korvaa tuodut kirjaukset", async () => {
    // Uudessa sovelluksessa lisätty kirjaus avoimelle vuodelle säilyy.
    await db.asService((tx) =>
      tx.query(
        `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net)
         select organization_id, id, '2025-08-01', 'expense', 'other_expense', 'Uuden sovelluksen kirjaus', 10 from sk_clients where legacy_id = $1`,
        [C1],
      ),
    );
    // Vanha sovellus kirjoitti vuoden 2025 uudelleen: kirjaus 42 sai uuden tunnisteen ja summan.
    // Suljetun vuoden 2024 kirjaus 41 on poistettu vanhasta, mutta sitä ei saa poistaa uudesta.
    const rewritten: LegacyData = {
      ...data,
      transactions: [
        { ...data.transactions[1], id: "00000000-0000-4000-8000-000000000044", summa_alv0: 900 },
        data.transactions[2],
      ],
      depreciations: data.depreciations,
    };
    const r = await db.asService((tx) => importLegacyData(tx, { orgName: ORG }, rewritten));
    expect(r.counts).toMatchObject({ kirjauksia: 1, "kirjauksia poistettu": 1, "suljetun vuoden muutos ohitettu": 1 });
    const rows = await db.asService((tx) =>
      tx.query<{ legacy_id: string | null; amount_net: string }>(
        "select t.legacy_id, t.amount_net from sk_transactions t join sk_clients c on c.id = t.client_id where c.legacy_id = $1 order by t.booked_on",
        [C1],
      ),
    );
    expect(rows.map((x) => [x.legacy_id, Number(x.amount_net)])).toEqual([
      ["00000000-0000-4000-8000-000000000041", 15000],
      ["00000000-0000-4000-8000-000000000044", 900],
      [null, 10],
    ]);
  });

  it("muuttunut kirjaus päivittyy avoimella vuodella", async () => {
    const changed: LegacyData = {
      ...data,
      transactions: [
        data.transactions[0],
        { ...data.transactions[1], id: "00000000-0000-4000-8000-000000000044", summa_alv0: 950, kuvaus: "Taimet ja lannoite" },
        data.transactions[2],
      ],
    };
    const r = await db.asService((tx) => importLegacyData(tx, { orgName: ORG }, changed));
    expect(r.counts).toMatchObject({ "kirjauksia päivitetty": 1 });
    expect(r.counts["kirjauksia poistettu"] ?? 0).toBe(0);
    const [t] = await db.asService((tx) =>
      tx.query<{ amount_net: string; description: string }>("select amount_net, description from sk_transactions where legacy_id = '00000000-0000-4000-8000-000000000044'"),
    );
    expect([Number(t.amount_net), t.description]).toEqual([950, "Taimet ja lannoite"]);
  });

  it("tuodun suljetun vuoden kirjausta ei voi muuttaa", async () => {
    await expect(
      db.asService((tx) => tx.query("update sk_transactions set amount_net = 1 where legacy_id = '00000000-0000-4000-8000-000000000041'")),
    ).rejects.toThrow(/Verovuosi 2024 on suljettu/);
  });

  it("puuttuva kohdeorganisaatio pysäyttää ajon", async () => {
    await expect(db.asService((tx) => importLegacyData(tx, { orgName: "Ei ole" }, data))).rejects.toThrow(/ei ole/);
  });
});
