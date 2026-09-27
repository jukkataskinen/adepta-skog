import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/types";
import { documentPath } from "@/lib/storage";
import {
  isSkipped,
  mapAsset,
  mapClient,
  mapProperty,
  mapTransaction,
  mapUser,
  taxYears,
  type LegacyAsset,
  type LegacyClient,
  type LegacyDeduction,
  type LegacyDepreciation,
  type LegacyProperty,
  type LegacyTransaction,
  type LegacyUser,
  type Skipped,
} from "./legacy";

/**
 * Vanhan kannan rivit uuteen kantaan yhdessä transaktiossa (palvelun rooli).
 * Kutsuja: scripts/import-legacy.mts. Testit: tests/db/legacy-import.test.ts.
 *
 * Ajo on toistettava: rivit tunnistetaan vanhalla tunnisteella (legacy_id).
 * Myöhemmin lisätyt kentät (migraatio 0004) täydennetään jo tuotuihin riveihin.
 *
 * Rinnakkaisajon aikana vanhaa sovellusta käytetään edelleen, ja se tallentaa
 * koko vuoden kirjaukset poistamalla ja kirjoittamalla ne uudelleen uusilla
 * tunnisteilla. Siksi avoimen vuoden kirjaukset, poistot ja metsävähennykset
 * korvataan vanhan kannan nykytilalla: uudet lisätään, muuttuneet päivitetään
 * ja vanhasta poistetut poistetaan. Uudessa sovelluksessa lisättyihin
 * kirjauksiin (legacy_id tyhjä) ja suljettuihin vuosiin ei kosketa.
 * Tiedostoja ei tallenneta
 * täällä: ne palautetaan kutsujalle, joka tallentaa ne ennen transaktion loppua.
 */

export interface LegacyArchiveRow {
  id: string;
  asiakas_id: string;
  verovuosi: number;
  liite_nimi: string | null;
  liite_data: string | null;
}

export interface LegacyData {
  users: LegacyUser[];
  clients: LegacyClient[];
  properties: LegacyProperty[];
  deductions: LegacyDeduction[];
  assets: LegacyAsset[];
  depreciations: LegacyDepreciation[];
  transactions: LegacyTransaction[];
  archive: LegacyArchiveRow[];
}

export interface ImportResult {
  counts: Record<string, number>;
  skipped: Skipped[];
  guessedCategories: number;
  files: { path: string; body: Buffer; contentType: string }[];
}

