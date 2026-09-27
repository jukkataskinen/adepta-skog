/**
 * Verosäännöt ja kirjausten luokat. Vuosikohtaiset arvot ovat täällä eivätkä
 * koodin seassa (CLAUDE.md). Luokat vastaavat vanhan sovelluksen luokkia
 * (legacy/app/asiakas/asiakas.html, KATEGORIAT), jotta tiedonsiirto ja
 * vertailu vanhaan onnistuvat. Lähteet: docs/verosaannot-selvitys-2026-09-27.md.
 */

export type TransactionKind = "income" | "expense" | "investment";

/** Arvonlisäveron oletus luokalle: yleinen verokanta tai veroton. */
export type VatDefault = "general" | "none";

export interface Category {
  code: string;
  label: string;
  group: string;
  kind: TransactionKind;
  vat: VatDefault;
  /** Vanhan sovelluksen nimi tiedonsiirtoa varten. */
  legacyName: string;
}

export const CATEGORIES: Category[] = [
  { code: "standing_sale", label: "Pystykauppa", group: "Puukauppatulot", kind: "income", vat: "general", legacyName: "Pystykauppa" },
  { code: "delivery_sale", label: "Hankintakauppa", group: "Puukauppatulot", kind: "income", vat: "general", legacyName: "Hankintakauppa" },
  { code: "firewood_sale", label: "Polttopuukauppa", group: "Puukauppatulot", kind: "income", vat: "general", legacyName: "Polttopuukauppa" },
  { code: "insurance_compensation", label: "Vakuutuskorvaukset", group: "Korvaukset ja tuet", kind: "income", vat: "none", legacyName: "Vakuutuskorvaukset" },
  { code: "moose_damage_compensation", label: "Hirvivahinkokorvaukset", group: "Korvaukset ja tuet", kind: "income", vat: "none", legacyName: "Hirvivahinkokorvaukset" },
  { code: "forestry_subsidy", label: "Metsätalouden tuet", group: "Korvaukset ja tuet", kind: "income", vat: "none", legacyName: "Metsätalouden tuet" },
  { code: "asset_purchase", label: "Käyttöomaisuuden hankinta", group: "Investoinnit", kind: "investment", vat: "general", legacyName: "Käyttöomaisuuden hankinta" },
  { code: "asset_sale", label: "Käyttöomaisuuden myynti", group: "Investoinnit", kind: "income", vat: "general", legacyName: "Käyttöomaisuuden myynti" },
  // Oma hankintatyö arvostetaan Verohallinnon taksoilla (vanha sovellus: HT_TAKSAT). Laskuri tulee vaiheessa 5 (BLOCKERS 5).
  { code: "delivery_work", label: "Hankintatyö", group: "Menot", kind: "expense", vat: "none", legacyName: "Hankintatyö" },
  { code: "wages", label: "Palkkausmenot", group: "Menot", kind: "expense", vat: "none", legacyName: "Palkkausmenot" },
  { code: "travel", label: "Matkakulut", group: "Menot", kind: "expense", vat: "general", legacyName: "Matkakulut" },
  { code: "other_expense", label: "Muut vuosimenot", group: "Menot", kind: "expense", vat: "general", legacyName: "Muut vuosimenot" },
];

export const CATEGORY_GROUPS = [...new Set(CATEGORIES.map((c) => c.group))];

export function category(code: string): Category | null {
  return CATEGORIES.find((c) => c.code === code) ?? null;
}

/** Puukaupan tulot: metsävähennyksen vuosiraja lasketaan näistä (vaihe 5). */
export const TIMBER_SALE_CODES = ["standing_sale", "delivery_sale", "firewood_sale"];

/**
 * Yleinen arvonlisäverokanta päivän mukaan. Kanta nousi 24 prosentista
 * 25,5 prosenttiin 1.9.2024.
 */
const GENERAL_VAT: { from: string; rate: number }[] = [
  { from: "2013-01-01", rate: 24 },
  { from: "2024-09-01", rate: 25.5 },
];

export function generalVatRate(date: string): number {
  let rate = GENERAL_VAT[0].rate;
  for (const r of GENERAL_VAT) if (date >= r.from) rate = r.rate;
  return rate;
}

/** Luokan oletusverokanta kirjauksen päivälle. */
export function defaultVatRate(code: string, date: string): number {
  const c = category(code);
  return c?.vat === "general" ? generalVatRate(date) : 0;
}

/**
 * Menojäännöspoiston enimmäisprosentit hyödykelajeittain. Metsätaloudessa ei ole
 * tasapoistoa: kaikki poistot tehdään hyödykekohtaisesti poistamattomasta
 * hankintamenosta, ja prosentti on enimmäismäärä (Verohallinto: Poistoina
 * vähennettävät menot; docs/verosaannot-selvitys-2026-09-27.md).
 */
