# LUONNOS – Skogin alikäsittelijät

> **Luonnos Jukan tarkistettavaksi, 28.9.2026.** Ei vielä hyväksytty eikä
> julkaistu sopimuksen liitteenä. Claude kokosi luettelon koodista
> (`vercel.json`, `.env.example`, `src/lib/ai/receipts`, `src/lib/storage`,
> `src/lib/email`, `src/lib/accounts`) ja toimittajien julkisista ehdoista
> 28.9.2026. Sarake "Tarkistettava" ei kuulu sopimuksen liitteeseen.
>
> Tämä on käsittelysopimuksen liite 2 (`kasittelysopimus-luonnos.md`).
> Sovelluksen julkinen sivu `/tietosuoja` näyttää saman luettelon tiedostosta
> `src/lib/privacy/subprocessors.ts`. **Kun luettelo muuttuu, päivitä
> molemmat** (testi `tests/unit/privacy.test.ts` tarkistaa, että jokainen
> sovelluksen luettelon alikäsittelijä on myös tässä tiedostossa).

Päivitetty: 28.9.2026

## Alikäsittelijät

Adepta Oy käyttää Skog-palvelun tuottamiseen seuraavia alikäsittelijöitä.

| Alikäsittelijä | Tehtävä | Käsiteltävät tiedot | Sijainti | Siirtoperuste EU:n ulkopuolelle |
|---|---|---|---|---|
| Supabase Inc. | Tietokanta ja tiedostot (tositteet, arkistoidut raportit) | Kaikki palvelun tiedot | Data AWS eu-west-1 (Irlanti). Yhtiö Yhdysvalloissa. | Supabasen DPA, EU:n vakiolausekkeet (moduuli 2) mahdolliselle tukipääsylle |
| Vercel Inc. | Sovelluspalvelin: sivut ja palvelinfunktiot | Kaikki pyynnöt käsittelyn ajan, palvelimen tekniset lokit | Funktiot alueella dub1 (Dublin, Irlanti). Yhtiö Yhdysvalloissa. | Vercelin DPA, EU:n vakiolausekkeet |
| Okta Inc. (Auth0) | Käyttäjien kirjautuminen ja kutsut | Käyttäjän sähköposti, nimi, salasanan tiiviste, kirjautumistapahtumat | **Yhdysvallat** (nykyinen tenantti) | Oktan DPA, EU:n vakiolausekkeet |
| Anthropic PBC | Tositteiden tunnistus tekoälyllä, vain kun kirjanpitäjä pyytää | Tositetiedosto (voi sisältää metsänomistajan ja kolmansien osapuolten nimiä, osoitteita ja summia) | **Yhdysvallat** | Anthropicin DPA (osa kaupallisia ehtoja), EU:n vakiolausekkeet (moduulit 2 ja 3) |
| Resend Inc. | Käyttäjien kutsusähköpostit | Vastaanottajan sähköposti ja nimi, toimiston nimi, kutsulinkki | Tarkistettava (Resendillä on EU-alue) | Resendin DPA |

Resend ei ole vielä tuotantokäytössä: kutsut ovat testitilassa (`EMAIL_MODE=mock`), eikä viestejä lähetetä (BLOCKERS 7). Se on luettelossa, jotta sen voi ottaa käyttöön ilman erillistä ilmoitusta.

## Toimittajat, jotka eivät käsittele asiakkaiden henkilötietoja

| Toimittaja | Tehtävä | Mitä se saa |
|---|---|---|
| GitHub Inc. | Lähdekoodi ja automaattiset tarkistukset | Ei asiakastietoja. Henkilötietovahti ja avainvahti estävät asiakastiedostot ja avaimet. |
| Verohallinto (Ilmoitin.fi) | Ei alikäsittelijä | Skog ei lähetä Verohallinnolle mitään. Tilitoimisto lataa 2C-ilmoitustiedoston itse Ilmoitin.fi:hin omana ilmoittamisenaan. |

## Tarkistettava (ei kuulu liitteeseen)

| Alikäsittelijä | Tarkistettu 28.9.2026 | Jukan tehtävä |
|---|---|---|
| Supabase | DPA versio 1.8.2026: vakiolausekkeet moduuli 2, ilmoitus tietoturvaloukkauksesta 48 tunnin sisällä, jos mahdollista. DPA hyväksytään sopimuksen hyväksymisellä. | Varmista, että Skogin projektin organisaatio on hyväksynyt ehdot. Tarkista varmuuskopioiden säilytysaika tilauksesta (vaikuttaa käsittelysopimuksen kohtaan 11). |
| Vercel | DPA päivitetty 17.3.2026 (voimassa 31.3.2026): vakiolausekkeet. Ilmoitus loukkauksesta "viipymättä", ei tuntirajaa. | Tarkista, että projektin Functions-alue on dub1 myös asetuksissa (`vercel.json` asettaa sen). Lokien säilytysaika tilauksessa. |
| Okta (Auth0) | Oktan DPA sisältää vakiolausekkeet. EU–US-tietosuojakehystä (DPF) ei tarkistettu. | Siirrä Skog EU-tenanttiin (`*.eu.auth0.com`), jolloin kirjautumistiedot pysyvät EU:ssa (BLOCKERS 8 b). |
| Anthropic | Kaupalliset ehdot 17.6.2025: DPA sisältyy, asiakkaan aineistolla ei kouluteta malleja. DPA 24.2.2025: vakiolausekkeet moduulit 2 ja 3, loukkausilmoitus 48 tunnissa, alikäsittelijät anthropic.com/subprocessors. Säilytys (privacy.claude.com, 1.7.2026): API-syötteet ja -vastaukset poistetaan 30 päivässä; käyttöehtojen rikkomukseksi merkityt enintään 2 vuotta. | Varmista, että Skogin API-avain on organisaatiossa, joka on hyväksynyt kaupalliset ehdot (Console). Harkitse nollasäilytyssopimusta (Zero Data Retention), jos se on saatavilla. |
| Resend | Ei tarkistettu. | Valitse EU-alue, kun Resend otetaan käyttöön, ja päivitä sijainti. |
