/**
 * Verosäännöt ja kirjausten luokat. Vuosikohtaiset arvot ovat täällä eivätkä
 * koodin seassa (CLAUDE.md). Luokat vastaavat vanhan sovelluksen luokkia
 * (legacy/app/asiakas/asiakas.html, KATEGORIAT), jotta tiedonsiirto ja
 * vertailu vanhaan onnistuvat. Lähteet: docs/verosaannot-selvitys-2026-09-27.md.
 */

export type TransactionKind = "income" | "expense" | "investment";

/** Toiminto: metsätalous (2C) tai maatalous (lomake 2). Kirjauksen toiminto tulee luokasta. */
export type Activity = "forestry" | "agriculture";

export const ACTIVITY_LABEL: Record<Activity, string> = { forestry: "Metsätalous", agriculture: "Maatalous" };

/** Arvonlisäveron oletus luokalle: yleinen verokanta, alennettu verokanta tai veroton. */
export type VatDefault = "general" | "reduced" | "none";

/**
 * Maatalouden luokan paikka lomakkeella 2 (docs/maatalous-suunnitelma-2026-10-02.md, 1.2–1.3).
 * by_vat: meno viedään kohtaan 226, 229 tai 230 arvonlisäverokannan mukaan.
 * vat_only: oma käyttö, jonka vero kuuluu arvonlisäveroon mutta ei tuloverotukseen.
 * asset_purchase ja asset_sale: investointi ja sen myynti poistoryhmän kautta.
 */
export type Form2Target =
  | "210" | "211" | "213" | "214" | "215" | "216" | "217" | "218" | "220" | "221" | "222"
  | "dividend_listed" | "dividend_other" | "coop_surplus" | "vat_only"
  | "225" | "227" | "230" | "464" | "465" | "by_vat"
  | "asset_purchase" | "asset_sale";

export interface Category {
  code: string;
  label: string;
  group: string;
  kind: TransactionKind;
  vat: VatDefault;
  activity: Activity;
  /** Vanhan sovelluksen nimi tiedonsiirtoa varten. Maatalouden luokilla sama kuin nimi. */
  legacyName: string;
  /**
   * Pikanumero taulukkosyötön luokkavalikossa. Numerot 1–11 ovat samat kuin
   * vanhassa sovelluksessa, jotta kirjanpitäjän tottumukset säilyvät; Hankintatyö
   * on uusi numero 12. Maatalouden numerot ovat 21–59, jotta numero on
   * yksilöllinen koko luettelossa ja Excelin luokkanumero toimii ilman toimintoa.
   */
  no: number;
  /** Maatalouden luokan kenttä lomakkeella 2. */
  form2?: Form2Target;
}

/** Maatalouden luokan tunnus alkaa aina tällä, ja kanta tarkistaa sen (0015). */
export const AGRI_PREFIX = "agri_";

const F = "forestry" as const;
const A = "agriculture" as const;

