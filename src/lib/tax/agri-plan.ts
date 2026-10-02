import { round2 } from "./amounts";
import { agriDepreciation, type AgriAdjustment, type AgriAssetInput, type AgriDepreciationResult, type AgriPool, type AgriRecorded } from "./agri-depreciation";
import { computeForm2, type Form2Input, type Form2Result, type ReserveInput } from "./agriculture";
import { businessIncomeSplit, earnedIncomeTaxEstimate, equalizationReserveMax, type EarnedTaxEstimate, type IncomeSplitResult } from "./income-split";
import { capitalIncomeTax, type PlanResult } from "./plan";
import { capitalIncomeTaxRule, type IncomeSplitClaim } from "./rules";

/**
 * Verosuunnitelman maatalousosa: lomakkeen 2 tulos valituilla poistoilla ja
 * varauksilla, yritystulon jako ja yhteinen vero metsätalouden kanssa. Puhdas
 * laskenta; sama funktio palvelee selaimen laskuria, vahvistusta ja
 * veroraporttia, joten luvut ovat kaikkialla samat (DECISIONS 2.10.2026).
 */

/** Varaus suunnitelmassa. Käytöt jaetaan: aiemmat vuodet, tämän vuoden investointi ja tuloutus. */
export interface PlanReserve {
  id: string;
  kind: "equalization" | "replacement";
  madeYear: number;
  amount: number;
  farmName: string | null;
  /** Käytetty ennen verovuotta (investointiin ja tuloutettu). */
  usedBefore: number;
  /** Käytetty verovuonna investointiin. */
  assetUseThisYear: number;
  /** Tuloutettu verovuonna (kirjattu). */
  incomeThisYear: number;
}

export interface AgriPlanData {
  year: number;
  /** Lomakkeen 2 lähtötiedot ilman poistoja ja varauksia, jotka valitaan suunnitelmassa. */
  form2Base: Omit<Form2Input, "depreciation" | "reserves">;
  depreciation: { assets: AgriAssetInput[]; adjustments: AgriAdjustment[]; recorded: AgriRecorded[] };
  reserves: PlanReserve[];
  /**
   * Verovuodelta tehty tasausvaraus, jota suunnitelma muuttaa. Suunnitelma voi
   * muuttaa vain yhtä varausta vuodessa; jos vuodelle on useampi (useampi tila),
   * määrä muutetaan Lomake 2 -välilehdellä (editable false).
   */
  equalizationThisYear: { id: string | null; amount: number; editable: boolean; usedThisYear: number };
  /** Edellisen vuoden lopun nettovarallisuus: laskettu Skogin edellisestä vuodesta tai syötetty. */
  priorWealth: { netWealth: number | null; wages: number; source: "computed" | "manual" | "none" };
  confirmedLosses: number;
  spouseWealthSharePct: number | null;
  spouseWorkSharePct: number | null;
  claim: IncomeSplitClaim;
  lossToCapitalIncome: number | null;
  /** Ryhmäpoistot on vahvistettu tälle vuodelle (Lomake 2 tai suunnitelma). */
  depreciationConfirmed: boolean;
}

export interface AgriChoices {
  depreciation: Partial<Record<AgriPool, number>>;
  /** Verovuodelta tehtävä tasausvaraus (232). */
  equalization: number;
  /** Aiempien varausten tuloutus verovuonna: varaus → euroa. */
  releases: Record<string, number>;
  claim: IncomeSplitClaim;
  lossToCapital: boolean;
}

/** Vahvistetut tai kirjatut valinnat: veroraportti ja laskurin alkuarvot. */
export function recordedChoices(d: AgriPlanData): AgriChoices {
  const dep: Partial<Record<AgriPool, number>> = {};
  for (const r of d.depreciation.recorded.filter((x) => x.taxYear === d.year)) dep[r.pool] = r.amount;
  return {
    depreciation: dep,
    equalization: d.equalizationThisYear.amount,
    releases: Object.fromEntries(d.reserves.filter((r) => r.madeYear < d.year).map((r) => [r.id, r.incomeThisYear])),
    claim: d.claim,
    lossToCapital: (d.lossToCapitalIncome ?? 0) > 0,
  };
}

/** Laskurin alkuarvot: kirjatut poistot, tai enimmäismäärät, jos poistoja ei ole vahvistettu. */
export function initialChoices(d: AgriPlanData): AgriChoices {
  const c = recordedChoices(d);
  if (d.depreciationConfirmed) return c;
  const dep = agriDepreciation(d.depreciation.assets, d.depreciation.adjustments, d.depreciation.recorded, d.year);
  return { ...c, depreciation: Object.fromEntries(dep.pools.filter((p) => p.base > 0).map((p) => [p.pool, p.max])) };
}

/** Varauksesta tuloutettavissa verovuonna: purkamaton määrä ennen vuotta miinus vuoden investointikäyttö. */
export function releasable(r: PlanReserve): number {
  return Math.max(0, round2(r.amount - r.usedBefore - r.assetUseThisYear));
}

