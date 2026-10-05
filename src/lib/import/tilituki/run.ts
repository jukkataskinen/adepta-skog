import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/types";
import { thirds } from "@/lib/tax/agriculture";
import { round2 } from "@/lib/tax/amounts";
import { tilitukiId, TILITUKI_ID_SQL } from "@/lib/import/origin";
import { buildForestHistory, sameAsManual, type HistoryAsset, type ManualAsset } from "./history";
import { buildYearPlan, clientName, dataYearRange, hasAgriculture, hasForestry, type TtFolder, type UnmappedAccount, type YearPlan } from "./map";

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
  /** Verovuodet, jotka avataan tuodulle asiakkaalle, jos niitä ei vielä ole (esim. 2026 kirjanpidon aloittamiseksi). */
  openYears?: number[];
}

export interface FolderResult {
  folder: string;
  /** Skogin asiakas, jos vuosi tuotiin (vuosien sulkemista varten). */
  clientId?: string;
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
  // Vuodet ennen asiakkaan ensimmäistä ja jälkeen viimeisen Tilituki-vuoden ohitetaan: verovuotta ei luoda tyhjänä.
  const range = dataYearRange(f);
  if (!range || year < range.first || year > range.last) return skip("ei Tilituki-aineistoa vuodelta");
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

  // Verovuosi. Käyttäjän sulkemaan vuoteen ei kosketa. Tuonnin itse sulkema vuosi avataan uusintatuontia varten
  // ja suljetaan ajon lopuksi uudelleen (closeImportedYears), joten ajo on toistettava.
  const [ty] = await tx.query<{ id: string; status: string; closed_by: string | null }>(
    "select id, status, closed_by::text from sk_tax_years where client_id = $1 and year = $2",
    [clientId, year],
  );
  if (ty?.status === "closed") {
    if (!(await closedByImport(tx, ty))) return { ...skip("verovuosi on suljettu"), counts };
    await tx.query("update sk_tax_years set status = 'open', closed_at = null, closed_by = null where id = $1", [ty.id]);
    await tx.query(
      "insert into sk_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'tax_year.reopen', 'sk_tax_years', $2, $3)",
      [orgId, ty.id, JSON.stringify({ year, source: IMPORT_SOURCE })],
    );
    add("tuonnin sulkemia verovuosia avattu");
  }
  if (!ty) {
    await tx.query("insert into sk_tax_years (organization_id, client_id, year, status) values ($1,$2,$3,'open')", [orgId, clientId, year]);
    add("verovuosia avattu");
  }