export const CATEGORIES: Category[] = [
  { code: "standing_sale", no: 1, label: "Pystykauppa", group: "Puukauppatulot", kind: "income", vat: "general", activity: F, legacyName: "Pystykauppa" },
  { code: "delivery_sale", no: 2, label: "Hankintakauppa", group: "Puukauppatulot", kind: "income", vat: "general", activity: F, legacyName: "Hankintakauppa" },
  { code: "firewood_sale", no: 3, label: "Polttopuukauppa", group: "Puukauppatulot", kind: "income", vat: "general", activity: F, legacyName: "Polttopuukauppa" },
  { code: "insurance_compensation", no: 4, label: "Vakuutuskorvaukset", group: "Korvaukset ja tuet", kind: "income", vat: "none", activity: F, legacyName: "Vakuutuskorvaukset" },
  { code: "moose_damage_compensation", no: 5, label: "Hirvivahinkokorvaukset", group: "Korvaukset ja tuet", kind: "income", vat: "none", activity: F, legacyName: "Hirvivahinkokorvaukset" },
  { code: "forestry_subsidy", no: 6, label: "Metsätalouden tuet", group: "Korvaukset ja tuet", kind: "income", vat: "none", activity: F, legacyName: "Metsätalouden tuet" },
  { code: "asset_purchase", no: 10, label: "Käyttöomaisuuden hankinta", group: "Investoinnit", kind: "investment", vat: "general", activity: F, legacyName: "Käyttöomaisuuden hankinta" },
  { code: "asset_sale", no: 11, label: "Käyttöomaisuuden myynti", group: "Investoinnit", kind: "income", vat: "general", activity: F, legacyName: "Käyttöomaisuuden myynti" },
  { code: "wages", no: 7, label: "Palkkausmenot", group: "Menot", kind: "expense", vat: "none", activity: F, legacyName: "Palkkausmenot" },
  { code: "travel", no: 8, label: "Matkakulut", group: "Menot", kind: "expense", vat: "general", activity: F, legacyName: "Matkakulut" },
  { code: "other_expense", no: 9, label: "Muut vuosimenot", group: "Menot", kind: "expense", vat: "general", activity: F, legacyName: "Muut vuosimenot" },
  // Oma hankintatyö arvostetaan Verohallinnon ohjetaksoilla (DELIVERY_WORK_RATES, laskuri src/lib/tax/delivery-work.ts).
  { code: "delivery_work", no: 12, label: "Hankintatyö", group: "Menot", kind: "expense", vat: "none", activity: F, legacyName: "Hankintatyö" },
  // Maatalous (lomake 2). Ostot viedään lomakkeelle arvonlisäverokannan mukaan (226/229/230), joten
  // menoluokat palvelevat kirjanpitäjää ja asiakasta: niistä näkee, mihin rahat menivät.
  ...agri([
    [21, "agri_livestock_sale", "Kotieläinten myynti", "Maatalous: myynnit", "income", "general", "210"],
    [22, "agri_livestock_sale_deferred", "Kotieläinten myynti, jaksotettava", "Maatalous: myynnit", "income", "general", "211"],
    [23, "agri_other_sales", "Muu myynti (työt, koneiden vuokra)", "Maatalous: myynnit", "income", "general", "213"],
    [24, "agri_livestock_products", "Maito ja muut kotieläintuotteet", "Maatalous: myynnit", "income", "reduced", "214"],
    [25, "agri_crops", "Kasvinviljelytuotteet", "Maatalous: myynnit", "income", "reduced", "215"],
    [26, "agri_accommodation", "Majoituspalvelut", "Maatalous: myynnit", "income", "reduced", "216"],
    [34, "agri_own_use_vat", "Oma käyttö (vain alv)", "Maatalous: myynnit", "income", "reduced", "vat_only"],
    [27, "agri_state_subsidy", "Maataloustuet (Ruokavirasto)", "Maatalous: tuet ja muut tulot", "income", "none", "217"],
    [28, "agri_other_subsidy", "Muut tuet ja korvaukset", "Maatalous: tuet ja muut tulot", "income", "none", "218"],
    [29, "agri_other_income", "Muut alv 0 % tulot (vahingonkorvaukset, rakennusten vuokrat)", "Maatalous: tuet ja muut tulot", "income", "none", "220"],
    [30, "agri_additions", "Energiaveron palautus ja muut lisäykset", "Maatalous: tuet ja muut tulot", "income", "none", "222"],
    [31, "agri_private_use", "Tuloutus yksityiskäytöstä", "Maatalous: tuet ja muut tulot", "income", "none", "221"],
    [32, "agri_coop_surplus", "Osuuskunnan ylijäämä", "Maatalous: tuet ja muut tulot", "income", "none", "coop_surplus"],
    [33, "agri_dividends", "Osingot (muut kuin pörssiyhtiöt)", "Maatalous: tuet ja muut tulot", "income", "none", "dividend_other"],
    [35, "agri_dividends_listed", "Osingot pörssiyhtiöistä", "Maatalous: tuet ja muut tulot", "income", "none", "dividend_listed"],
    [41, "agri_fertilizers", "Lannoitteet ja kalkki", "Maatalous: ostot", "expense", "general", "by_vat"],
    [42, "agri_seeds", "Siemenet ja taimet", "Maatalous: ostot", "expense", "general", "by_vat"],
    [43, "agri_feed", "Rehut", "Maatalous: ostot", "expense", "reduced", "by_vat"],
    [44, "agri_fuels", "Polttoaineet ja voiteluaineet", "Maatalous: ostot", "expense", "general", "by_vat"],
    [45, "agri_repairs", "Koneiden ja rakennusten korjaukset", "Maatalous: ostot", "expense", "general", "by_vat"],
    [46, "agri_energy", "Sähkö, vesi ja lämpö", "Maatalous: ostot", "expense", "general", "by_vat"],
    [47, "agri_veterinary", "Eläinlääkäri ja eläinten hoito", "Maatalous: ostot", "expense", "general", "by_vat"],
    [48, "agri_contracting", "Urakointi ja ostopalvelut", "Maatalous: ostot", "expense", "general", "by_vat"],
    [49, "agri_other_purchases", "Muut ostot ja kalusto", "Maatalous: ostot", "expense", "general", "by_vat"],
    [50, "agri_livestock_purchase_deferred", "Kotieläinten hankinta, jaksotettava", "Maatalous: ostot", "expense", "general", "227"],
    [51, "agri_wages", "Palkat ja sivukulut", "Maatalous: muut menot", "expense", "none", "225"],
    [52, "agri_rents", "Vuokrat", "Maatalous: muut menot", "expense", "none", "by_vat"],
    [53, "agri_insurance", "Vakuutukset", "Maatalous: muut menot", "expense", "none", "230"],
    [54, "agri_myel", "MYEL-maksut", "Maatalous: muut menot", "expense", "none", "230"],
    [55, "agri_property_tax", "Kiinteistövero ja lomitusmaksut", "Maatalous: muut menot", "expense", "none", "230"],
    [56, "agri_interest", "Korot", "Maatalous: muut menot", "expense", "none", "465"],
    [57, "agri_other_deductions", "Muut vähennykset", "Maatalous: muut menot", "expense", "none", "464"],
    [58, "agri_asset_purchase", "Maatalouden investointi", "Maatalous: investoinnit", "investment", "general", "asset_purchase"],
    [59, "agri_asset_sale", "Maatalouden käyttöomaisuuden myynti", "Maatalous: investoinnit", "income", "general", "asset_sale"],
  ]),
];

