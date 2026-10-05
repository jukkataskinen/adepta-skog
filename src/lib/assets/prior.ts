import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { ASSET_CLASS_PCTS, parseAgriAssetChoice, type Activity } from "@/lib/tax/rules";

/**
 * Aiemmin hankittu investointi: tie, oja, kone tai rakennus, joka on hankittu
 * ennen kuin asiakas tuli Skogiin (DECISIONS 28.9.2026, migraatio 0014).
 *
 * Kirjanpitäjä antaa kohteen hankintahinnan ja kertyneen poiston vuoden X
 * loppuun. Menojäännös lasketaan niistä, ja poistot alkavat vuodesta X + 1.
 * Kanta varmistaa saman säännön (sk_assets_prior) ja estää muutokset, kun
 * ensimmäinen poistovuosi on suljettu (sk_check_prior_asset_year_open).
 */

/** Käyttäjälle näytettävä virhe. Heitetään, jotta transaktio perutaan. */
export class PriorAssetError extends Error {}

export interface Actor {
  organizationId: string;
  userId: string;
}

export interface PriorAssetInput {
  description: string;
  /** Metsätalous: menojäännöspoiston enimmäisprosentti, joka kertoo myös lajin (ASSET_CLASSES). */
  ratePct: number;
  /**
   * Maatalous: poistoryhmän valinta (rules.ts agriAssetChoices). Kun annettu,
   * investointi on maataloutta ja prosentti tulee ryhmästä. Koneet voi antaa
   * yhtenä rivinä, koska maatalouden koneilla on yhteinen menojäännös.
   */
  agriChoice?: string | null;
  /** Vuosi X: kertynyt poisto ja menojäännös ovat tämän vuoden lopussa. */
  balanceYear: number;
  /** Hankintapäivä; tyhjä = vuoden X viimeinen päivä. */
  acquiredOn: string | null;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  forestPropertyId: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Menojäännös vuoden X lopussa: hankintahinta miinus kertynyt poisto. */
export function priorBookValue(acquisitionCost: number, accumulatedDepreciation: number): number {
  return round2(acquisitionCost - accumulatedDepreciation);
}

/**
 * Hankintavuosi tai -päivä lomakkeelta: "2019", "1.5.2019" tai "2019-05-01".
 * Pelkkä vuosi tallennetaan vuoden viimeiseksi päiväksi. Palauttaa null, jos
 * kenttä on tyhjä, ja undefined, jos muoto on väärä.
 */
export function parseAcquired(value: string | null | undefined): string | null | undefined {
  const v = (value ?? "").trim();
  if (!v) return null;
  let m = /^(\d{4})$/.exec(v);
  if (m) return `${m[1]}-12-31`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) ?? null;
  let iso: string | null = m ? v : null;
  if (!iso) {
    const f = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
    if (f) iso = `${f[3]}-${f[2].padStart(2, "0")}-${f[1].padStart(2, "0")}`;
  }
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/** Tarkistukset ennen tallennusta. Samat säännöt ovat kannassa, mutta tästä tulee selkeä viesti. */
export function validatePriorAsset(input: PriorAssetInput): string | null {
  if (!input.description.trim()) return "Anna investoinnin kuvaus.";
  if (input.agriChoice) {
    if (!parseAgriAssetChoice(input.agriChoice, input.balanceYear + 1)) return "Valitse maatalouden poistoryhmä. Korotettu poisto koskee vain vuosia 2020–2025.";
  } else if (!ASSET_CLASS_PCTS.includes(input.ratePct)) return "Valitse investoinnin laji.";
  if (!Number.isInteger(input.balanceYear) || input.balanceYear < 1950 || input.balanceYear > 2100) return "Tarkista menojäännöksen vuosi.";
  if (!(input.acquisitionCost > 0)) return "Anna hankintahinta.";
  if (!(input.accumulatedDepreciation >= 0)) return "Anna kertynyt poisto. Jos poistoja ei ole tehty, kirjoita 0.";
  if (input.accumulatedDepreciation > input.acquisitionCost) return "Kertynyt poisto voi olla enintään hankintahinta.";
  const acquired = input.acquiredOn ?? `${input.balanceYear}-12-31`;
  if (Number(acquired.slice(0, 4)) > input.balanceYear) return `Hankinnan pitää olla viimeistään vuonna ${input.balanceYear}, koska menojäännös on vuoden ${input.balanceYear} lopussa.`;
  return null;
}

async function assertOpen(tx: Sql, clientId: string, year: number) {
  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (y?.status === "closed") throw new PriorAssetError(`Verovuosi ${year} on suljettu, joten investoinnin lähtötietoja ei voi muuttaa. Pääkäyttäjä voi avata vuoden.`);
}

export interface PriorAssetRow {
  id: string;
  description: string;
  acquired_on: string;
  acquisition_cost: string;
  declining_rate_pct: string;
  opening_year: number;
  opening_accumulated_depreciation: string;
  opening_book_value: string;
  forest_property_id: string | null;
  disposed_on: string | null;
  activity: Activity;
  asset_class: string | null;
  accelerated: boolean;
  /** Ensimmäinen poistovuosi on suljettu: lähtötietoja ei voi muuttaa. */
  locked: boolean;
}

export async function getPriorAsset(tx: Sql, clientId: string, assetId: string): Promise<PriorAssetRow | null> {
  const [row] = await tx.query<PriorAssetRow>(
    `select id, description, acquired_on::text, acquisition_cost, declining_rate_pct, opening_year, opening_accumulated_depreciation, opening_book_value,
            forest_property_id, disposed_on::text, activity, asset_class, accelerated, sk_year_is_closed(client_id, opening_year) as locked
       from sk_assets where id = $1 and client_id = $2 and opening_year is not null`,
    [assetId, clientId],
  );
  return row ?? null;
}

/** Lisää tai muuttaa aiemman investoinnin. Palauttaa tunnisteen ja poistettujen vahvistettujen poistojen määrän. */
export async function savePriorAsset(
  tx: Sql, actor: Actor, clientId: string, input: PriorAssetInput, assetId?: string | null,
): Promise<{ id: string; removedDepreciations: number }> {
  const error = validatePriorAsset(input);
  if (error) throw new PriorAssetError(error);
  const openingYear = input.balanceYear + 1;
  const bookValue = priorBookValue(input.acquisitionCost, input.accumulatedDepreciation);
  const acquiredOn = input.acquiredOn ?? `${input.balanceYear}-12-31`;
  await assertOpen(tx, clientId, openingYear);
  // Maatalouden investointi: ryhmä, korotettu poisto ja ryhmän prosentti. Metsätilaa ei ole.
  const agri = input.agriChoice ? parseAgriAssetChoice(input.agriChoice, openingYear) : null;
  const ratePct = agri ? agri.pct : input.ratePct;
  const kind = agri
    ? { activity: "agriculture", assetClass: agri.assetClass, accelerated: agri.accelerated, propertyId: null }
    : { activity: "forestry", assetClass: null, accelerated: false, propertyId: input.forestPropertyId };
  const values = [
    input.description.trim(), acquiredOn, input.acquisitionCost, ratePct, bookValue, openingYear, input.accumulatedDepreciation, kind.propertyId, kind.activity,
    kind.assetClass, kind.accelerated,
  ];

  if (!assetId) {
    const [row] = await tx.query<{ id: string }>(
      `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_book_value,
                              opening_year, opening_accumulated_depreciation, forest_property_id, activity, asset_class, accelerated)
       values ($1, $2, $3, $4, $5, 'declining_balance', $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [actor.organizationId, clientId, ...values],
    );
    await audit(tx, {
      organizationId: actor.organizationId, userId: actor.userId, action: "asset.prior.create", entity: "sk_assets", entityId: row.id,
      details: { openingYear, ratePct, activity: kind.activity, assetClass: kind.assetClass },
    });
    return { id: row.id, removedDepreciations: 0 };
  }

  const prev = await getPriorAsset(tx, clientId, assetId);
  if (!prev) throw new PriorAssetError("Investointia ei löytynyt.");
  if (prev.locked) await assertOpen(tx, clientId, prev.opening_year);
  if (prev.disposed_on && prev.disposed_on < acquiredOn) throw new PriorAssetError("Investointi on myyty ennen tätä hankintapäivää.");
  // Vahvistetut poistot on laskettu vanhasta menojäännöksestä. Jos arvo tai
  // laji muuttuu, ne poistetaan, ja verosuunnitelma vahvistetaan uudelleen.
  const valueChanged =
    Number(prev.acquisition_cost) !== input.acquisitionCost || Number(prev.opening_accumulated_depreciation) !== input.accumulatedDepreciation ||
    Number(prev.declining_rate_pct) !== ratePct || Number(prev.opening_year) !== openingYear || prev.asset_class !== kind.assetClass ||
    prev.accelerated !== kind.accelerated;
  let removed = 0;
  if (valueChanged) {
    const rows = await tx.query("delete from sk_depreciations where asset_id = $1 returning id", [assetId]);
    removed = rows.length;
  }
  await tx.query(
    `update sk_assets set description = $3, acquired_on = $4, acquisition_cost = $5, declining_rate_pct = $6, opening_book_value = $7,
            opening_year = $8, opening_accumulated_depreciation = $9, forest_property_id = $10, activity = $11, asset_class = $12, accelerated = $13
      where id = $1 and client_id = $2`,
    [assetId, clientId, ...values],
  );
  await audit(tx, {
    organizationId: actor.organizationId, userId: actor.userId, action: "asset.prior.update", entity: "sk_assets", entityId: assetId,
    details: { openingYear, ratePct, activity: kind.activity, assetClass: kind.assetClass, depreciationsRemoved: removed },
  });
  return { id: assetId, removedDepreciations: removed };
}

export async function deletePriorAsset(tx: Sql, actor: Actor, clientId: string, assetId: string): Promise<void> {
  const prev = await getPriorAsset(tx, clientId, assetId);
  if (!prev) throw new PriorAssetError("Investointia ei löytynyt.");
  if (prev.disposed_on) throw new PriorAssetError("Investointi on myyty. Poista ensin myyntikirjaus kirjanpidosta.");
  await assertOpen(tx, clientId, prev.opening_year);
  // Vahvistetut poistot poistuvat investoinnin mukana; suljetun vuoden poisto estää poiston kannassa.
  await tx.query("delete from sk_assets where id = $1 and client_id = $2", [assetId, clientId]);
  await audit(tx, {
    organizationId: actor.organizationId, userId: actor.userId, action: "asset.prior.delete", entity: "sk_assets", entityId: assetId,
    details: { openingYear: prev.opening_year },
  });
}

export interface ClientAssetRow {
  id: string;
  description: string;
  acquired_on: string;
  acquisition_cost: string;
  method: "straight_line" | "declining_balance";
  declining_rate_pct: string | null;
  opening_year: number | null;
  opening_accumulated_depreciation: string | null;
  opening_book_value: string | null;
  disposed_on: string | null;
  sale_price: string | null;
  useful_life_years: number | null;
  legacy_id: string | null;
  property_name: string | null;
  /** Kirjatut poistot vuosittain (metsätalous). */
  deps: { taxYear: number; amount: string; bookValueEnd: string }[] | null;
  activity: Activity;
  asset_class: string | null;
  accelerated: boolean;
  locked: boolean;
}

/** Asiakkaan kaikki investoinnit Investoinnit-sivulle. */
export async function listClientAssets(tx: Sql, clientId: string): Promise<ClientAssetRow[]> {
  return tx.query<ClientAssetRow>(
    `select a.id, a.description, a.acquired_on::text, a.acquisition_cost, a.method, a.declining_rate_pct, a.opening_year,
            a.opening_accumulated_depreciation, a.opening_book_value, a.disposed_on::text, a.sale_price, a.useful_life_years, a.legacy_id,
            p.name as property_name,
            (select json_agg(json_build_object('taxYear', d.tax_year, 'amount', d.amount, 'bookValueEnd', d.book_value_end)) from sk_depreciations d
              where d.asset_id = a.id) as deps,
            a.activity, a.asset_class, a.accelerated,
            coalesce(sk_year_is_closed(a.client_id, a.opening_year), false) as locked
       from sk_assets a left join sk_forest_properties p on p.id = a.forest_property_id
      where a.client_id = $1
      order by a.activity, a.disposed_on nulls first, a.acquired_on desc, a.description`,
    [clientId],
  );
}
