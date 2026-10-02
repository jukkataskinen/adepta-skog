import type { Sql } from "@/lib/db/types";
import { getAgriYear, listExtras } from "@/lib/agriculture/year";
import { computeForm2, type Form2Input, type Form2Result } from "./agriculture";
import { loadAgriDepreciation, loadAgriDepreciationSource } from "./agri-load";
import type { AgriPlanData, PlanReserve } from "./agri-plan";
import type { Activity, TransactionKind } from "./rules";
import { activityRows } from "./share";

/**
 * Lomakkeen 2 lähtötiedot kannasta käyttäjän RLS-transaktiossa. Samat luvut
 * palvelevat Maatalous-välilehteä, veroraporttia ja VSY002-tiedostoa.
 * Toimii myös suljetulle vuodelle, koska mitään ei kirjoiteta.
 */

const DEFERRAL_KIND: Record<string, "livestock_sale" | "livestock_purchase"> = {
  agri_livestock_sale_deferred: "livestock_sale",
  agri_livestock_purchase_deferred: "livestock_purchase",
};

export async function loadForm2Input(tx: Sql, clientId: string, year: number): Promise<Form2Input | null> {
  const [c] = await tx.query<{ vat_registered: boolean }>("select vat_registered from sk_clients where id = $1", [clientId]);
  if (!c) return null;
  // Kolmen vuoden kirjaukset: kotieläinten jaksotukset jakautuvat kolmelle vuodelle.
  const stored = await tx.query<{
    tax_year: number; kind: TransactionKind; category: string; amount_net: string; amount_gross: string; vat_rate: string; business_share_pct: string;
    other_share_pct: string; activity: Activity;
  }>(
    `select tax_year, kind, category, amount_net, amount_gross, vat_rate, business_share_pct, other_share_pct, activity
       from sk_transactions where client_id = $1 and tax_year between $2 - 2 and $2 order by booked_on, created_at`,
    [clientId, year],
  );
  // Maatalouteen maatalouden kirjausten oma osuus ja metsätalouden kirjausten maataloudelle annettu osuus.
  const parts = activityRows(
    stored.map((r) => ({
      ...r, tax_year: Number(r.tax_year), amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), vatRate: Number(r.vat_rate),
      businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct),
    })),
    "agriculture",
  );
  const rows = parts.filter((r) => r.tax_year === year).map((r) => ({ kind: r.kind, category: r.category, amountNet: r.amountNet, amountGross: r.amountGross, vatRate: r.vatRate }));
  // Jaksotettava hankinta on meno: verollisena, jos asiakas ei ole alv-velvollinen. Myynti aina ilman veroa.
  const ledgerDeferrals = parts
    .filter((r) => DEFERRAL_KIND[r.category])
    .map((r) => {
      const kind = DEFERRAL_KIND[r.category];
      return { year: r.tax_year, kind, amount: kind === "livestock_purchase" && !c.vat_registered ? r.amountGross : r.amountNet };
    });
  const manual = await tx.query<{ tax_year: number; kind: "livestock_sale" | "livestock_purchase"; year1: string; year2: string; year3: string }>(
    "select tax_year, kind, year1, year2, year3 from sk_agri_deferrals where client_id = $1 and tax_year between $2 - 2 and $2",
    [clientId, year],
  );
  const reserves = await tx.query<{ kind: "equalization" | "replacement"; made_year: number; amount: string; used: string; income: string }>(
    `select r.kind, r.made_year, r.amount,
            coalesce((select sum(u.amount) from sk_agri_reserve_uses u where u.reserve_id = r.id and u.tax_year <= $2), 0) as used,
            coalesce((select sum(u.amount) from sk_agri_reserve_uses u where u.reserve_id = r.id and u.tax_year = $2 and u.use_kind = 'income'), 0) as income
       from sk_agri_reserves r where r.client_id = $1 and r.made_year <= $2`,
    [clientId, year],
  );
  const y = await getAgriYear(tx, clientId, year);
  return {
    year,
    vatRegistered: c.vat_registered,
    rows,
    ledgerDeferrals,
    manualDeferrals: manual.map((m) => ({ year: Number(m.tax_year), kind: m.kind, year1: Number(m.year1), year2: Number(m.year2), year3: Number(m.year3) })),
    depreciation: await loadAgriDepreciation(tx, clientId, year),
    reserves: reserves.map((r) => ({
      kind: r.kind, madeYear: Number(r.made_year), amount: Number(r.amount), usedThroughYear: Number(r.used), incomeThisYear: Number(r.income),
    })),
    agriYear: y,
    extras: await listExtras(tx, clientId, year),
  };
}