function agri(rows: [number, string, string, string, TransactionKind, VatDefault, Form2Target][]): Category[] {
  return rows.map(([no, code, label, group, kind, vat, form2]) => ({ no, code, label, group, kind, vat, activity: A, legacyName: label, form2 }));
}

/** Metsätalouden luokat: vanhan sovelluksen tuonti ja tositteiden tunnistus käyttävät vain näitä. */
export const FORESTRY_CATEGORIES = CATEGORIES.filter((c) => c.activity === F);

export const CATEGORY_GROUPS = [...new Set(CATEGORIES.map((c) => c.group))];

export function category(code: string): Category | null {
  return CATEGORIES.find((c) => c.code === code) ?? null;
}

/** Luokan toiminto. Tuntematon luokka on metsätaloutta kuten vanhoissa riveissä. */
export function categoryActivity(code: string): Activity {
  return code.startsWith(AGRI_PREFIX) ? "agriculture" : "forestry";
}

/** Asiakkaan toiminnot: metsätalous oletuksena, maatalous asetuksesta. */
export interface ClientActivities {
  hasForestry: boolean;
  hasAgriculture: boolean;
}

export function activitiesOf(c: ClientActivities): Activity[] {
  const out: Activity[] = [];
  if (c.hasForestry || !c.hasAgriculture) out.push("forestry");
  if (c.hasAgriculture) out.push("agriculture");
  return out;
}

/** Asiakkaan luokat: pelkkä metsäasiakas näkee vain metsätalouden luokat kuten ennen. */
export function categoriesFor(c: ClientActivities): Category[] {
  const acts = activitiesOf(c);
  return CATEGORIES.filter((x) => acts.includes(x.activity));
}

