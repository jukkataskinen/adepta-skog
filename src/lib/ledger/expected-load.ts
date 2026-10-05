import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import type { Activity, TransactionKind } from "@/lib/tax/rules";
import { EXPECTED_DEFAULTS, expectedStatus, findExpected, type ExpectedState, type HistoryEntry } from "@/lib/ledger/expected";

/**
 * Odotettujen kirjausten haku ja ohitukset (0019). Aina käyttäjän
 * RLS-transaktiossa. Historia luetaan yhdellä kyselyllä indeksin
 * sk_transactions_client_year kautta, ja laskenta tehdään palvelimella.
 */

interface Row {
  id: string;
  tax_year: number;
  booked_on: string;
  category: string;
  kind: TransactionKind;
  activity: Activity;
  description: string;
  amount_gross: string;
  vat_rate: string;
  business_share_pct: string;
  other_share_pct: string;
  farm_id: string | null;
  forest_property_id: string | null;
}

export interface ExpectedView {
  states: ExpectedState[];
  /** Aiempia kirjausvuosia tarkastelujaksolla: 0 = uusi asiakas, ennuste alkaa toisesta vuodesta. */
  historyYears: number;
}

/**
 * Vuoden odotetut kirjaukset toiminnolle (null = kaikki). today on päivä,
 * johon myöhästyminen verrataan (vvvv-kk-pp, Helsingin aika).
 */
export async function loadExpected(
  tx: Sql,
  client: { id: string; vatRegistered: boolean },
  year: number,
  view: Activity | null,
  today: string,
): Promise<ExpectedView> {
  const rows = await tx.query<Row>(
    `select id, tax_year, booked_on::text, category, kind, activity, description, amount_gross, vat_rate, business_share_pct, other_share_pct,
            farm_id, forest_property_id
       from sk_transactions
      where client_id = $1 and tax_year between $2 and $3 ${view ? "and activity = $4" : ""}`,
    view ? [client.id, year - EXPECTED_DEFAULTS.historyYears, year, view] : [client.id, year - EXPECTED_DEFAULTS.historyYears, year],
  );
  const skips = await tx.query<{ expected_key: string }>("select expected_key from sk_expected_skips where client_id = $1 and tax_year = $2", [client.id, year]);
  const entries: (HistoryEntry & { id: string })[] = rows.map((r) => ({
    id: r.id,
    year: Number(r.tax_year),
    bookedOn: r.booked_on,
    category: r.category,
    kind: r.kind,
    activity: r.activity,
    description: r.description ?? "",
    amountGross: Number(r.amount_gross),
    vatRate: Number(r.vat_rate),
    businessSharePct: Number(r.business_share_pct),
    otherSharePct: Number(r.other_share_pct),
    farmId: r.farm_id,
    forestPropertyId: r.forest_property_id,
  }));
  const history = entries.filter((e) => e.year < year);
  const expected = findExpected(history, { year, vatRegistered: client.vatRegistered });
  const states = expectedStatus(
    expected,
    entries.filter((e) => e.year === year),
    { year, today, skipped: skips.map((s) => s.expected_key) },
  );
  const historyYears = new Set(history.filter((e) => e.year >= year - EXPECTED_DEFAULTS.lookbackYears).map((e) => e.year)).size;
  return { states, historyYears };
}

/** Merkitsee odotetun kirjauksen ohitetuksi vuodelle ("ei tule tänä vuonna") tai palauttaa sen. */
export async function setExpectedSkip(
  tx: Sql,
  actor: { organizationId: string; userId: string },
  clientId: string,
  year: number,
  key: string,
  skip: boolean,
): Promise<void> {
  if (skip) {
    const [row] = await tx.query<{ id: string }>(
      `insert into sk_expected_skips (organization_id, client_id, tax_year, expected_key, created_by) values ($1, $2, $3, $4, $5)
       on conflict (client_id, tax_year, expected_key) do nothing returning id`,
      [actor.organizationId, clientId, year, key, actor.userId],
    );
    if (row) await audit(tx, { ...actor, action: "expected.skip", entity: "sk_expected_skips", entityId: row.id, details: { year, key } });
    return;
  }
  const rows = await tx.query<{ id: string }>("delete from sk_expected_skips where client_id = $1 and tax_year = $2 and expected_key = $3 returning id", [
    clientId, year, key,
  ]);
  for (const r of rows) await audit(tx, { ...actor, action: "expected.unskip", entity: "sk_expected_skips", entityId: r.id, details: { year, key } });
}
