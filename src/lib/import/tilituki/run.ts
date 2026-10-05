import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/types";
import { thirds } from "@/lib/tax/agriculture";
import { tilitukiId, TILITUKI_ID_SQL } from "@/lib/import/origin";
import { buildYearPlan, clientName, hasAgriculture, hasForestry, type TtFolder, type UnmappedAccount, type YearPlan } from "./map";

/**
 * Tilituki-aineiston kirjoitus Skogiin yhdessä transaktiossa (palvelun rooli).
 * Kutsuja: scripts/import-tilituki.mts. Testit: tests/db/tilituki-import.test.ts.
 *
 * Ajo on toistettava: tuodut rivit tunnistetaan pysyvästä tunnisteesta
 * (legacy_id, origin.ts). Avoimen vuoden Tilituki-kirjaukset korvataan
 * aineiston nykytilalla: uudet lisätään, muuttuneet päivitetään ja aineistosta
 * poistuneet poistetaan. Skogissa lisättyihin kirjauksiin ja suljettuihin
 * vuosiin ei kosketa.
 *
 * Asiakas yhdistetään ensin Y-tunnuksella organisaation sisällä, sitten
 * aiemman tuonnin tunnisteella. Uusi asiakas luodaan vain, kun createClients on päällä.
 */

export interface TilitukiImportOptions {
  orgName: string;
  createOrg?: boolean;
  createClients?: boolean;
  year: number;
  /** Myös asiakkaat, joilla on vain metsätaloutta. Oletuksena tuodaan maatalousasiakkaat. */
  includeForestOnly?: boolean;
}

export interface FolderResult {
  folder: string;
  status: "imported" | "skipped";
  reason?: string;
  counts: Record<string, number>;
  unmapped: UnmappedAccount[];
  ignored: Record<string, number>;
  notes: Record<string, number>;
}

export interface TilitukiImportResult {
  folders: FolderResult[];
  counts: Record<string, number>;
}

const NOTE = "Tilituki-tuonti";

export async function importTilituki(tx: Sql, opts: TilitukiImportOptions, data: TtFolder[]): Promise<TilitukiImportResult> {
  const totals: Record<string, number> = {};
  const addTotal = (k: string, n = 1) => {
    if (n) totals[k] = (totals[k] ?? 0) + n;
  };
  let [org] = await tx.query<{ id: string }>("select id from sk_organizations where name = $1", [opts.orgName]);
  if (!org && opts.createOrg) [org] = await tx.query<{ id: string }>("insert into sk_organizations (name) values ($1) returning id", [opts.orgName]);
  if (!org) throw new Error(`Organisaatiota "${opts.orgName}" ei ole. Luo se lipulla --luo.`);

  const folders: FolderResult[] = [];
  for (const f of data) {
    const res = await importFolder(tx, org.id, opts, f);
    folders.push(res);
    for (const [k, v] of Object.entries(res.counts)) addTotal(k, v);
    addTotal(res.status === "imported" ? "asiakkaita tuotu" : "asiakkaita ohitettu");
  }
  await tx.query(
    "insert into sk_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'import.tilituki', 'sk_organizations', $1, $2)",
    [org.id, JSON.stringify({ year: opts.year, counts: totals, run: randomUUID() })],
  );
  return { folders, counts: totals };
}