/** Investoinnin hankinta tai myynti: investointi syntyy tai myydään kirjauksesta. */
export const ASSET_PURCHASE_CODES = ["asset_purchase", "agri_asset_purchase"];
export const ASSET_SALE_CODES = ["asset_sale", "agri_asset_sale"];
export const isAssetPurchase = (code: string) => ASSET_PURCHASE_CODES.includes(code);
export const isAssetSale = (code: string) => ASSET_SALE_CODES.includes(code);

/**
 * Toisen toiminnon osuuden luokka (0015). Esimerkiksi sähkölasku kirjataan
 * maatalouteen, ja 20 % siitä kuuluu metsätaloudelle: metsätalouden osuus on
 * Muut vuosimenot. Osuus on vain menoilla. Metsätaloudesta maatalouteen
 * siirtyvä meno viedään lomakkeelle 2 arvonlisäverokannan mukaan.
 */
export function crossCategory(code: string): string {
  if (categoryActivity(code) === "agriculture") return code === "agri_wages" ? "wages" : "other_expense";
  return code === "wages" ? "agri_wages" : "agri_other_purchases";
}

/** Luokat, joille toisen toiminnon osuutta ei voi antaa: hankintatyö on metsätalouden oma arvostus. */
export function allowsOtherShare(code: string): boolean {
  const c = category(code);
  return !!c && c.kind === "expense" && code !== "delivery_work" && code !== "agri_livestock_purchase_deferred";
}

/**
 * Maatalouden osinkojen ja osuuskuntaylijäämän veronalaiset osuudet (lomake 2: 224, 322, 328).
 * Muiden osuuskuntien ylijäämästä 25 % on veronalaista 5 000 euroon asti ja 75 % sen yli.
 */
export const DIVIDEND_OTHER_TAXABLE_PCT = 75;
export const DIVIDEND_LISTED_TAXABLE_PCT = 85;
export const COOP_SURPLUS_LOW_PCT = 25;
export const COOP_SURPLUS_HIGH_PCT = 75;
export const COOP_SURPLUS_THRESHOLD = 5000;

/** Tasausvaraus: enintään 40 % tilan puhtaasta tulosta ennen korkoja, 800–25 000 €, alas sataan euroon. */
export const EQUALIZATION_RESERVE = { pct: 40, min: 800, max: 25000, round: 100 } as const;

/** Kotieläinten jaksotus: kolme vuotta tasaerinä (lomake 2: 211/212 ja 227/228). */
export const LIVESTOCK_DEFERRAL_YEARS = 3;

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

/**
 * Alennettu arvonlisäverokanta (elintarvikkeet, rehut, majoitus): 14 % ja
 * 13,5 % 1.1.2026 alkaen. Maito ja vilja ovat tällä kannalla, elävät eläimet
 * yleisellä (docs/maatalous-suunnitelma-2026-10-02.md, 2.1).
 */
const REDUCED_VAT: { from: string; rate: number }[] = [
  { from: "2013-01-01", rate: 14 },
  { from: "2026-01-01", rate: 13.5 },
];

export function reducedVatRate(date: string): number {
  let rate = REDUCED_VAT[0].rate;
  for (const r of REDUCED_VAT) if (date >= r.from) rate = r.rate;
  return rate;
}

/** Verokannan ryhmä: yleinen (VSRALVKV 301), alennettu 14 % tai 13,5 % (302), 10 % (303) tai veroton. */
export type VatRateGroup = "general" | "reduced" | "ten" | "zero";

export function vatRateGroup(rate: number): VatRateGroup {
  if (rate <= 0) return "zero";
  if (rate === 10) return "ten";
  return rate >= 20 ? "general" : "reduced";
}

/**
 * Uuden kirjauksen oletusverokanta. Arvonlisäverorekisteriin kuulumaton
 * asiakas ei voi vähentää ostojen veroa eikä hänen myynnissään ole veroa,
 * joten hänelle oletus on aina 0 % ja kulu on koko kuitin summa (Jukan
 * vahvistus 28.9.2026). Rekisteröidyllä oletus tulee luokasta ja päivästä.
 * Kirjanpitäjä voi aina vaihtaa kannan riville.
 */
