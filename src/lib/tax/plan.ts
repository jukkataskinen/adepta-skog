import { capitalIncomeTaxRule, FOREST_DEDUCTION_ANNUAL_PCT, FOREST_DEDUCTION_MIN } from "./rules";

/**
 * Verosuunnitelman laskenta: metsätalouden puhdas pääomatulo, metsävähennyksen
 * rajat ja pääomatulon vero. Sama laskenta palvelee suunnitelman näkymää,
 * vahvistusta ja veroraporttia, joten luvut ovat kaikkialla samat.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export function capitalIncomeTax(taxable: number, year: number): { low: number; high: number; total: number } {
  const r = capitalIncomeTaxRule(year);
  if (taxable <= 0) return { low: 0, high: 0, total: 0 };
  const low = round2((Math.min(taxable, r.threshold) * r.lowPct) / 100);
  const high = round2((Math.max(0, taxable - r.threshold) * r.highPct) / 100);
  return { low, high, total: round2(low + high) };
}

export interface ForestDeductionProperty {
  id: string;
  remaining: number | null;
}

export interface ForestDeductionLimits {
  /** Tilojen käyttämätön pohja yhteensä. */
  available: number;
  /** 60 % puhtaasta pääomatulosta ennen vähennystä. */
  annualMax: number;
  max: number;
  /** Alle vähimmäismäärän vähennystä ei voi tehdä (0 tai vähintään tämä). */
  min: number;
}

export function forestDeductionLimits(properties: ForestDeductionProperty[], netBeforeDeduction: number): ForestDeductionLimits {
  const available = round2(properties.reduce((s, p) => s + (p.remaining ?? 0), 0));
  const annualMax = round2(Math.max(0, (netBeforeDeduction * FOREST_DEDUCTION_ANNUAL_PCT) / 100));
  const max = round2(Math.min(available, annualMax));
  return { available, annualMax, max: max >= FOREST_DEDUCTION_MIN ? max : 0, min: FOREST_DEDUCTION_MIN };
}

/** Vähennyksen jako tiloille: vanhin käyttämätön pohja ensin, tilojen järjestyksessä. */
export function allocateForestDeduction(properties: ForestDeductionProperty[], amount: number): { id: string; amount: number }[] {
  const out: { id: string; amount: number }[] = [];
  let left = round2(amount);
  for (const p of properties) {
    if (left <= 0) break;
    const take = round2(Math.min(left, p.remaining ?? 0));
    if (take > 0) {
      out.push({ id: p.id, amount: take });
      left = round2(left - take);
    }
  }
  return out;
}

export interface PlanInput {
  year: number;
  income: number;
  expense: number;
  depreciation: number;
  saleGain: number;
  saleLoss: number;
  forestDeduction: number;
}

export interface PlanResult {
  /** Tulot ja myyntivoitot miinus menot, poistot ja myyntitappiot. */
  netBeforeDeduction: number;
  taxable: number;
  tax: ReturnType<typeof capitalIncomeTax>;
  taxWithoutDeductions: ReturnType<typeof capitalIncomeTax>;
  saving: number;
}

export function computePlan(p: PlanInput): PlanResult {
  const gross = p.income + p.saleGain - p.expense - p.saleLoss;
  const netBeforeDeduction = round2(gross - p.depreciation);
  const taxable = round2(Math.max(0, netBeforeDeduction - p.forestDeduction));
  const tax = capitalIncomeTax(taxable, p.year);
  const taxWithoutDeductions = capitalIncomeTax(round2(Math.max(0, gross)), p.year);
  return { netBeforeDeduction, taxable, tax, taxWithoutDeductions, saving: round2(taxWithoutDeductions.total - tax.total) };
}

/** Tarkistaa valitun metsävähennyksen. Palauttaa virheen tai null. */
export function validateForestDeduction(amount: number, limits: ForestDeductionLimits): string | null {
  if (amount === 0) return null;
  if (amount < limits.min) return `Metsävähennys on vähintään ${limits.min} € tai ei lainkaan.`;
  if (amount > limits.max) return `Metsävähennys voi olla enintään ${limits.max.toLocaleString("fi-FI")} €.`;
  return null;
}
