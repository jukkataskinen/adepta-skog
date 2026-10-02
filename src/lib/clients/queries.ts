import type { Sql } from "@/lib/db/types";
import { forestDeductionBase, type ForestDeductionBase } from "@/lib/tax/forest-deduction";

/**
 * Asiakkaiden ja metsätilojen kyselyt. Ajetaan aina käyttäjän
 * RLS-transaktiossa (ctx.run), joten kirjanpitäjä saa vain vastuuasiakkaansa
 * ilman erillistä rajausta tässä.
 */

export interface ClientListRow {
  id: string;
  name: string;
  municipality: string | null;
  vat_registered: boolean;
  responsible_name: string | null;
  property_count: number;
  open_year: number | null;
  archived: boolean;
}

export async function listClients(tx: Sql, orgId: string, opts: { q?: string; archived?: boolean } = {}): Promise<ClientListRow[]> {
  const q = opts.q?.trim();
  return tx.query<ClientListRow>(
    `select c.id, c.last_name || ', ' || c.first_name as name, c.municipality, c.vat_registered,
            coalesce(u.full_name, u.email) as responsible_name,
            (select count(*)::int from sk_forest_properties p where p.client_id = c.id) as property_count,
            (select max(y.year)::int from sk_tax_years y where y.client_id = c.id and y.status = 'open') as open_year,
            c.archived_at is not null as archived
       from sk_clients c
       left join sk_users u on u.id = c.responsible_user_id
      where c.organization_id = $1
        and (c.archived_at is null) = not $2
        and ($3::text is null or c.first_name || ' ' || c.last_name ilike '%' || $3 || '%' or c.last_name || ' ' || c.first_name ilike '%' || $3 || '%'
             or c.business_id ilike '%' || $3 || '%' or c.municipality ilike '%' || $3 || '%')
      order by c.last_name, c.first_name
      limit 500`,
    [orgId, opts.archived === true, q || null],
  );
}

export interface ClientDetail {
  id: string;
  first_name: string;
  last_name: string;
  business_id: string | null;
  municipality: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  tax_account_reference: string | null;
  vat_registered: boolean;
  vat_number: string | null;
  /** Toiminnot (0015): maatalouden luokat ja sivut näkyvät vain, kun has_agriculture. */
  has_forestry: boolean;
  has_agriculture: boolean;
  responsible_user_id: string | null;
  responsible_name: string | null;
  archived_at: string | null;
}

export async function getClient(tx: Sql, orgId: string, id: string): Promise<ClientDetail | null> {
  const [row] = await tx.query<ClientDetail>(
    `select c.id, c.first_name, c.last_name, c.business_id, c.municipality, c.email, c.phone, c.street, c.postal_code, c.city,
            c.tax_account_reference, c.vat_registered, c.vat_number, c.has_forestry, c.has_agriculture, c.responsible_user_id,
            coalesce(u.full_name, u.email) as responsible_name, c.archived_at
       from sk_clients c left join sk_users u on u.id = c.responsible_user_id
      where c.id = $1 and c.organization_id = $2`,
    [id, orgId],
  );
  return row ?? null;
}

export interface PropertyRow {
  id: string;
  name: string;
  property_code: string | null;
  area_ha: string | null;
  acquisition_price: string | null;
  acquired_on: string | null;
  forest_land_share_pct: string | null;
  forest_land_ha: string | null;
  deduction_used_before: string;
  /** Myyty osuus tilan hankintamenosta, prosentteina (0–100). */
  sold_share_pct: number;
  deduction: ForestDeductionBase;
}

const n = (v: string | null) => (v === null ? null : Number(v));
// Metsävähennyksen prosentti riippuu vuodesta, joten tilan pohja näytetään kuluvan vuoden säännöillä.
const currentYear = () => Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Helsinki", year: "numeric" }).format(new Date()));