export function defaultVatRate(code: string, date: string, client: { vatRegistered: boolean }): number {
  if (!client.vatRegistered) return 0;
  const c = category(code);
  return c?.vat === "general" ? generalVatRate(date) : c?.vat === "reduced" ? reducedVatRate(date) : 0;
}

export function categoryByNo(no: number): Category | null {
  return CATEGORIES.find((c) => c.no === no) ?? null;
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
 * Maatalouden poistoryhmät lomakkeella 2 (MVL; docs/maatalous-suunnitelma-2026-10-02.md, 1.5).
 * Prosentti on enimmäispoisto menojäännöksestä. Poisto valitaan ryhmälle
 * (sk_agri_depreciations), ja koneilla on yhteinen menojäännös.
 * smallLimit: enintään tämän suuruisen ryhmän menojäännöksen saa poistaa kerralla.
 */
export type AgriAssetClass =
  | "agri_production_building" | "agri_dwelling" | "agri_greenhouse" | "agri_environmental" | "agri_machinery" | "agri_bridges" | "agri_drainage";

export const AGRI_ASSET_CLASSES: { code: AgriAssetClass; label: string; pct: number; smallLimit: number | null }[] = [
  { code: "agri_production_building", label: "Tuotantorakennus", pct: 10, smallLimit: 1000 },
  { code: "agri_dwelling", label: "Asuin- tai toimistorakennus", pct: 6, smallLimit: 1000 },
  { code: "agri_greenhouse", label: "Kasvihuone tai vastaava rakennelma", pct: 20, smallLimit: 1000 },
  { code: "agri_environmental", label: "Ympäristönsuojelun rakennelma", pct: 25, smallLimit: 1000 },
  { code: "agri_machinery", label: "Koneet ja kalusto", pct: 25, smallLimit: 1200 },
  { code: "agri_bridges", label: "Sillat, asfaltointi, padot ja kaivot", pct: 10, smallLimit: null },
  { code: "agri_drainage", label: "Salaojat (oma viljely)", pct: 20, smallLimit: null },
];

export function agriAssetClass(code: string | null | undefined) {
  return AGRI_ASSET_CLASSES.find((c) => c.code === code) ?? null;
}

/**
 * Uuden koneen korotettu poisto 50 % (käyttöön 2020–2025, verovuodet 2020–2025).
 * Valinnassa se on oma vaihtoehtonsa, ja kannassa koneet ja kalusto + accelerated.
 */
export const AGRI_ACCELERATED_CHOICE = "agri_machinery_accelerated";
const ACCELERATED: { firstYear: number; lastYear: number; pct: number } = { firstYear: 2020, lastYear: 2025, pct: 50 };

export function acceleratedPct(year: number): number | null {
  return year >= ACCELERATED.firstYear && year <= ACCELERATED.lastYear ? ACCELERATED.pct : null;
}

/** Investoinnin lajivalinnat maataloudelle: ryhmät ja vuonna sallittu korotettu poisto. */
export function agriAssetChoices(year: number): { id: string; label: string }[] {
  const out = AGRI_ASSET_CLASSES.map((c) => ({ id: c.code as string, label: `${c.label} ${c.pct} %` }));
  if (acceleratedPct(year)) {
    out.splice(5, 0, { id: AGRI_ACCELERATED_CHOICE, label: `Uusi kone, korotettu poisto ${ACCELERATED.pct} % (käyttöön ${ACCELERATED.firstYear}–${ACCELERATED.lastYear})` });
  }
  return out;
}

/** Valinta kannan sarakkeiksi. null, jos valinta ei ole maatalouden laji tai vuosi ei salli sitä. */
export function parseAgriAssetChoice(choice: string, year: number): { assetClass: AgriAssetClass; accelerated: boolean; pct: number } | null {
  if (choice === AGRI_ACCELERATED_CHOICE) return acceleratedPct(year) ? { assetClass: "agri_machinery", accelerated: true, pct: 25 } : null;
  const c = agriAssetClass(choice);
  return c ? { assetClass: c.code, accelerated: false, pct: c.pct } : null;
}

/** Maatalouden investoinnin laji tekstinä. */
export function agriAssetLabel(assetClass: string | null, accelerated = false): string {
  if (accelerated) return "Uusi kone, korotettu poisto";
  return agriAssetClass(assetClass)?.label ?? "Maatalouden investointi";
}

/**
 * Maatalouden pienhankinta: enintään tämän suuruinen hankinta vähennetään
 * vuosimenona eikä poistoina (docs/maatalous-suunnitelma-2026-10-02.md, 1.5).
 * Poikkeaa metsätaloudesta (600 €), joten raja on toiminnon mukainen.
 */
export const AGRI_SMALL_ASSET_LIMIT = 1200;

/**
 * Pienen hyödykkeen raja (TVL 115 § 3 mom., vuodesta 2021): enintään tämän
 * suuruinen menojäännös poistetaan kerralla, ja enintään tämän suuruinen
 * hankinta vähennetään vuosimenona.
 */
export const SMALL_ASSET_LIMIT = 600;

/** Pienhankinnan raja toiminnon mukaan. */
export function smallAssetLimit(activity: Activity): number {
  return activity === "agriculture" ? AGRI_SMALL_ASSET_LIMIT : SMALL_ASSET_LIMIT;
}

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

/**
 * Hankintatyön ohjetaksat €/m³: työn arvo puutavaran valmistuksesta ja
 * kuljetuksesta. Lähde: Verohallinnon yhtenäistämisohjeet, kohta 4.1.9
 * (vuodelta 2025 toimitettava verotus). Vanha sovellus käytti samoja lukuja.
 * Uuden vuoden taksat julkaistaan vasta verotuksen aikaan, joten vuodelle,
 * jolle taksoja ei ole, käytetään uusimpia ja näytetään siitä huomautus.
 */
export interface DeliveryWorkRate {
  code: string;
  label: string;
  making: number;
  transport: number;
}

const DELIVERY_WORK_RATES: { year: number; rates: DeliveryWorkRate[] }[] = [
  {
    year: 2025,
    rates: [
      { code: "pine_log", label: "Mäntytukki", making: 6.49, transport: 2.55 },
      { code: "pine_pulp", label: "Mäntykuitu", making: 15.0, transport: 2.63 },
      { code: "spruce_log", label: "Kuusitukki", making: 8.38, transport: 2.58 },
      { code: "spruce_pulp", label: "Kuusikuitu", making: 15.69, transport: 2.79 },
      { code: "birch_log", label: "Koivutukki", making: 6.19, transport: 2.93 },
      { code: "birch_pulp", label: "Koivukuitu", making: 13.87, transport: 3.07 },
      { code: "energy_wood", label: "Energiapuu (kokopuu)", making: 9.25, transport: 4.8 },
      { code: "firewood", label: "Halot ja klapit", making: 31.44, transport: 3.07 },
    ],
  },
];

export function deliveryWorkRates(year: number): { year: number; rates: DeliveryWorkRate[] } {
  const sorted = [...DELIVERY_WORK_RATES].sort((a, b) => a.year - b.year);
  let found = sorted[0];
  for (const r of sorted) if (r.year <= year) found = r;
  return found;
}

/** Hankintatyön arvo on tekijöille verovapaata tähän puumäärään asti maatilaa ja vuotta kohden (TVL 63 § 3 mom.). */
export const DELIVERY_WORK_TAX_FREE_M3 = 125;

/**
 * Metsätalouden arvonlisävero, kun verokausi on kalenterivuosi: ilmoitus ja
 * maksu viimeistään seuraavan helmikuun viimeisenä päivänä. Viikonlopulta
 * siirrytään seuraavaan arkipäivään (maaliskuun alussa ei ole pyhiä).
 */
export function annualVatDueDate(year: number): string {
  const d = new Date(Date.UTC(year + 1, 2, 0));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Lisäennakko: maksettu viimeistään verovuotta seuraavan tammikuun 31. päivänä, ei korkoa. Vähimmäismäärä 500 €. */
export const ADDITIONAL_PREPAYMENT_MIN = 500;
export const additionalPrepaymentDueDate = (year: number) => `${year + 1}-01-31`;
