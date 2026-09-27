import type { Sql } from "@/lib/db/types";
import type { TransactionKind } from "@/lib/tax/rules";

/** Kirjanpidon kyselyt. Aina käyttäjän RLS-transaktiossa (ctx.run). */

export interface TransactionRow {
  id: string;
  booked_on: string;
  kind: TransactionKind;
  category: string;
  description: string;
  amount_net: string;
  amount_gross: string;
  vat_rate: string;
  withholding: string;
  reference: string | null;
  asset_id: string | null;
  asset_description: string | null;
  forest_property_id: string | null;
  document_count: number;
  /** Kokoomatiedosto tai saman tiedoston toinen kirjaus (0011). */
  source_document_id: string | null;
  /** Sivut tekstinä "{3,4}" (parsePagesColumn). */
  source_pages: string | null;
}

export async function listTransactions(tx: Sql, clientId: string, year: number): Promise<TransactionRow[]> {
  return tx.query<TransactionRow>(
    `select t.id, t.booked_on::text, t.kind, t.category, t.description, t.amount_net, t.amount_gross, t.vat_rate, t.withholding, t.reference, t.asset_id, t.forest_property_id,
            a.description as asset_description, t.source_document_id, t.source_pages::text as source_pages,
            (select count(*)::int from sk_documents d where d.transaction_id = t.id) as document_count
       from sk_transactions t left join sk_assets a on a.id = t.asset_id
      where t.client_id = $1 and t.tax_year = $2
      order by t.booked_on, t.created_at`,
    [clientId, year],
  );
}

export async function getTransaction(
  tx: Sql,
  clientId: string,
  id: string,
): Promise<(TransactionRow & { tax_year: number; source_file_name: string | null }) | null> {
  const [row] = await tx.query<TransactionRow & { tax_year: number; source_file_name: string | null }>(
    `select t.id, t.booked_on::text, t.tax_year, t.kind, t.category, t.description, t.amount_net, t.amount_gross, t.vat_rate, t.withholding, t.reference, t.asset_id, t.forest_property_id,
            a.description as asset_description, 0 as document_count, t.source_document_id, t.source_pages::text as source_pages, sd.file_name as source_file_name
       from sk_transactions t left join sk_assets a on a.id = t.asset_id
       left join sk_documents sd on sd.id = t.source_document_id
      where t.id = $1 and t.client_id = $2`,
    [id, clientId],
  );
  return row ?? null;
}

export interface DocumentRow {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export async function listTransactionDocuments(tx: Sql, transactionId: string): Promise<DocumentRow[]> {
  return tx.query<DocumentRow>(
    "select id, file_name, content_type, size_bytes, created_at from sk_documents where transaction_id = $1 order by created_at",
    [transactionId],
  );
}

export interface YearInfo {
  year: number;
  status: "open" | "closed";
}

export async function listYears(tx: Sql, clientId: string): Promise<YearInfo[]> {
  return tx.query<YearInfo>("select year, status from sk_tax_years where client_id = $1 order by year desc", [clientId]);
}

/** Oletusvuosi: uusin avoin, muuten uusin. */
export function defaultYear(years: YearInfo[]): number | null {
  return years.find((y) => y.status === "open")?.year ?? years[0]?.year ?? null;
}

export interface AssetOption {
  id: string;
  description: string;
  acquired_on: string;
  disposed_on: string | null;
}

export interface PropertyOption {
  id: string;
  name: string;
}

export async function listPropertyOptions(tx: Sql, clientId: string): Promise<PropertyOption[]> {
  return tx.query<PropertyOption>("select id, name from sk_forest_properties where client_id = $1 order by name", [clientId]);
}

export async function listAssets(tx: Sql, clientId: string): Promise<AssetOption[]> {
  return tx.query<AssetOption>(
    "select id, description, acquired_on::text, disposed_on::text from sk_assets where client_id = $1 order by acquired_on desc",
    [clientId],
  );
}
