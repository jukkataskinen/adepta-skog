import type { Sql } from "@/lib/db/types";
import type { AgriAssetClass } from "./rules";
import { agriDepreciation, type AgriAdjustment, type AgriAssetInput, type AgriDepreciationResult, type AgriPool, type AgriRecorded } from "./agri-depreciation";

/**
 * Maatalouden poistojen lähtötiedot kannasta käyttäjän RLS-transaktiossa:
 * maatalouden investoinnit, investointituet, investointeihin käytetyt
 * tasausvaraukset ja kirjatut ryhmäpoistot. Laskenta on puhdas funktio
 * (agri-depreciation.ts), jotta Maatalous-sivu, raportti ja lomake 2 näyttävät
 * samat luvut.
 */

export interface AgriDepreciationSource {
  assets: AgriAssetInput[];
  adjustments: AgriAdjustment[];
  recorded: AgriRecorded[];
}

export async function loadAgriDepreciationSource(tx: Sql, clientId: string): Promise<AgriDepreciationSource> {
  const assets = await tx.query<{
    id: string; description: string; asset_class: AgriAssetClass; accelerated: boolean; acquired_on: string; acquisition_cost: string;
    opening_year: number | null; opening_book_value: string | null; disposed_on: string | null; sale_price: string | null;
  }>(
    `select id, description, asset_class, accelerated, acquired_on::text, acquisition_cost, opening_year, opening_book_value, disposed_on::text, sale_price
       from sk_assets where client_id = $1 and activity = 'agriculture' order by acquired_on, description`,
    [clientId],
  );
  const grants = await tx.query<{ asset_id: string; tax_year: number; amount: string }>(
    "select asset_id, tax_year, amount from sk_asset_adjustments where client_id = $1",
    [clientId],
  );
  const uses = await tx.query<{ asset_id: string; tax_year: number; amount: string }>(
    "select asset_id, tax_year, amount from sk_agri_reserve_uses where client_id = $1 and use_kind = 'asset'",
    [clientId],
  );
  const recorded = await tx.query<{ tax_year: number; pool: AgriPool; amount: string }>(
    "select tax_year, pool, amount from sk_agri_depreciations where client_id = $1",
    [clientId],
  );
  return {
    assets: assets.map((a) => ({
      id: a.id, description: a.description, assetClass: a.asset_class, accelerated: a.accelerated, acquiredOn: a.acquired_on, acquisitionCost: Number(a.acquisition_cost),
      openingYear: a.opening_year === null ? null : Number(a.opening_year), openingBookValue: a.opening_book_value === null ? null : Number(a.opening_book_value),
      disposedOn: a.disposed_on, salePrice: a.sale_price === null ? null : Number(a.sale_price),
    })),
    adjustments: [
      ...grants.map((g) => ({ assetId: g.asset_id, taxYear: Number(g.tax_year), kind: "grant" as const, amount: Number(g.amount) })),
      ...uses.map((u) => ({ assetId: u.asset_id, taxYear: Number(u.tax_year), kind: "equalization" as const, amount: Number(u.amount) })),
    ],
    recorded: recorded.map((r) => ({ taxYear: Number(r.tax_year), pool: r.pool, amount: Number(r.amount) })),
  };
}

export async function loadAgriDepreciation(tx: Sql, clientId: string, year: number, chosen: Partial<Record<AgriPool, number>> = {}): Promise<AgriDepreciationResult> {
  const s = await loadAgriDepreciationSource(tx, clientId);
  return agriDepreciation(s.assets, s.adjustments, s.recorded, year, chosen);
}