export async function loadForm2(tx: Sql, clientId: string, year: number): Promise<Form2Result | null> {
  const input = await loadForm2Input(tx, clientId, year);
  return input ? computeForm2(input) : null;
}

/**
 * Verosuunnitelman maatalousosan lähtötiedot (agri-plan.ts). Edellisen vuoden
 * nettovarallisuus lasketaan Skogin edellisen vuoden lomakkeesta 2, jos se
 * vuosi on Skogissa ja sille on varallisuustiedot; muuten käytetään vuoden
 * tietoihin syötettyä edellisen vuoden nettovarallisuutta (0015).
 */
export async function loadAgriPlanData(tx: Sql, clientId: string, year: number): Promise<AgriPlanData | null> {
  const input = await loadForm2Input(tx, clientId, year);
  if (!input) return null;
  const form2Base: AgriPlanData["form2Base"] = {
    year: input.year, vatRegistered: input.vatRegistered, rows: input.rows, ledgerDeferrals: input.ledgerDeferrals, manualDeferrals: input.manualDeferrals,
    agriYear: input.agriYear, extras: input.extras,
  };
  const source = await loadAgriDepreciationSource(tx, clientId);
  const rows = await tx.query<{ id: string; kind: "equalization" | "replacement"; made_year: number; amount: string; farm_name: string | null; before: string; asset_now: string; income_now: string }>(
    `select r.id, r.kind, r.made_year, r.amount, f.name as farm_name,
            coalesce((select sum(u.amount) from sk_agri_reserve_uses u where u.reserve_id = r.id and u.tax_year < $2), 0) as before,
            coalesce((select sum(u.amount) from sk_agri_reserve_uses u where u.reserve_id = r.id and u.tax_year = $2 and u.use_kind = 'asset'), 0) as asset_now,
            coalesce((select sum(u.amount) from sk_agri_reserve_uses u where u.reserve_id = r.id and u.tax_year = $2 and u.use_kind = 'income'), 0) as income_now
       from sk_agri_reserves r left join sk_farms f on f.id = r.farm_id
      where r.client_id = $1 and r.made_year <= $2 order by r.kind, r.made_year, r.created_at`,
    [clientId, year],
  );
  const reserves: PlanReserve[] = rows.map((r) => ({
    id: r.id, kind: r.kind, madeYear: Number(r.made_year), amount: Number(r.amount), farmName: r.farm_name,
    usedBefore: Number(r.before), assetUseThisYear: Number(r.asset_now), incomeThisYear: Number(r.income_now),
  }));
  const eqNow = reserves.filter((r) => r.kind === "equalization" && r.madeYear === year);
  const equalizationThisYear =
    eqNow.length === 0
      ? { id: null, amount: 0, editable: true, usedThisYear: 0 }
      : {
          id: eqNow[0].id,
          amount: eqNow.reduce((s, r) => s + r.amount, 0),
          editable: eqNow.length === 1,
          usedThisYear: eqNow.reduce((s, r) => s + r.assetUseThisYear + r.incomeThisYear, 0),
        };
  const y = await getAgriYear(tx, clientId, year);
  let priorWealth: AgriPlanData["priorWealth"] = { netWealth: null, wages: 0, source: "none" };
  const [prevYear] = await tx.query<{ year: number }>("select year from sk_tax_years where client_id = $1 and year = $2", [clientId, year - 1]);
  const prev = prevYear ? await loadForm2(tx, clientId, year - 1) : null;
  if (prev && (prev.fields["731"] !== undefined || prev.fields["732"] !== undefined)) {
    const prevYearData = await getAgriYear(tx, clientId, year - 1);
    priorWealth = { netWealth: (prev.fields["735"] ?? 0) - (prev.fields["736"] ?? 0), wages: prevYearData.wagesSubjectToWithholding, source: "computed" };
  } else if (y.priorNetWealth !== null) {
    priorWealth = { netWealth: y.priorNetWealth, wages: 0, source: "manual" };
  }
  return {
    year, form2Base, depreciation: source, reserves, equalizationThisYear, priorWealth, confirmedLosses: y.confirmedLossesCarried,
    spouseWealthSharePct: y.spouseWealthSharePct, spouseWorkSharePct: y.spouseWorkSharePct, claim: y.incomeSplitClaim, lossToCapitalIncome: y.lossToCapitalIncome,
    depreciationConfirmed: source.recorded.some((r) => r.taxYear === year),
  };
}
