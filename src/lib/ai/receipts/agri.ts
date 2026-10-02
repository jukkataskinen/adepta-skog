import { AGRI_ASSET_CLASSES, category, generalVatRate, reducedVatRate, type AgriAssetClass } from "@/lib/tax/rules";

/**
 * Maatalouden tositteiden tunnistuksen säännöt (DECISIONS 2.10.2026,
 * maatalouden tositteiden tunnistus). Puhdas moduuli: samat tiedot menevät
 * tekoälyn ohjeeseen (anthropic.ts) ja tarkistukseen (schema.ts), joten ohje ja
 * tulkinta eivät voi erota toisistaan.
 *
 * Tekoäly lukee tositteesta tuen nimen ja valitsee tukilajin. Luokka ja
 * lomakkeen 2 kenttä tulevat tukilajista tässä, ei mallilta, koska tukien jako
 * kohtiin 217 ja 218 on kirjanpitäjän tulkinta (BLOCKERS 14 a), ja sen pitää
 * olla sama joka tositteella ja helppo muuttaa yhdestä paikasta.
 */

export interface SubsidyType {
  code: string;
  /** Tukilajin nimi suomeksi (näkyy perustelussa). */
  label: string;
  /** Tunnistuksen avainsanat ohjeeseen: tuen nimet, joilla laji näkyy maksuilmoituksella. */
  examples: string;
  /** Kirjauksen luokka. */
  category: string;
  /** Lomakkeen 2 kenttä, johon luokka vie; null = ei tuloa (investointituki). */
  field: "217" | "218" | "220" | "222" | null;
  /** Jako on tulkinta, joka on vahvistettava (BLOCKERS 14). */
  uncertain: boolean;
  /** Ehdotuksen varmuuden yläraja: epävarma laji näkyy kirjanpitäjälle keltaisena. */
  maxConfidence?: number;
  /** Huomautus kirjanpitäjälle ehdotusrivin alla. */
  note?: string;
}

/**
 * Tukilajit. CAP-tuet (EU:n ja valtion yhdessä rahoittamat) ja kansalliset tuet
 * maksaa Ruokavirasto, ELY-keskus tai kunnan maaseutuviranomainen, joten ne
 * ovat valtiolta saatuja tukia (217). Ostajan kautta saatu tuki ja muut
 * korvaukset ovat 218, vahingonkorvaukset sadosta ja eläimistä 220 ja
 * energiaveron palautus 222. Investointituki ei ole tuloa: se vähennetään
 * hankintamenosta Lomake 2 -välilehdellä.
 */