async function importFolder(tx: Sql, orgId: string, opts: TilitukiImportOptions, f: TtFolder): Promise<FolderResult> {
  const counts: Record<string, number> = {};
  const add = (k: string, n = 1) => {
    if (n) counts[k] = (counts[k] ?? 0) + n;
  };
  const year = opts.year;
  const agri = hasAgriculture(f, year);
  const forest = hasForestry(f, year);
  const skip = (reason: string): FolderResult => ({ folder: f.folder, status: "skipped", reason, counts, unmapped: [], ignored: {}, notes: {} });
  const plan = buildYearPlan(f, year);
  const clientLegacy = tilitukiId("client", f.folder);
  // Y-tunnus ensin: asiakas voi olla Skogissa jo ennestään.
  let [client] = f.client.businessId
    ? await tx.query<{ id: string; has_agriculture: boolean; has_forestry: boolean; vat_registered: boolean }>(
        "select id, has_agriculture, has_forestry, vat_registered from sk_clients where organization_id = $1 and business_id = $2 and archived_at is null order by created_at limit 1",
        [orgId, f.client.businessId],
      )
    : [];
  if (!client) {
    [client] = await tx.query("select id, has_agriculture, has_forestry, vat_registered from sk_clients where legacy_id = $1 and organization_id = $2", [clientLegacy, orgId]);
  }
  // Ensimmäinen tuonti tallensi koko nimen sukunimeksi. Korjataan Tilitukista luodun asiakkaan nimi, jos käyttäjä ei
  // ole vielä muuttanut sitä (etunimi on tyhjä). Muualta tulleen asiakkaan nimeen ei kosketa.
  if (client) {
    const name = clientName(f.client, f.folder);
    const fixed = await tx.query(
      "update sk_clients set first_name = $2, last_name = $3 where id = $1 and legacy_id = $4 and first_name = '' and (first_name, last_name) is distinct from ($2, $3) returning id",
      [client.id, name.firstName, name.lastName, clientLegacy],
    );
    if (fixed.length) add("asiakkaan nimi korjattu");
  }
  // Aiemmin tuotu maatalousasiakas tuodaan joka vuosi, vaikka vuonna ei olisi maataloutta (esim. pelkät jako-osuudet).
  const known = !!client && (client.has_agriculture || (opts.includeForestOnly ?? false));
  if (!agri && !known && !(opts.includeForestOnly && forest)) return skip(forest ? "vain metsätaloutta" : "ei kirjanpitoa vuodelta");
  if (!client) {
    if (!opts.createClients) return skip("asiakasta ei ole Skogissa (luo lipulla --luo)");
    const name = clientName(f.client, f.folder);
    [client] = await tx.query(
      `insert into sk_clients (organization_id, first_name, last_name, business_id, street, postal_code, city, vat_registered, has_agriculture, has_forestry, legacy_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, has_agriculture, has_forestry, vat_registered`,
      [orgId, name.firstName, name.lastName, f.client.businessId, f.client.street, f.client.postalCode, f.client.city, plan.vatRegistered, agri, forest, clientLegacy],
    );
    add("asiakkaita luotu");
  } else {
    // Toiminto vain lisätään: pois kytkeminen piilottaisi olemassa olevia lukuja.
    if ((agri && !client.has_agriculture) || (forest && !client.has_forestry)) {
      await tx.query("update sk_clients set has_agriculture = has_agriculture or $2, has_forestry = has_forestry or $3 where id = $1", [client.id, agri, forest]);
      add("asiakkaan toimintoja lisätty");
    }
    if (client.vat_registered !== plan.vatRegistered) add("alv-rekisteröinti poikkeaa Tilitukista (ei muutettu)");
  }
  const clientId = client.id;

  // Verovuosi. Suljettuun vuoteen ei kosketa.
  const [ty] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (ty?.status === "closed") return { ...skip("verovuosi on suljettu"), counts };
  if (!ty) {
    await tx.query("insert into sk_tax_years (organization_id, client_id, year, status) values ($1,$2,$3,'open')", [orgId, clientId, year]);
    add("verovuosia avattu");
  }

  // Aloitusvuosi: aiemmat investoinnit, varaukset ja jaksotukset tuodaan vain asiakkaan ensimmäiselle tuontivuodelle.
  const [earlier] = await tx.query<{ n: number }>(
    `select count(*)::int as n from sk_assets where client_id = $1 and ${TILITUKI_ID_SQL} and opening_year is not null and opening_year < $2`,
    [clientId, year],
  );
  const firstYear = earlier.n === 0;

  // ---------------------------------------------------------------------------
  // Investoinnit
  // ---------------------------------------------------------------------------
  const assetIds = new Map<string, string>();
  const wantedAssets = [...(firstYear ? plan.openingAssets : []), ...plan.newAssets];
  for (const a of wantedAssets) {
    const [row] = await tx.query<{ id: string; inserted: boolean }>(
      `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_book_value,
                              opening_year, opening_accumulated_depreciation, activity, asset_class, accelerated, legacy_id)
       values ($1,$2,$3,$4,$5,'declining_balance',$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (legacy_id) do update set description = excluded.description, acquired_on = excluded.acquired_on, acquisition_cost = excluded.acquisition_cost,
         declining_rate_pct = excluded.declining_rate_pct, opening_book_value = excluded.opening_book_value, opening_year = excluded.opening_year,
         opening_accumulated_depreciation = excluded.opening_accumulated_depreciation, asset_class = excluded.asset_class, accelerated = excluded.accelerated
       returning id, (xmax = 0) as inserted`,
      [orgId, clientId, a.description, a.acquiredOn, a.acquisitionCost, a.ratePct, a.openingBookValue, a.openingYear, a.openingYear === null ? null : 0,
        a.activity, a.assetClass, a.accelerated, a.legacyId],
    );
    assetIds.set(a.key, row.id);
    add(row.inserted ? (a.openingYear ? "aiempia investointeja" : "investointeja") : "investointeja päivitetty");
  }
  // Aineistosta poistuneet saman vuoden Tilituki-investoinnit pois (hankinnat ja vuoden aiemmat).
  const keepAssets = [...assetIds.values()];
  const removedAssets = await tx.query(
    `delete from sk_assets where client_id = $1 and ${TILITUKI_ID_SQL} and not (id = any($2::uuid[]))
        and (opening_year = $3 or (opening_year is null and extract(year from acquired_on) = $3))
     returning id`,
    [clientId, keepAssets, year],
  );
  add("investointeja poistettu", removedAssets.length);

  // ---------------------------------------------------------------------------
  // Kirjaukset
  // ---------------------------------------------------------------------------
  for (const t of plan.transactions) {
    const assetId = t.assetKey ? (assetIds.get(t.assetKey) ?? null) : null;
    const [ex] = await tx.query<{ id: string; same: boolean }>(
      `select id, (booked_on = $2::date and kind = $3 and category = $4 and description = $5 and amount_net = $6::numeric and vat_rate = $7::numeric
                   and withholding = $8::numeric and reference is not distinct from $9 and asset_id is not distinct from $10::uuid) as same
         from sk_transactions where legacy_id = $1`,
      [t.legacyId, t.bookedOn, t.kind, t.category, t.description, t.amountNet, t.vatRate, t.withholding, t.reference, assetId],
    );
    const activity = t.category.startsWith("agri_") ? "agriculture" : "forestry";
    if (ex) {
      if (ex.same) continue;
      // amount_gross null: kanta laskee verollisen summan verottomasta (0009), jolloin veroton pysyy Tilitukin lukuna.
      await tx.query(
        `update sk_transactions set booked_on = $2, kind = $3, category = $4, description = $5, amount_gross = null, amount_net = $6, vat_rate = $7,
                withholding = $8, reference = $9, asset_id = $10, activity = $11 where id = $1`,
        [ex.id, t.bookedOn, t.kind, t.category, t.description, t.amountNet, t.vatRate, t.withholding, t.reference, assetId, activity],
      );
      add("kirjauksia päivitetty");
      continue;
    }
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, withholding, reference, asset_id,
                                    activity, legacy_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [orgId, clientId, t.bookedOn, t.kind, t.category, t.description, t.amountNet, t.vatRate, t.withholding, t.reference, assetId, activity, t.legacyId],
    );
    add("kirjauksia");
  }
  const removed = await tx.query(
    `delete from sk_transactions where client_id = $1 and tax_year = $2 and ${TILITUKI_ID_SQL} and not (legacy_id = any($3::uuid[])) returning id`,
    [clientId, year, plan.transactions.map((t) => t.legacyId)],
  );
  add("kirjauksia poistettu", removed.length);

  // ---------------------------------------------------------------------------
  // Poistot, vuoden tiedot, harvinaiset kentät, varaukset ja jaksotukset
  // ---------------------------------------------------------------------------
  for (const d of plan.agriDepreciations) {
    await tx.query(
      `insert into sk_agri_depreciations (organization_id, client_id, tax_year, pool, amount) values ($1,$2,$3,$4,$5)
       on conflict (client_id, tax_year, pool) do update set amount = excluded.amount`,
      [orgId, clientId, year, d.pool, d.amount],
    );
    add("ryhmäpoistoja");
  }
  for (const d of plan.forestDepreciations) {
    const assetId = assetIds.get(d.assetKey);
    if (!assetId) continue;
    await tx.query(
      `insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1,$2,$3,$4,$5)
       on conflict (asset_id, tax_year) do update set amount = excluded.amount, book_value_end = excluded.book_value_end`,
      [orgId, assetId, year, d.amount, d.bookValueEnd],
    );
    add("metsätalouden poistoja");
  }
  if (plan.agriYear && (agri || client.has_agriculture)) {
    const y = plan.agriYear;
    await tx.query(
      `insert into sk_agri_years (organization_id, client_id, tax_year, spouse_wealth_share_pct, spouse_work_share_pct, income_split_claim, loss_to_capital_income,
                                  wages_subject_to_withholding, land_value, rental_dwellings_value, shares_value, other_assets_value, liabilities, other_farm_assets)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (client_id, tax_year) do update set spouse_wealth_share_pct = excluded.spouse_wealth_share_pct, spouse_work_share_pct = excluded.spouse_work_share_pct,
         income_split_claim = excluded.income_split_claim, loss_to_capital_income = excluded.loss_to_capital_income,
         wages_subject_to_withholding = excluded.wages_subject_to_withholding, land_value = excluded.land_value, rental_dwellings_value = excluded.rental_dwellings_value,
         shares_value = excluded.shares_value, other_assets_value = excluded.other_assets_value, liabilities = excluded.liabilities, other_farm_assets = excluded.other_farm_assets`,
      [orgId, clientId, year, y.spouseWealthSharePct, y.spouseWorkSharePct, y.incomeSplitClaim, y.lossToCapitalIncome, y.wagesSubjectToWithholding, y.landValue,
        y.rentalDwellingsValue, y.sharesValue, y.otherAssetsValue, y.liabilities, y.otherFarmAssets],
    );
    add("maatalouden vuositietoja");
  }
  for (const x of plan.extras) {
    await tx.query(
      `insert into sk_agri_form_extras (organization_id, client_id, tax_year, code, value) values ($1,$2,$3,$4,$5)
       on conflict (client_id, tax_year, code) do update set value = excluded.value`,
      [orgId, clientId, year, x.code, x.value],
    );
    add("lomakkeen 2 lisäkenttiä");
  }
  // Varaukset: Tilitukista tuodut tunnistetaan muistiinpanosta, ja verovuoden varaukset korvataan.
  const reserves = [...(firstYear ? plan.openingReserves : []), ...plan.yearReserves];
  await tx.query("delete from sk_agri_reserves where client_id = $1 and note = $2 and made_year = $3", [clientId, NOTE, year]);
  if (firstYear) await tx.query("delete from sk_agri_reserves where client_id = $1 and note = $2 and made_year < $3", [clientId, NOTE, year]);
  for (const r of reserves) {
    const [row] = await tx.query<{ id: string }>(
      "insert into sk_agri_reserves (organization_id, client_id, kind, made_year, amount, note) values ($1,$2,$3,$4,$5,$6) returning id",
      [orgId, clientId, r.kind, r.madeYear, r.amount, NOTE],
    );
    add("varauksia");
    if (r.incomeThisYear > 0) {
      await tx.query(
        "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,$4,'income',$5)",
        [orgId, clientId, row.id, year, r.incomeThisYear],
      );
      add("varausten tuloutuksia");
    }
  }
  if (firstYear) {
    await tx.query("delete from sk_agri_deferrals where client_id = $1 and note = $2 and transaction_id is null", [clientId, NOTE]);
    for (const d of plan.openingDeferrals) {
      const [y1, y2, y3] = thirds(d.amount);
      await tx.query(
        "insert into sk_agri_deferrals (organization_id, client_id, tax_year, kind, amount, year1, year2, year3, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [orgId, clientId, d.taxYear, d.kind, d.amount, y1, y2, y3, NOTE],
      );
      add("kotieläinten jaksotuksia");
    }
  }

  return { folder: f.folder, status: "imported", counts, unmapped: plan.unmapped, ignored: plan.ignored, notes: plan.notes };
}

/** Tuonnin yhteenveto ilman henkilötietoja: kartoittamattomat tilit (tilikartan nimi ja numero) ja ohitetut syyt määrinä. */
export function summarizeUnmapped(results: FolderResult[]): { account: string; name: string; taxCode: string; reason: string; rows: number; clients: number }[] {
  const m = new Map<string, { account: string; name: string; taxCode: string; reason: string; rows: number; clients: Set<string> }>();
  for (const r of results) {
    for (const u of r.unmapped) {
      const key = `${u.account}|${u.taxCode}`;
      const e = m.get(key) ?? { account: u.account, name: u.name, taxCode: u.taxCode, reason: u.reason, rows: 0, clients: new Set<string>() };
      e.rows += u.count;
      e.clients.add(r.folder);
      m.set(key, e);
    }
  }
  return [...m.values()].map((e) => ({ ...e, clients: e.clients.size })).sort((a, b) => a.account.localeCompare(b.account));
}

export type { YearPlan };
