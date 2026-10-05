/**
 * Alikäsittelijät julkiselle tietosuojasivulle (/tietosuoja). Sama luettelo on
 * käsittelysopimuksen liitteenä tiedostossa docs/tietosuoja/alikasittelijat.md.
 * Kun luettelo muuttuu, päivitä molemmat: testi tests/unit/privacy.test.ts
 * tarkistaa, että jokainen tässä oleva nimi löytyy myös asiakirjasta.
 */

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
  /** Käsittely tai säilytys EU:n ulkopuolella. */
  outsideEu: boolean;
  /** Ei vielä tuotantokäytössä. */
  notInUse?: boolean;
}

export const SUBPROCESSORS_UPDATED = "2026-09-28";

export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: "Supabase Inc.",
    purpose: "Tietokanta ja tiedostot",
    data: "Kaikki palvelun tiedot, tositteet ja raportit",
    location: "Irlanti",
    outsideEu: false,
  },
  {
    name: "Vercel Inc.",
    purpose: "Sovelluspalvelin",
    data: "Pyynnöt käsittelyn ajan ja tekniset lokit",
    location: "Irlanti (Dublin)",
    outsideEu: false,
  },
  {
    name: "Okta Inc. (Auth0)",
    purpose: "Kirjautuminen ja kutsut",
    data: "Käyttäjän nimi, sähköposti ja kirjautumistapahtumat",
    location: "Yhdysvallat",
    outsideEu: true,
  },
  {
    name: "Anthropic PBC",
    purpose: "Tositteen tunnistus tekoälyllä, vain pyydettäessä",
    data: "Tositetiedosto ja vihjeeksi asiakkaan tavallisimmat tiliöinnit (selitteen avainsanat, luokka, alv-% ja osuus)",
    location: "Yhdysvallat",
    outsideEu: true,
  },
  {
    name: "Resend Inc.",
    purpose: "Kutsusähköpostit",
    data: "Vastaanottajan nimi ja sähköposti",
    location: "Tarkistetaan käyttöönotossa",
    outsideEu: false,
    notInUse: true,
  },
];
