/**
 * Testitilan maatalouden esimerkit tiedostonimestä (DECISIONS 2.10.2026,
 * maatalouden tositteiden tunnistus). Kaikki tiedot ovat kuvitteellisia.
 * Jokainen esimerkki on yksi monikirjauksinen asiakirja, jonka rivit täsmäävät
 * tositteen loppusummaan, jotta hyväksyntänäkymän ryhmä ja täsmäytys näkyvät:
 *
 *   meijeri, maito         maitotilitys: maito, rehu, seminointi, kuljetus, jäsenmaksu, ylijäämä
 *   teurastamo, teuras     teurastilitys: naudat, kuljetus, luokitus, Naseva
 *   vilja, kuivaus         viljan tilitys: vehnä, kuivaus, varastointi
 *   vipu, tukiyhteenveto,  maksetut tuet: tuki per maksu ja maksupäivä, investointituki
 *   maksetut tuet, tuet
 *   konekauppa, traktori   traktori investointina ja vaihtokone myyntinä, rekisteröinti
 *   eläinkauppa, vasikat   vasikoiden myynti ja välityspalkkio
 *   sähkö                  sähkölasku, yksityisosuuden huomautus
 *   myel, mela             MYEL-maksu ja tapaturmavakuutus
 *   osuusmaksu             maitotilitys, josta osuusmaksu on pidätetty: täsmäytys näyttää eron
 *
 * Nimen vuosi (2025 tai 2026) valitsee päivät ja alennetun verokannan
 * (14 % 2025, 13,5 % 2026). Rivit ovat raakavastauksen muodossa, ja ne
 * tarkistetaan samalla tavalla kuin oikean palvelun vastaus.
 */

type Raw = { category: string; [key: string]: unknown };

const REASONING = "Testitila: ehdotus on johdettu tiedostonimestä, tositetta ei luettu.";

function doc(index: number, source: string, type: string, pages: number[], total: number, invoice: string | null = null) {
  return {
    document_index: index, source_document: source, document_type: type, pages, contract_number: null, invoice_number: invoice, document_total: total,
    withholding: 0, reasoning: REASONING, note: null, subsidy_type: null, asset_class: null,
  };
}

function line(base: Record<string, unknown>, date: string, description: string, amount: number, vat: number, category: string, extra: Record<string, unknown> = {}): Raw {
  return { ...base, date, description, amount_gross: amount, vat_rate: vat, category, confidence: 0.7, ...extra };
}

const yearOf = (name: string) => Number(/(20\d{2})/.exec(name)?.[1] ?? "2025");
const foodRate = (year: number) => (year >= 2026 ? 13.5 : 14);

function dairy(year: number, withheldShare = false): Raw[] {
  const food = foodRate(year);
  // Osuusmaksu pidätetään tilityksestä, mutta se ei ole kulu: maksettu summa on silloin 200 € pienempi.
  const d = doc(1, `Maitotilitys 3/${year}, Esimerkin Osuusmeijeri`, "dairy_settlement", [1, 2], withheldShare ? 5275.5 : 5475.5, `M-${year}-03`);
  const date = `${year}-04-15`;
  return [
    line(d, date, "Esimerkin Osuusmeijeri, maito maaliskuu", 6840, food, "agri_livestock_products"),
    line(d, date, "Esimerkin Osuusmeijeri, rehu", 1230.4, food, "agri_feed"),
    line(d, date, "Esimerkin Osuusmeijeri, seminointi", 186, 25.5, "agri_veterinary"),
    line(d, date, "Esimerkin Osuusmeijeri, maidon kuljetus", 212.6, 25.5, "agri_contracting"),
    line(d, date, "Esimerkin Osuusmeijeri, jäsenmaksu", 48, 0, "agri_other_purchases"),
    line(d, date, "Esimerkin Osuusmeijeri, ylijäämän palautus", 312.5, 0, "agri_coop_surplus", { confidence: 0.6 }),
  ].map((l) => (withheldShare ? { ...l, note: "Tilityksestä on pidätetty osuusmaksu 200,00 €, jota ei kirjata kuluksi." } : l));
}

function slaughter(year: number): Raw[] {
  const d = doc(1, `Teurastilitys 118, Esimerkin Lihatalo`, "slaughter_settlement", [1], 4673.3, "T-118");
  const date = `${year}-05-22`;
  return [
    line(d, date, "Esimerkin Lihatalo, naudat 2 kpl", 4812, 25.5, "agri_livestock_sale"),
    line(d, date, "Esimerkin Lihatalo, eläinkuljetus", 96, 25.5, "agri_contracting"),
    line(d, date, "Esimerkin Lihatalo, luokitusmaksu", 24.1, 25.5, "agri_contracting"),
    line(d, date, "Esimerkin Lihatalo, Naseva-maksu", 18.6, 25.5, "agri_veterinary"),
  ];
}

