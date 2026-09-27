import { capitalIncomeTaxRule, ENTREPRENEUR_DEDUCTION_PCT, FOREST_DEDUCTION_MIN, forestDeductionPct, SALE_EXEMPTION_LIMIT } from "./rules";

/**
 * Verosuunnitelman laskenta: metsätalouden puhdas pääomatulo, metsävähennyksen
 * rajat, yrittäjävähennys, koneiden luovutusvoitot ja pääomatulon vero. Sama
 * laskenta palvelee suunnitelman näkymää, vahvistusta ja veroraporttia, joten
 * luvut ovat kaikkialla samat. Lähteet: docs/verosaannot-selvitys-2026-09-27.md.
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
  /** Tilojen käyttämätön pohja yhteensä. Verotuksessa metsät ovat yksi kokonaisuus. */
  available: number;
  /** Vuoden prosentti veronalaisesta metsätalouden pääomatulosta. */
  annualPct: number;
  annualMax: number;
  max: number;
  /** Alle vähimmäismäärän vähennystä ei voi tehdä (0 tai vähintään tämä). */
  min: number;
}

/**
 * Veronalainen metsätalouden pääomatulo metsävähennyksen vuosirajaa varten:
 * tulot ennen kuluja ja poistoja, hankintakaupassa ilman oman hankintatyön
 * arvoa. Koneiden myynnit eivät kuulu siihen.
 */
export function forestDeductionIncome(income: number, deliveryWork: number): number {
  return round2(Math.max(0, income - deliveryWork));
}

export function forestDeductionLimits(properties: ForestDeductionProperty[], taxableForestIncome: number, year: number): ForestDeductionLimits {
  const available = round2(properties.reduce((s, p) => s + (p.remaining ?? 0), 0));
  const annualPct = forestDeductionPct(year);
  const annualMax = round2(Math.max(0, (taxableForestIncome * annualPct) / 100));
  const max = round2(Math.min(available, annualMax));
  return { available, annualPct, annualMax, max: max >= FOREST_DEDUCTION_MIN ? max : 0, min: FOREST_DEDUCTION_MIN };
}

/**
 * Vähennyksen tallennus tiloille: vanhin käyttämätön pohja ensin, tilojen
 * järjestyksessä. Verotuksessa jakoa ei ole; se pitää vain tilakohtaisen
 * seurannan ajan tasalla.
 */
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
  forestDeduction: number;
  /** Koneiden myynnit: luovutusvoitot ja -tappiot sekä myyntihinnat yhteensä. */
  saleGain: number;
  saleLoss: number;
  salePrices: number;
}

export interface PlanResult {
  /** Metsätalouden puhdas pääomatulo: tulot miinus menot ja poistot. */
  netBeforeDeduction: number;
  entrepreneurDeduction: number;
  /** Metsätalouden verotettava osuus metsävähennyksen ja yrittäjävähennyksen jälkeen. */
  forestryTaxable: number;
  /** Koneiden luovutusvoitto (+) tai -tappio (−). Nolla, jos myynnit ovat enintään 1 000 €. */
  saleResult: number;
  saleExempt: boolean;
  taxable: number;
  tax: ReturnType<typeof capitalIncomeTax>;
  taxWithoutDeductions: ReturnType<typeof capitalIncomeTax>;
  saving: number;
}

export function computePlan(p: PlanInput): PlanResult {
  const netBeforeDeduction = round2(p.income - p.expense - p.depreciation);
  const afterDeduction = round2(netBeforeDeduction - p.forestDeduction);
  // Yrittäjävähennystä ei tehdä tappiolliseen tulokseen.
  const entrepreneurDeduction = afterDeduction > 0 ? round2((afterDeduction * ENTREPRENEUR_DEDUCTION_PCT) / 100) : 0;
  const forestryTaxable = round2(afterDeduction - entrepreneurDeduction);
  // Luovutusvoitto on tavallista pääomatuloa, ja tappio vähennetään muista pääomatuloista.
  // Arvio ottaa huomioon vain tämän asiakkaan metsätalouden, joten tulos ei mene alle nollan.
  const saleExempt = p.salePrices > 0 && p.salePrices <= SALE_EXEMPTION_LIMIT;
  const saleResult = saleExempt ? 0 : round2(p.saleGain - p.saleLoss);
  const taxable = round2(Math.max(0, forestryTaxable + saleResult));
  const tax = capitalIncomeTax(taxable, p.year);
  const taxWithoutDeductions = capitalIncomeTax(round2(Math.max(0, p.income - p.expense + saleResult)), p.year);
  return { netBeforeDeduction, entrepreneurDeduction, forestryTaxable, saleResult, saleExempt, taxable, tax, taxWithoutDeductions, saving: round2(taxWithoutDeductions.total - tax.total) };
}

/** Tarkistaa valitun metsävähennyksen. Palauttaa virheen tai null. */
export function validateForestDeduction(amount: number, limits: ForestDeductionLimits): string | null {
  if (amount === 0) return null;
  if (amount < limits.min) return `Metsävähennys on vähintään ${limits.min} € tai ei lainkaan.`;
  if (amount > limits.max) return `Metsävähennys voi olla enintään ${limits.max.toLocaleString("fi-FI")} €.`;
  return null;
}
