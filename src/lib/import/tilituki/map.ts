import { round2 } from "@/lib/tax/amounts";
import { category, type AgriAssetClass, type TransactionKind } from "@/lib/tax/rules";
import { ACCELERATED_POOL, POOL_FIELDS, type AgriPool } from "@/lib/tax/agri-depreciation";
import { AGRI_EXTRA_FIELDS } from "@/lib/filing/vsy002-fields";
import { tilitukiId } from "@/lib/import/origin";

/**
 * Tilituki Pro -aineiston muunnos Skogin riveiksi (BLOCKERS 12, DECISIONS 5.10.2026).
 * Puhdas muunnos ilman kantakutsuja; kirjoitus on run.ts:ssä ja jäsennys
 * Pythonilla (scripts/tilituki/parse.py), joka lukee DBF-taulut JSONiksi.
 *
 * Kartoitus tehdään tilin veronumeron (KPTILIT.KTVERONRO) kautta, koska se
 * kertoo Tilitukissa, mihin lomakkeen kohtaan tili viedään. Sama veronumero on
 * kaikilla asiakkailla, joten kartoitus on yleinen. Tilitukin vakiotilikartan
 * tilinumero tarkentaa luokan (esim. 3210 MYEL-maksut), mutta vain jos
 * tarkennettu luokka vie rivin samaan lomakkeen kohtaan kuin perusluokka.
 *
 * Tilituki kirjaa verottoman summan kulutilille ja veron omalle tililleen.
 * Skogissa vero on kirjauksen kanta: veroton summa ja kanta tuodaan, ja
 * verollinen summa lasketaan niistä (amounts.ts). Alv-tilit ohitetaan.
 */

// ---------------------------------------------------------------------------
// Jäsennetty aineisto (scripts/tilituki/parse.py)
// ---------------------------------------------------------------------------

export interface TtAccount {
  number: string;
  name: string;
  /** KTTILILUOK: TU = tulos, TA = tase, TAALV… = alv. */
  class: string;
  /** KTVERONRO: lomakkeen rivi, esim. L2_258 tai L2C_119. */
  taxCode: string;
  vatPct: number;
  side: string;
  vatAccount: string | null;
}

export interface TtEntry {
  id: string;
  voucher: string;
  row: number | null;
  date: string;
  account: string;
  debit: number;
  credit: number;
  gross: number | null;
  vatPct: number;
  vat: number;
  description: string;
}

export interface TtMachineYear { pct: number; start: number; additions: number; disposals: number; base: number; depreciation: number; end: number }
export interface TtMachine {
  id: string;
  name: string;
  type: string;
  source: string;
  acquiredOn: string | null;
  /** Käyttöönottopäivä (PKKAYTTOPV), jos annettu. */
  usedFrom?: string | null;
  cost: number;
  maxPct: number;
  years: Record<string, TtMachineYear>;
}

export interface TtBuildingYear {
  start: number; additions: number; sales: number; compensation: number; grants: number; equalization: number; base: number; pct: number; depreciation: number; end: number;
  /** Jälleenhankintavarauksen käyttö (TRVJHVARA) ja siirrot (TRVSIIRTOT); uudemmassa jäsennyksessä. */
  replacementReserve?: number;
  transfers?: number;
}
export interface TtBuilding {
  id: string;
  number: string;
  name: string;
  type: number | null;
  depreciationClass: number | null;
  acquiredYear: string | null;
  cost: number;
  maxPct: number;
  years: Record<string, TtBuildingYear>;
}

export interface TtClient {
  name: string | null;
  /** Ilmoitusaineiston nimi Verohallinnon muodossa: sukunimi ensin. */
  taxName?: string | null;
  businessId: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  openYear: number | null;
  vatMethod: string | null;
}