  // Aloitusvuosi: aiemmat investoinnit, varaukset ja jaksotukset tuodaan vain asiakkaan ensimmäiselle tuontivuodelle.
  // Ensimmäinen vuosi on se, jota ennen asiakkaalla ei ole Tilitukista tuotuja kirjauksia eikä maatalouden
  // investointeja. Pelkkä aiempi ryhmä ei riitä: ilman ryhmiä alkanut asiakas voi hankkia koneen myöhemmin.
  const [earlier] = await tx.query<{ n: number }>(
    `select ((select count(*) from sk_transactions where client_id = $1 and tax_year < $2 and ${TILITUKI_ID_SQL})
           + (select count(*) from sk_assets where client_id = $1 and activity = 'agriculture' and ${TILITUKI_ID_SQL}
                and coalesce(opening_year, extract(year from acquired_on)::int) < $2))::int as n`,
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
      [orgId, clientId, a.description, a.acquiredOn, a.acquisitionCost, a.ratePct, a.openingBookValue, a.openingYear, a.openingYear === null ? null : round2(a.acquisitionCost - (a.openingBookValue ?? 0)),
        a.activity, a.assetClass, a.accelerated, a.legacyId],
    );
    assetIds.set(a.key, row.id);
    add(row.inserted ? (a.openingYear ? "aiempia investointeja" : "investointeja") : "investointeja päivitetty");
  }
  // Aineistosta poistuneet saman vuoden Tilituki-investoinnit pois (hankinnat ja vuoden aiemmat).
  const keepAssets = [...assetIds.values()];
  const removedAssets = await tx.query(
    `delete from sk_assets where client_id = $1 and activity = 'agriculture' and ${TILITUKI_ID_SQL} and not (id = any($2::uuid[]))
        and (opening_year = $3 or (opening_year is null and extract(year from acquired_on) = $3))
     returning id`,
    [clientId, keepAssets, year],
  );
  add("investointeja poistettu", removedAssets.length);

  // ---------------------------------------------------------------------------
  // Kirjaukset
  // ---------------------------------------------------------------------------
  // Olemassa olevat rivit yhdellä kyselyllä ja uudet erissä: vuosia on 25 ja vientejä kymmeniätuhansia,
  // joten rivi kerrallaan tuotantokantaan menisi liian kauan.
  const existing = new Map(
    (
      await tx.query<{
        id: string; legacy_id: string; booked_on: string; kind: string; category: string; description: string; amount_net: string; vat_rate: string;
        withholding: string; reference: string | null; asset_id: string | null;
      }>(
        `select id, legacy_id::text, booked_on::text, kind, category, description, amount_net, vat_rate, withholding, reference, asset_id::text
           from sk_transactions where client_id = $1 and legacy_id = any($2::uuid[])`,
        [clientId, plan.transactions.map((t) => t.legacyId)],
      )
    ).map((r) => [r.legacy_id, r]),
  );
  const inserts: { t: YearPlan["transactions"][number]; assetId: string | null; activity: string }[] = [];
  for (const t of plan.transactions) {
    const assetId = t.assetKey ? (assetIds.get(t.assetKey) ?? null) : null;
    const activity = t.category.startsWith("agri_") ? "agriculture" : "forestry";
    const ex = existing.get(t.legacyId);
    if (!ex) {
      inserts.push({ t, assetId, activity });
      continue;
    }
    const same =
      ex.booked_on === t.bookedOn && ex.kind === t.kind && ex.category === t.category && ex.description === t.description &&
      Number(ex.amount_net) === t.amountNet && Number(ex.vat_rate) === t.vatRate && Number(ex.withholding) === t.withholding &&
      ex.reference === t.reference && ex.asset_id === assetId;
    if (same) continue;
    // amount_gross null: kanta laskee verollisen summan verottomasta (0009), jolloin veroton pysyy Tilitukin lukuna.
    await tx.query(
      `update sk_transactions set booked_on = $2, kind = $3, category = $4, description = $5, amount_gross = null, amount_net = $6, vat_rate = $7,
              withholding = $8, reference = $9, asset_id = $10, activity = $11 where id = $1`,
      [ex.id, t.bookedOn, t.kind, t.category, t.description, t.amountNet, t.vatRate, t.withholding, t.reference, assetId, activity],
    );
    add("kirjauksia päivitetty");
  }
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, withholding, reference, asset_id,
                                    activity, legacy_id)
       select $1, $2, * from unnest($3::date[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::numeric[], $9::numeric[], $10::text[], $11::uuid[],
                                    $12::text[], $13::uuid[])`,
      [orgId, clientId, chunk.map((c) => c.t.bookedOn), chunk.map((c) => c.t.kind), chunk.map((c) => c.t.category), chunk.map((c) => c.t.description),
        chunk.map((c) => c.t.amountNet), chunk.map((c) => c.t.vatRate), chunk.map((c) => c.t.withholding), chunk.map((c) => c.t.reference),
        chunk.map((c) => c.assetId), chunk.map((c) => c.activity), chunk.map((c) => c.t.legacyId)],
    );
  }
  add("kirjauksia", inserts.length);
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
  // Myöhempien vuosien tuloutus (219) aiemmin tuoduista varauksista vanhimmasta alkaen. Aloitusvuonna se on
  // aloitusvarauksilla (incomeThisYear). Pitkässä historiassa varauksia tehdään ja tuloutetaan monena vuonna.
  await tx.query(
    "delete from sk_agri_reserve_uses u using sk_agri_reserves r where u.reserve_id = r.id and r.client_id = $1 and r.note = $2 and u.tax_year = $3",
    [clientId, NOTE, year],
  );
  if (!firstYear && plan.reserveIncome > 0) {
    const open = await tx.query<{ id: string; left: string }>(
      `select r.id, r.amount - coalesce((select sum(u.amount) from sk_agri_reserve_uses u where u.reserve_id = r.id and u.tax_year < $3), 0) as left
         from sk_agri_reserves r where r.client_id = $1 and r.note = $2 and r.kind = 'equalization' and r.made_year < $3 order by r.made_year`,
      [clientId, NOTE, year],
    );
    let income = plan.reserveIncome;
    for (const r of open) {
      const use = round2(Math.min(income, Number(r.left)));
      if (use <= 0) continue;
      await tx.query(
        "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,$4,'income',$5)",
        [orgId, clientId, r.id, year, use],
      );
      add("varausten tuloutuksia");
      income = round2(income - use);
    }
    if (income > 0.005) add("tasausvarauksen tuloutusta ei voitu kohdistaa");
  }
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

  // Metsätalouden investoinnit koko historiana (vuodesta riippumaton, toistettava).
  const historyNotes = await syncForestHistory(tx, orgId, clientId, buildForestHistory(f.folder, f.machinery), add);

  // Pyydetyt verovuodet auki (esim. 2026), jotta seuraavan vuoden kirjanpito voi alkaa tuodusta historiasta.
  for (const y of opts.openYears ?? []) {
    const opened = await tx.query(
      "insert into sk_tax_years (organization_id, client_id, year, status) values ($1,$2,$3,'open') on conflict (client_id, year) do nothing returning id",
      [orgId, clientId, y],
    );
    add(`verovuosia avattu (${y})`, opened.length);
  }

  return { folder: f.folder, clientId, status: "imported", counts, unmapped: plan.unmapped, ignored: plan.ignored, notes: { ...plan.notes, ...historyNotes } };
}

/** Tuonnin sulkemien vuosien merkintä muutoslokissa (details.source). */
const IMPORT_SOURCE = "tilituki";

/**
 * Onko vuosi tuonnin sulkema: sulkijaa ei ole (palvelun rooli), tuonti on kirjannut sulkemisen lokiin, eikä
 * vuotta ole koskaan avattu tai suljettu muuten (käyttäjä tai muu lähde). Käyttäjän kerran käsittelemään
 * vuoteen tuonti ei enää koske. Saman ajon avaus ja sulkeminen ovat lokissa samalla ajalla, joten
 * järjestykseen ei luoteta.
 */
async function closedByImport(tx: Sql, ty: { id: string; closed_by: string | null }): Promise<boolean> {
  if (ty.closed_by) return false;
  const [r] = await tx.query<{ imported: boolean; other: boolean }>(
    `select bool_or(action = 'tax_year.close' and user_id is null and details->>'source' = $2) as imported,
            bool_or(user_id is not null or details->>'source' is distinct from $2) as other
       from sk_audit_log where entity = 'sk_tax_years' and entity_id = $1 and action in ('tax_year.close', 'tax_year.reopen', 'tax_year.open')`,
    [ty.id, IMPORT_SOURCE],
  );
  return !!r?.imported && !r.other;
}

/**
 * Tuodut vanhat verovuodet suljetaan, jotta niitä ei muuteta vahingossa (DECISIONS 5.10.2026, koko historia).
 * Suljetaan vain tässä ajossa tuodut vuodet, jotka ovat enintään `throughYear`. Sulkeminen kirjataan lokiin
 * ilman käyttäjää lähteellä "tilituki", josta uusintatuonti tunnistaa vuoden omakseen.
 */
export async function closeImportedYears(tx: Sql, orgId: string, imported: { clientId: string; year: number }[], throughYear: number): Promise<number> {
  let n = 0;
  const seen = new Set<string>();
  for (const { clientId, year } of imported) {
    const key = `${clientId}/${year}`;
    if (year > throughYear || seen.has(key)) continue;
    seen.add(key);
    const [row] = await tx.query<{ id: string }>(
      "update sk_tax_years set status = 'closed', closed_at = now(), closed_by = null where client_id = $1 and year = $2 and status = 'open' returning id",
      [clientId, year],
    );
    if (!row) continue;
    await tx.query(
      "insert into sk_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'tax_year.close', 'sk_tax_years', $2, $3)",
      [orgId, row.id, JSON.stringify({ year, source: IMPORT_SOURCE })],
    );
    n++;
  }
  return n;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));
const TT_ASSET = TILITUKI_ID_SQL.replace(/legacy_id/g, "a.legacy_id");
const TT_TRANSACTION = TILITUKI_ID_SQL.replace(/legacy_id/g, "t.legacy_id");

/**
 * Metsätalouden kalustokortit koko historiana (history.ts). Investointi
 * päivitetään Tilitukin mukaiseksi ja jokaiselle Tilitukin vuodelle kirjoitetaan
 * poistorivi. Ei kosketa:
 * - investointiin, jota on muokattu Skogissa (muutosloki: käyttäjän tekemä
 *   tapahtuma investoinnille). Tuonti kirjaa lokiin vain organisaatiotason rivin
 *   ilman käyttäjää, joten käyttäjän muutos erottuu ilman migraatiota;
 * - suljetun vuoden poistoon tai lähtötietoihin;
 * - poistoriveihin Tilitukin viimeisen vuoden jälkeen (Skogissa vahvistetut);
 * - myyntitietoihin, jos myynti on kirjattu Skogin kirjanpitoon.
 */
async function syncForestHistory(
  tx: Sql, orgId: string, clientId: string, assets: HistoryAsset[], add: (k: string, n?: number) => void,
): Promise<Record<string, number>> {
  const notes: Record<string, number> = {};
  const note = (k: string, n = 1) => (notes[k] = (notes[k] ?? 0) + n);
  for (const a of assets) for (const n of a.notes) note(`kalustokortti: ${n}`);
  const closed = new Set(
    (await tx.query<{ year: number }>("select year from sk_tax_years where client_id = $1 and status = 'closed'", [clientId])).map((r) => Number(r.year)),
  );
  const existing = await tx.query<{
    id: string; legacy_id: string; description: string; acquired_on: string; acquisition_cost: string; declining_rate_pct: string | null; opening_year: number | null;
    opening_book_value: string | null; opening_accumulated_depreciation: string | null; disposed_on: string | null; sale_price: string | null; touched: boolean;
    sold_in_ledger: boolean;
  }>(
    `select a.id, a.legacy_id::text, a.description, a.acquired_on::text, a.acquisition_cost, a.declining_rate_pct, a.opening_year, a.opening_book_value,
            a.opening_accumulated_depreciation, a.disposed_on::text, a.sale_price,
            exists (select 1 from sk_audit_log l where l.entity = 'sk_assets' and l.entity_id = a.id and l.user_id is not null) as touched,
            exists (select 1 from sk_transactions t where t.asset_id = a.id and t.kind <> 'investment' and (t.legacy_id is null or not (${TT_TRANSACTION}))) as sold_in_ledger
       from sk_assets a where a.client_id = $1 and a.activity = 'forestry' and ${TT_ASSET}`,
    [clientId],
  );
  const byLegacy = new Map(existing.map((e) => [e.legacy_id, e]));
  const wanted = new Set(assets.map((a) => a.legacyId));
  // Skogissa käsin lisätyt metsätalouden investoinnit (ei Tilitukista): sama kohde tuodaan vain kerran.
  const manual: ManualAsset[] = (
    await tx.query<{ declining_rate_pct: string | null; acquired_on: string; acquisition_cost: string; opening_year: number | null; opening_book_value: string | null }>(
      `select a.declining_rate_pct, a.acquired_on::text, a.acquisition_cost, a.opening_year, a.opening_book_value
         from sk_assets a where a.client_id = $1 and a.activity = 'forestry' and (a.legacy_id is null or not (${TT_ASSET}))`,
      [clientId],
    )
  ).map((m) => ({
    ratePct: num(m.declining_rate_pct), acquiredOn: m.acquired_on, acquisitionCost: Number(m.acquisition_cost), openingYear: num(m.opening_year),
    openingBookValue: num(m.opening_book_value),
  }));

  for (const a of assets) {
    const ex = byLegacy.get(a.legacyId);
    if (manual.some((m) => sameAsManual(a, m))) {
      // Kirjanpitäjä on lisännyt saman kohteen itse: hänen rivinsä on oikea. Aiemmin tuotu kaksoiskappale pois,
      // jos sitä ei ole muokattu eikä sillä ole suljetun vuoden poistoja.
      if (ex && !ex.touched && !ex.sold_in_ledger && !(ex.opening_year !== null && closed.has(Number(ex.opening_year)))) {
        const [locked] = await tx.query<{ n: number }>(
          `select count(*)::int as n from sk_depreciations d join sk_tax_years y on y.client_id = $2 and y.year = d.tax_year and y.status = 'closed'
            where d.asset_id = $1`,
          [ex.id, clientId],
        );
        if (!locked.n) {
          await tx.query("delete from sk_assets where id = $1", [ex.id]);
          add("historia: tuotu kaksoiskappale poistettu (sama kohde lisätty Skogissa)");
          continue;
        }
      }
      add("historia: investointeja ohitettu (sama kohde lisätty Skogissa)");
      continue;
    }
    if (ex?.touched) {
      add("historia: investointeja ohitettu (muokattu Skogissa)");
      continue;
    }
    const sale = ex?.sold_in_ledger
      ? { on: ex.disposed_on, price: ex.sale_price === null ? null : Number(ex.sale_price) }
      : { on: a.disposedOn, price: a.salePrice };
    let assetId: string;
    if (!ex) {
      if (a.openingYear !== null && closed.has(a.openingYear)) {
        add("historia: investointeja ohitettu (lähtövuosi suljettu)");
        continue;
      }
      const [row] = await tx.query<{ id: string }>(
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_book_value,
                                opening_year, opening_accumulated_depreciation, activity, disposed_on, sale_price, legacy_id)
         values ($1,$2,$3,$4,$5,'declining_balance',$6,$7,$8,$9,'forestry',$10,$11,$12) returning id`,
        [orgId, clientId, a.description, a.acquiredOn, a.acquisitionCost, a.ratePct, a.openingBookValue, a.openingYear, a.openingAccumulated, sale.on, sale.price,
          a.legacyId],
      );
      assetId = row.id;
      add("historia: investointeja luotu");
    } else {
      assetId = ex.id;
      const same =
        ex.description === a.description && ex.acquired_on === a.acquiredOn && Number(ex.acquisition_cost) === a.acquisitionCost &&
        num(ex.declining_rate_pct) === a.ratePct && num(ex.opening_year) === a.openingYear && num(ex.opening_book_value) === a.openingBookValue &&
        num(ex.opening_accumulated_depreciation) === a.openingAccumulated;
      const saleSame = ex.disposed_on === sale.on && num(ex.sale_price) === sale.price;
      if (!same && ((ex.opening_year !== null && closed.has(Number(ex.opening_year))) || (a.openingYear !== null && closed.has(a.openingYear)))) {
        add("historia: investointeja ohitettu (lähtövuosi suljettu)");
        continue;
      }
      if (!same || !saleSame) {
        await tx.query(
          `update sk_assets set description = $2, acquired_on = $3, acquisition_cost = $4, declining_rate_pct = $5, opening_book_value = $6, opening_year = $7,
                  opening_accumulated_depreciation = $8, disposed_on = $9, sale_price = $10, method = 'declining_balance', useful_life_years = null
            where id = $1`,
          [assetId, a.description, a.acquiredOn, a.acquisitionCost, a.ratePct, a.openingBookValue, a.openingYear, a.openingAccumulated, sale.on, sale.price],
        );
        add("historia: investointeja päivitetty");
      }
    }
    // Poistorivit: Tilitukin vuodet sellaisinaan, suljettuihin vuosiin ei kosketa.
    const deps = await tx.query<{ tax_year: number; amount: string; book_value_end: string }>(
      "select tax_year, amount, book_value_end from sk_depreciations where asset_id = $1",
      [assetId],
    );
    const have = new Map(deps.map((d) => [Number(d.tax_year), d]));
    for (const d of a.depreciations) {
      const cur = have.get(d.taxYear);
      if (cur && Number(cur.amount) === d.amount && Number(cur.book_value_end) === d.bookValueEnd) continue;
      if (closed.has(d.taxYear)) {
        add("historia: suljetun vuoden poistoa ei muutettu");
        continue;
      }
      await tx.query(
        `insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1,$2,$3,$4,$5)
         on conflict (asset_id, tax_year) do update set amount = excluded.amount, book_value_end = excluded.book_value_end`,
        [orgId, assetId, d.taxYear, d.amount, d.bookValueEnd],
      );
      add(cur ? "historia: poistoja päivitetty" : "historia: poistoja lisätty");
    }
    // Tilitukin aikajänteeltä ylimääräiset rivit pois (esim. myyntivuosi); myöhemmät vuodet ovat Skogin omia.
    const keepYears = new Set(a.depreciations.map((d) => d.taxYear));
    const extra = [...have.keys()].filter((y) => y <= a.lastYear && !keepYears.has(y) && !closed.has(y));
    if (extra.length) {
      await tx.query("delete from sk_depreciations where asset_id = $1 and tax_year = any($2::int[])", [assetId, extra]);
      add("historia: poistoja poistettu", extra.length);
    }
  }
  // Aineistosta kadonneet kortit pois, jos niitä ei ole muokattu eikä niillä ole suljetun vuoden poistoja.
  for (const ex of existing.filter((e) => !wanted.has(e.legacy_id) && !e.touched && !e.sold_in_ledger)) {
    const [locked] = await tx.query<{ n: number }>(
      `select count(*)::int as n from sk_depreciations d join sk_tax_years y on y.client_id = $2 and y.year = d.tax_year and y.status = 'closed'
        where d.asset_id = $1`,
      [ex.id, clientId],
    );
    if (locked.n || (ex.opening_year !== null && closed.has(Number(ex.opening_year)))) continue;
    await tx.query("delete from sk_assets where id = $1", [ex.id]);
    add("historia: investointeja poistettu");
  }
  return notes;
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
