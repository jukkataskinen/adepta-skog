/**
 * Lomakkeen 2 (Maatalouden veroilmoitus, tietovirta VSY002) tunnusten nimet,
 * järjestys ja harvinaiset käsin syötettävät kentät. Lähde: Verohallinto,
 * Maatalouden veroilmoitus 2, tietuekuvaus 2026 v1.0 (22.9.2026) ja 2025 v1.0
 * (23.9.2025), luku 7 (docs/maatalous-suunnitelma-2026-10-02.md, lähteet).
 *
 * Erillään muodostimesta (vsy002.ts), jotta Maatalous-sivu voi näyttää
 * harvinaisten kenttien nimet ilman muodostinta.
 */

export type ExtraKind = "amount" | "int" | "choice12";

export interface ExtraField {
  code: string;
  label: string;
  group: string;
  kind: ExtraKind;
}

/**
 * Harvinaiset kentät, joille Skogissa ei ole omaa laskentaa (sk_agri_form_extras).
 * Sama luettelo vuosina 2025 ja 2026. Arvo viedään tiedostoon sellaisenaan.
 */
export const AGRI_EXTRA_FIELDS: ExtraField[] = [
  { code: "279", label: "Käyttöön ottamattomien rakennusten hankintamenot verovuonna", group: "Käyttöön ottamattomat", kind: "amount" },
  { code: "278", label: "Käyttöön ottamattomien koneiden hankintamenot verovuonna", group: "Käyttöön ottamattomat", kind: "amount" },
  { code: "280", label: "Käyttöön ottamattomiin käytetty tasausvaraus", group: "Käyttöön ottamattomat", kind: "amount" },
  { code: "281", label: "Kaluston ajoneuvon käyttötiedot perustuvat (1 = ajopäiväkirja, 2 = muu selvitys)", group: "Maatalouden ajoneuvot", kind: "choice12" },
  { code: "516", label: "Ajoneuvon kokonaiskilometrit verovuonna", group: "Maatalouden ajoneuvot", kind: "int" },
  { code: "282", label: "Ajoneuvon kokonaismenot muistiinpanoissa", group: "Maatalouden ajoneuvot", kind: "amount" },
  { code: "283", label: "Ajoneuvon yksityistalouden osuus", group: "Maatalouden ajoneuvot", kind: "amount" },
  { code: "284", label: "Ajoneuvon metsätalouden osuus", group: "Maatalouden ajoneuvot", kind: "amount" },
  { code: "534", label: "Oman auton käyttötiedot perustuvat (1 = ajopäiväkirja, 2 = muu selvitys)", group: "Oma auto maataloudessa", kind: "choice12" },
  { code: "287", label: "Oman auton kokonaiskilometrit", group: "Oma auto maataloudessa", kind: "int" },
  { code: "288", label: "Oman auton maatalouden ajot (km)", group: "Oma auto maataloudessa", kind: "int" },
  { code: "518", label: "Oman auton enimmäismäärä yhteensä", group: "Oma auto maataloudessa", kind: "amount" },
  { code: "519", label: "Oman auton kulut muistiinpanoissa vähennetty", group: "Oma auto maataloudessa", kind: "amount" },
  { code: "285", label: "Oman auton lisävähennys", group: "Oma auto maataloudessa", kind: "amount" },
  { code: "401", label: "Matkapäivät yli 10 h", group: "Tilapäiset työmatkat", kind: "int" },
  { code: "406", label: "Matkapäivät yli 6 h", group: "Tilapäiset työmatkat", kind: "int" },
  { code: "411", label: "Ulkomaan matkapäivät", group: "Tilapäiset työmatkat", kind: "int" },
  { code: "402", label: "Yli 10 h, enimmäismäärä matkapäivältä", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "403", label: "Yli 10 h, enimmäismäärä yhteensä", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "404", label: "Yli 10 h, muistiinpanoissa vähennetty", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "405", label: "Yli 10 h, lisävähennys", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "407", label: "Yli 6 h, enimmäismäärä matkapäivältä", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "408", label: "Yli 6 h, enimmäismäärä yhteensä", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "429", label: "Yli 6 h, muistiinpanoissa vähennetty", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "410", label: "Yli 6 h, lisävähennys", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "423", label: "Ulkomaan matka, enimmäismäärä yhteensä", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "424", label: "Ulkomaan matka, muistiinpanoissa vähennetty", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "425", label: "Ulkomaan matka, lisävähennys", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "532", label: "Matkat yhteensä, enimmäismäärä", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "533", label: "Matkat yhteensä, muistiinpanoissa vähennetty", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "286", label: "Matkat yhteensä, lisävähennys", group: "Tilapäiset työmatkat", kind: "amount" },
  { code: "409", label: "Maatalouden arvopapereiden luovutusvoitot (täytä myös lomake 9A)", group: "Muut", kind: "amount" },
];

