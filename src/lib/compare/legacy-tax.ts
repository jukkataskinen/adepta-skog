import type { LegacyAsset, LegacyDeduction, LegacyDepreciation, LegacyTransaction } from "@/lib/import/legacy";
import type { ReportData } from "@/lib/reports/data";

/**
 * Veroraportin luvut vanhan ja uuden sovelluksen välillä (PLAN vaihe 5,
 * `npm run vertaa:vero`). Puhtaita funktioita: vanhan raportin laskenta on
 * kopioitu sellaisenaan tiedostosta legacy/app/veroraportti/veroraportti.html
 * (lataaData), jotta vertailu kertoo, mitä vanha sovellus oikeasti näytti.
 * Erot selitetään tunnetuilla sääntöeroilla (BLOCKERS 4), jotta jäljelle jäävät
 * selittämättömät erot erottuvat.
 */

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const round2 = (x: number) => Math.round(x * 100) / 100;

export interface TaxFigures {
  income: number;
  expense: number;
  depreciation: number;
  forestDeduction: number;
  taxable: number;
  tax: number;
  withholding: number;
  vatOutput: number;
  vatInput: number;
}

export const FIGURE_LABELS: Record<keyof TaxFigures, string> = {
  income: "Tulot (alv 0 %)",
  expense: "Menot (alv 0 %)",
  depreciation: "Poistot",
  forestDeduction: "Metsävähennys",
  taxable: "Verotettava tulo",
  tax: "Pääomatulon vero",
  withholding: "Ennakonpidätys",
  vatOutput: "Myynnin alv",
  vatInput: "Ostojen alv",
};

export interface LegacyInput {
  year: number;
  transactions: LegacyTransaction[];
  /** Asiakkaan kaikki investoinnit. Vanha raportti laski poiston jokaisesta aktiivisesta. */
  assets: LegacyAsset[];
  deductions: LegacyDeduction[];
  depreciations: LegacyDepreciation[];
}

export interface LegacyFigures extends TaxFigures {
  /** Vahvistuksessa tallennetut poistot. Vanhan raportin yhteenveto ei käyttänyt niitä. */
  depreciationRecorded: number;
  /** Tyypin investointi kirjaukset: vanha jätti ne tuloista, menoista ja ostojen alv:sta. */
  investment: number;
  investmentVat: number;
  /** Käyttöomaisuuden myynnit: vanha laski ne tuloiksi sellaisenaan. */
  assetSales: number;
  transactionCount: number;
}

/** Vanhan veroraportin yhteenveto (veroraportti.html, lataaData). */
export function legacyFigures(input: LegacyInput): LegacyFigures {
  const rows = input.transactions.filter((t) => t.verovuosi === input.year);
  const sum = (f: (t: LegacyTransaction) => boolean, v: (t: LegacyTransaction) => number) => rows.filter(f).reduce((s, t) => s + v(t), 0);
  const net = (t: LegacyTransaction) => n(t.summa_alv0);
  const vat = (t: LegacyTransaction) => (n(t.summa_alv0) * n(t.alv_prosentti)) / 100;
  const isIncome = (t: LegacyTransaction) => t.tyyppi === "tulo";
  const isExpense = (t: LegacyTransaction) => t.tyyppi === "meno";
  const isInvestment = (t: LegacyTransaction) => t.tyyppi === "investointi";

  const income = sum(isIncome, net);
  const expense = sum(isExpense, net);
  const depreciation = input.assets
    .filter((a) => a.aktiivinen === true)
    .reduce((s, a) => {
      const base = n(a.hankintahinta) - n(a.jaannosarvo);
      return s + (a.poistotapa === "tasa" ? base / (n(a.poistoaika_vuotta) || 1) : base * 0.25);
    }, 0);
  const forestDeduction = input.deductions.filter((d) => d.verovuosi === input.year).reduce((s, d) => s + n(d.kaytettava_vahennys), 0);
  const taxable = Math.max(0, income - expense - depreciation - forestDeduction);
  const tax = taxable <= 30000 ? taxable * 0.3 : 30000 * 0.3 + (taxable - 30000) * 0.34;
  const activeIds = new Set(input.assets.map((a) => a.id));

  return {
    income: round2(income),
    expense: round2(expense),
    depreciation: round2(depreciation),
    forestDeduction: round2(forestDeduction),
    taxable: round2(taxable),
    tax: round2(tax),
    withholding: round2(rows.reduce((s, t) => s + n(t.ennakko), 0)),
    vatOutput: round2(sum(isIncome, vat)),
    vatInput: round2(sum(isExpense, vat)),
    depreciationRecorded: round2(
      input.depreciations.filter((d) => d.verovuosi === input.year && activeIds.has(d.investointi_id)).reduce((s, d) => s + n(d.poistomaara), 0),
    ),
    investment: round2(sum(isInvestment, net)),
    investmentVat: round2(sum(isInvestment, vat)),
    assetSales: round2(sum((t) => isIncome(t) && t.kategoria === "Käyttöomaisuuden myynti", net)),
    transactionCount: rows.length,
  };
}

