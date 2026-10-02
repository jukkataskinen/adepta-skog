import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { AGRI_POOLS, type AgriPool } from "@/lib/tax/agri-depreciation";
import { loadAgriDepreciation } from "@/lib/tax/agri-load";
import { validateExtra } from "@/lib/filing/vsy002-fields";

/**
 * Maatalouden vuoden tiedot: lomakkeen 2 tiedot, joita ei saa kirjauksista
 * (migraatio 0015). Kaikki käyttäjän RLS-transaktiossa, ja jokainen muutos
 * kirjataan lokiin samassa transaktiossa. Suljetun vuoden lukitus on kannassa.
 *
 * Tasausvaraukset, kotieläinten jaksotukset ja investointituet syötetään
 * käsin (Jukan päätös 2.10.2026); laskurit tehdään myöhemmin.
 */

/** Käyttäjälle näytettävä virhe. Heitetään, jotta transaktio perutaan. */
export class AgriError extends Error {}

export interface Actor {
  organizationId: string;
  userId: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: string | null) => (v === null ? null : Number(v));

// ---------------------------------------------------------------------------
// Vuoden tiedot
// ---------------------------------------------------------------------------

export interface AgriYear {
  spouseWealthSharePct: number | null;
  spouseWorkSharePct: number | null;
  incomeSplitClaim: "ten" | "earned" | null;
  lossToCapitalIncome: number | null;
  wagesSubjectToWithholding: number;
  landValue: number | null;
  rentalDwellingsValue: number | null;
  sharesValue: number | null;
  otherAssetsValue: number | null;
  liabilities: number | null;
  otherFarmAssets: number | null;
  priorNetWealth: number | null;
  confirmedLossesCarried: number;
}

export const EMPTY_AGRI_YEAR: AgriYear = {
  spouseWealthSharePct: null, spouseWorkSharePct: null, incomeSplitClaim: null, lossToCapitalIncome: null, wagesSubjectToWithholding: 0, landValue: null,
  rentalDwellingsValue: null, sharesValue: null, otherAssetsValue: null, liabilities: null, otherFarmAssets: null, priorNetWealth: null, confirmedLossesCarried: 0,
};

export async function getAgriYear(tx: Sql, clientId: string, year: number): Promise<AgriYear> {
  const [r] = await tx.query<{
    spouse_wealth_share_pct: string | null; spouse_work_share_pct: string | null; income_split_claim: "ten" | "earned" | null; loss_to_capital_income: string | null;
    wages_subject_to_withholding: string; land_value: string | null; rental_dwellings_value: string | null; shares_value: string | null; other_assets_value: string | null;
    liabilities: string | null; other_farm_assets: string | null; prior_net_wealth: string | null; confirmed_losses_carried: string;
  }>("select * from sk_agri_years where client_id = $1 and tax_year = $2", [clientId, year]);
  if (!r) return EMPTY_AGRI_YEAR;
  return {
    spouseWealthSharePct: num(r.spouse_wealth_share_pct), spouseWorkSharePct: num(r.spouse_work_share_pct), incomeSplitClaim: r.income_split_claim,
    lossToCapitalIncome: num(r.loss_to_capital_income), wagesSubjectToWithholding: Number(r.wages_subject_to_withholding), landValue: num(r.land_value),
    rentalDwellingsValue: num(r.rental_dwellings_value), sharesValue: num(r.shares_value), otherAssetsValue: num(r.other_assets_value), liabilities: num(r.liabilities),
    otherFarmAssets: num(r.other_farm_assets), priorNetWealth: num(r.prior_net_wealth), confirmedLossesCarried: Number(r.confirmed_losses_carried),
  };
}