export function extraField(code: string): ExtraField | null {
  return AGRI_EXTRA_FIELDS.find((f) => f.code === code) ?? null;
}

/** Arvon tarkistus kentän lajin mukaan. Palauttaa virheen tai null. */
export function validateExtra(code: string, value: number): string | null {
  const f = extraField(code);
  if (!f) return "Valitse kenttä luettelosta.";
  if (!Number.isFinite(value) || value < 0) return "Arvon on oltava nolla tai suurempi.";
  if (f.kind === "choice12" && value !== 1 && value !== 2) return "Arvoksi käy 1 (ajopäiväkirja) tai 2 (muu selvitys).";
  if (f.kind === "int" && !Number.isInteger(value)) return "Arvo on kokonaisluku.";
  if (f.kind === "amount" && Math.abs(Math.round(value * 100) - value * 100) > 1e-6) return "Rahamäärässä on enintään kaksi desimaalia.";
  return null;
}

/**
 * Tunnusten järjestys tietuekuvauksen tunnus-tietoluettelossa (luku 7).
 * Vuoden 2025 korotettujen poistojen erittely (364–584) on 280:n jälkeen;
 * vuonna 2026 sitä ei ole.
 */
export const FORM2_ORDER = [
  "210", "211", "212", "213", "214", "215", "216", "217", "218", "219", "220", "221", "222", "223", "224", "321", "322", "325", "326", "327", "328", "332",
  "225", "226", "227", "228", "229", "230", "231", "232", "465", "464", "357", "362", "363", "420", "413", "414", "415", "416",
  "240", "245", "250", "255", "241", "246", "251", "256", "242", "247", "252", "257", "528", "529", "530", "531", "243", "248", "253", "258",
  "524", "525", "526", "527", "244", "249", "254", "259",
  "260", "266", "272", "261", "267", "273", "262", "268", "274", "263", "269", "275", "264", "270", "276", "511", "513", "515", "265", "271", "277",
  "279", "278", "280", "364", "365", "366", "367", "581", "368", "584",
  "281", "516", "282", "283", "284", "534", "287", "288", "518", "519", "285",
  "401", "406", "411", "402", "403", "404", "405", "407", "408", "429", "410", "423", "424", "425", "532", "533", "286",
  "432", "466", "431", "467", "468", "469", "731", "732", "735", "736", "470", "418", "409", "437", "170", "171", "172", "173", "174", "175",
];

const POOL_LABEL: Record<string, string> = {
  "240": "rakennukset 10 %", "245": "rakennukset 6 %", "250": "rakennelmat 20 %", "255": "rakennelmat 25 %",
  "260": "koneet ja kalusto", "266": "sillat, asfaltointi ym.", "272": "salaojat",
};
const POOL_ROWS: { label: string; codes: string[] }[] = [
  { label: "Poistamaton hankintameno vuoden alussa", codes: ["240", "245", "250", "255"] },
  { label: "Hankinta- ja perusparannusmenot", codes: ["241", "246", "251", "256"] },
  { label: "Vähennetään tasausvaraus", codes: ["242", "247", "252", "257"] },
  { label: "Vähennetään myyntihinnat", codes: ["528", "529", "530", "531"] },
  { label: "Vähennetään korvaukset ja avustukset", codes: ["243", "248", "253", "258"] },
  { label: "Verovuoden poisto", codes: ["524", "525", "526", "527"] },
  { label: "Poistamaton hankintameno vuoden lopussa", codes: ["244", "249", "254", "259"] },
  { label: "Menojäännös vuoden alussa", codes: ["260", "266", "272"] },
  { label: "Hankinta- ja perusparannusmenot", codes: ["261", "267", "273"] },
  { label: "Vähennetään tasausvaraus", codes: ["262", "268", "274"] },
  { label: "Vähennetään myyntihinnat", codes: ["263", "269", "275"] },
  { label: "Vähennetään korvaukset ja avustukset", codes: ["264", "270", "276"] },
  { label: "Verovuoden poisto", codes: ["511", "513", "515"] },
  { label: "Menojäännös vuoden lopussa", codes: ["265", "271", "277"] },
];

