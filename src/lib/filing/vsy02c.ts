import { forestDeductionPct, FOREST_DEDUCTION_MIN } from "@/lib/tax/rules";

/**
 * Metsätalouden veroilmoitus 2C sähköisenä ilmoitustiedostona (tietovirta
 * VSY02C), jonka tilitoimisto lataa Ilmoitin.fi-palveluun. Puhdas funktio:
 * ei kantakutsuja, syöte sisään ja tiedoston teksti ulos.
 *
 * Lähteet (luettu 28.9.2026):
 * - [TK26] Verohallinto: 2C Metsätalouden veroilmoitus, tietuekuvaus 2026,
 *   versio 1.0, 22.9.2026. https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2026_2c.pdf
 * - [TK25] Sama verovuodelle 2025, versio 1.0, 23.9.2025 (…/verohallinto_tietuekuvaus_2025_2c.pdf).
 *   Tunnukset ovat samat; erot ovat tietuetunnus (VSY02C25), varausvuodet ja
 *   metsävähennyksen enimmäismäärän tarkistus (#819 60 %, 2026 #2049 75 %).
 * - [YK] Verohallinto: Sähköinen ilmoittaminen, yleiskuvaus, versio 6.12,
 *   13.2.2026: tunnus:tieto-muoto (2.1), muodot R13,2 ja +N7 (3.1), HETU2 ja
 *   YTUNNUS2 (3.2), ohjelmiston tiedot 014/048/198 (8), merkistö ISO-8859-1 (9).
 * - [OHJE] vero.fi: Metsätalouden veroilmoitus 2C (täyttöohje): tulot aina
 *   ilman arvonlisäveroa, menot ilman veroa vain alv-velvolliselle,
 *   ennakonpidätystä ei ilmoiteta, hankintatyö tekijöittäin, luovutukset
 *   poistotaulukossa menojäännöksinä.
 *
 * Kentät, joille Skogissa ei ole tietoa, jätetään pois ([YK] 2.1: puuttuva
 * tieto jätetään tunnuksineen pois). Luettelo DECISIONS 28.9.2026.
 */

export interface Vsy02cSpec {
  year: number;
  recordId: string;
  version: string;
  published: string;
  /** Tarkistus, joka rajaa verovuoden metsävähennyksen prosenttiin tunnuksesta 716. */
  deductionCheck: string;
}

/** Tuetut verovuodet. Uuden vuoden tietuekuvaus luetaan ja lisätään tähän joka syksy. */
export const VSY02C_SPECS: Record<number, Vsy02cSpec> = {
  2025: { year: 2025, recordId: "VSY02C25", version: "1.0", published: "2025-09-23", deductionCheck: "#819" },
  2026: { year: 2026, recordId: "VSY02C26", version: "1.0", published: "2026-09-22", deductionCheck: "#2049" },
};

/**
 * Ohjelmiston tiedot [YK] 8.1–8.2. 014 on ohjelmiston tuottaneen yhtiön
 * Y-tunnus ja kaksi itse valittua tarkistemerkkiä alaviivalla erotettuna.
 * Skogin tuottaa Adepta Oy (Y-tunnus 2237131-2, vanhan sovelluksen
 * tietosuojaseloste). Tarkistemerkit SK valittiin tässä; ne ilmoitetaan
 * Verohallinnolle (ohjelmistotalot@vero.fi) ennen tuotantokäyttöä (BLOCKERS 9).
 */
export const SKOG_SOFTWARE = { name: "Adepta Skog 2", id: "2237131-2_SK" } as const;

