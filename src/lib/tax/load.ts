import type { Sql } from "@/lib/db/types";
import { summarize } from "@/lib/ledger/summary";
import { assetYear, type AssetYear } from "./depreciation";
import { forestDeductionBase } from "./forest-deduction";
import { disposalFractions, forestDeductionPool, forestDeductionTracking, forestSales, soldSharePct, type ForestPropertyInput, type ForestSale } from "./forest-sale";
import { isRoadOrDitch, type Activity, type TransactionKind } from "./rules";
import { activityRows } from "./share";

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
  acquiredOn: string;
  acquisitionCost: number;
  /**
   * Poistamaton arvo ennen Skogia: aiempi investointi (year = ensimmäinen
   * poistovuosi, arvo on vuoden year − 1 lopussa) tai vanhasta sovelluksesta
   * tuotu poistamaton arvo (year null). null, jos kohde on hankittu Skogissa.
   */
  opening: PriorOpening | null;
  year: AssetYear;
  /** Tälle vuodelle jo kirjattu poisto (vahvistettu suunnitelma). */
  recorded: number | null;
}

export interface PriorOpening {
  year: number | null;
  accumulated: number;
  bookValue: number;
}

/**
 * Hankintahinta, kertynyt poisto ja menojäännös ennen Skogia. Jos kertynyttä
 * poistoa ei ole tallennettu (vanhan sovelluksen tuonti), se lasketaan
 * hankintahinnasta ja poistamattomasta arvosta.
 */
export function priorOpening(a: { acquisitionCost: number; openingBookValue: number | null; openingYear: number | null; openingAccumulated: number | null }): PriorOpening | null {
  if (a.openingBookValue === null) return null;
  const accumulated = a.openingAccumulated ?? Math.max(0, Math.round((a.acquisitionCost - a.openingBookValue) * 100) / 100);
  return { year: a.openingYear, accumulated, bookValue: a.openingBookValue };
}

/**
 * Aiemman investoinnin tai vanhasta ohjelmasta tuodun kohteen lähtötiedot:
 * hankintahinta, kertynyt poisto ja menojäännös ennen Skogia.
 */
export function priorOpeningText(acquisitionCost: number, opening: PriorOpening | null): string | null {
  if (!opening) return null;
  if (opening.year === null) {
    return `Tuotu vanhasta ohjelmasta: hankintahinta ${euro(acquisitionCost)}, kertynyt poisto ${euro(opening.accumulated)}, poistamaton arvo ${euro(opening.bookValue)}`;
  }
  const end = `31.12.${opening.year - 1}`;
  return `Aiempi investointi: hankintahinta ${euro(acquisitionCost)}, kertynyt poisto ${end} ${euro(opening.accumulated)}, menojäännös ${end} ${euro(opening.bookValue)}`;
}

const euro = (n: number) => (n + 0).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export interface PlanProperty {
  id: string;
  name: string;
  /** Käyttämätön pohja ilman tämän vuoden kirjattua vähennystä, jotta suunnitelman voi tehdä uudelleen. */
  remaining: number | null;
  recordedThisYear: number;
}

export type PlanForestSale = ForestSale & { name: string };

export interface PlanData {
  income: number;
  expense: number;
  /** Oman hankintatyön arvo: vähennetään metsävähennyksen vuosirajan tulosta. */
  deliveryWork: number;
  investment: number;
  withholding: number;
  assets: PlanAsset[];
  /** Vuonna omistetut tilat: metsävähennys tallennetaan niille. */
  properties: PlanProperty[];
  /** Käyttämätön metsävähennyspohja kaikista metsistä yhteensä (verovelvolliskohtainen). */
  deductionPool: number | null;
  /** Vuoden metsätilan luovutukset ja luovutusvoittoon lisättävä metsävähennys. */
  forestSales: PlanForestSale[];
  recordedDeduction: number;
  confirmed: boolean;
  /**
   * Hyödykkeet, joiden koko arvo siirtyi tänä vuonna metsän hankintamenoon
   * (koko tila myyty). Ne eivät ole enää aktiivisia, mutta veroilmoituksen
   * poistotaulukossa ne ovat luovutuksia.
   */
  transfersOut: { method: "straight_line" | "declining_balance"; decliningRatePct: number | null; acquiredOn: string; amount: number }[];
  /** Metsävähennyksen seurantatiedot veroilmoitukselle (forestDeductionTracking). */
  deductionTracking: ReturnType<typeof forestDeductionTracking>;
}