export async function saveAgriYear(tx: Sql, actor: Actor, clientId: string, year: number, y: AgriYear): Promise<void> {
  // Puolison osuudet annetaan pareittain: lomakkeella yrittäjän ja puolison osuudet ovat yhteensä 100 % (#38, #39).
  if ((y.spouseWealthSharePct === null) !== (y.spouseWorkSharePct === null)) {
    throw new AgriError("Anna puolison osuus sekä nettovarallisuudesta että työskentelystä, tai jätä molemmat tyhjiksi.");
  }
  await tx.query(
    `insert into sk_agri_years (organization_id, client_id, tax_year, spouse_wealth_share_pct, spouse_work_share_pct, income_split_claim, loss_to_capital_income,
                                wages_subject_to_withholding, land_value, rental_dwellings_value, shares_value, other_assets_value, liabilities, other_farm_assets,
                                prior_net_wealth, confirmed_losses_carried)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     on conflict (client_id, tax_year) do update set
       spouse_wealth_share_pct = excluded.spouse_wealth_share_pct, spouse_work_share_pct = excluded.spouse_work_share_pct,
       income_split_claim = excluded.income_split_claim, loss_to_capital_income = excluded.loss_to_capital_income,
       wages_subject_to_withholding = excluded.wages_subject_to_withholding, land_value = excluded.land_value,
       rental_dwellings_value = excluded.rental_dwellings_value, shares_value = excluded.shares_value, other_assets_value = excluded.other_assets_value,
       liabilities = excluded.liabilities, other_farm_assets = excluded.other_farm_assets, prior_net_wealth = excluded.prior_net_wealth,
       confirmed_losses_carried = excluded.confirmed_losses_carried`,
    [
      actor.organizationId, clientId, year, y.spouseWealthSharePct, y.spouseWorkSharePct, y.incomeSplitClaim, y.lossToCapitalIncome, y.wagesSubjectToWithholding,
      y.landValue, y.rentalDwellingsValue, y.sharesValue, y.otherAssetsValue, y.liabilities, y.otherFarmAssets, y.priorNetWealth, y.confirmedLossesCarried,
    ],
  );
  // Lokiin vain se, että tiedot tallennettiin: luvut ovat asiakkaan taloustietoja.
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.year.save", entity: "sk_agri_years", details: { clientId, year } });
}

// ---------------------------------------------------------------------------
// Maatilat
// ---------------------------------------------------------------------------

export interface FarmRow {
  id: string;
  name: string;
  farm_code: string | null;
}

export async function listFarms(tx: Sql, clientId: string): Promise<FarmRow[]> {
  return tx.query<FarmRow>("select id, name, farm_code from sk_farms where client_id = $1 order by name", [clientId]);
}

export async function addFarm(tx: Sql, actor: Actor, clientId: string, name: string, farmCode: string | null): Promise<void> {
  const [r] = await tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name, farm_code) values ($1, $2, $3, $4) returning id", [
    actor.organizationId, clientId, name.trim(), farmCode?.trim() || null,
  ]);
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.farm.create", entity: "sk_farms", entityId: r.id });
}

export async function deleteFarm(tx: Sql, actor: Actor, clientId: string, farmId: string): Promise<void> {
  const rows = await tx.query("delete from sk_farms where id = $1 and client_id = $2 returning id", [farmId, clientId]);
  if (!rows.length) throw new AgriError("Maatilaa ei löytynyt.");
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.farm.delete", entity: "sk_farms", entityId: farmId });
}

// ---------------------------------------------------------------------------
// Varaukset
// ---------------------------------------------------------------------------

export interface ReserveUseRow {
  id: string;
  tax_year: number;
  use_kind: "asset" | "income";
  asset_description: string | null;
  amount: number;
}

export interface ReserveRow {
  id: string;
  kind: "equalization" | "replacement";
  made_year: number;
  amount: number;
  farm_name: string | null;
  note: string | null;
  uses: ReserveUseRow[];
  /** Purkamaton määrä verovuoden lopussa: tehty − vuoden loppuun mennessä käytetty. */
  remaining: number;
}