/** Tunnuksen nimi esikatseluun ja raporttiin. Vuosiluvut ja alennettu kanta vuoden mukaan. */
export function form2Label(code: string, year: number): string {
  const reduced = year >= 2026 ? "13,5 %" : "14 %";
  const fixed: Record<string, string> = {
    "210": "Myyntitulot kotieläimistä (ei jaksotettuja)",
    "211": `Jaksotettavat myyntitulot kotieläimistä vuonna ${year}`,
    "212": `Vuoden ${year} tuloksi jaksotetut myyntitulot kotieläimistä (${year - 2}–${year})`,
    "213": "Muut myyntitulot",
    "214": `Kotieläintuotteiden myyntitulot (${reduced})`,
    "215": `Kasvinviljelytuotteiden myyntitulot (${reduced})`,
    "216": `Majoituspalveluiden yms. myyntitulot (${reduced})`,
    "217": "Valtiolta saadut tuet",
    "218": "Muut arvonlisäverottomat tuet ja korvaukset",
    "219": "Tasausvarauksen suora tuloutus",
    "220": "Muut maatalouden arvonlisäverottomat tulot",
    "221": "Tuloutus yksityiskäytöstä",
    "222": "Muut lisäykset",
    "223": "Osingot julkisesti noteeratuista yhtiöistä",
    "224": "Osingot julkisesti noteeratuista yhtiöistä, veronalainen osuus",
    "321": "Osingot muista yhtiöistä",
    "322": "Osingot muista yhtiöistä, veronalainen osuus",
    "325": "Ylijäämät julkisesti noteeratuista osuuskunnista",
    "326": "Ylijäämät julkisesti noteeratuista osuuskunnista, veronalainen osuus",
    "327": "Ylijäämät muista osuuskunnista",
    "328": "Ylijäämät muista osuuskunnista, veronalainen osuus",
    "332": "Tulot yhteensä",
    "225": "Palkat",
    "226": "Vähennyskelpoiset ostot 25,5 % ilman arvonlisäveroa",
    "227": `Jaksotettavat kotieläinten hankintamenot vuonna ${year}`,
    "228": `Vuoden ${year} poistona vähennettävät jaksotetut kotieläinten hankintamenot (${year - 2}–${year})`,
    "229": `Vähennyskelpoiset ostot ${reduced} ja 10 % ilman arvonlisäveroa`,
    "230": "Muut maatalouden arvonlisäverottomat menot 0 %",
    "231": "Poistot",
    "232": "Verovuodelta tehty tasausvaraus",
    "465": "Korkomenot",
    "464": "Muut vähennykset",
    "357": "Menot yhteensä",
    "362": "Maatalouden tulos",
    "363": "Maatalouden tappio",
    "420": "Pääomatuloista vähennettävän maatalouden tappion määrä",
    "413": "Osuus nettovarallisuudesta, yrittäjä %",
    "414": "Osuus nettovarallisuudesta, puoliso %",
    "415": "Työskentely maataloudessa, yrittäjä %",
    "416": "Työskentely maataloudessa, puoliso %",
    "364": "Aikaisempien vuosien kone- ja laiteinvestoinnit (korotettu poisto)",
    "365": "Aikaisempina vuosina tehdyt poistot näistä",
    "366": "Jäljellä oleva poistopohja aikaisempien vuosien investoinneista",
    "367": "Verovuoden poisto aiemmin tehdyistä kone- ja laiteinvestoinneista",
    "581": "Kone- ja laiteinvestoinnit verovuonna (korotettu poisto)",
    "368": "Poisto verovuoden kone- ja laiteinvestoinneista",
    "584": "Verovuoden korotettu poisto yhteensä",
    "432": "Maatalousmaa ja tuotantorakennusten rakennuspaikat",
    "466": "Tuotantorakennukset",
    "431": "Lomamökit ym. vuokrattavat asuinrakennukset",
    "467": "Maatalouden koneet ja kalusto",
    "468": "Maatalouteen kuuluvat osakkeet ja osuudet",
    "469": "Muut maatalouteen kuuluvat varat",
    "731": "Maatalouden varat yhteensä",
    "732": "Maatalouden velat ja velvoitteet yhteensä",
    "735": "Maatalouden positiivinen nettovarallisuus",
    "736": "Maatalouden negatiivinen nettovarallisuus",
    "470": "Maatilaan kuuluvat etuudet (kiven-, soranottopaikat ym.)",
    "418": "Vaatimus jaettavasta yritystulosta (1 = 10 %, 2 = ansiotuloa)",
    "437": "Verovuonna maksetut ennakonpidätyksen alaiset palkat",
    "170": `Tasausvaraus vuodelta ${year - 2}`,
    "171": `Tasausvaraus vuodelta ${year - 1}`,
    "172": `Tasausvaraus vuodelta ${year}`,
    "173": `Jälleenhankintavaraus vuodelta ${year - 2}`,
    "174": `Jälleenhankintavaraus vuodelta ${year - 1}`,
    "175": `Jälleenhankintavaraus vuodelta ${year}`,
  };
  if (fixed[code]) return fixed[code];
  const row = POOL_ROWS.find((r) => r.codes.includes(code));
  if (row) {
    // Rakennuksilla on neljä ryhmää ja muilla varallisuuserillä kolme, samassa järjestyksessä joka rivillä.
    const firsts = row.codes.length === 4 ? ["240", "245", "250", "255"] : ["260", "266", "272"];
    return `${row.label}: ${POOL_LABEL[firsts[row.codes.indexOf(code)]]}`;
  }
  return extraField(code)?.label ?? code;
}