/** Viimeinen vuosi, jona varaus on käytettävä tai tuloutettava (kolmas vuosi tekovuoden jälkeen). */
export const reserveDeadline = (r: { madeYear: number }) => r.madeYear + 3;

export interface AgriPlanResult {
  form2: Form2Result;
  depreciation: AgriDepreciationResult;
  equalization: { max: number; base: number; amount: number };
  split: IncomeSplitResult;
}

export function computeAgriPlan(d: AgriPlanData, c: AgriChoices): AgriPlanResult {
  const dep = agriDepreciation(d.depreciation.assets, d.depreciation.adjustments, d.depreciation.recorded, d.year, c.depreciation);
  const reserves: ReserveInput[] = [];
  for (const r of d.reserves) {
    if (r.id === d.equalizationThisYear.id && d.equalizationThisYear.editable) continue;
    const release = r.madeYear < d.year ? Math.min(Math.max(0, c.releases[r.id] ?? r.incomeThisYear), releasable(r)) : r.incomeThisYear;
    reserves.push({
      kind: r.kind, madeYear: r.madeYear, amount: r.amount,
      usedThroughYear: round2(r.usedBefore + r.assetUseThisYear + release), incomeThisYear: round2(release),
    });
  }
  const eq = d.equalizationThisYear.editable ? Math.max(0, c.equalization) : d.equalizationThisYear.amount;
  if (d.equalizationThisYear.editable && eq > 0) {
    reserves.push({ kind: "equalization", madeYear: d.year, amount: eq, usedThroughYear: d.equalizationThisYear.usedThisYear, incomeThisYear: 0 });
  }
  const input: Form2Input = { ...d.form2Base, depreciation: dep, reserves, agriYear: { ...d.form2Base.agriYear, incomeSplitClaim: c.claim, lossToCapitalIncome: null } };
  let form2 = computeForm2(input);
  if (c.lossToCapital && form2.result < 0) {
    form2 = computeForm2({ ...input, agriYear: { ...input.agriYear, lossToCapitalIncome: -form2.result } });
  }
  // Tasausvarauksen pohja: puhdas tulos ennen korkoja ja ennen tämän vuoden tasausvarausta.
  const thisYearEq = d.equalizationThisYear.editable ? eq : d.equalizationThisYear.amount;
  const base = round2(form2.result + thisYearEq + (form2.fields["465"] ?? 0));
  const split = businessIncomeSplit({
    result: form2.result, confirmedLosses: d.confirmedLosses, priorNetWealth: d.priorWealth.netWealth, priorWages: d.priorWealth.wages, claim: c.claim,
    spouseWealthSharePct: d.spouseWealthSharePct, spouseWorkSharePct: d.spouseWorkSharePct, lossToCapitalIncome: c.lossToCapital,
  });
  return { form2, depreciation: dep, equalization: { max: equalizationReserveMax(base), base, amount: thisYearEq }, split };
}

export interface CombinedTax {
  /** Metsätalouden verotettava osuus ja luovutusvoitot ennen nollarajaa. */
  forestCapital: number;
  agriCapital: number;
  lossToCapital: number;
  /** Verotettava pääomatulo yhteensä (vähintään 0). */
  capital: number;
  capitalTax: ReturnType<typeof capitalIncomeTax>;
  agriEarned: number;
  earnedTax: EarnedTaxEstimate;
  total: number;
  /** Pääomatulo ylittää 34 %:n rajan. */
  aboveThreshold: boolean;
}

/**
 * Henkilön verot yhteensä: metsätalouden pääomatulo ja maatalouden
 * pääomatulo-osuus lasketaan yhteen 30/34 %:n rajaa varten, ja maatalouden
 * tappio vähennetään pääomatuloista vaatimuksesta. Ansiotulo-osuuden vero on
 * arvio (earnedIncomeTaxEstimate). Pelkkä metsäasiakas: agri null, jolloin
 * tulos on sama kuin computePlan.
 */
export function combinedTax(
  year: number,
  forest: Pick<PlanResult, "forestryTaxable" | "saleResult">,
  agri: IncomeSplitResult | null,
  opts: { otherEarned?: number; municipalPct?: number } = {},
): CombinedTax {
  const forestCapital = round2(forest.forestryTaxable + forest.saleResult);
  const agriCapital = agri?.owner.capital ?? 0;
  const lossToCapital = agri?.lossToCapital ?? 0;
  const capital = round2(Math.max(0, forestCapital + agriCapital - lossToCapital));
  const capitalTax = capitalIncomeTax(capital, year);
  const agriEarned = agri?.owner.earned ?? 0;
  const earnedTax = earnedIncomeTaxEstimate(agriEarned, year, opts.otherEarned ?? 0, opts.municipalPct);
  return {
    forestCapital, agriCapital, lossToCapital, capital, capitalTax, agriEarned, earnedTax, total: round2(capitalTax.total + earnedTax.total),
    aboveThreshold: capital > capitalIncomeTaxRule(year).threshold,
  };
}