export async function listReserves(tx: Sql, clientId: string, year: number): Promise<ReserveRow[]> {
  const rows = await tx.query<{ id: string; kind: "equalization" | "replacement"; made_year: number; amount: string; farm_name: string | null; note: string | null }>(
    `select r.id, r.kind, r.made_year, r.amount, f.name as farm_name, r.note
       from sk_agri_reserves r left join sk_farms f on f.id = r.farm_id
      where r.client_id = $1 and r.made_year <= $2 order by r.kind, r.made_year, r.created_at`,
    [clientId, year],
  );
  const uses = await tx.query<{ id: string; reserve_id: string; tax_year: number; use_kind: "asset" | "income"; asset_description: string | null; amount: string }>(
    `select u.id, u.reserve_id, u.tax_year, u.use_kind, a.description as asset_description, u.amount
       from sk_agri_reserve_uses u left join sk_assets a on a.id = u.asset_id
      where u.client_id = $1 and u.tax_year <= $2 order by u.tax_year, u.created_at`,
    [clientId, year],
  );
  return rows
    .map((r) => {
      const own = uses.filter((u) => u.reserve_id === r.id).map((u) => ({ id: u.id, tax_year: Number(u.tax_year), use_kind: u.use_kind, asset_description: u.asset_description, amount: Number(u.amount) }));
      return { ...r, made_year: Number(r.made_year), amount: Number(r.amount), uses: own, remaining: round2(Number(r.amount) - own.reduce((s, u) => s + u.amount, 0)) };
    })
    // Kokonaan käytetyt aiempien vuosien varaukset jäävät pois, jotta lista pysyy lyhyenä.
    .filter((r) => r.remaining > 0 || r.made_year === year || r.uses.some((u) => u.tax_year === year));
}

export async function addReserve(
  tx: Sql, actor: Actor, clientId: string, r: { kind: "equalization" | "replacement"; madeYear: number; amount: number; farmId: string | null; note: string | null },
): Promise<void> {
  const [row] = await tx.query<{ id: string }>(
    "insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount, note) values ($1,$2,$3,$4,$5,$6,$7) returning id",
    [actor.organizationId, clientId, r.farmId, r.kind, r.madeYear, r.amount, r.note],
  );
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.create", entity: "sk_agri_reserves", entityId: row.id, details: { kind: r.kind, madeYear: r.madeYear } });
}

export async function deleteReserve(tx: Sql, actor: Actor, clientId: string, id: string): Promise<void> {
  // Käytöt poistuvat varauksen mukana; suljetun vuoden käyttö estää poiston kannassa.
  const rows = await tx.query("delete from sk_agri_reserves where id = $1 and client_id = $2 returning id", [id, clientId]);
  if (!rows.length) throw new AgriError("Varausta ei löytynyt.");
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.delete", entity: "sk_agri_reserves", entityId: id });
}

export async function addReserveUse(
  tx: Sql, actor: Actor, clientId: string, u: { reserveId: string; year: number; useKind: "asset" | "income"; assetId: string | null; amount: number },
): Promise<void> {
  if (u.useKind === "asset" && !u.assetId) throw new AgriError("Valitse investointi, johon varaus käytettiin.");
  if (u.assetId) {
    const [a] = await tx.query<{ activity: string }>("select activity from sk_assets where id = $1 and client_id = $2", [u.assetId, clientId]);
    if (a?.activity !== "agriculture") throw new AgriError("Valitse maatalouden investointi.");
  }
  try {
    const [row] = await tx.query<{ id: string }>(
      "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, asset_id, amount) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [actor.organizationId, clientId, u.reserveId, u.year, u.useKind, u.useKind === "asset" ? u.assetId : null, u.amount],
    );
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.use", entity: "sk_agri_reserve_uses", entityId: row.id, details: { year: u.year, useKind: u.useKind } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/enemmän kuin se on/.test(msg)) throw new AgriError("Varauksesta käytettäisiin enemmän kuin sitä on jäljellä.");
    if (/ennen sen tekovuotta/.test(msg)) throw new AgriError("Varausta ei voi käyttää ennen vuotta, jolta se on tehty.");
    throw err;
  }
}

export async function deleteReserveUse(tx: Sql, actor: Actor, clientId: string, id: string): Promise<void> {
  const rows = await tx.query("delete from sk_agri_reserve_uses where id = $1 and client_id = $2 returning id", [id, clientId]);
  if (!rows.length) throw new AgriError("Varauksen käyttöä ei löytynyt.");
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.use.delete", entity: "sk_agri_reserve_uses", entityId: id });
}