/** Tunnusten nimet tietuekuvauksesta [TK26] 7, esikatselua varten. */
export const VSY02C_LABELS: Record<string, string> = {
  "603": "Puun myyntitulot, pystykaupat",
  "604": "Puun myyntitulot, hankintakaupat",
  "613": "Puun myyntitulot, poltto- ja joulupuukaupat",
  "690": "Puun myyntitulot yhteensä",
  "605": "Hankintatyön arvo, hankintakaupat",
  "625": "Hankintatyön arvo, poltto- ja joulupuukaupat",
  "691": "Hankintatyön arvo yhteensä",
  "607": "Vakuutuskorvaukset",
  "608": "Hirvivahinkokorvaukset",
  "609": "Metsätalouden tuet",
  "610": "Vakuutus- ja hirvivahinkokorvaukset, metsätalouden tuet yhteensä",
  "615": "Metsävähennys",
  "618": "Metsävähennys ja varaukset yhteensä",
  "620": "Muut pääomatuloksi luettavat erät",
  "651": "Muut pääomatuloksi luettavat erät yhteensä",
  "622": "Palkkausmenot",
  "623": "Matkakulut",
  "624": "Muut vuosimenot",
  "693": "Vuosimenot yhteensä",
  "660": "Menojäännös 1.1.: Koneet ja kalusto",
  "670": "Menojäännös 1.1.: Rakennukset",
  "680": "Menojäännös 1.1.: Ojat ja tiet",
  "661": "Lisäykset verovuonna: Koneet ja kalusto",
  "671": "Lisäykset verovuonna: Rakennukset",
  "681": "Lisäykset verovuonna: Ojat ja tiet",
  "645": "Luovutukset verovuonna: Koneet ja kalusto",
  "646": "Luovutukset verovuonna: Rakennukset",
  "682": "Luovutukset verovuonna: Ojat ja tiet",
  "642": "Poistot: Koneet ja kalusto",
  "643": "Poistot: Rakennukset",
  "644": "Poistot: Ojat ja tiet",
  "694": "Poistot yhteensä",
  "626": "Menojäännös 31.12.: Koneet ja kalusto",
  "627": "Menojäännös 31.12.: Rakennukset",
  "628": "Menojäännös 31.12.: Ojat ja tiet",
  "630": "Toisesta tulolähteestä siirrettävät menot",
  "635": "Metsätalouden puhdas pääomatulo",
  "636": "Metsätalouden tappiollinen pääomatulo",
  "655": "Metsävähennyspohja",
  "656": "Aikaisemmin käytetty metsävähennys",
  "657": "Luovutusvoittoihin lisättyjen metsävähennysten määrä",
  "715": "Käytettävissä olevan metsävähennyksen määrä",
  "716": "Veronalainen pääomatulo metsävähennykseen oikeuttavista metsistä",
  "717": "Verovuoden metsävähennys",
  "720": "Käytetty metsävähennys yhteensä",
};

/**
 * Tunnusten järjestys tietuekuvauksen tunnus-tietoluettelossa [TK26] 7.
 * Oma lista, koska JavaScript järjestää numeroiset avaimet numerojärjestykseen.
 */
export const VSY02C_ORDER = [
  "603", "604", "613", "690", "605", "625", "691", "607", "608", "609", "610", "615", "618", "620", "651", "622", "623", "624", "693",
  "660", "670", "680", "661", "671", "681", "645", "646", "682", "642", "643", "644", "694", "626", "627", "628", "630", "635", "636",
  "655", "656", "657", "715", "716", "717", "720",
];

export type AssetClass = "machinery" | "buildings" | "roads";

/** Poistotaulukon tunnukset lajeittain [TK26] 7: alku, lisäys, luovutus, poisto, loppu. */
const ASSET_CODES: Record<AssetClass, { start: string; add: string; out: string; dep: string; end: string }> = {
  machinery: { start: "660", add: "661", out: "645", dep: "642", end: "626" },
  buildings: { start: "670", add: "671", out: "646", dep: "643", end: "627" },
  roads: { start: "680", add: "681", out: "682", dep: "644", end: "628" },
};

export interface Filing2cAsset {
  method: "straight_line" | "declining_balance";
  decliningRatePct: number | null;
  acquiredOn: string;
  /** Poistamaton arvo vuoden alussa (hankintavuonna hankintameno). */
  bookValueStart: number;
  sold: boolean;
  /** Metsätilan luovutuksessa metsän hankintamenoon siirtynyt arvo. */
  transferred: number;
  /** Vahvistettu poisto (0, jos suunnitelmaa ei ole vahvistettu). */
  depreciation: number;
}