export interface TtFolder {
  folder: string;
  client: TtClient;
  accounts: TtAccount[];
  entries: Record<string, TtEntry[]>;
  machinery: TtMachine[];
  buildings: TtBuilding[];
  /** Lomakkeen 2 luvut tietuetunnuksittain vuosittain. */
  form2: Record<string, Record<string, number>>;
  form2c: Record<string, Record<string, number>>;
  /** Lomakkeen 2 laskentarivit Tilitukin veronumeroittain (myös ilman tietuetunnusta). */
  form2Raw: Record<string, Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Tilin kartoitus
// ---------------------------------------------------------------------------

export type AccountMapping =
  | { type: "category"; category: string }
  /** Maatalouden investointi poistoryhmään (lomake 2: 261, 267, 273). */
  | { type: "agri_asset"; assetClass: AgriAssetClass; accelerated: boolean }
  /** Lomakkeen harvinainen kenttä suoraan viennin summasta (käyttöön ottamattomat koneet 278). */
  | { type: "extra"; code: string }
  | { type: "withholding" }
  | { type: "ignore"; reason: string }
  | { type: "unmapped"; reason: string };

/** Veronumero → Skogin luokka. Maatalous: lomakkeen 2 kenttä suluissa. */
export const TAX_CODE_CATEGORIES: Record<string, string> = {
  // Maatalouden tulot
  L2_209: "agri_livestock_sale", // 210
  L2_355: "agri_livestock_sale_deferred", // 211
  L2_254: "agri_other_sales", // 213
  L2_255: "agri_livestock_products", // 214
  L2_214: "agri_crops", // 215
  L2_256: "agri_accommodation", // 216
  L2_217: "agri_state_subsidy", // 217
  L2_218: "agri_other_subsidy", // 218
  L2_257: "agri_other_income", // 220
  L2_232: "agri_private_use", // 221
  L2_240: "agri_additions", // 222
  L2_240A: "agri_additions", // 222, energiaveron palautus kirjanpidosta
  L2_OSI11: "agri_dividends_listed", // 223/224
  L2_OSI11B: "agri_dividends", // 321/322
  // Skogissa ei ole julkisesti noteerattujen osuuskuntien omaa luokkaa (325/326): ylijäämä viedään kohtaan 327.
  L2_OSI21: "agri_coop_surplus",
  L2_OSI21B: "agri_coop_surplus", // 327/328
  // Maatalouden menot
  L2_223: "agri_wages", // 225
  L2_258: "agri_other_purchases", // 226
  L2_259: "agri_feed", // 229
  L2_259B: "agri_feed", // 229 (10 %)
  L2_260: "agri_other_purchases", // 230 rekisteröidyllä kannan mukaan; ks. ZERO_VAT_FALLBACK
  L2_363: "agri_livestock_purchase_deferred", // 227
  L2_151: "agri_interest", // 465
  L2_170: "agri_interest", // 465
  L2_242: "agri_other_deductions", // 464
  // Metsätalous (2C)
  L2C_102: "standing_sale",
  L2C_103: "delivery_sale",
  L2C_613: "firewood_sale",
  L2C_106_1: "insurance_compensation",
  L2C_106_2: "moose_damage_compensation",
  L2C_106_3: "forestry_subsidy",
  L2C_117: "wages",
  L2C_118: "travel",
  L2C_119: "other_expense",
};

/** Maatalouden investoinnit poistoryhmiin. T-pääte on Tilitukissa korotettu poisto (VHP, 2020–2025). */
const TAX_CODE_ASSETS: Record<string, { assetClass: AgriAssetClass; accelerated: boolean }> = {
  L21_111: { assetClass: "agri_machinery", accelerated: false },
  L21_111T: { assetClass: "agri_machinery", accelerated: true },
  L21_120: { assetClass: "agri_bridges", accelerated: false },
  L21_128: { assetClass: "agri_drainage", accelerated: false },
};

/** Veronumerot, joita Skog ei vielä tue: kirjanpitäjä kirjaa ne käsin. Syy näkyy tuonnin raportissa. */
const UNSUPPORTED_TAX_CODES: Record<string, string> = {
  L21_113: "koneen myynti: kirjaa myynti investoinnille käsin",
  L21_113T: "koneen myynti: kirjaa myynti investoinnille käsin",
  L21_1132: "koneen korvaus tai avustus: kirjaa investointitukena käsin",
  L21_1132T: "koneen korvaus tai avustus: kirjaa investointitukena käsin",
  L21_122: "sillan tms. myynti: kirjaa käsin",
  L21_1222: "sillan tms. avustus: kirjaa investointitukena käsin",
  L21_130: "salaojan myynti: kirjaa käsin",
  L21_1302: "salaojan avustus: kirjaa investointitukena käsin",
  L2_174: "henkilökohtainen pääomatulo (maa-ainekset): ei Skogissa",
  L2_175: "henkilökohtainen pääomatulo (maa-ainekset): ei Skogissa",
  L2_176: "maatalousmaan vuokratulo (7L): ei Skogissa",
  L2_177: "maatalousmaan vuokratulo (7L): ei Skogissa",
  L2_178: "metsämaan vuokratulo (7L): ei Skogissa",
  L2_179: "metsämaan vuokratulo (7L): ei Skogissa",
  L2C_115: "metsätalouden muu pääomatulo: Skogissa ei luokkaa",
  KALUSTOMETSÄ: "metsätalouden investointi: tuodaan kalustokortistosta (ei kirjausta)",
};

/**
 * Tilitukin vakiotilikartan (MAATILAVEROTUS) tilinumero → tarkempi luokka.
 * Käytetään vain, jos luokka vie rivin samaan lomakkeen kohtaan kuin perusluokka.
 */
const ACCOUNT_REFINEMENTS: [RegExp, string][] = [
  [/^19[01]/, "agri_livestock_purchase"],
  [/^2000|^2110/, "agri_feed"],
  [/^2106|^2120/, "agri_veterinary"],
  [/^22/, "agri_fertilizers"],
  [/^23/, "agri_seeds"],
  [/^24/, "agri_fuels"],
  [/^25|^3360/, "agri_energy"],
  [/^26|^30|^31[0-2]/, "agri_repairs"],
  [/^2[89]/, "agri_rents"],
  [/^3210$/, "agri_myel"],
  [/^32/, "agri_insurance"],
  [/^3380$/, "agri_property_tax"],
];

/** Lomakkeen 2 kohta, johon Tilituki vie veronumeron (vain menojen alv-kohdat, joissa luokka voi poiketa). */
const TILITUKI_VAT_FIELD: Record<string, "226" | "229" | "230"> = { L2_258: "226", L2_259: "229", L2_259B: "229", L2_260: "230" };

/**
 * Skogin kohta menolle (agriculture.ts vatField): rekisteröidyllä rivin kanta, muuten luokan oletus.
 * Kiinteän kohdan luokat (230: vakuutus, MYEL, kiinteistövero) menevät aina sinne.
 */
function skogExpenseField(code: string, vatRegistered: boolean, rowVatPct: number): string | null {
  const c = category(code);
  if (!c?.form2) return null;
  if (c.form2 !== "by_vat") return c.form2;
  if (vatRegistered) return rowVatPct >= 20 ? "226" : rowVatPct > 0 ? "229" : "230";
  return c.vat === "general" ? "226" : c.vat === "reduced" ? "229" : "230";
}

/**
 * Tilin kartoitus. `rowVatPct` on viennin verokanta, kun asiakas on alv-velvollinen;
 * sitä käytetään vain tarkennetun luokan tarkistukseen.
 */
export function mapAccount(account: TtAccount | undefined, vatRegistered = true, rowVatPct = 0): AccountMapping {
  if (!account) return { type: "unmapped", reason: "tiliä ei ole tilikartassa" };
  const code = (account.taxCode || "").trim();
  if (/ennakonpid/i.test(account.name)) return { type: "withholding" };
  if (account.class.startsWith("TAALV") || code.startsWith("LALV")) return { type: "ignore", reason: "arvonlisävero (kirjauksen verokanta)" };
  if (code === "LAINA") return { type: "ignore", reason: "laina (lyhennys tai yksityinen korko)" };
  if (code === "RAKENNUS") return { type: "ignore", reason: "rakennus (rakennuskortiston kautta)" };
  if (!code) return { type: "ignore", reason: account.class.startsWith("TA") ? "tasetili" : "ei verolomakkeella (yksityinen tai muu)" };
  const asset = TAX_CODE_ASSETS[code];
  if (asset) return { type: "agri_asset", ...asset };
  if (code === "L21_136") return { type: "extra", code: "278" };
  let base = TAX_CODE_CATEGORIES[code];
  if (base) {
    if (TILITUKI_VAT_FIELD[code]) {
      // Rekisteröimättömällä 0 %:n menot tarvitsevat luokan, jonka oletuskanta on 0 % (Vuokrat on alv-kannan mukaan).
      if (code === "L2_260" && !vatRegistered) base = "agri_rents";
      // Tarkennus ei saa muuttaa lomakkeen kohtaa: se on vain kirjanpitäjälle selkeämpi nimi.
      const refined = ACCOUNT_REFINEMENTS.find(([re]) => re.test(account.number))?.[1];
      if (refined && skogExpenseField(refined, vatRegistered, rowVatPct) === skogExpenseField(base, vatRegistered, rowVatPct)) {
        return { type: "category", category: refined };
      }
    }
    return { type: "category", category: base };
  }
  if (UNSUPPORTED_TAX_CODES[code]) return { type: "unmapped", reason: UNSUPPORTED_TAX_CODES[code] };
  return { type: "unmapped", reason: `tuntematon veronumero ${code}` };
}

// ---------------------------------------------------------------------------
// Vuoden tuontisuunnitelma
// ---------------------------------------------------------------------------

export interface PlannedTransaction {
  legacyId: string;
  bookedOn: string;
  kind: TransactionKind;
  category: string;
  description: string;
  /** Veroton summa etumerkkeineen: hyvitys on negatiivinen. */
  amountNet: number;
  vatRate: number;
  withholding: number;
  reference: string;
  /** Investoinnin hankinta: suunnitelman investoinnin avain. */
  assetKey: string | null;
}

export interface PlannedAsset {
  key: string;
  legacyId: string;
  activity: "agriculture" | "forestry";
  description: string;
  assetClass: AgriAssetClass | null;
  accelerated: boolean;
  ratePct: number;
  acquiredOn: string;
  acquisitionCost: number;
  /** Aiempi investointi: menojäännös vuoden alussa. */
  openingYear: number | null;
  openingBookValue: number | null;
}

export interface PlannedReserve {
  kind: "equalization" | "replacement";
  madeYear: number;
  amount: number;
  /** Tuloutettu verovuonna (219), vanhimmasta alkaen. */
  incomeThisYear: number;
}

export interface UnmappedAccount {
  account: string;
  name: string;
  taxCode: string;
  reason: string;
  count: number;
}

export interface AgriYearPlan {
  spouseWealthSharePct: number | null;
  spouseWorkSharePct: number | null;
  incomeSplitClaim: "ten" | "earned" | null;
  lossToCapitalIncome: number | null;
  wagesSubjectToWithholding: number;
  landValue: number | null;
  rentalDwellingsValue: number | null;
  sharesValue: number | null;
  otherAssetsValue: number | null;
  liabilities: number | null;
  otherFarmAssets: number | null;
}

export interface YearPlan {
  folder: string;
  year: number;
  agriculture: boolean;
  forestry: boolean;
  vatRegistered: boolean;
  transactions: PlannedTransaction[];
  /** Maatalouden aiemmat investoinnit (menojäännös vuoden alussa). Tuodaan vain asiakkaan ensimmäiselle tuontivuodelle. */
  openingAssets: PlannedAsset[];
  /** Verovuoden hankinnat. */
  newAssets: PlannedAsset[];
  agriDepreciations: { pool: AgriPool; amount: number }[];
  agriYear: AgriYearPlan | null;
  extras: { code: string; value: number }[];
  /** Aiemmilta vuosilta purkamattomat varaukset (aloitusvuosi) ja verovuoden varaus. */
  openingReserves: PlannedReserve[];
  yearReserves: PlannedReserve[];
  /** Kotieläinten jaksotukset kahdelta edelliseltä vuodelta (aloitusvuosi). */
  openingDeferrals: { taxYear: number; kind: "livestock_sale" | "livestock_purchase"; amount: number }[];
  unmapped: UnmappedAccount[];
  ignored: Record<string, number>;
  notes: Record<string, number>;
}

/** Lomakkeen 2 kentät, jotka ovat Tilitukissa käsin annettuja summia. Erotus kirjanpitoon tuodaan vuoden lopun kirjauksena. */
const MANUAL_FIELDS: { code: string; category: string; label: string }[] = [
  { code: "221", category: "agri_private_use", label: "tuloutus yksityiskäytöstä" },
  { code: "222", category: "agri_additions", label: "muut lisäykset" },
  { code: "464", category: "agri_other_deductions", label: "muut vähennykset" },
];

/** Rakennuksen poistoluokka (RAKENNUS.TR_POISTOL) → Skogin ryhmä. */
export const BUILDING_CLASSES: Record<number, AgriAssetClass> = {
  1: "agri_production_building",
  2: "agri_dwelling",
  3: "agri_greenhouse",
  4: "agri_environmental",
};

/** Ryhmän alku- ja loppukenttä lomakkeella 2 (agri-depreciation.ts POOL_FIELDS). */
const poolFields = (pool: AgriAssetClass) => POOL_FIELDS[pool];

/**
 * Tilitukin vuoden 2025 päivitys siirsi maatalousmaan vuokratulot uudelle tilille (8120/8125, lomakkeen 2
 * kohta 737) ja tyhjensi vakiotilin 6715 veronumeron. Tilikartta on vain nykytilassa, joten aiempien
 * vuosien viennit tällä tilillä viedään kuten silloin: muihin alv 0 %:n tuloihin (220).
 */
export function accountForYear(a: TtAccount | undefined, year: number): TtAccount | undefined {
  if (a && year <= 2024 && a.number === "6715" && !a.taxCode) return { ...a, taxCode: "L2_257" };
  return a;
}

/** Onko vuodella maataloutta: kirjauksia maatalouden tileillä tai summia lomakkeella 2 (pelkät jako-osuudet eivät riitä). */
export function hasAgriculture(f: TtFolder, year: number): boolean {
  const accounts = new Map(f.accounts.map((a) => [a.number, a]));
  const form = f.form2[String(year)] ?? {};
  if (Object.keys(form).some((c) => !["413", "414", "415", "416"].includes(c))) return true;
  return (f.entries[String(year)] ?? []).some((e) => {
    const code = accountForYear(accounts.get(e.account), year)?.taxCode ?? "";
    return code.startsWith("L2_") || code.startsWith("L21_");
  });
}

export function hasForestry(f: TtFolder, year: number): boolean {
  const accounts = new Map(f.accounts.map((a) => [a.number, a]));
  if (Object.keys(f.form2c[String(year)] ?? {}).length) return true;
  if (f.machinery.some((m) => m.source.toUpperCase().startsWith("METS") && (m.years[String(year)]?.start ?? 0) > 0)) return true;
  return (f.entries[String(year)] ?? []).some((e) => (accounts.get(e.account)?.taxCode ?? "").startsWith("L2C_"));
}

/** Alv-velvollinen, jos vuoden vienneissä on arvonlisäveroa. */
export function isVatRegistered(f: TtFolder, year: number): boolean {
  const accounts = new Map(f.accounts.map((a) => [a.number, a]));
  return (f.entries[String(year)] ?? []).some((e) => {
    const a = accounts.get(e.account);
    return !!a && (a.class.startsWith("TAALV") || a.taxCode.startsWith("LALV")) && (e.debit || e.credit);
  });
}

export function buildYearPlan(f: TtFolder, year: number): YearPlan {
  const Y = String(year);
  const prevY = String(year - 1);
  const accounts = new Map(f.accounts.map((a) => [a.number, a]));
  const vatRegistered = isVatRegistered(f, year);
  const form = f.form2[Y] ?? {};
  const prevForm = f.form2[prevY] ?? {};
  const raw = f.form2Raw[Y] ?? {};
  const prevRaw = f.form2Raw[prevY] ?? {};
  const ignored: Record<string, number> = {};
  const notes: Record<string, number> = {};
  const note = (k: string, n = 1) => (notes[k] = (notes[k] ?? 0) + n);
  const unmappedMap = new Map<string, UnmappedAccount>();
  const transactions: PlannedTransaction[] = [];
  const newAssets: PlannedAsset[] = [];
  const extras = new Map<string, number>();
  const entries = f.entries[Y] ?? [];

  // Ennakonpidätykset tositteittain: liitetään tositteen ainoaan metsätalouden tuloon.
  const withholdingByVoucher = new Map<string, number>();
  for (const e of entries) {
    const a = accounts.get(e.account);
    if (a && mapAccount(a).type === "withholding") withholdingByVoucher.set(e.voucher, round2((withholdingByVoucher.get(e.voucher) ?? 0) + e.debit - e.credit));
  }

  for (const e of entries) {
    if (e.row !== null && e.row < 0) {
      ignored["vastakirjaus (kassa tai pankki)"] = (ignored["vastakirjaus (kassa tai pankki)"] ?? 0) + 1;
      continue;
    }
    const a = accountForYear(accounts.get(e.account), year);
    // Verokanta vain, jos rivillä on veroa: hyvitys ilman veroa on 0 %.
    const vatRate = vatRegistered && e.vat ? e.vatPct : 0;
    const m = mapAccount(a, vatRegistered, vatRate);
    const net = round2(e.debit - e.credit);
    if (m.type === "withholding") continue;
    if (net === 0) {
      ignored["nollarivi"] = (ignored["nollarivi"] ?? 0) + 1;
      continue;
    }
    if (m.type === "ignore") {
      ignored[m.reason] = (ignored[m.reason] ?? 0) + 1;
      continue;
    }
    if (m.type === "unmapped") {
      const key = e.account;
      const u = unmappedMap.get(key) ?? { account: e.account, name: a?.name ?? "", taxCode: a?.taxCode ?? "", reason: m.reason, count: 0 };
      u.count++;
      unmappedMap.set(key, u);
      continue;
    }
    if (m.type === "extra") {
      extras.set(m.code, round2((extras.get(m.code) ?? 0) + net));
      continue;
    }
    const legacyId = tilitukiId("entry", f.folder, e.id);
    const reference = `Tilituki ${e.voucher}`;
    if (m.type === "agri_asset") {
      const key = `asset-entry-${e.id}`;
      const pct = m.accelerated ? 25 : (m.assetClass === "agri_machinery" ? 25 : m.assetClass === "agri_bridges" ? 10 : 20);
      newAssets.push({
        key, legacyId: tilitukiId("asset", f.folder, key), activity: "agriculture", description: e.description || a?.name || "Maatalouden investointi",
        assetClass: m.assetClass, accelerated: m.accelerated, ratePct: pct, acquiredOn: e.date, acquisitionCost: net, openingYear: null, openingBookValue: null,
      });
      transactions.push({ legacyId, bookedOn: e.date, kind: "investment", category: "agri_asset_purchase", description: e.description, amountNet: net, vatRate, withholding: 0, reference, assetKey: key });
      continue;
    }
    const cat = category(m.category)!;
    const amount = cat.kind === "income" ? -net : net;
    // Tilituki laskee kohdan tilit niiden oletuspuolelta, joten menokohdan kredit-tili (esim. luontoisetujen
    // vastatili) kasvattaa summaa. Skog vähentää sen, kuten kirjanpidossa (BLOCKERS 14 y).
    if (cat.kind === "expense" && a?.side === "K") note("menokohdan kredit-tili: Skog vähentää, Tilituki lisää");
    // Veroton rivi verollisella tilillä: Skog vie sen kannan mukaan kohtaan 230, Tilituki tilin mukaan.
    if (cat.form2 === "by_vat" && vatRegistered && vatRate === 0 && (a?.vatPct ?? 0) > 0) note("veroton rivi verollisella tilillä (Skog: kohta 230)");
    if (cat.form2 === "by_vat" && vatRegistered && vatRate > 0 && vatRate < 20 && TILITUKI_VAT_FIELD[a?.taxCode ?? ""] === "226") {
      note("alennetun kannan rivi 25,5 %:n tilillä (Skog: kohta 229)");
    }
    transactions.push({ legacyId, bookedOn: e.date, kind: cat.kind, category: cat.code, description: e.description, amountNet: amount, vatRate, withholding: 0, reference, assetKey: null });
  }

  // Ennakonpidätys tositteen metsätalouden tuloon, jos niitä on täsmälleen yksi.
  for (const [voucher, amount] of withholdingByVoucher) {
    if (amount <= 0) continue;
    const targets = transactions.filter((t) => t.reference === `Tilituki ${voucher}` && t.kind === "income" && !t.category.startsWith("agri_"));
    if (targets.length === 1) targets[0].withholding = amount;
    else note("ennakonpidätystä ei voitu liittää tuloon");
  }

  // Käsin annetut lomakkeen 2 erät: erotus kirjanpidon kautta tulevaan summaan.
  for (const mf of MANUAL_FIELDS) {
    const fromLedger = round2(transactions.filter((t) => t.category === mf.category).reduce((s, t) => s + t.amountNet, 0));
    const diff = round2((form[mf.code] ?? 0) - fromLedger);
    if (Math.abs(diff) < 0.005 || form[mf.code] === undefined) continue;
    const cat = category(mf.category)!;
    transactions.push({
      legacyId: tilitukiId("adjustment", f.folder, Y, mf.code), bookedOn: `${Y}-12-31`, kind: cat.kind, category: mf.category,
      description: `Tilituki: lomakkeen 2 kohta ${mf.code} (${mf.label}), käsin annettu erä`, amountNet: diff, vatRate: 0, withholding: 0, reference: "Tilituki lomake 2", assetKey: null,
    });
    note(`käsin annettu lomakkeen 2 erä tuotu kirjauksena (${mf.code})`);
  }

  // ---------------------------------------------------------------------------
  // Aiemmat investoinnit: menojäännös 31.12. edellisenä vuonna
  // ---------------------------------------------------------------------------
  const openingAssets: PlannedAsset[] = [];
  const opening = (
    key: string, activity: "agriculture" | "forestry", description: string, assetClass: AgriAssetClass | null, accelerated: boolean, ratePct: number, value: number,
    origin?: { acquiredYear: number | null; cost: number },
  ) => {
    if (!(value > 0)) return;
    // Rakennuksen hankintavuosi ja -hinta kortistosta, jos ne sopivat: kertynyt poisto on niiden erotus.
    // Ryhmän menojäännöksellä hankintaa ei tiedetä, joten hinta on menojäännös ja hankinta edellisen vuoden lopussa.
    const known = origin && origin.acquiredYear !== null && origin.acquiredYear < year && origin.cost >= value;
    openingAssets.push({
      key, legacyId: tilitukiId("asset", f.folder, key), activity, description, assetClass, accelerated, ratePct,
      acquiredOn: known ? `${origin!.acquiredYear}-12-31` : `${prevY}-12-31`, acquisitionCost: round2(known ? origin!.cost : value), openingYear: year,
      openingBookValue: round2(value),
    });
  };
  // Verovuoden lomake ratkaisee, jos Tilituki on laskenut sen: kirjanpitäjä on voinut jättää ryhmän tai
  // rakennuksen pois. Laskematta olevalle vuodelle käytetään edellisen vuoden loppuarvoja.
  const computed = ["332", "357", "362", "363"].some((c) => form[c] !== undefined);
  const startOf = (pool: AgriAssetClass) => (computed ? (form[poolFields(pool).start] ?? 0) : (prevForm[poolFields(pool).end] ?? 0));
  // Koneet, sillat ja salaojat ovat Tilitukissa vain ryhmän menojäännöksenä lomakkeella (kalusto on metsätaloutta).
  // Lomakkeen 260/265 on koneiden yhteismäärä, johon sisältyy korotetun poiston koneet (T-rivit).
  const acceleratedStart = computed ? (raw["L21_110T"] ?? 0) : (prevRaw["L21_118T"] ?? 0);
  opening("pool-agri_machinery", "agriculture", "Koneet ja kalusto, menojäännös (Tilituki)", "agri_machinery", false, 25, round2(startOf("agri_machinery") - acceleratedStart));
  opening("pool-agri_machinery_accelerated", "agriculture", "Uudet koneet, korotettu poisto, menojäännös (Tilituki)", "agri_machinery", true, 25, acceleratedStart);
  opening("pool-agri_bridges", "agriculture", "Sillat, padot ja kaivot, menojäännös (Tilituki)", "agri_bridges", false, 10, startOf("agri_bridges"));
  opening("pool-agri_drainage", "agriculture", "Salaojat, menojäännös (Tilituki)", "agri_drainage", false, 20, startOf("agri_drainage"));

  // Rakennukset rakennuksittain, jos rakennuskortiston summa täsmää lomakkeen ryhmään; muuten ryhmänä.
  for (const [cls, pool] of Object.entries(BUILDING_CLASSES)) {
    const formStart = startOf(pool);
    const inClass = f.buildings.filter((b) => b.depreciationClass === Number(cls));
    const valueOf = (b: TtBuilding) => b.years[Y]?.start ?? b.years[prevY]?.end ?? 0;
    // Tilituki jättää lomakkeelta pois rakennuksen, jolle ei ole koskaan annettu poistoprosenttia. Rakennus, jolta
    // poistoa ei tehty vuonna (prosentti tyhjä esim. valmistumisvuonna), on silti lomakkeella.
    const counted = inClass.filter((b) => depreciable(b) && valueOf(b) > 0);
    const skipped = inClass.filter((b) => !counted.includes(b) && valueOf(b) > 0);
    if (skipped.length) note("rakennus ilman poistoprosenttia jätettiin pois (ei Tilitukin lomakkeella)", skipped.length);
    const sum = round2(counted.reduce((s, b) => s + valueOf(b), 0));
    const pct = POOL_PCT[pool];
    if (counted.length && Math.abs(sum - formStart) < 0.05) {
      for (const b of counted) {
        const acquiredYear = b.acquiredYear && /^\d{4}$/.test(b.acquiredYear) ? Number(b.acquiredYear) : null;
        opening(`building-${b.id}`, "agriculture", `${b.name || "Rakennus"} (Tilituki)`, pool, false, pct, valueOf(b), { acquiredYear, cost: b.cost });
      }
    } else {
      if (counted.length) note("rakennukset tuotiin ryhmänä, koska kortisto ei täsmää lomakkeeseen");
      opening(`pool-${pool}`, "agriculture", `${POOL_LABEL[pool]}, menojäännös (Tilituki)`, pool, false, pct, formStart);
    }
    // Verovuoden rakennusmenot rakennuskortistosta (rakennusten viennit ohitetaan, ettei summa tuplaudu).
    for (const b of inClass) {
      const add = b.years[Y]?.additions ?? 0;
      if (add > 0 && depreciable(b)) {
        const key = `building-add-${b.id}-${Y}`;
        newAssets.push({
          key, legacyId: tilitukiId("asset", f.folder, key), activity: "agriculture", description: `${b.name || "Rakennus"}, verovuoden menot (Tilituki)`,
          assetClass: pool, accelerated: false, ratePct: pct, acquiredOn: `${Y}-12-31`, acquisitionCost: round2(add), openingYear: null, openingBookValue: null,
        });
      }
    }
  }

  // Metsätalouden kalusto (KALUSTO, tulolähde metsätalous) tuodaan koko historiana kortti kerrallaan
  // (history.ts, run.ts syncForestHistory), ei vuoden suunnitelmassa.

  // Ryhmien poistot verovuodelle: Tilitukin lomakkeelta, jos vuosi on laskettu.
  const agriDepreciations: YearPlan["agriDepreciations"] = [];
  for (const pool of Object.keys(POOL_FIELDS) as AgriAssetClass[]) {
    const v = form[POOL_FIELDS[pool].dep];
    if (v) agriDepreciations.push({ pool, amount: v });
  }
  const accDep = raw["L21_117T"];
  if (accDep) {
    // Tilituki laskee korotetun poiston koneiden kokonaispoistoon (511); Skogissa se on oma ryhmänsä.
    agriDepreciations.push({ pool: ACCELERATED_POOL, amount: accDep });
    const m = agriDepreciations.find((d) => d.pool === "agri_machinery");
    if (m) m.amount = round2(m.amount - accDep);
  }

  // Lomakkeen 2 harvinaiset kentät sellaisinaan.
  for (const x of AGRI_EXTRA_FIELDS) {
    if (form[x.code] && form[x.code] > 0) extras.set(x.code, round2((extras.get(x.code) ?? 0) + form[x.code]));
  }

  // Vuoden tiedot: puoliso-osuudet, palkat ja varallisuuslaskelman syötettävät erät.
  const has = (c: string) => form[c] !== undefined;
  const agriYear: AgriYearPlan | null = hasAgriculture(f, year) || Object.keys(form).length
    ? {
        spouseWealthSharePct: has("413") || has("414") ? (form["414"] ?? 0) : null,
        spouseWorkSharePct: has("415") || has("416") ? (form["416"] ?? 0) : null,
        incomeSplitClaim: form["418"] === 1 ? "ten" : form["418"] === 2 ? "earned" : null,
        lossToCapitalIncome: form["420"] ?? null,
        wagesSubjectToWithholding: form["437"] ?? 0,
        landValue: form["432"] ?? null,
        rentalDwellingsValue: form["431"] ?? null,
        sharesValue: form["468"] ?? null,
        // Skog lisää muihin varoihin siltojen ja salaojien menojäännöksen (271, 277).
        otherAssetsValue: has("469") ? Math.max(0, round2(form["469"] - (form["271"] ?? 0) - (form["277"] ?? 0))) : null,
        liabilities: form["732"] ?? null,
        otherFarmAssets: form["470"] ?? null,
      }
    : null;

  // Varaukset: edellisen vuoden lopun purkamattomat (170–175) ja verovuoden tasausvaraus (232).
  const openingReserves: PlannedReserve[] = [];
  for (let i = 0; i < 3; i++) {
    const made = year - 3 + i;
    const eq = prevForm[String(170 + i)];
    if (eq) openingReserves.push({ kind: "equalization", madeYear: made, amount: eq, incomeThisYear: 0 });
    const rep = prevForm[String(173 + i)];
    if (rep) openingReserves.push({ kind: "replacement", madeYear: made, amount: rep, incomeThisYear: 0 });
  }
  let income = form["219"] ?? 0;
  for (const r of openingReserves.filter((x) => x.kind === "equalization")) {
    const use = Math.min(income, r.amount);
    r.incomeThisYear = round2(use);
    income = round2(income - use);
  }
  if (income > 0) note("tasausvarauksen tuloutusta ei voitu kohdistaa varaukseen");
  const yearReserves: PlannedReserve[] = form["232"] ? [{ kind: "equalization", madeYear: year, amount: form["232"], incomeThisYear: 0 }] : [];
  for (const c of ["242", "247", "252", "257", "262", "268", "274", "280"]) if (form[c]) note("investointiin käytetty tasausvaraus: kirjaa käsin");

  // Kotieläinten jaksotukset kahdelta edelliseltä vuodelta (211 ja 227 kyseisen vuoden lomakkeelta).
  const openingDeferrals: YearPlan["openingDeferrals"] = [];
  for (const back of [1, 2]) {
    const fy = f.form2[String(year - back)] ?? {};
    if (fy["211"]) openingDeferrals.push({ taxYear: year - back, kind: "livestock_sale", amount: fy["211"] });
    if (fy["227"]) openingDeferrals.push({ taxYear: year - back, kind: "livestock_purchase", amount: fy["227"] });
  }

  return {
    folder: f.folder,
    year,
    agriculture: hasAgriculture(f, year),
    forestry: hasForestry(f, year),
    vatRegistered,
    transactions,
    openingAssets,
    newAssets,
    agriDepreciations,
    agriYear,
    extras: [...extras].filter(([, v]) => v > 0).map(([code, value]) => ({ code, value })),
    openingReserves,
    yearReserves,
    openingDeferrals,
    unmapped: [...unmappedMap.values()].sort((a, b) => a.account.localeCompare(b.account)),
    ignored,
    notes,
  };
}

/** Rakennus, jolle Tilitukissa on jonain vuonna annettu poistoprosentti. */
const depreciable = (b: TtBuilding) => Object.values(b.years).some((y) => (y.pct ?? 0) > 0);

const POOL_PCT: Record<AgriAssetClass, number> = {
  agri_production_building: 10, agri_dwelling: 6, agri_greenhouse: 20, agri_environmental: 25, agri_machinery: 25, agri_bridges: 10, agri_drainage: 20,
};
const POOL_LABEL: Record<AgriAssetClass, string> = {
  agri_production_building: "Tuotantorakennukset", agri_dwelling: "Asuin- ja toimistorakennukset", agri_greenhouse: "Kasvihuoneet ym.",
  agri_environmental: "Ympäristönsuojelun rakennelmat", agri_machinery: "Koneet ja kalusto", agri_bridges: "Sillat, padot ja kaivot", agri_drainage: "Salaojat",
};

/** Tilitukin asiakkaan nimi Skogin kenttiin: koko virallinen nimi sukunimeksi, koska henkilön ja tilan nimeä ei voi erottaa. */
// Yhtymän, kuolinpesän tai yrityksen nimeä ei jaeta suku- ja etunimeksi.
const GROUP_NAME = /(\s(ja|&)\s|kuolinpes|yhtym|(oy|ky|ay|tmi|ry))/i;

/**
 * Asiakkaan nimi. Tilitukin ilmoitusaineiston nimi on Verohallinnon muodossa
 * "Sukunimi Etunimet", joten ensimmäinen sana on sukunimi. Yhtymä tai kuolinpesä
 * jää kokonaan sukunimeksi, jotta nimi ei hajoa.
 */
export function clientName(c: TtClient, folder: string): { firstName: string; lastName: string } {
  const tax = (c.taxName ?? "").trim().replace(/\s+/g, " ");
  if (tax && !GROUP_NAME.test(tax)) {
    const [last, ...rest] = tax.split(" ");
    if (rest.length) return { firstName: rest.join(" "), lastName: last };
  }
  const whole = tax || (c.name ?? "").trim();
  return { firstName: "", lastName: whole || `Tilituki-asiakas ${folder}` };
}
