import type { IconName } from "@/components/NavIcon";

/**
 * Ohjesivujen sisältö (/ohjeet). Etusivu esittelee toiminnot, ja se sopii
 * myös myyntiesittelyyn, joten tekstit kertovat ensin hyödyn ja sitten
 * käytön. Sisällössä ei ole asiakastietoja. Kun toiminto muuttuu, päivitä
 * sen ohje samassa muutoksessa.
 */

export interface HelpSection {
  title: string;
  text?: string;
  steps?: string[];
  bullets?: string[];
}

export interface HelpTopic {
  slug: string;
  group: string;
  icon: IconName;
  title: string;
  /** Yhden lauseen hyöty etusivun kortille. */
  summary: string;
  /** Kortin ja ohjeen alun kohokohdat. */
  highlights: string[];
  /** Sovelluksen sivu, josta toiminto löytyy. */
  appPath?: string;
  appLabel?: string;
  sections: HelpSection[];
  tips?: string[];
  related?: string[];
  /** Kehitteillä oleva toiminto: näytetään merkinnällä. */
  upcoming?: boolean;
}

export const HELP_GROUPS = ["Aloitus", "Asiakkaat ja metsätilat", "Kirjanpito", "Verotus ja raportit", "Hallinta ja tietoturva"];

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "tyopoyta",
    group: "Aloitus",
    icon: "home",
    title: "Työpöytä",
    summary: "Työpöydältä näet, mitä toimistossa on meneillään.",
    highlights: ["Toimiston nimi ja käyttäjät", "Tulossa olevat toiminnot"],
    appPath: "/tyopoyta",
    appLabel: "Työpöytä",
    sections: [
      {
        title: "Mitä työpöydällä on",
        bullets: [
          "Ylhäällä on toimiston nimi.",
          "Luku kertoo, montako käyttäjää toimistolla on.",
          "Tulossa-listassa ovat toiminnot, joita tehdään. Ne tulevat valikkoon, kun ne valmistuvat.",
        ],
      },
    ],
  },
  {
    slug: "asiakkaat",
    group: "Asiakkaat ja metsätilat",
    icon: "users",
    title: "Asiakkaat",
    summary: "Kaikki metsänomistajat yhdessä listassa. Jokaisella asiakkaalla on vastuukirjanpitäjä.",
    highlights: ["Haku nimellä", "Vastuukirjanpitäjä", "Asiakkaan sivulla kaikki tiedot välilehdillä"],
    sections: [
      {
        title: "Kuka näkee asiakkaan",
        bullets: ["Pääkäyttäjä näkee kaikki toimiston asiakkaat.", "Kirjanpitäjä näkee asiakkaat, joiden vastuukirjanpitäjä hän on."],
      },
    ],
    upcoming: true,
  },
  {
    slug: "metsatilat",
    group: "Asiakkaat ja metsätilat",
    icon: "map",
    title: "Metsätilat",
    summary: "Asiakkaan metsätilat ja niiden hankintatiedot. Niistä lasketaan metsävähennyksen pohja.",
    highlights: ["Kiinteistötunnus ja pinta-ala", "Hankintahinta ja -päivä", "Metsävähennyksen pohja"],
    sections: [
      {
        title: "Metsävähennyksen pohja",
        text: "Pohja on 60 prosenttia metsämaan hankintamenosta. Ohjelma laskee sen tilan tiedoista ja seuraa, paljonko pohjasta on jo käytetty.",
      },
    ],
    upcoming: true,
  },
  {
    slug: "kirjanpito",
    group: "Kirjanpito",
    icon: "list",
    title: "Kirjanpito",
    summary: "Metsätalouden tulot ja menot verovuosittain, tositteet mukana.",
    highlights: ["Kirjaukset taulukkona", "Tosite jokaiseen kirjaukseen", "Arvonlisävero lasketaan valmiiksi"],
    sections: [
      {
        title: "Suljettu vuosi",
        text: "Kun verovuosi on suljettu, sen kirjauksia ei voi muuttaa. Pääkäyttäjä voi avata vuoden, ja avaus jää lokiin.",
      },
    ],
    upcoming: true,
  },
  {
    slug: "investoinnit",
    group: "Kirjanpito",
    icon: "hammer",
    title: "Investoinnit ja poistot",
    summary: "Koneet, tiet ja ojat poistetaan vuosittain. Ohjelma laskee poistot ja jäljellä olevan arvon.",
    highlights: ["Tasapoisto tai menojäännöspoisto", "Koneen myynti ja myyntivoitto", "Poistot verosuunnitelmaan"],
    sections: [
      {
        title: "Poistotavat",
        bullets: [
          "Tasapoisto: sama summa joka vuosi poistoajan loppuun.",
          "Menojäännöspoisto: 25 prosenttia jäljellä olevasta arvosta joka vuosi.",
        ],
      },
    ],
    upcoming: true,
  },
  {
    slug: "verosuunnitelma",
    group: "Verotus ja raportit",
    icon: "coins",
    title: "Verosuunnitelma",
    summary: "Arvio vuoden verotettavasta tulosta. Valitse, paljonko metsävähennystä ja poistoja käytetään.",
    highlights: ["Verotettava pääomatulo", "Metsävähennyksen käyttö", "Vahvistus sulkee vuoden"],
    sections: [
      {
        title: "Vuoden sulkeminen",
        steps: [
          "Tarkista kirjaukset ja poistot.",
          "Valitse metsävähennyksen määrä.",
          "Vahvista suunnitelma. Vuoden poistot ja metsävähennys tallentuvat.",
          "Vuosi sulkeutuu, ja veroraportti arkistoidaan.",
        ],
      },
    ],
    upcoming: true,
  },
  {
    slug: "veroraportti",
    group: "Verotus ja raportit",
    icon: "folder",
    title: "Veroraportti ja arkisto",
    summary: "Veroilmoitusta tukeva raportti PDF:nä. Raportit ja tositteet säilyvät arkistossa verovuosittain.",
    highlights: ["Kansilehti ja sisällysluettelo", "LUONNOS-merkintä avoimelle vuodelle", "Tositteet samassa paikassa"],
    sections: [
      {
        title: "Raportin sisältö",
        bullets: ["Tulot ja menot", "Arvonlisävero", "Poistot", "Metsävähennys"],
      },
    ],
    upcoming: true,
  },
  {
    slug: "asetukset",
    group: "Hallinta ja tietoturva",
    icon: "gear",
    title: "Asetukset",
    summary: "Asetuksissa päätetään toimiston tiedot ja käyttäjät. Asetukset näkee vain pääkäyttäjä.",
    highlights: ["Toimiston yhteystiedot", "Käyttäjät ja roolit", "Viimeisimmät muutokset"],
    appPath: "/asetukset",
    appLabel: "Asetukset",
    sections: [
      {
        title: "Yhteystiedot",
        text: "Sähköposti, puhelin ja postiosoite tulevat veroraportin kansilehdelle.",
      },
      {
        title: "Käyttäjät",
        steps: [
          "Kirjoita uuden käyttäjän sähköposti ja nimi.",
          "Valitse rooli: pääkäyttäjä tai kirjanpitäjä.",
          "Tallenna. Käyttäjä kirjautuu samalla sähköpostiosoitteella.",
        ],
      },
    ],
    tips: ["Alimpana näkyvät viimeisimmät muutokset: kuka teki mitä ja milloin."],
    related: ["kayttajat"],
  },
  {
    slug: "kayttajat",
    group: "Hallinta ja tietoturva",
    icon: "shield",
    title: "Käyttäjät, roolit ja tietoturva",
    summary: "Jokainen toimisto näkee vain omat tietonsa, ja jokainen muutos jää lokiin.",
    highlights: ["Roolit: pääkäyttäjä ja kirjanpitäjä", "Toimistojen tiedot erillään tietokannassa", "Kirjautuminen kaksivaiheisella tunnistuksella"],
    appPath: "/asetukset",
    appLabel: "Asetukset",
    sections: [
      {
        title: "Roolit",
        bullets: [
          "Pääkäyttäjä: kaikki asiakkaat, käyttäjät ja verovuoden sulkeminen.",
          "Kirjanpitäjä: omat asiakkaat, kirjaukset ja raportit.",
        ],
      },
      {
        title: "Tietoturva",
        bullets: [
          "Tietokanta itse rajaa jokaisen haun käyttäjän toimistoon. Rajaus ei ole pelkästään ohjelman varassa.",
          "Muutokset kirjataan lokiin samalla kertaa kuin itse muutos.",
          "Henkilötunnuksia ei käsitellä. Henkilötietoja ei kirjoiteta osoitteisiin, lokeihin eikä virheviesteihin.",
          "Tietokanta sijaitsee EU:ssa.",
        ],
      },
    ],
  },
];

/** Ohjeen osion ankkuri otsikosta: "Kun hinta muuttuu" → "kun-hinta-muuttuu". */
export function sectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[äå]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function helpTopic(slug: string) {
  return HELP_TOPICS.find((t) => t.slug === slug) ?? null;
}