export interface Tip {
  tone: "warn" | "info" | "ok";
  text: string;
}

const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });

/**
 * Maatalouden huomiot ja suositukset. Vaikutukset lasketaan samoilla
 * funktioilla kuin laskelma: jokainen vaihtoehto lasketaan kokonaan uudelleen.
 */
export function agriTips(
  d: AgriPlanData,
  c: AgriChoices,
  forest: Pick<PlanResult, "forestryTaxable" | "saleResult">,
  opts: { otherEarned?: number; municipalPct?: number } = {},
): Tip[] {
  const tips: Tip[] = [];
  const now = computeAgriPlan(d, c);
  const total = (ch: AgriChoices) => combinedTax(d.year, forest, computeAgriPlan(d, ch).split, opts).total;
  const current = combinedTax(d.year, forest, now.split, opts);

  if (d.priorWealth.source === "none") {
    tips.push({ tone: "warn", text: "Edellisen vuoden nettovarallisuus puuttuu, joten koko maatalouden tulo on laskettu ansiotuloksi. Anna se Lomake 2 -välilehdellä." });
  }
  // Jakovaatimus: kokeillaan kaikki kolme ja kerrotaan edullisin.
  if (now.split.splitBase > 0 && now.split.wealthBase > 0) {
    const options: { claim: IncomeSplitClaim; label: string }[] = [
      { claim: null, label: "20 %" }, { claim: "ten", label: "10 %" }, { claim: "earned", label: "0 %" },
    ];
    const best = options.map((o) => ({ ...o, tax: total({ ...c, claim: o.claim }) })).sort((a, b) => a.tax - b.tax)[0];
    if (best.claim !== c.claim && current.total - best.tax >= 1) {
      tips.push({
        tone: "ok",
        text: `Pääomatulo-osuus ${best.label} pienentäisi arvioitua veroa ${eur(current.total - best.tax)}. Pienempi osuus kannattaa, kun ansiotulon veroprosentti jää alle pääomatulon 30–34 %:n. Vaatimus tehdään veroilmoituksella (kohta 418).`,
      });
    }
    if (current.aboveThreshold && c.claim === null) {
      tips.push({ tone: "info", text: "Pääomatulot ylittävät 30 000 euroa yhdessä metsätalouden kanssa. Ylittävästä osasta vero on 34 %, joten pienempi pääomatulo-osuus voi kannattaa." });
    }
  }
  // Tasausvaraus: enimmäismäärän vaikutus.
  if (d.equalizationThisYear.editable && now.equalization.max > c.equalization) {
    const withMax = total({ ...c, equalization: now.equalization.max });
    if (current.total - withMax >= 1) {
      tips.push({
        tone: "ok",
        text: `Tasausvarausta voisi tehdä ${eur(now.equalization.max)}. Enimmäismäärä pienentäisi tämän vuoden veroa ${eur(current.total - withMax)}. Varaus on käytettävä investointiin tai tuloutettava viimeistään kolmantena vuonna.`,
      });
    }
  }
  // Poistot: tekemättä jäävä osa.
  const unused = round2(now.depreciation.pools.reduce((s, p) => s + Math.max(0, p.max - p.depreciation), 0));
  if (unused > 0) {
    const all = Object.fromEntries(now.depreciation.pools.filter((p) => p.base > 0).map((p) => [p.pool, p.max]));
    const saving = current.total - total({ ...c, depreciation: all });
    tips.push({ tone: "info", text: `Maatalouden poistoja jää tekemättä ${eur(unused)}. Täysi poisto pienentäisi arvioitua veroa ${eur(Math.max(0, saving))}. Tekemätön poisto jää menojäännökseen.` });
  }
  // Varaukset, jotka on purettava tänä vuonna.
  for (const r of d.reserves.filter((x) => x.madeYear < d.year && reserveDeadline(x) <= d.year)) {
    const left = round2(releasable(r) - Math.min(c.releases[r.id] ?? r.incomeThisYear, releasable(r)));
    if (left > 0) {
      tips.push({ tone: "warn", text: `${r.kind === "equalization" ? "Tasausvaraus" : "Jälleenhankintavaraus"} vuodelta ${r.madeYear} (${eur(left)}) on käytettävä investointiin tai tuloutettava viimeistään tänä vuonna.` });
    }
  }
  if (now.split.loss > 0) {
    tips.push({
      tone: "warn",
      text: c.lossToCapital
        ? `Maatalouden tappio ${eur(now.split.loss)} vähennetään tämän vuoden pääomatuloista.`
        : `Maatalouden tappio ${eur(now.split.loss)} vahvistetaan, ja se vähennetään seuraavien 10 vuoden tuloksista. Jos asiakkaalla on pääomatuloja, tappion voi vaatia vähennettäväksi niistä.`,
    });
  }
  if (now.split.spouse) {
    tips.push({ tone: "info", text: "Puolison osuudet verotetaan puolisolla. Arvioitu vero koskee vain asiakasta." });
  }
  return tips;
}