export async function loadPlanData(tx: Sql, clientId: string, year: number): Promise<PlanData> {
  const stored = await tx.query<{
    kind: TransactionKind; category: string; asset_id: string | null; amount_net: string; amount_gross: string; withholding: string; business_share_pct: string;
    other_share_pct: string; activity: Activity;
  }>(
    `select kind, category, asset_id, amount_net, amount_gross, withholding, business_share_pct, other_share_pct, activity
       from sk_transactions where client_id = $1 and tax_year = $2`,
    [clientId, year],
  );
  // Metsätalouteen vain metsätalouden kirjausten osuus ja maatalouden kirjausten
  // metsätaloudelle annettu osuus (src/lib/tax/share.ts, activityRows).
  const rows = activityRows(
    stored.map((r) => ({
      ...r, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct),
    })),
    "forestry",
  );
  // Investointiin liitetyn myynnin hinta ei ole tuloa sellaisenaan: verotettavaa on vain
  // myyntivoitto (tai vähennettävää myyntitappio), joka lasketaan investoinnista.
  // Muuten myyntihinta ja myyntivoitto tulisivat laskelmaan kahteen kertaan.
  const sum = summarize(
    rows.map((r) => ({
      kind: r.kind,
      amountNet: r.category === "asset_sale" && r.asset_id ? 0 : r.amountNet,
      amountGross: r.category === "asset_sale" && r.asset_id ? 0 : r.amountGross,
      withholding: r.cross ? 0 : Number(r.withholding),
    })),
  );

  const props = await tx.query<{
    id: string; name: string; acquisition_price: string | null; acquired_on: string | null; forest_land_share_pct: string | null; deduction_used_before: string;
    ded: { taxYear: number; amount: string }[] | null;
  }>(
    `select p.id, p.name, p.acquisition_price, p.acquired_on::text, p.forest_land_share_pct, p.deduction_used_before,
            (select json_agg(json_build_object('taxYear', d.tax_year, 'amount', d.amount)) from sk_forest_deductions d where d.forest_property_id = p.id) as ded
       from sk_forest_properties p where p.client_id = $1 order by p.acquired_on nulls last, p.name`,
    [clientId],
  );
  const disposals = await tx.query<{
    id: string; forest_property_id: string; disposed_on: string; sale_price: string; share_pct: string; selling_costs: string; no_deduction_addition: boolean;
  }>(
    `select id, forest_property_id, disposed_on::text, sale_price, share_pct, selling_costs, no_deduction_addition
       from sk_forest_property_disposals where client_id = $1 order by disposed_on, id`,
    [clientId],
  );
  const disposalsOf = (propertyId: string) => disposals.filter((d) => d.forest_property_id === propertyId);
  const fractions = new Map(props.map((p) => [p.id, disposalFractions(disposalsOf(p.id).map((d) => ({ disposedOn: d.disposed_on, sharePct: Number(d.share_pct) })))]));

  const assets = await tx.query<{
    id: string; description: string; acquired_on: string; acquisition_cost: string; method: "straight_line" | "declining_balance";
    useful_life_years: number | null; declining_rate_pct: string | null; opening_book_value: string | null; disposed_on: string | null; sale_price: string | null;
    opening_year: number | null; opening_accumulated_depreciation: string | null;
    forest_property_id: string | null;
    deps: { taxYear: number; amount: string; bookValueEnd: string }[] | null;
  }>(
    `select a.id, a.description, a.acquired_on::text, a.acquisition_cost, a.method, a.useful_life_years, a.declining_rate_pct, a.opening_book_value,
            a.disposed_on::text, a.sale_price, a.forest_property_id, a.opening_year, a.opening_accumulated_depreciation,
            (select json_agg(json_build_object('taxYear', d.tax_year, 'amount', d.amount, 'bookValueEnd', d.book_value_end)) from sk_depreciations d where d.asset_id = a.id) as deps
       from sk_assets a where a.client_id = $1 and a.activity = 'forestry' order by a.acquired_on`,
    [clientId],
  );
  const planAssets: PlanAsset[] = [];
  const transfersOut: PlanData["transfersOut"] = [];
  // Tien ja ojan poistamaton arvo, joka siirtyy luovutusvuonna metsän hankintamenoon: tila → vuosi → euroa.
  const roadDitch = new Map<string, Map<number, number>>();
  for (const a of assets) {
    const deps = (a.deps ?? []).map((d) => ({ taxYear: Number(d.taxYear), amount: Number(d.amount), bookValueEnd: Number(d.bookValueEnd) }));
    const rate = a.declining_rate_pct === null ? null : Number(a.declining_rate_pct);
    const transfers = a.forest_property_id && isRoadOrDitch({ method: a.method, decliningRatePct: rate }) ? fractions.get(a.forest_property_id) ?? [] : [];
    const input = {
      acquiredOn: a.acquired_on, acquisitionCost: Number(a.acquisition_cost), method: a.method, usefulLifeYears: a.useful_life_years,
      decliningRatePct: rate,
      openingBookValue: a.opening_book_value === null ? null : Number(a.opening_book_value),
      openingYear: a.opening_year === null ? null : Number(a.opening_year),
      disposedOn: a.disposed_on, salePrice: a.sale_price === null ? null : Number(a.sale_price),
      transferFractions: transfers,
    };
    for (const t of transfers) {
      const moved = assetYear(input, deps, t.year).transferred;
      if (!moved) continue;
      const byYear = roadDitch.get(a.forest_property_id!) ?? new Map<number, number>();
      byYear.set(t.year, (byYear.get(t.year) ?? 0) + moved);
      roadDitch.set(a.forest_property_id!, byYear);
    }
    const y = assetYear(input, deps, year);
    if (!y.active) {
      if (y.transferred > 0) transfersOut.push({ method: a.method, decliningRatePct: rate, acquiredOn: a.acquired_on, amount: y.transferred });
      continue;
    }
    const opening = priorOpening({
      acquisitionCost: input.acquisitionCost, openingBookValue: input.openingBookValue, openingYear: input.openingYear,
      openingAccumulated: a.opening_accumulated_depreciation === null ? null : Number(a.opening_accumulated_depreciation),
    });
    planAssets.push({
      id: a.id, description: a.description, method: a.method, decliningRatePct: rate, acquiredOn: a.acquired_on, acquisitionCost: input.acquisitionCost, opening, year: y,
      recorded: deps.find((d) => d.taxYear === year)?.amount ?? null,
    });
  }

  const num = (v: string | null) => (v === null ? null : Number(v));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const inputs: (ForestPropertyInput & { name: string })[] = props.map((p) => {
    const own = disposalsOf(p.id);
    // Vuoden siirtyvä tie- ja ojamenojen arvo jaetaan saman vuoden luovutuksille osuuksien suhteessa.
    const sharesInYear = (y: string) => own.filter((d) => d.disposed_on.slice(0, 4) === y).reduce((s, d) => s + Number(d.share_pct), 0);
    return {
      id: p.id,
      name: p.name,
      acquisitionPrice: num(p.acquisition_price),
      acquiredOn: p.acquired_on,
      forestLandSharePct: num(p.forest_land_share_pct),
      usedBefore: Number(p.deduction_used_before),
      deductions: (p.ded ?? []).map((d) => ({ taxYear: Number(d.taxYear), amount: Number(d.amount) })),
      disposals: own.map((d) => {
        const y = d.disposed_on.slice(0, 4);
        const moved = roadDitch.get(p.id)?.get(Number(y)) ?? 0;
        return {
          id: d.id, disposedOn: d.disposed_on, salePrice: Number(d.sale_price), sharePct: Number(d.share_pct), sellingCosts: Number(d.selling_costs),
          noDeductionAddition: d.no_deduction_addition, roadDitchCost: r2((moved * Number(d.share_pct)) / sharesInYear(y)),
        };
      }),
    };
  });
  // Vuoden lopussa omistetut tilat: myyty osuus ei tuo pohjaa enää luovutusvuonna (Metsävähennys, luku 3.4).
  const owned = inputs.filter((p) => soldSharePct(p, year) < 100);
  const properties: PlanProperty[] = owned.map((p) => {
    const left = 100 - soldSharePct(p, year);
    const base = forestDeductionBase(
      {
        acquisitionPrice: p.acquisitionPrice === null ? null : (p.acquisitionPrice * left) / 100,
        forestLandSharePct: p.forestLandSharePct, usedBefore: p.usedBefore, recorded: p.deductions.filter((d) => d.taxYear !== year).map((d) => d.amount),
      },
      year,
    );
    return { id: p.id, name: p.name, remaining: base.remaining, recordedThisYear: p.deductions.find((d) => d.taxYear === year)?.amount ?? 0 };
  });
  const names = new Map(inputs.map((p) => [p.id, p.name]));
  const sales: PlanForestSale[] = forestSales(inputs)
    .filter((x) => x.year === year)
    .map((x) => ({ ...x, name: names.get(x.propertyId) ?? "" }));

  const recordedDeduction = properties.reduce((s, p) => s + p.recordedThisYear, 0);
  return {
    income: sum.income.net,
    expense: sum.expense.net,
    deliveryWork:
      Math.round(
        rows
          .filter((r) => r.category === "delivery_work")
          .reduce((s, r) => s + r.amountNet, 0) * 100,
      ) / 100,
    investment: sum.investment.net,
    withholding: sum.withholding,
    assets: planAssets,
    properties,
    deductionPool: forestDeductionPool(inputs, year),
    forestSales: sales,
    recordedDeduction,
    transfersOut,
    deductionTracking: forestDeductionTracking(inputs, year),
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
  // Metsätilan luovutusvoitto tai -tappio (lisäyksineen) samaan luovutusvoittojen summaan.
  for (const f of data.forestSales) {
    if (f.gain >= 0) saleGain += f.gain;
    else saleLoss -= f.gain;
    salePrices += f.salePrice;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { depreciation: r(depreciation), saleGain: r(saleGain), saleLoss: r(saleLoss), salePrices: r(salePrices) };
}
