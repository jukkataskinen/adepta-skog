import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { listPropertyOptions } from "@/lib/ledger/queries";
import { MAX_BATCH_ROWS, validateBatch, type BatchRowInput, type BatchState } from "@/lib/ledger/transaction-input";

/**
 * Taulukkosyötön tallennus käyttäjän RLS-transaktiossa. Kaikki tai ei mitään:
 * jos yksikin rivi on virheellinen, mitään ei tallenneta ja virheet palautetaan
 * rivin avaimella, jotta kirjanpitäjä voi korjata ne menettämättä syötettyä.
 */
export async function saveTransactionBatch(
  tx: Sql,
  input: { organizationId: string; userId: string; clientId: string; year: number; rows: BatchRowInput[] },
): Promise<BatchState> {
  const error = (message: string, rowErrors: Record<string, Record<string, string>> = {}): BatchState => ({ status: "error", message, rowErrors });
  if (input.rows.length > MAX_BATCH_ROWS) return error(`Tallenna kerralla enintään ${MAX_BATCH_ROWS} riviä.`);

  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [input.clientId, input.year]);
  if (!y) return error(`Verovuotta ${input.year} ei ole avattu. Avaa vuosi asiakkaan sivulla.`);
  if (y.status === "closed") return error(`Verovuosi ${input.year} on suljettu. Pääkäyttäjä voi avata vuoden.`);

  const properties = await listPropertyOptions(tx, input.clientId);
  const { valid, rowErrors, hasErrors } = validateBatch(input.rows, { year: input.year, propertyIds: properties.map((p) => p.id) });
  if (hasErrors) {
    const n = Object.keys(rowErrors).length;
    return error(n === 1 ? "Yhdellä rivillä on virhe. Mitään ei tallennettu." : `${n} rivillä on virhe. Mitään ei tallennettu.`, rowErrors);
  }
  if (valid.length === 0) return error("Taulukossa ei ole tallennettavia rivejä.");

  for (const r of valid) {
    const [row] = await tx.query<{ id: string }>(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, withholding, reference,
                                    forest_property_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [input.organizationId, input.clientId, r.bookedOn, r.kind, r.category, r.description, r.amountNet, r.vatRate, r.withholding, r.reference,
        r.forestPropertyId, input.userId],
    );
    // Loki kirjauksittain kuten lomakkeella, jotta jokaisen kirjauksen historia löytyy samalla tavalla.
    await audit(tx, {
      organizationId: input.organizationId, userId: input.userId, action: "transaction.create", entity: "sk_transactions", entityId: row.id,
      details: { source: "table" },
    });
  }
  return { status: "saved", count: valid.length };
}