export async function listProperties(tx: Sql, clientId: string): Promise<PropertyRow[]> {
  const rows = await tx.query<Omit<PropertyRow, "deduction"> & { recorded: string[] | null }>(
    `select p.id, p.name, p.property_code, p.area_ha, p.acquisition_price, p.acquired_on::text, p.forest_land_share_pct, p.forest_land_ha, p.deduction_used_before,
            (select coalesce(sum(x.share_pct), 0)::float8 from sk_forest_property_disposals x where x.forest_property_id = p.id) as sold_share_pct,
            (select array_agg(d.amount::text) from sk_forest_deductions d where d.forest_property_id = p.id) as recorded
       from sk_forest_properties p where p.client_id = $1 order by p.name`,
    [clientId],
  );
  return rows.map(({ recorded, ...p }) => ({
    ...p,
    sold_share_pct: Number(p.sold_share_pct),
    // Myyty osuus ei tuo pohjaa: pohja lasketaan jäljellä olevasta hankintamenosta.
    deduction: forestDeductionBase({
      acquisitionPrice: p.acquisition_price === null ? null : (Number(p.acquisition_price) * (100 - Number(p.sold_share_pct))) / 100,
      forestLandSharePct: n(p.forest_land_share_pct),
      usedBefore: Number(p.deduction_used_before),
      recorded: (recorded ?? []).map(Number),
    }, currentYear()),
  }));
}

export async function getProperty(tx: Sql, clientId: string, id: string) {
  const [row] = await tx.query<Omit<PropertyRow, "deduction" | "sold_share_pct">>(
    `select id, name, property_code, area_ha, acquisition_price, acquired_on::text, forest_land_share_pct, forest_land_ha, deduction_used_before
       from sk_forest_properties where id = $1 and client_id = $2`,
    [id, clientId],
  );
  return row ?? null;
}

export interface DisposalRow {
  id: string;
  disposed_on: string;
  tax_year: number;
  sale_price: string;
  share_pct: string;
  selling_costs: string;
  no_deduction_addition: boolean;
  note: string | null;
  /** Luovutusvuoden tila: null, jos vuotta ei ole avattu. */
  year_status: "open" | "closed" | null;
}

export async function listDisposals(tx: Sql, clientId: string, propertyId: string): Promise<DisposalRow[]> {
  return tx.query<DisposalRow>(
    `select d.id, d.disposed_on::text, d.tax_year, d.sale_price, d.share_pct, d.selling_costs, d.no_deduction_addition, d.note, y.status as year_status
       from sk_forest_property_disposals d
       left join sk_tax_years y on y.client_id = d.client_id and y.year = d.tax_year
      where d.client_id = $1 and d.forest_property_id = $2
      order by d.disposed_on, d.created_at`,
    [clientId, propertyId],
  );
}

export interface TaxYearRow {
  id: string;
  year: number;
  status: "open" | "closed";
  closed_at: string | null;
  closed_by_name: string | null;
  transaction_count: number;
}

export async function listTaxYears(tx: Sql, clientId: string): Promise<TaxYearRow[]> {
  return tx.query<TaxYearRow>(
    `select y.id, y.year, y.status, y.closed_at, coalesce(u.full_name, u.email) as closed_by_name,
            (select count(*)::int from sk_transactions t where t.client_id = y.client_id and t.tax_year = y.year) as transaction_count
       from sk_tax_years y left join sk_users u on u.id = y.closed_by
      where y.client_id = $1 order by y.year desc`,
    [clientId],
  );
}

/** Toimiston käytössä olevat jäsenet vastuukirjanpitäjän valintaan. */
export async function listResponsibleOptions(tx: Sql, orgId: string): Promise<{ id: string; name: string }[]> {
  return tx.query(
    `select u.id, coalesce(u.full_name, u.email) as name from sk_org_members m join sk_users u on u.id = m.user_id
      where m.organization_id = $1 and m.deactivated_at is null order by name`,
    [orgId],
  );
}