function crop(year: number): Raw[] {
  const food = foodRate(year);
  const d = doc(1, `Viljan tilitys 2207, Esimerkin Viljakauppa`, "crop_settlement", [1], 6316.1, "V-2207");
  const date = `${year}-10-03`;
  return [
    line(d, date, "Esimerkin Viljakauppa, vehnä 28 450 kg", 7112.5, food, "agri_crops"),
    line(d, date, "Esimerkin Viljakauppa, kuivaus", 612.4, 25.5, "agri_contracting"),
    line(d, date, "Esimerkin Viljakauppa, varastointi", 184, 25.5, "agri_contracting"),
  ];
}

/** Vipun maksetut tuet: rivi jokaisesta maksusta maksupäivän mukaan. Luokka tulee tukilajista (agri.ts). */
function subsidySummary(year: number): Raw[] {
  const rows: [string, string, number, string][] = [
    [`${year}-04-24`, `Ympäristökorvaus ${year - 1}, loppuerä`, 1840, "environmental"],
    [`${year}-05-08`, "Investointituki, navetan laajennus", 12000, "investment_aid"],
    [`${year}-06-17`, `Luonnonhaittakorvaus ${year}, ennakko`, 6120, "natural_constraint"],
    [`${year}-10-15`, `Perustulotuki ${year}, ennakko`, 7380, "basic_income"],
    [`${year}-10-15`, `Ekojärjestelmätuki ${year}`, 1260, "eco_scheme"],
    [`${year}-12-18`, `Perustulotuki ${year}, loppuerä`, 820, "basic_income"],
    [`${year}-12-18`, `Eläinten hyvinvointikorvaus ${year}`, 2450, "animal_welfare"],
    [`${year}-12-22`, `Kansallinen kotieläintuki ${year}`, 3100, "southern_national"],
  ];
  const total = rows.reduce((s, r) => s + r[2], 0);
  const d = doc(1, `Maksetut tuet ${year}, Vipu`, "subsidy_summary", [1, 2], total);
  return rows.map(([date, desc, amount, type]) => line(d, date, `Ruokavirasto, ${desc}`, amount, 0, "agri_state_subsidy", { subsidy_type: type }));
}

function machine(year: number): Raw[] {
  const d = doc(1, "Kauppakirja 4410, Esimerkin Konekauppa", "machine_trade", [1, 2], 50562, "4410");
  const date = `${year}-03-12`;
  return [
    line(d, date, "Esimerkin Konekauppa, traktori", 68500, 25.5, "agri_asset_purchase", { asset_class: "agri_machinery" }),
    line(d, date, "Esimerkin Konekauppa, vaihtokone", 18000, 25.5, "agri_asset_sale", { confidence: 0.6 }),
    line(d, date, "Esimerkin Konekauppa, rekisteröinti", 62, 0, "agri_other_purchases"),
  ];
}

function livestock(year: number): Raw[] {
  const d = doc(1, "Eläinvälityksen tilitys 77, Esimerkin Eläinvälitys", "livestock_trade", [1], 1568, "77");
  const date = `${year}-08-05`;
  return [
    line(d, date, "Esimerkin Eläinvälitys, vasikat 3 kpl", 1650, 25.5, "agri_livestock_sale"),
    line(d, date, "Esimerkin Eläinvälitys, välityspalkkio", 82, 25.5, "agri_contracting"),
  ];
}

function electricity(year: number): Raw[] {
  const d = doc(1, "Sähkölasku 88213, Esimerkin Energia", "utility_invoice", [1], 1284.6, "88213");
  return [line(d, `${year}-02-10`, "Esimerkin Energia, sähkö tammikuu", 1284.6, 25.5, "agri_energy", { note: "Samassa mittauksessa on asuinrakennus." })];
}

function myel(year: number): Raw[] {
  const d = doc(1, "MYEL-lasku, Mela", "myel_invoice", [1], 3306, null);
  const date = `${year}-03-31`;
  return [line(d, date, "Mela, MYEL-maksu 1. erä", 3120, 0, "agri_myel"), line(d, date, "Mela, tapaturmavakuutus (MATA)", 186, 0, "agri_insurance")];
}

/**
 * Maatalouden esimerkki nimestä, tai null, jos nimi ei ole maatalouden
 * esimerkki. Vanha kokooma (maatila, maatalous) on mock.ts:ssä ennallaan.
 */
export function agriExampleByName(name: string): { lines: Raw[] } | null {
  const year = yearOf(name);
  if (/osuusmaksu/.test(name)) return { lines: dairy(year, true) };
  if (/meijeri|maito/.test(name)) return { lines: dairy(year) };
  if (/teurastamo|teuras/.test(name)) return { lines: slaughter(year) };
  if (/vilja|kuivaus/.test(name)) return { lines: crop(year) };
  if (/vipu|tukiyhteenveto|maksetut tuet|maksetut_tuet|\btuet\b/.test(name)) return { lines: subsidySummary(year) };
  if (/konekauppa|traktori/.test(name)) return { lines: machine(year) };
  if (/eläinkauppa|elainkauppa|vasikat/.test(name)) return { lines: livestock(year) };
  if (/sähkö|sahko/.test(name)) return { lines: electricity(year) };
  if (/myel|mela/.test(name)) return { lines: myel(year) };
  return null;
}