export interface Filing2cData {
  year: number;
  vatRegistered: boolean;
  /**
   * Kirjausten summat luokittain (rules.ts CATEGORIES): veroton ja brutto.
   * Investointiin liitetyn myynnin hinta ei ole mukana, koska myynti on
   * luovutusvoittoa (lomake 9) eikä metsätalouden tuloa.
   */
  categories: Record<string, { net: number; gross: number }>;
  assets: Filing2cAsset[];
  /** Koko arvo siirtyi metsän hankintamenoon (tila myyty kokonaan). */
  transfersOut: { method: "straight_line" | "declining_balance"; decliningRatePct: number | null; acquiredOn: string; amount: number }[];
  forestDeduction: number;
  /** Toisesta tulolähteestä siirrettävät menot (630): maatalouden kaluston metsätalouden ajot (lomake 2: 284). Puuttuva = 0. */
  otherSourceExpense?: number;
  tracking: { base: number; usedBefore: number; addedToGains: number; missing: number } | null;
  planConfirmed: boolean;
  yearOpen: boolean;
  /** Vuonna myydyt koneet tai metsätilat: luovutusvoitot ilmoitetaan erikseen. */
  hasDisposals: boolean;
}

export interface Field2c {
  code: string;
  label: string;
  value: number;
}

export interface Computed2c {
  spec: Vsy02cSpec;
  fields: Field2c[];
  /** Hankintatyön arvo yhteensä (luokka Hankintatyö). */
  deliveryWork: number;
  /** Estävät virheet: Verohallinto ei ota tiedostoa vastaan. */
  errors: string[];
  warnings: string[];
}

