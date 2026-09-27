import type { Sql } from "@/lib/db/types";
import { summarize } from "@/lib/ledger/summary";
import { assetYear, type AssetYear } from "./depreciation";
import { forestDeductionBase } from "./forest-deduction";
import type { TransactionKind } from "./rules";

/**
 * Verosuunnitelman lähtötiedot yhdelle asiakkaalle ja vuodelle. Käyttäjän
 * RLS-transaktiossa. Sama haku palvelee suunnitelman näkymää ja vahvistusta,
 * jotta palvelin tarkistaa samoilla luvuilla kuin käyttäjä näki.
 */

export interface PlanAsset {
  id: string;
  description: string;
  method: "straight_line" | "declining_balance";
  decliningRatePct: number | null;
  year: AssetYear;
  /** Tälle vuodelle jo kirjattu poisto (vahvistettu suunnitelma). */
  recorded: number | null;
}

export interface PlanProperty {
  id: string;
  name: string;
  /** Käyttämätön pohja ilman tämän vuoden kirjattua vähennystä, jotta suunnitelman voi tehdä uudelleen. */
  remaining: number | null;
  recordedThisYear: number;
}

export interface PlanData {
  income: number;
  expense: number;
  /** Oman hankintatyön arvo: vähennetään metsävähennyksen vuosirajan tulosta. */
  deliveryWork: number;
  investment: number;
  withholding: number;
  assets: PlanAsset[];
  properties: PlanProperty[];
  recordedDeduction: number;
  confirmed: boolean;
}

export async function loadPlanData(tx: Sql, clientId: string, year: number): Promise<PlanData> {
  const rows = await tx.query<{ kind: TransactionKind; category: string; asset_id: string | null; amount_net: string; vat_rate: string; withholding: string }>(
    "select kind, category, asset_id, amount_net, vat_rate, withholding from sk_transactions where client_id = $1 and tax_year = $2",
    [clientId, year],
  );
  // Investointiin liitetyn myynnin hinta ei ole tuloa sellaisenaan: verotettavaa on vain
  // myyntivoitto (tai vähennettävää myyntitappio), joka lasketaan investoinnista.
  // Muuten myyntihinta ja myyntivoitto tulisivat laskelmaan kahteen kertaan.
  const sum = summarize(
    rows.map((r) => ({
      kind: r.kind,
      amountNet: r.category === "asset_sale" && r.asset_id ? 0 : Number(r.amount_net),
      vatRate: Number(r.vat_rate),
      withholding: Number(r.withholding),
    })),
  );

  const assets = await tx.query<{
    id: string; description: string; acquired_on: string; acquisition_cost: string; method: "straight_line" | "declining_balance";
    useful_life_years: number | null; declining_rate_pct: string | null; opening_book_value: string | null; disposed_on: string | null; sale_price: string | null;
    deps: { taxYear: number; amount: string; bookValueEnd: string }[] | null;
  }>(
    `select a.id, a.description, a.acquired_on::text, a.acquisition_cost, a.method, a.useful_life_years, a.declining_rate_pct, a.opening_book_value,
            a.disposed_on::text, a.sale_price,
            (select json_agg(json_build_object('taxYear', d.tax_year, 'amount', d.amount, 'bookValueEnd', d.book_value_end)) from sk_depreciations d where d.asset_id = a.id) as deps
       from sk_assets a where a.client_id = $1 order by a.acquired_on`,
    [clientId],
  );
  const planAssets: PlanAsset[] = [];
  for (const a of assets) {
    const deps = (a.deps ?? []).map((d) => ({ taxYear: Number(d.taxYear), amount: Number(d.amount), bookValueEnd: Number(d.bookValueEnd) }));
    const y = assetYear(
      {
        acquiredOn: a.acquired_on, acquisitionCost: Number(a.acquisition_cost), method: a.method, usefulLifeYears: a.useful_life_years,
        decliningRatePct: a.declining_rate_pct === null ? null : Number(a.declining_rate_pct),
        openingBookValue: a.opening_book_value === null ? null : Number(a.opening_book_value),
        disposedOn: a.disposed_on, salePrice: a.sale_price === null ? null : Number(a.sale_price),
      },
      deps,
      year,
    );
    if (!y.active) continue;
    planAssets.push({ id: a.id, description: a.description, method: a.method, decliningRatePct: a.declining_rate_pct === null ? null : Number(a.declining_rate_pct), year: y, recorded: deps.find((d) => d.taxYear === year)?.amount ?? null });
  }

  const props = await tx.query<{
    id: string; name: string; acquisition_price: string | null; forest_land_share_pct: string | null; deduction_used_before: string;
    ded: { taxYear: number; amount: string }[] | null;
  }>(
    `select p.id, p.name, p.acquisition_price, p.forest_land_share_pct, p.deduction_used_before,
            (select json_agg(json_build_object('taxYear', d.tax_year, 'amount', d.amount)) from sk_forest_deductions d where d.forest_property_id = p.id) as ded
       from sk_forest_properties p where p.client_id = $1 order by p.acquired_on nulls last, p.name`,
    [clientId],
  );
  const properties: PlanProperty[] = props.map((p) => {
    const ded = (p.ded ?? []).map((d) => ({ taxYear: Number(d.taxYear), amount: Number(d.amount) }));
    const base = forestDeductionBase({
      acquisitionPrice: p.acquisition_price === null ? null : Number(p.acquisition_price),
      forestLandSharePct: p.forest_land_share_pct === null ? null : Number(p.forest_land_share_pct),
      usedBefore: Number(p.deduction_used_before),
      recorded: ded.filter((d) => d.taxYear !== year).map((d) => d.amount),
    }, year);
    return { id: p.id, name: p.name, remaining: base.remaining, recordedThisYear: ded.find((d) => d.taxYear === year)?.amount ?? 0 };
  });

  const recordedDeduction = properties.reduce((s, p) => s + p.recordedThisYear, 0);
  return {
    income: sum.income.net,
    expense: sum.expense.net,
    deliveryWork: Math.round(rows.filter((r) => r.category === "delivery_work").reduce((s, r) => s + Number(r.amount_net), 0) * 100) / 100,
    investment: sum.investment.net,
    withholding: sum.withholding,
    assets: planAssets,
    properties,
    recordedDeduction,
    confirmed: recordedDeduction > 0 || planAssets.some((a) => a.recorded !== null),
  };
}

/** Poistojen ja myyntien summat valituilla poistoilla. Poistot ovat vapaaehtoisia, enintään vuoden enimmäismäärä. */
export function planTotals(data: PlanData, chosen: Record<string, number>) {
  let depreciation = 0;
  let saleGain = 0;
  let saleLoss = 0;
  let salePrices = 0;
  for (const a of data.assets) {
    if (a.year.sold) {
      saleGain += a.year.saleGain;
      saleLoss += a.year.saleLoss;
      salePrices += a.year.salePrice;
    } else depreciation += Math.min(Math.max(chosen[a.id] ?? 0, 0), a.year.max);
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { depreciation: r(depreciation), saleGain: r(saleGain), saleLoss: r(saleLoss), salePrices: r(salePrices) };
}