export const SUBSIDY_TYPES: SubsidyType[] = [
  { code: "basic_income", label: "Perustulotuki", examples: "perustulotuki, tilatuki (ennen 2023), suorat tuet", category: "agri_state_subsidy", field: "217", uncertain: false },
  { code: "redistributive", label: "Uudelleenjakotulotuki", examples: "uudelleenjakotulotuki, uudelleenjakotuki", category: "agri_state_subsidy", field: "217", uncertain: false },
  { code: "young_farmer", label: "Nuoren viljelijän tulotuki", examples: "nuoren viljelijän tulotuki, nuoren viljelijän tuki (suora tuki)", category: "agri_state_subsidy", field: "217", uncertain: false },
  {
    code: "coupled", label: "Tuotantosidonnainen tuki",
    examples: "nautapalkkio, emolehmäpalkkio, sonnipalkkio, uuhi- ja kuttupalkkio, teurastettavan karitsan ja kilin palkkio, valkuaiskasvien, rukiin, sokerijuurikkaan, tärkkelysperunan, avomaanvihannesten ja öljykasvien tuotantosidonnainen tuki",
    category: "agri_state_subsidy", field: "217", uncertain: false,
  },
  {
    code: "eco_scheme", label: "Ekojärjestelmätuki",
    examples: "ekojärjestelmätuki, ilmasto- ja ympäristötuki, talviaikainen kasvipeitteisyys, peltoluonnon monimuotoisuus, kerääjäkasvit, maanparannuskasvit, viherryttämistuki (ennen 2023)",
    category: "agri_state_subsidy", field: "217", uncertain: false,
  },
  { code: "natural_constraint", label: "Luonnonhaittakorvaus", examples: "luonnonhaittakorvaus (LHK) ja sen kansallinen lisäosa", category: "agri_state_subsidy", field: "217", uncertain: true },
  {
    code: "environmental", label: "Ympäristö- ja luomukorvaus",
    examples: "ympäristökorvaus, ympäristösitoumus, lohkokohtaiset toimenpiteet, luonnonmukainen tuotanto (luomukorvaus), alkuperäisrotujen kasvattaminen, kosteikkojen hoito, ei-tuotannollinen investointi",
    category: "agri_state_subsidy", field: "217", uncertain: true,
  },
  { code: "animal_welfare", label: "Eläinten hyvinvointikorvaus", examples: "eläinten hyvinvointikorvaus, eläinten hyvinvointisitoumus", category: "agri_state_subsidy", field: "217", uncertain: true },
  {
    code: "northern", label: "Pohjoinen tuki",
    examples: "pohjoinen tuki, pohjoinen kotieläintuki, maidon tuotantotuki, pohjoinen hehtaarituki, pohjoinen peltokasvituki",
    category: "agri_state_subsidy", field: "217", uncertain: false,
  },
  {
    code: "southern_national", label: "Etelä-Suomen kansallinen tuki",
    examples: "Etelä-Suomen kansallinen tuki, kotieläintalouden tuki (AB-alue), sika- ja siipikarjatalouden tuotannosta irrotettu tuki, 141-tuki",
    category: "agri_state_subsidy", field: "217", uncertain: false,
  },
  {
    code: "national_other", label: "Muu kansallinen tuki",
    examples: "kasvihuonetuotannon tuki, puutarhatuotteiden varastointituki, kriisituki, poikkeuksellinen tuki, mehiläistalouden tuki",
    category: "agri_state_subsidy", field: "217", uncertain: false,
  },
  {
    code: "damage", label: "Vahinkokorvaus",
    examples: "riistavahinkokorvaus, hirvieläinvahinko, satovahinkokorvaus, eläintautikorvaus, petovahinkokorvaus",
    category: "agri_other_income", field: "220", uncertain: true, maxConfidence: 0.6,
    note: "Vahinkokorvaus sadosta tai eläimistä on muuta alv 0 % tuloa (220). Tarkista, onko korvaus tuki vai vahingonkorvaus.",
  },
  {
    code: "via_buyer", label: "Ostajan kautta maksettu tuki",
    examples: "meijerin, teurastamon tai viljan ostajan kautta maksettu tuki tai lisä",
    category: "agri_other_subsidy", field: "218", uncertain: false,
  },
  {
    code: "start_aid", label: "Aloitustuki", examples: "nuoren viljelijän aloitustuki (avustus), tilanpidon aloittamisen tuki",
    category: "agri_other_subsidy", field: "218", uncertain: true, maxConfidence: 0.4,
    note: "Aloitustuen verokohtelu on tarkistettava (BLOCKERS 14). Jos tuki on myönnetty investointiin, se vähennetään hankintamenosta eikä ole tuloa.",
  },
  {
    code: "investment_aid", label: "Investointituki", examples: "investointituki, investointiavustus, rakentamisen tuki, salaojituksen tuki",
    category: "agri_other_subsidy", field: null, uncertain: false, maxConfidence: 0.4,
    note: "Investointituki ei ole tuloa. Poista rivi ja kirjaa tuki Lomake 2 -välilehden investointitukiin, jolloin se vähennetään hankintamenosta.",
  },
  {
    code: "energy_tax_refund", label: "Energiaveron palautus", examples: "maatalouden energiaveron palautus, energiatuotteiden valmisteveron palautus",
    category: "agri_additions", field: "222", uncertain: false,
  },
  {
    code: "other", label: "Muu tuki", examples: "tuki, jonka lajia ei tunnisteta yllä olevista",
    category: "agri_other_subsidy", field: "218", uncertain: true, maxConfidence: 0.5,
    note: "Tukilajia ei tunnistettu. Tarkista luokka: valtion tuki on Maataloustuet (217), muu tuki Muut tuet ja korvaukset (218).",
  },
];