// ---------------------------------------------------------------------------
// Kotieläinten jaksotukset
// ---------------------------------------------------------------------------

export interface DeferralRow {
  id: string;
  tax_year: number;
  kind: "livestock_sale" | "livestock_purchase";
  amount: number;
  year1: number;
  year2: number;
  year3: number;
  note: string | null;
}

/** Tasaerät kolmelle vuodelle senteissä; ensimmäinen vuosi saa pyöristyksen erotuksen. */
export function deferralThirds(amount: number): [number, number, number] {
  const c = Math.round(amount * 100);
  const third = Math.floor(c / 3);
  return [(c - 2 * third) / 100, third / 100, third / 100];
}

export async function listDeferrals(tx: Sql, clientId: string, year: number): Promise<DeferralRow[]> {
  const rows = await tx.query<{ id: string; tax_year: number; kind: DeferralRow["kind"]; amount: string; year1: string; year2: string; year3: string; note: string | null }>(
    "select id, tax_year, kind, amount, year1, year2, year3, note from sk_agri_deferrals where client_id = $1 and tax_year between $2 - 2 and $2 order by tax_year, kind",
    [clientId, year],
  );
  return rows.map((r) => ({ ...r, tax_year: Number(r.tax_year), amount: Number(r.amount), year1: Number(r.year1), year2: Number(r.year2), year3: Number(r.year3) }));
}

export async function addDeferral(
  tx: Sql, actor: Actor, clientId: string, d: { year: number; kind: DeferralRow["kind"]; amount: number; split: [number, number, number] | null; note: string | null },
): Promise<void> {
  const [y1, y2, y3] = d.split ?? deferralThirds(d.amount);
  if (Math.round((y1 + y2 + y3) * 100) !== Math.round(d.amount * 100)) throw new AgriError("Vuosien osien summan on oltava sama kuin jaksotettava määrä.");
  const [row] = await tx.query<{ id: string }>(
    "insert into sk_agri_deferrals (organization_id, client_id, tax_year, kind, amount, year1, year2, year3, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id",
    [actor.organizationId, clientId, d.year, d.kind, d.amount, y1, y2, y3, d.note],
  );
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.deferral.create", entity: "sk_agri_deferrals", entityId: row.id, details: { year: d.year, kind: d.kind } });
}

export async function deleteDeferral(tx: Sql, actor: Actor, clientId: string, id: string): Promise<void> {
  const rows = await tx.query("delete from sk_agri_deferrals where id = $1 and client_id = $2 returning id", [id, clientId]);
  if (!rows.length) throw new AgriError("Jaksotusta ei löytynyt.");
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.deferral.delete", entity: "sk_agri_deferrals", entityId: id });
}

// ---------------------------------------------------------------------------
// Investointituet
// ---------------------------------------------------------------------------

export interface GrantRow {
  id: string;
  asset_description: string;
  amount: number;
  note: string | null;
}

