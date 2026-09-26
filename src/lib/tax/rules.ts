/**
 * Verosäännöt ja kirjausten luokat. Vuosikohtaiset arvot ovat täällä eivätkä
 * koodin seassa (CLAUDE.md). Luokat vastaavat vanhan sovelluksen luokkia
 * (legacy/app/asiakas/asiakas.html, KATEGORIAT), jotta tiedonsiirto ja
 * vertailu vanhaan onnistuvat. Prosenttien lähteet vahvistetaan (BLOCKERS 4).
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

/** Menojäännöspoiston enimmäisprosentti koneille ja kalustolle. */
export const DECLINING_BALANCE_MAX_PCT = 25;

/** Metsävähennyksen pohja: osuus metsämaan hankintamenosta. */
export const FOREST_DEDUCTION_BASE_PCT = 60;
