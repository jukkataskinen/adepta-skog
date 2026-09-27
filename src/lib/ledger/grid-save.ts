import type { Sql } from "@/lib/db/types";
import { listPropertyOptions, listTransactions } from "@/lib/ledger/queries";
import { DEPRECIATED_MESSAGE } from "@/lib/ledger/transaction-input";
import { deleteTransaction, LedgerError, saveTransaction, type Actor } from "@/lib/ledger/write";
import { MAX_GRID_ROWS, planGridChanges, rowFromStored, validateGridRow, type GridRow, type RowErrors, type ValidGridRow } from "@/lib/ledger/grid";

/**
 * Kirjanpidon taulukon tallennus käyttäjän RLS-transaktiossa. Kaikki tai ei
 * mitään: muuttuneet rivit päivitetään paikallaan (tositteet, loki ja
 * investoinnin linkki säilyvät), uudet lisätään ja poistetut poistetaan samoilla
 * säännöillä kuin lomakkeella (src/lib/ledger/write.ts). Virhe heitetään
 * GridSaveErrorina, jolloin koko transaktio perutaan ja virheet näytetään riveittäin.
 */

export class GridSaveError extends Error {
  constructor(
    message: string,
    public rowErrors: Record<string, RowErrors> = {},
  ) {
    super(message);
  }
}

export interface GridSaveResult {
  created: number;
  updated: number;
  deleted: number;
}

const plural = (n: number) => (n === 1 ? "Yhdellä rivillä on virhe." : `${n} rivillä on virhe.`);

export async function saveLedgerGrid(
  tx: Sql,
  input: { actor: Actor; clientId: string; year: number; rows: GridRow[]; deletedIds: string[] },
): Promise<GridSaveResult> {
  const { actor, clientId, year } = input;
  if (input.rows.length > MAX_GRID_ROWS) throw new GridSaveError(`Taulukossa voi olla enintään ${MAX_GRID_ROWS} riviä.`);

  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (!y) throw new GridSaveError(`Verovuotta ${year} ei ole avattu. Avaa vuosi asiakkaan sivulla.`);
  if (y.status === "closed") throw new GridSaveError(`Verovuosi ${year} on suljettu. Pääkäyttäjä voi avata vuoden.`);
  const [client] = await tx.query<{ vat_registered: boolean }>("select vat_registered from sk_clients where id = $1", [clientId]);
  if (!client) throw new GridSaveError("Asiakasta ei löytynyt.");

  // Vertailu tehdään kannan nykytilaa vasten, ei selaimen muistamaa alkuperäistä.
  const stored = await listTransactions(tx, clientId, year);
  const original = stored.map(rowFromStored);
  const storedById = new Map(stored.map((t) => [t.id, t]));
  // Investoinnin linkki tulee kannasta, ei selaimelta.
  const rows = input.rows.map((r) => (r.id ? { ...r, assetId: storedById.get(r.id)?.asset_id ?? null } : { ...r, assetId: null }));
  const changes = planGridChanges(original, rows, input.deletedIds, year);
  const staleDeletes = changes.deleted.filter((id) => !storedById.has(id));
  if (changes.unknown.length || staleDeletes.length) {
    throw new GridSaveError("Kirjauksia on muutettu toisaalla sillä välin. Lataa sivu uudelleen, niin näet nykytilan.");
  }

  const properties = await listPropertyOptions(tx, clientId);
  const assets = await tx.query<{ id: string; disposed_on: string | null }>("select id, disposed_on::text from sk_assets where client_id = $1", [clientId]);
  const unsold = assets.filter((a) => !a.disposed_on).map((a) => a.id);
  const opts = {
    year,
    propertyIds: properties.map((p) => p.id),
    vatRegistered: client.vat_registered,
    saleableAssetIds: (r: GridRow) => (r.assetId ? [...unsold, r.assetId] : unsold),
  };

  const rowErrors: Record<string, RowErrors> = {};
  const valid: ValidGridRow[] = [];
  for (const r of [...changes.updated, ...changes.created]) {
    const res = validateGridRow(r, opts);
    if (res.ok) valid.push(res.value);
    else rowErrors[r.key] = res.errors;
  }
  const errorCount = Object.keys(rowErrors).length;
  if (errorCount) throw new GridSaveError(`${plural(errorCount)} Mitään ei tallennettu.`, rowErrors);

  // Poistettavan hankinnan investoinnista ei saa olla poistoja. Tarkistetaan ennen kirjoituksia, jotta viesti on selvä.
  const deletedAssets = changes.deleted.map((id) => storedById.get(id)!).filter((t) => t.category === "asset_purchase" && t.asset_id);
  if (deletedAssets.length) {
    const dep = await tx.query<{ asset_id: string }>("select distinct asset_id from sk_depreciations where asset_id = any($1::uuid[])", [
      deletedAssets.map((t) => t.asset_id),
    ]);
    if (dep.length) {
      const names = deletedAssets.filter((t) => dep.some((d) => d.asset_id === t.asset_id)).map((t) => t.description || "investointi");
      throw new GridSaveError(`${DEPRECIATED_MESSAGE} Palauta poistettu rivi (Ctrl + Z): ${names.join(", ")}.`);
    }
  }

  const details = { source: "table" };
  for (const id of changes.deleted) await deleteTransaction(tx, actor, clientId, id, details);
  for (const v of valid) {
    try {
      await saveTransaction(
        tx,
        actor,
        clientId,
        v.id,
        {
          bookedOn: v.bookedOn, category: v.category, kind: v.kind, description: v.description, amountGross: v.amountGross, vatRate: v.vatRate,
          withholding: v.withholding, reference: v.reference, forestPropertyId: v.forestPropertyId, assetRatePct: v.assetRatePct, saleAssetId: v.saleAssetId,
        },
        details,
      );
    } catch (err) {
      if (err instanceof LedgerError) throw new GridSaveError(`${plural(1)} Mitään ei tallennettu.`, { [v.key]: { category: err.message } });
      throw err;
    }
  }
  return { created: changes.created.length, updated: changes.updated.length, deleted: changes.deleted.length };
}