export const SUBSIDY_TYPE_CODES = SUBSIDY_TYPES.map((s) => s.code) as [string, ...string[]];

export function subsidyType(code: string | null | undefined): SubsidyType | null {
  return SUBSIDY_TYPES.find((s) => s.code === code) ?? null;
}

/** Tuen luokat: rivi, jonka luokka on jokin näistä, voi saada luokan tukilajista. */
const SUBSIDY_CATEGORIES = new Set(["agri_state_subsidy", "agri_other_subsidy", "agri_other_income", "agri_additions"]);

/** Maatalouden poistoryhmät tekoälyn skeemaan (investoinnin ryhmä). */
export const AGRI_ASSET_CLASS_CODES = AGRI_ASSET_CLASSES.map((c) => c.code) as [AgriAssetClass, ...AgriAssetClass[]];

/** Rivi, jota huomautukset koskevat (schema.ts:n tarkistettu rivi). */
export interface AnnotatableLine {
  date: string | null;
  description: string;
  category: string;
  amountGross: number;
  vatRate: number;
  withholding: number;
  confidence: number;
  reasoning: string;
  documentType: string;
  note?: string | null;
  subsidyType?: string | null;
  assetClass?: string | null;
}

const fiDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
};
const pct = (n: number) => `${String(n).replace(".", ",")} %`;

/**
 * Verokannan tarkistus päivän mukaan. Kantaa ei muuteta, koska tositteen kanta
 * ratkaisee: esimerkiksi tammikuun 2026 maitotilitys joulukuun 2025 maidosta on
 * 14 %, vaikka tilityspäivänä kanta on 13,5 %. Ristiriidasta tulee huomautus.
 */
export function vatRateNote(line: Pick<AnnotatableLine, "date" | "category" | "vatRate">): string | null {
  if (!line.date || line.vatRate <= 0) return null;
  const c = category(line.category);
  if (!c) return null;
  if (line.vatRate === 14 || line.vatRate === 13.5) {
    const expected = reducedVatRate(line.date);
    if (expected !== line.vatRate) {
      return `Alennettu verokanta on ${pct(expected)} päivänä ${fiDate(line.date)}, tositteella ${pct(line.vatRate)}. Tarkista, koskeeko tilitys edellisen vuoden toimituksia.`;
    }
  }
  if (line.vatRate === 24 || line.vatRate === 25.5) {
    const expected = generalVatRate(line.date);
    if (expected !== line.vatRate) return `Yleinen verokanta on ${pct(expected)} päivänä ${fiDate(line.date)}, tositteella ${pct(line.vatRate)}. Tarkista päivä ja kanta.`;
  }
  return null;
}

/**
 * Asiakirjalajin ja luokan mukaiset huomautukset. Ne kertovat kirjanpitäjälle
 * asian, jota tositteesta ei voi päätellä (jaksotus, yksityisosuus,
 * vaihtokone), eivätkä muuta rivin summaa.
 */