export const ASSET_CLASSES = [
  { pct: 25, label: "Kone tai laite" },
  { pct: 15, label: "Metsätie tai ojitus" },
  { pct: 10, label: "Rakennus" },
] as const;
export const ASSET_CLASS_PCTS: number[] = ASSET_CLASSES.map((c) => c.pct);
export const DECLINING_BALANCE_MAX_PCT = 25;

export function assetClassLabel(pct: number | null): string {
  return ASSET_CLASSES.find((c) => c.pct === pct)?.label ?? "Menojäännöspoisto";
}

/**
 * Pienen hyödykkeen raja (TVL 115 § 3 mom., vuodesta 2021): enintään tämän
 * suuruinen menojäännös poistetaan kerralla, ja enintään tämän suuruinen
 * hankinta vähennetään vuosimenona.
 */
export const SMALL_ASSET_LIMIT = 600;

/**
 * Pääomatulon vero: alempi kanta rajaan asti, ylempi sen yli. Voimassa
 * verovuodesta 2015 (30 % / 34 %, raja 30 000 €), myös 2025 ja 2026.
 */
const CAPITAL_INCOME_TAX: { fromYear: number; lowPct: number; highPct: number; threshold: number }[] = [
  { fromYear: 2015, lowPct: 30, highPct: 34, threshold: 30000 },
];

export function capitalIncomeTaxRule(year: number) {
  let rule = CAPITAL_INCOME_TAX[0];
  for (const r of CAPITAL_INCOME_TAX) if (year >= r.fromYear) rule = r;
  return rule;
}

/**
 * Metsävähennyksen prosentti. Sama luku on sekä pohja (osuus metsän eli
 * metsämaan ja puuston hankintamenosta) että vuosiraja (osuus verovuoden
 * veronalaisesta metsätalouden pääomatulosta). Laki 872/2025 nosti molemmat
 * 75 prosenttiin verovuodesta 2026, ja vanha pohja korotetaan kertoimella 1,25,
 * joten pohja lasketaan aina tarkasteltavan vuoden prosentilla.
 */
const FOREST_DEDUCTION_PCT: { fromYear: number; pct: number }[] = [
  { fromYear: 2008, pct: 60 },
  { fromYear: 2026, pct: 75 },
];

export function forestDeductionPct(year: number): number {
  let pct = FOREST_DEDUCTION_PCT[0].pct;
  for (const r of FOREST_DEDUCTION_PCT) if (year >= r.fromYear) pct = r.pct;
  return pct;
}

/** Pienempää metsävähennystä ei tehdä (TVL 55 § 4 mom.). */
export const FOREST_DEDUCTION_MIN = 1500;

/** Yrittäjävähennys: osuus metsävähennyksen jälkeisestä metsätalouden puhtaasta pääomatulosta (TVL 30 a §). */
export const ENTREPRENEUR_DEDUCTION_PCT = 5;

/** Luovutusvoitto on verovapaa, jos vuoden luovutushinnat ovat yhteensä enintään tämän (TVL 48 § 6 mom.). */
export const SALE_EXEMPTION_LIMIT = 1000;

/**
 * Metsätilan luovutus: luovutusvoittoon lisättävän käytetyn metsävähennyksen
 * enimmäisosuus myydyn metsän hankintamenosta (TVL 46 § 8 mom.). Laki 872/2025
 * nosti sen 75 prosenttiin, mutta sitä sovelletaan vasta verovuodesta 2027.
 */
const FOREST_SALE_ADDITION_PCT: { fromYear: number; pct: number }[] = [
  { fromYear: 2009, pct: 60 },
  { fromYear: 2027, pct: 75 },
];

export function forestSaleAdditionPct(year: number): number {
  let pct = FOREST_SALE_ADDITION_PCT[0].pct;
  for (const r of FOREST_SALE_ADDITION_PCT) if (year >= r.fromYear) pct = r.pct;
  return pct;
}

/** Hankintameno-olettama: 20 % luovutushinnasta, 40 % jos omistettu vähintään 10 vuotta (TVL 46 § 2 mom.). */
export const DEEMED_COST_PCT = 20;
export const DEEMED_COST_LONG_PCT = 40;
export const DEEMED_COST_LONG_YEARS = 10;

/**
 * Metsätie tai ojitus tunnistetaan hyödykelajista (menojäännöspoisto 15 %).
 * Niiden poistamaton arvo lisätään metsän hankintamenoon, kun metsä tai sen
 * osa myydään (Verohallinto: Metsävähennys, luku 3.1.3).
 */
export const ROAD_DITCH_PCT = 15;

export function isRoadOrDitch(asset: { method: string; decliningRatePct: number | null }): boolean {
  return asset.method === "declining_balance" && asset.decliningRatePct === ROAD_DITCH_PCT;
}
