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