export function lineNotes(l: AnnotatableLine): string[] {
  const notes: string[] = [];
  const t = l.documentType;
  if (t === "livestock_trade" && l.category === "agri_livestock_sale") {
    notes.push("Kotieläinten myynnin voi jaksottaa kolmelle vuodelle, jos myydään merkittävä osa eläimistä: valitse kirjaukselle Jaksota tai luokka Kotieläinten myynti, jaksotettava.");
  }
  if (t === "livestock_trade" && (l.category === "agri_other_purchases" || l.category === "agri_livestock_purchase" || l.category === "agri_livestock_purchase_deferred")) {
    notes.push("Kotieläinten hankinnan voi jaksottaa kolmelle vuodelle: valitse kirjaukselle Jaksota tai luokka Kotieläinten hankinta, jaksotettava.");
  }
  if (l.category === "agri_energy" && (t === "utility_invoice" || /sähkö/i.test(l.description))) {
    notes.push("Jos sähköä käytetään myös asunnossa, merkitse maatalouden osuus Osuus-sarakkeeseen (esimerkiksi 80 %).");
  }
  if (l.category === "agri_fuels") {
    notes.push("Energiaveron palautus kirjataan erikseen palautuspäätöksestä (Energiaveron palautus ja muut lisäykset), ei tästä laskusta.");
  }
  if (l.category === "agri_asset_purchase") {
    const cls = AGRI_ASSET_CLASSES.find((c) => c.code === l.assetClass);
    notes.push(`Investointi: poistoryhmä ${cls ? `${cls.label} (${cls.pct} %)` : "valitaan tallennettaessa"}. Tarkista ryhmä ennen tallennusta.`);
  }
  if (l.category === "agri_asset_sale") {
    notes.push("Vaihtokone tai myyty kone: valitse myytävä kone. Myyntihinta vähennetään koneiden menojäännöksestä.");
  }
  if (l.category === "agri_coop_surplus") {
    notes.push("Osuuskunnan ylijäämä: veronalainen osuus lasketaan lomakkeella 2 (327 ja 328).");
  }
  if (t === "subsidy_decision") {
    notes.push("Tukipäätös ei ole maksu. Tuki kirjataan maksupäivän mukaan maksuilmoituksesta tai Vipun maksetuista tuista.");
  }
  return notes;
}

const joinNotes = (parts: (string | null | undefined)[]) =>
  [...new Set(parts.map((p) => (p ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))].join(" ").slice(0, 300) || null;

/**
 * Maatalousasiakkaan rivien jälkikäsittely: tuen luokka tukilajista, alv 0 %
 * tuille, varmuuden yläraja epävarmoille lajeille, investoinnin oletusryhmä
 * (koneet) ja huomautukset. Metsätalouden rivit (ei agri_-luokkaa) jäävät ennalleen.
 */
export function annotateAgriLine<T extends AnnotatableLine>(l: T): T {
  if (!l.category.startsWith("agri_")) return { ...l, subsidyType: null, assetClass: null };
  let out: T = { ...l };
  const sub = subsidyType(l.subsidyType);
  const subsidyDoc = ["subsidy_payment", "subsidy_summary", "subsidy_decision"].includes(l.documentType);
  if (sub && (SUBSIDY_CATEGORIES.has(l.category) || subsidyDoc)) {
    out = {
      ...out,
      category: sub.category,
      vatRate: 0,
      withholding: 0,
      confidence: Math.min(out.confidence, sub.maxConfidence ?? 1),
      note: joinNotes([out.note, sub.note]),
    };
  } else {
    out = { ...out, subsidyType: null };
  }
  if (out.category === "agri_asset_purchase") {
    out = { ...out, assetClass: AGRI_ASSET_CLASS_CODES.includes(out.assetClass as AgriAssetClass) ? out.assetClass : "agri_machinery" };
  } else {
    out = { ...out, assetClass: null };
  }
  // Tukipäätös on aina epävarma: summa maksetaan myöhemmin ja voi muuttua.
  if (out.documentType === "subsidy_decision") out = { ...out, confidence: Math.min(out.confidence, 0.3) };
  return { ...out, note: joinNotes([out.note, ...lineNotes(out), vatRateNote(out)]) };
}