export interface DeliveryWorker {
  name: string;
  /** Kysytään vain tiedostoa muodostettaessa, ei tallenneta (DECISIONS 28.9.2026). */
  personalId: string;
  madeM3: number;
  transportedM3: number;
  value: number;
  taxableValue: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const eur = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export function assetClass(a: { method: string; decliningRatePct: number | null }): AssetClass | null {
  if (a.method !== "declining_balance") return null;
  if (a.decliningRatePct === 15) return "roads";
  if (a.decliningRatePct === 10) return "buildings";
  if (a.decliningRatePct === 25) return "machinery";
  return null;
}

/** Luvut 2C:n kenttiin ilman tunnisteita. Sama tulos näytetään esikatseluna ja kirjoitetaan tiedostoon. */
export function compute2c(d: Filing2cData): Computed2c {
  const spec = VSY02C_SPECS[d.year];
  if (!spec) throw new Error(`2C-tietuekuvausta vuodelle ${d.year} ei ole`);
  const errors: string[] = [];
  const warnings: string[] = [];
  const values = new Map<string, number>();
  const set = (code: string, v: number) => {
    const r = round2(v);
    if (r !== 0) values.set(code, r);
  };
  const net = (code: string) => d.categories[code]?.net ?? 0;
  // Menot arvonlisäverollisina, jos asiakas ei ole alv-velvollinen [OHJE, Menot ja varaukset].
  const cost = (code: string) => (d.vatRegistered ? (d.categories[code]?.net ?? 0) : (d.categories[code]?.gross ?? 0));

  const known = new Set(["standing_sale", "delivery_sale", "firewood_sale", "insurance_compensation", "moose_damage_compensation", "forestry_subsidy", "asset_purchase", "asset_sale", "wages", "travel", "other_expense", "delivery_work"]);
  for (const code of Object.keys(d.categories)) if (!known.has(code)) errors.push(`Luokkaa ${code} ei osata viedä veroilmoitukselle.`);

  // Puun myyntitulot aina ilman arvonlisäveroa [OHJE, Puun myyntitulot].
  const standing = round2(net("standing_sale"));
  const delivery = round2(net("delivery_sale"));
  const firewood = round2(net("firewood_sale"));
  set("603", standing);
  set("604", delivery);
  set("613", firewood);
  const sales = round2(standing + delivery + firewood);
  set("690", sales);

  // Hankintatyön arvo vähennetään ensin hankintakaupoista, sitten polttopuukaupoista (#1401, #1402).
  const deliveryWork = round2(net("delivery_work"));
  const w605 = round2(Math.min(deliveryWork, delivery));
  const w625 = round2(Math.min(deliveryWork - w605, firewood));
  set("605", w605);
  set("625", w625);
  const work = round2(w605 + w625);
  set("691", work);
  if (deliveryWork > work) {
    warnings.push(
      `Hankintatyön arvosta ${eur(deliveryWork - work)} ei mahdu tämän vuoden hankinta- tai polttopuukauppojen tuloihin. Se vähennetään sinä vuonna, kun kaupasta saadaan maksu, joten se jää tästä tiedostosta pois.`,
    );
  }

  const insurance = round2(net("insurance_compensation"));
  const moose = round2(net("moose_damage_compensation"));
  const subsidy = round2(net("forestry_subsidy"));
  set("607", insurance);
  set("608", moose);
  set("609", subsidy);
  const compensations = round2(insurance + moose + subsidy);
  set("610", compensations);

  // Investointiin liittämätön myyntikirjaus on Skogissa tuloa, joten se viedään muihin eriin.
  const otherIncome = round2(net("asset_sale"));
  set("620", otherIncome);
  set("651", otherIncome);
  if (otherIncome) warnings.push(`Käyttöomaisuuden myynti ilman investointia (${eur(otherIncome)}) on viety kohtaan Muut pääomatuloksi luettavat erät. Tarkista, kuuluuko se sinne.`);

  const wages = round2(cost("wages"));
  const travel = round2(cost("travel"));
  const other = round2(cost("other_expense"));
  set("622", wages);
  set("623", travel);
  set("624", other);
  const expenses = round2(wages + travel + other);
  set("693", expenses);

  // Poistotaulukko lajeittain. Loppu lasketaan kaavalla, jotta tarkistukset #2050–#2052 täsmäävät aina.
  const table: Record<AssetClass, { start: number; add: number; out: number; dep: number }> = {
    machinery: { start: 0, add: 0, out: 0, dep: 0 },
    buildings: { start: 0, add: 0, out: 0, dep: 0 },
    roads: { start: 0, add: 0, out: 0, dep: 0 },
  };
  let unclassified = 0;
  const classOf = (a: { method: string; decliningRatePct: number | null }) => {
    const c = assetClass(a);
    if (!c) unclassified++;
    return c ?? "machinery";
  };
  const acquiredThisYear = (a: { acquiredOn: string }) => Number(a.acquiredOn.slice(0, 4)) === d.year;
  for (const a of d.assets) {
    const t = table[classOf(a)];
    if (acquiredThisYear(a)) t.add += a.bookValueStart;
    else t.start += a.bookValueStart;
    // Luovutus on myydyn hyödykkeen menojäännös [OHJE, Poistot]; myyntivuonna poistoa ei tehdä.
    if (a.sold) t.out += a.bookValueStart;
    else {
      t.out += a.transferred;
      t.dep += a.depreciation;
    }
  }
  for (const a of d.transfersOut) {
    const t = table[classOf(a)];
    if (acquiredThisYear(a)) t.add += a.amount;
    else t.start += a.amount;
    t.out += a.amount;
  }
  if (unclassified) warnings.push(`${unclassified} investoinnin lajia ei tiedetä (vanha tasapoisto). Ne on viety koneisiin ja kalustoon. Tarkista laji.`);
  let depreciation = 0;
  for (const cls of Object.keys(table) as AssetClass[]) {
    const t = table[cls];
    const c = ASSET_CODES[cls];
    const [start, add, out, dep] = [round2(t.start), round2(t.add), round2(t.out), round2(t.dep)];
    if (!start && !add && !out && !dep) continue;
    set(c.start, start);
    set(c.add, add);
    set(c.out, out);
    set(c.dep, dep);
    const end = round2(start + add - out - dep);
    if (end < 0) errors.push("Poistotaulukon menojäännös menisi negatiiviseksi. Tarkista investoinnit ja poistot.");
    // Loppu annetaan myös nollana, jotta taulukko on täydellinen.
    values.set(c.end, Math.max(0, end));
    depreciation += dep;
  }
  depreciation = round2(depreciation);
  set("694", depreciation);
  if (!d.vatRegistered && d.categories.asset_purchase && round2(d.categories.asset_purchase.gross - d.categories.asset_purchase.net) !== 0) {
    warnings.push("Asiakas ei ole alv-velvollinen, mutta investoinneissa on arvonlisäveroa. Poistot on laskettu verottomasta hankintamenosta, vaikka sen pitäisi sisältää vero.");
  }

  const deduction = round2(d.forestDeduction);
  set("615", deduction);
  set("618", deduction);

  // Maatalouden ajoneuvon metsätalouden ajot (0018): tuloutettu maataloudessa, vähennetään tässä.
  const transferred = round2(d.otherSourceExpense ?? 0);
  set("630", transferred);

  // Kaava [TK26] 635: 690-691+610+614-618+651-693-694-630+634 (614 ja 634 puuttuvat Skogista).
  const result = round2(sales - work + compensations - deduction + otherIncome - expenses - depreciation - transferred);
  // Joko 635 tai 636 on annettava, nollakin käy (#1396).
  if (result >= 0) values.set("635", result);
  else values.set("636", -result);

  // Metsävähennyksen seuranta. Ilmoitetaan, vaikka vähennystä ei tänä vuonna tehtäisi [OHJE].
  if (d.tracking) {
    const t = d.tracking;
    values.set("655", round2(t.base));
    set("656", t.usedBefore);
    set("657", t.addedToGains);
    // #1991: 715 = 655 - 656 + 657, negatiivinen annetaan nollana.
    const available = round2(Math.max(0, t.base - t.usedBefore + t.addedToGains));
    values.set("715", available);
    // #1403: enintään 603+604+613-605-625+607+608+609+614. Skog olettaa, että kaikki metsät oikeuttavat vähennykseen.
    const eligibleIncome = round2(Math.max(0, sales - work + compensations));
    values.set("716", eligibleIncome);
    set("717", deduction);
    set("720", t.usedBefore + deduction);
    if (t.missing) warnings.push(`${t.missing} metsätilalta puuttuu hankintahinta tai metsän osuus, joten niiden pohja puuttuu metsävähennyspohjasta.`);
    if (deduction) {
      const pct = forestDeductionPct(d.year);
      if (deduction > round2((eligibleIncome * pct) / 100)) errors.push(`Metsävähennys on yli ${pct} % metsätalouden veronalaisesta pääomatulosta (tarkistus ${spec.deductionCheck}).`);
      if (deduction < FOREST_DEDUCTION_MIN || deduction > available) errors.push(`Metsävähennyksen on oltava vähintään ${FOREST_DEDUCTION_MIN} € ja enintään käytettävissä oleva määrä ${eur(available)} (tarkistus #820).`);
    }
  } else if (deduction) {
    errors.push("Metsävähennys on tehty, mutta metsätilojen hankintatiedot puuttuvat, joten metsävähennyspohjaa ei voi ilmoittaa.");
  }

  if (!d.planConfirmed) warnings.push("Verosuunnitelmaa ei ole vahvistettu. Poistot ja metsävähennys puuttuvat tiedostosta.");
  if (d.yearOpen) warnings.push("Vuosi on avoin, joten luvut voivat vielä muuttua.");

  const order = VSY02C_ORDER;
  const fields = [...values.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([code, value]) => ({ code, label: VSY02C_LABELS[code], value }));
  return { spec, fields, deliveryWork, errors, warnings };
}

/**
 * Tekstin muunto ISO-8859-1-merkistöön [YK] 9: aksentit pois merkeiltä, joita
 * merkistössä ei ole, ja muut korvataan. Rivinvaihdot ja ohjausmerkit
 * välilyönneiksi, koska tunnus:tieto-parin perässä ei saa olla rivinvaihtoa.
 */
const NO_DECOMPOSITION: Record<string, string> = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Œ": "OE", "œ": "oe", "ı": "i" };

export function toLatin1Text(value: string, max: number): string {
  let out = "";
  for (const ch of value.replace(/[–—]/g, "-").replace(/€/g, "EUR").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) out += " ";
    else if (code <= 0xff) out += ch;
    else if (NO_DECOMPOSITION[ch]) out += NO_DECOMPOSITION[ch];
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base.length && [...base].every((c) => c.codePointAt(0)! <= 0xff) ? base : "?";
    }
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Rahamäärä muodossa R13,2: desimaalipilkku, ei tuhaterottimia eikä miinusta [YK] 3.1. */
export function formatAmount(n: number): string {
  if (n < 0) throw new Error("Rahatieto ei voi olla negatiivinen");
  const s = round2(n).toFixed(2);
  if (s.split(".")[0].length > 13) throw new Error("Rahatieto on liian suuri");
  return s.replace(".", ",");
}

/** Aikaleima PPKKVVVVHHMMSS Suomen ajassa (tunnus 198). */
export function timestamp198(date: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}${p.month}${p.year}${p.hour}${p.minute}${p.second}`;
}

export interface Render2cInput {
  computed: Computed2c;
  /** Tunnus 010: Y-tunnus tai henkilötunnus (YTUNNUS2||HETU2). */
  filerId: string;
  software: { name: string; id: string };
  createdAt: Date;
  workers: DeliveryWorker[];
  contact?: { name: string | null; email: string | null; phone: string | null };
}

/** Ilmoitustiedoston teksti tunnus:tieto-muodossa, rivinvaihto CRLF. Tunnisteet tarkistetaan ennen tätä. */
export function render2c(input: Render2cInput): string {
  const { computed, workers } = input;
  const lines: string[] = [];
  const add = (code: string, value: string) => lines.push(`${code}:${value}`);
  add("000", computed.spec.recordId);
  add("198", timestamp198(input.createdAt));
  // 045 (välityspalvelun tunnus) jätetään pois: sen lisää ilmoituksen Verohallinnolle välittävä palvelu [YK] 8.
  add("048", toLatin1Text(input.software.name, 35));
  add("014", input.software.id);
  add("010", input.filerId);
  const tracking = new Set(["655", "656", "657", "715", "716", "717", "720"]);
  for (const f of computed.fields.filter((x) => !tracking.has(x.code))) add(f.code, formatAmount(f.value));
  // Tehty hankintatyö: osatietoryhmä 001 … 009 tekijää kohden [YK] 2.1, [TK26] 700–706.
  if (workers.length) {
    add("001", String(workers.length));
    workers.forEach((w, i) => {
      add("700", toLatin1Text(w.name, 70));
      add("701", w.personalId);
      // +N7: kokonaisluku ilman desimaaleja.
      if (Math.round(w.madeM3) > 0) add("702", String(Math.round(w.madeM3)));
      if (Math.round(w.transportedM3) > 0) add("703", String(Math.round(w.transportedM3)));
      if (round2(w.value) > 0) add("704", formatAmount(w.value));
      if (round2(w.taxableValue) > 0) add("705", formatAmount(w.taxableValue));
      add("009", String(i + 1));
    });
    add("706", formatAmount(workers.reduce((s, w) => s + round2(w.value), 0)));
  }
  for (const f of computed.fields.filter((x) => tracking.has(x.code))) add(f.code, formatAmount(f.value));
  if (input.contact?.name) add("041", toLatin1Text(input.contact.name, 140));
  if (input.contact?.email) add("044", toLatin1Text(input.contact.email, 140));
  if (input.contact?.phone) add("042", toLatin1Text(input.contact.phone, 35));
  add("999", "1");
  return lines.join("\r\n") + "\r\n";
}

/** Teksti ISO-8859-1-tavuiksi. toLatin1Text on jo poistanut merkit, joita merkistössä ei ole. */
export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 0xff) throw new Error("Merkki ei kuulu ISO-8859-1-merkistöön");
    out[i] = c;
  }
  return out;
}

/**
 * Hankintatyön veronalainen arvo: tekijän arvo kerrottuna kertoimella
 * (määrä − 125) / määrä, kun maatilalla valmistettu tai kuljetettu määrä
 * ylittää 125 m³ [OHJE, Hankintatyön veronalainen arvo]. Valmistusta ja
 * kuljetusta ei tässä eritellä, joten kerroin lasketaan valmistetusta määrästä.
 */
export function deliveryWorkTaxable(value: number, totalMadeM3: number): number {
  if (totalMadeM3 <= 125) return 0;
  return round2((value * (totalMadeM3 - 125)) / totalMadeM3);
}