export interface NewFigures extends TaxFigures {
  saleGain: number;
  saleLoss: number;
  /** Investointiin liitettyjen myyntien hinnat, jotka eivät ole verolaskelmassa tuloa. */
  linkedAssetSales: number;
  transactionCount: number;
  confirmed: boolean;
}

/** Uuden veroraportin samat luvut. Tulot ja menot kirjanpidon tasolla, kuten vanhassa. */
export function newFigures(r: ReportData): NewFigures {
  const byKind = (kind: string) => round2(r.categories.filter((c) => c.kind === kind).reduce((s, c) => s + c.net, 0));
  const saleGain = round2(r.depreciation.reduce((s, d) => s + d.saleGain, 0));
  const saleLoss = round2(r.depreciation.reduce((s, d) => s + d.saleLoss, 0));
  const income = byKind("income");
  return {
    income,
    expense: byKind("expense"),
    depreciation: round2(r.depreciation.reduce((s, d) => s + d.amount, 0)),
    forestDeduction: r.plan.recordedDeduction,
    taxable: r.result.taxable,
    tax: r.result.tax.total,
    withholding: r.plan.withholding,
    vatOutput: r.vat.year.output,
    vatInput: r.vat.year.input,
    saleGain,
    saleLoss,
    linkedAssetSales: round2(income - r.plan.income),
    transactionCount: r.transactions.length,
    confirmed: r.confirmed,
  };
}

export interface FigureDiff {
  key: keyof TaxFigures;
  label: string;
  legacy: number;
  current: number;
  diff: number;
}

export interface Comparison {
  rows: FigureDiff[];
  differing: FigureDiff[];
  /** Tunnetut syyt eroille. Tyhjä, jos eroja ei ole. */
  explanations: string[];
  /** Erot, joille tunnettu syy ei riitä. */
  unexplained: (keyof TaxFigures)[];
}

const eur = (x: number) => x.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

export function compareFigures(legacy: LegacyFigures, current: NewFigures): Comparison {
  const keys = Object.keys(FIGURE_LABELS) as (keyof TaxFigures)[];
  const rows = keys.map((key) => ({ key, label: FIGURE_LABELS[key], legacy: legacy[key], current: current[key], diff: round2(current[key] - legacy[key]) }));
  const differing = rows.filter((r) => !same(r.legacy, r.current));
  const d = new Map(differing.map((r) => [r.key, r]));
  const explanations: string[] = [];
  const explained = new Set<keyof TaxFigures>();

  if (d.has("income") || d.has("expense")) {
    if (legacy.transactionCount !== current.transactionCount) {
      explanations.push(`Kirjauksia on eri määrä: vanhassa ${legacy.transactionCount}, uudessa ${current.transactionCount}. Tarkista tuonnista pois jätetyt rivit.`);
    }
  }

  if (d.has("vatInput") && same(round2(legacy.vatInput + legacy.investmentVat), current.vatInput)) {
    explanations.push(`Ostojen alv: vanha jätti investointien veron (${eur(legacy.investmentVat)}) pois, uusi vähentää sen.`);
    explained.add("vatInput");
  }

  if (d.has("depreciation")) {
    if (same(legacy.depreciationRecorded, current.depreciation)) {
      explanations.push(
        `Poistot: uusi käyttää vahvistettuja poistoja (${eur(current.depreciation)}), kuten vanhan raportin poistosivu. ` +
          `Vanhan raportin yhteenveto laski poistot aina uudelleen hankintahinnasta (${eur(legacy.depreciation)}).`,
      );
      explained.add("depreciation");
    } else if (!current.confirmed) {
      explanations.push("Poistot: uudessa verosuunnitelmaa ei ole vahvistettu, joten poistot ovat nolla.");
      explained.add("depreciation");
    } else {
      explanations.push(
        `Poistot: vanha vahvisti ${eur(legacy.depreciationRecorded)}, uusi ${eur(current.depreciation)}. ` +
          "Menojäännöspoiston pohja on uudessa poistamaton arvo, vanhassa hankintahinta joka vuosi (BLOCKERS 4).",
      );
    }
  }

  if (d.has("forestDeduction") && !current.confirmed) {
    explanations.push("Metsävähennys: uudessa verosuunnitelmaa ei ole vahvistettu.");
    explained.add("forestDeduction");
  }

  if (legacy.assetSales || current.saleGain || current.saleLoss) {
    explanations.push(
      `Koneen myynti: vanha laski myyntihinnan (${eur(legacy.assetSales)}) tuloksi, uusi vain myyntivoiton ` +
        `(${eur(current.saleGain)}) tai -tappion (${eur(current.saleLoss)}).`,
    );
  }

  // Verotettava tulo ja vero seuraavat muista luvuista. Ne ovat selitettyjä, jos
  // kaikki niiden osat ovat samat tai selitettyjä.
  const parts: (keyof TaxFigures)[] = ["income", "expense", "depreciation", "forestDeduction"];
  const partsOk = parts.every((k) => !d.has(k) || explained.has(k));
  if (partsOk) {
    if (d.has("taxable")) explained.add("taxable");
    if (d.has("tax")) explained.add("tax");
  }

  return { rows, differing, explanations, unexplained: differing.map((r) => r.key).filter((k) => !explained.has(k)) };
}