export async function listGrants(tx: Sql, clientId: string, year: number): Promise<GrantRow[]> {
  const rows = await tx.query<{ id: string; asset_description: string; amount: string; note: string | null }>(
    `select g.id, a.description as asset_description, g.amount, g.note from sk_asset_adjustments g join sk_assets a on a.id = g.asset_id
      where g.client_id = $1 and g.tax_year = $2 order by g.created_at`,
    [clientId, year],
  );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

export async function addGrant(tx: Sql, actor: Actor, clientId: string, g: { assetId: string; year: number; amount: number; note: string | null }): Promise<void> {
  const [a] = await tx.query<{ activity: string }>("select activity from sk_assets where id = $1 and client_id = $2", [g.assetId, clientId]);
  if (a?.activity !== "agriculture") throw new AgriError("Valitse maatalouden investointi.");
  const [row] = await tx.query<{ id: string }>(
    "insert into sk_asset_adjustments (organization_id, client_id, asset_id, tax_year, kind, amount, note) values ($1,$2,$3,$4,'grant',$5,$6) returning id",
    [actor.organizationId, clientId, g.assetId, g.year, g.amount, g.note],
  );
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.grant.create", entity: "sk_asset_adjustments", entityId: row.id, details: { year: g.year } });
}

export async function deleteGrant(tx: Sql, actor: Actor, clientId: string, id: string): Promise<void> {
  const rows = await tx.query("delete from sk_asset_adjustments where id = $1 and client_id = $2 returning id", [id, clientId]);
  if (!rows.length) throw new AgriError("Tukea ei löytynyt.");
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.grant.delete", entity: "sk_asset_adjustments", entityId: id });
}

// ---------------------------------------------------------------------------
// Harvinaiset kentät
// ---------------------------------------------------------------------------

export async function listExtras(tx: Sql, clientId: string, year: number): Promise<{ code: string; value: number }[]> {
  const rows = await tx.query<{ code: string; value: string }>("select code, value from sk_agri_form_extras where client_id = $1 and tax_year = $2 order by code", [clientId, year]);
  return rows.map((r) => ({ code: r.code, value: Number(r.value) }));
}

export async function setExtra(tx: Sql, actor: Actor, clientId: string, year: number, code: string, value: number): Promise<void> {
  const error = validateExtra(code, value);
  if (error) throw new AgriError(error);
  await tx.query(
    `insert into sk_agri_form_extras (organization_id, client_id, tax_year, code, value) values ($1,$2,$3,$4,$5)
     on conflict (client_id, tax_year, code) do update set value = excluded.value`,
    [actor.organizationId, clientId, year, code, value],
  );
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.extra.save", entity: "sk_agri_form_extras", details: { clientId, year, code } });
}

export async function deleteExtra(tx: Sql, actor: Actor, clientId: string, year: number, code: string): Promise<void> {
  await tx.query("delete from sk_agri_form_extras where client_id = $1 and tax_year = $2 and code = $3", [clientId, year, code]);
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.extra.delete", entity: "sk_agri_form_extras", details: { clientId, year, code } });
}

// ---------------------------------------------------------------------------
// Ryhmäpoistot
// ---------------------------------------------------------------------------

/**
 * Tallentaa vuoden ryhmäpoistot. Palvelin laskee rajat uudelleen samalla
 * funktiolla kuin sivu, ja liian suuri poisto on virhe eikä sitä rajata
 * hiljaa. Ryhmä, jolle ei anneta poistoa, saa nollan, jotta vahvistus näkyy.
 */
export async function saveAgriDepreciations(tx: Sql, actor: Actor, clientId: string, year: number, chosen: Partial<Record<AgriPool, number>>): Promise<number> {
  const result = await loadAgriDepreciation(tx, clientId, year);
  for (const pool of Object.keys(chosen) as AgriPool[]) {
    if (!AGRI_POOLS.includes(pool)) throw new AgriError("Tuntematon poistoryhmä.");
    const p = result.pools.find((x) => x.pool === pool);
    const amount = chosen[pool] ?? 0;
    if (amount < 0) throw new AgriError("Poisto ei voi olla negatiivinen.");
    if (amount > (p?.max ?? 0) + 0.004) throw new AgriError(`${p?.label ?? "Ryhmän"} poisto voi olla enintään ${(p?.max ?? 0).toLocaleString("fi-FI", { minimumFractionDigits: 2 })} €.`);
  }
  await tx.query("delete from sk_agri_depreciations where client_id = $1 and tax_year = $2", [clientId, year]);
  let total = 0;
  for (const p of result.pools.filter((x) => x.base > 0)) {
    const amount = round2(chosen[p.pool] ?? 0);
    total += amount;
    await tx.query("insert into sk_agri_depreciations (organization_id, client_id, tax_year, pool, amount) values ($1,$2,$3,$4,$5)", [
      actor.organizationId, clientId, year, p.pool, amount,
    ]);
  }
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.depreciation.save", entity: "sk_agri_depreciations", details: { clientId, year } });
  return round2(total);
}