export async function importLegacyData(tx: Sql, input: { orgName: string; createOrg?: boolean }, data: LegacyData): Promise<ImportResult> {
  const skipped: Skipped[] = [];
  const counts: Record<string, number> = {};
  const add = (k: string, n = 1) => {
    if (n) counts[k] = (counts[k] ?? 0) + n;
  };
  let guessedCategories = 0;
  const files: ImportResult["files"] = [];

  let [org] = await tx.query<{ id: string }>("select id from sk_organizations where name = $1", [input.orgName]);
  // Kuivassa ajossa organisaatio luodaan samassa transaktiossa, joka perutaan lopuksi.
  if (!org && input.createOrg) [org] = await tx.query<{ id: string }>("insert into sk_organizations (name) values ($1) returning id", [input.orgName]);
  if (!org) throw new Error(`Organisaatiota "${input.orgName}" ei ole. Luo se: npm run kayttaja:lisaa -- --luo-org`);

  // Käyttäjät ja jäsenyydet. Käyttäjä yhdistyy ensimmäisellä kirjautumisella sähköpostilla (resolve-user).
  const userMap = new Map<string, string>();
  for (const u of data.users) {
    const m = mapUser(u);
    if (isSkipped(m)) {
      skipped.push(m);
      continue;
    }
    let [row] = await tx.query<{ id: string }>("select id from sk_users where lower(email) = $1", [m.email]);
    if (!row) {
      [row] = await tx.query<{ id: string }>("insert into sk_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [
        `pending|${m.email}`,
        m.email,
        m.fullName,
      ]);
      add("käyttäjiä luotu");
    }
    const ins = await tx.query(
      "insert into sk_org_members (organization_id, user_id, role) values ($1, $2, $3) on conflict do nothing returning user_id",
      [org.id, row.id, m.role],
    );
    add("jäsenyyksiä lisätty", ins.length);
    userMap.set(u.id, row.id);
  }

  // Asiakkaat
  const clientMap = new Map<string, string>();
  const openYears = new Map<string, number | null>();
  for (const c of data.clients) {
    const m = mapClient(c);
    if (isSkipped(m)) {
      skipped.push(m);
      continue;
    }
    const responsible = m.legacyResponsibleId ? (userMap.get(m.legacyResponsibleId) ?? null) : null;
    const [row] = await tx.query<{ id: string; inserted: boolean }>(
      `insert into sk_clients (organization_id, first_name, last_name, business_id, municipality, email, phone, street, postal_code, city,
                               tax_account_reference, vat_registered, responsible_user_id, archived_at, legacy_id, vat_number)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (legacy_id) do update set vat_number = coalesce(sk_clients.vat_number, excluded.vat_number)
       returning id, (xmax = 0) as inserted`,
      [org.id, m.firstName, m.lastName, m.businessId, m.municipality, m.email, m.phone, m.street, m.postalCode, m.city,
        m.taxAccountReference, m.vatRegistered, responsible, m.archivedAt, m.legacyId, m.vatNumber],
    );
    if (row.inserted) add("asiakkaita");
    clientMap.set(c.id, row.id);
    openYears.set(row.id, m.openYear);
  }
  const yearsByClient = new Map<string, Set<number>>();
  const touchYear = (client: string, y: number) => {
    if (!yearsByClient.has(client)) yearsByClient.set(client, new Set());
    yearsByClient.get(client)!.add(y);
  };

  // Suljetun vuoden rivejä ei voi lisätä, muuttaa eikä poistaa (lukitustriggeri).
  const yearClosed = async (client: string, year: number) =>
    (await tx.query<{ closed: boolean }>("select sk_year_is_closed($1, $2) as closed", [client, year]))[0].closed;

  // Metsätilat ja metsävähennykset. Tilan luovutuksia (sk_forest_property_disposals)
  // ei tuoda: vanhassa sovelluksessa niitä ei ole, ja uudessa kirjatut jäävät ennalleen.
  const propertyMap = new Map<string, { id: string; client: string }>();
  for (const p of data.properties) {
    const m = mapProperty(p, data.deductions);
    const client = clientMap.get(m.legacyClientId);
    if (!client) continue;
    const [row] = await tx.query<{ id: string; inserted: boolean }>(
      `insert into sk_forest_properties (organization_id, client_id, name, property_code, area_ha, acquisition_price, acquired_on,
                                         forest_land_share_pct, deduction_used_before, legacy_id, forest_land_ha)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (legacy_id) do update set forest_land_ha = coalesce(sk_forest_properties.forest_land_ha, excluded.forest_land_ha)
       returning id, (xmax = 0) as inserted`,
      [org.id, client, m.name, m.propertyCode, m.areaHa, m.acquisitionPrice, m.acquiredOn, m.forestLandSharePct, m.deductionUsedBefore, m.legacyId,
        m.forestLandHa],
    );
    if (row.inserted) add("metsätiloja");
    propertyMap.set(p.id, { id: row.id, client });
  }
  for (const d of data.deductions) {
    const p = propertyMap.get(d.metsatila_id);
    if (!p) continue;
    touchYear(p.client, d.verovuosi);
    // Lukitustriggeri laukeaa ennen on conflict -tarkistusta, joten suljettu vuosi tarkistetaan ensin.
    const [ex] = await tx.query<{ id: string; amount: string; closed: boolean }>(
      "select id, amount, sk_year_is_closed($3, $2) as closed from sk_forest_deductions where forest_property_id = $1 and tax_year = $2",
      [p.id, d.verovuosi, p.client],
    );
    if (ex) {
      if (!ex.closed && Number(ex.amount) !== Number(d.kaytettava_vahennys)) {
        await tx.query("update sk_forest_deductions set amount = $2 where id = $1", [ex.id, d.kaytettava_vahennys]);
        add("metsävähennyksiä päivitetty");
      }
      continue;
    }
    if (await yearClosed(p.client, d.verovuosi)) {
      add("suljetun vuoden muutos ohitettu");
      continue;
    }
    const ins = await tx.query(
      "insert into sk_forest_deductions (organization_id, forest_property_id, tax_year, amount) values ($1,$2,$3,$4) on conflict do nothing returning id",
      [org.id, p.id, d.verovuosi, d.kaytettava_vahennys],
    );
    add("metsävähennyksiä", ins.length);
  }

  // Vanhan kannan tila vain, jos se kuuluu samalle asiakkaalle. Muuten tila jätetään tyhjäksi.
  const propertyFor = (legacyPropertyId: string | null, client: string) => {
    const p = legacyPropertyId ? propertyMap.get(legacyPropertyId) : undefined;
    return p && p.client === client ? p.id : null;
  };

  // Investoinnit ja poistot. Myydyltä kohteelta puuttuu vanhassa kannassa
  // myyntipäivä, joten se asetetaan viimeisen poistovuoden loppuun (DECISIONS 26.9.2026).
  const assetMap = new Map<string, { id: string; client: string }>();
  for (const a of data.assets) {
    const m = mapAsset(a);
    if (isSkipped(m)) {
      skipped.push(m);
      continue;
    }
    const client = clientMap.get(m.legacyClientId);
    if (!client) continue;
    const years = data.depreciations.filter((d) => d.investointi_id === a.id).map((d) => d.verovuosi);
    const disposedOn = m.disposed ? `${Math.max(Number(m.acquiredOn.slice(0, 4)), ...years)}-12-31` : null;
    if (m.disposed) add("myydyn kohteen päivä pääteltiin");
    const property = propertyFor(m.legacyPropertyId, client);
    const [row] = await tx.query<{ id: string; inserted: boolean }>(
      `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, useful_life_years,
                              declining_rate_pct, opening_book_value, disposed_on, legacy_id, forest_property_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (legacy_id) do update set forest_property_id = coalesce(sk_assets.forest_property_id, excluded.forest_property_id)
       returning id, (xmax = 0) as inserted`,
      [org.id, client, m.description, m.acquiredOn, m.acquisitionCost, m.method, m.usefulLifeYears, m.decliningRatePct, m.openingBookValue,
        disposedOn, m.legacyId, property],
    );
    if (row.inserted) add("investointeja");
    assetMap.set(a.id, { id: row.id, client });
  }
  for (const d of data.depreciations) {
    const a = assetMap.get(d.investointi_id);
    if (!a) continue;
    touchYear(a.client, d.verovuosi);
    const [ex] = await tx.query<{ id: string; amount: string; book_value_end: string; closed: boolean }>(
      "select id, amount, book_value_end, sk_year_is_closed($3, $2) as closed from sk_depreciations where asset_id = $1 and tax_year = $2",
      [a.id, d.verovuosi, a.client],
    );
    const end = d.jaannosarvo_vuoden_lopussa ?? 0;
    if (ex) {
      if (!ex.closed && (Number(ex.amount) !== Number(d.poistomaara) || Number(ex.book_value_end) !== Number(end))) {
        await tx.query("update sk_depreciations set amount = $2, book_value_end = $3 where id = $1", [ex.id, d.poistomaara, end]);
        add("poistoja päivitetty");
      }
      continue;
    }
    if (await yearClosed(a.client, d.verovuosi)) {
      add("suljetun vuoden muutos ohitettu");
      continue;
    }
    const ins = await tx.query(
      "insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1,$2,$3,$4,$5) on conflict do nothing returning id",
      [org.id, a.id, d.verovuosi, d.poistomaara, d.jaannosarvo_vuoden_lopussa ?? 0],
    );
    add("poistoja", ins.length);
  }

  // Kirjaukset
  for (const t of data.transactions) {
    const m = mapTransaction(t);
    if (isSkipped(m)) {
      skipped.push(m);
      continue;
    }
    const client = clientMap.get(m.row.legacyClientId);
    if (!client) continue;
    if (m.categoryGuessed) guessedCategories++;
    const r = m.row;
    touchYear(client, Number(r.bookedOn.slice(0, 4)));
    const property = propertyFor(r.legacyPropertyId, client);
    const [existing] = await tx.query<{ id: string; forest_property_id: string | null; closed: boolean; same: boolean }>(
      `select id, forest_property_id, sk_year_is_closed(client_id, tax_year) as closed,
              (booked_on = $2::date and kind = $3 and category = $4 and description = $5 and amount_gross = $6::numeric
               and vat_rate = $7::numeric and withholding = $8::numeric and reference is not distinct from $9) as same
         from sk_transactions where legacy_id = $1`,
      [r.legacyId, r.bookedOn, r.kind, r.category, r.description, r.amountGross, r.vatRate, r.withholding, r.reference],
    );
    if (existing) {
      const fillProperty = Boolean(property && !existing.forest_property_id);
      if (existing.same && !fillProperty) continue;
      // Suljetun vuoden kirjausta ei voi muuttaa, eikä kirjausta voi siirtää suljetulle vuodelle.
      if (existing.closed || (await yearClosed(client, Number(r.bookedOn.slice(0, 4))))) {
        add(existing.same ? "kirjauksen tila jäi suljetulle vuodelle" : "suljetun vuoden muutos ohitettu");
        continue;
      }
      await tx.query(
        `update sk_transactions set booked_on = $2, kind = $3, category = $4, description = $5, amount_gross = $6, vat_rate = $7, withholding = $8,
                reference = $9, forest_property_id = coalesce(forest_property_id, $10) where id = $1`,
        [existing.id, r.bookedOn, r.kind, r.category, r.description, r.amountGross, r.vatRate, r.withholding, r.reference, property],
      );
      add(existing.same ? "kirjauksen tila täydennetty" : "kirjauksia päivitetty");
      continue;
    }
    if (await yearClosed(client, Number(r.bookedOn.slice(0, 4)))) {
      add("suljetun vuoden muutos ohitettu");
      continue;
    }
    const ins = await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_gross, vat_rate, withholding, reference, legacy_id,
                                    forest_property_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (legacy_id) do nothing returning id`,
      [org.id, client, r.bookedOn, r.kind, r.category, r.description, r.amountGross, r.vatRate, r.withholding, r.reference, r.legacyId, property],
    );
    add("kirjauksia", ins.length);
  }

  // Vanhasta kannasta poistetut kirjaukset pois avoimilta vuosilta. Vain vanhasta
  // tuodut rivit (legacy_id), jotta uudessa sovelluksessa tehdyt kirjaukset säilyvät.
  // Tositteet jäävät talteen ilman kirjausta (viiteavain nollautuu).
  const legacyIds = data.transactions.map((t) => t.id);
  const clientIds = [...new Set(clientMap.values())];
  if (clientIds.length) {
    const removed = await tx.query<{ closed: boolean }>(
      `select sk_year_is_closed(client_id, tax_year) as closed from sk_transactions
        where client_id = any($1) and legacy_id is not null and not (legacy_id = any($2::uuid[]))`,
      [clientIds, legacyIds],
    );
    const del = await tx.query(
      `delete from sk_transactions
        where client_id = any($1) and legacy_id is not null and not (legacy_id = any($2::uuid[]))
          and not sk_year_is_closed(client_id, tax_year)
       returning id`,
      [clientIds, legacyIds],
    );
    add("kirjauksia poistettu", del.length);
    add("suljetun vuoden muutos ohitettu", removed.filter((x) => x.closed).length);
  }

  // Arkiston liitteet tositteiksi
  for (const a of data.archive) {
    const client = clientMap.get(a.asiakas_id);
    if (!client || !a.liite_data) continue;
    const base64 = a.liite_data.replace(/^data:[^,]*,/, "");
    const contentType = a.liite_data.match(/^data:([^;,]+)/)?.[1] ?? "application/octet-stream";
    const body = Buffer.from(base64, "base64");
    const name = a.liite_nimi ?? "liite";
    const storagePath = documentPath(org.id, client, a.verovuosi, `legacy-${a.id}`, name);
    const ins = await tx.query(
      `insert into sk_documents (organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path)
       values ($1,$2,$3,'receipt',$4,$5,$6,$7) on conflict (storage_path) do nothing returning id`,
      [org.id, client, a.verovuosi, name, contentType, body.length, storagePath],
    );
    if (ins.length) {
      files.push({ path: storagePath, body, contentType });
      add("liitteitä");
    }
    touchYear(client, a.verovuosi);
  }

  // Verovuodet viimeisenä: suljettu vuosi estää rivien lisäämisen (migraatio 0002).
  for (const [client, openYear] of openYears) {
    for (const y of taxYears(openYear, [...(yearsByClient.get(client) ?? [])])) {
      const ins = await tx.query(
        `insert into sk_tax_years (organization_id, client_id, year, status, closed_at)
         values ($1,$2,$3,$4,$5) on conflict (client_id, year) do nothing returning id`,
        [org.id, client, y.year, y.closed ? "closed" : "open", y.closed ? new Date().toISOString() : null],
      );
      add(y.closed ? "suljettuja vuosia" : "avoimia vuosia", ins.length);
    }
  }

  await tx.query(
    "insert into sk_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'import.legacy', 'sk_organizations', $1, $2)",
    [org.id, JSON.stringify({ counts, skipped: skipped.length, run: randomUUID() })],
  );

  return { counts, skipped, guessedCategories, files };
}
