# LUONNOS – Skogin tietosuojaseloste

> **Luonnos Jukan tarkistettavaksi, 28.9.2026.** Ei julkaistu. Claude kirjoitti
> luonnoksen Skogin koodin (`v2`-haara) sekä eSinetin ja Reilusopparin
> luonnosten pohjalta. Hakasulkeissa `[ ]` olevat kohdat vaativat tiedon tai
> päätöksen, jota koodista ei näe.
>
> Asiakirjassa on kaksi osaa, koska rekisterinpitäjiä on kaksi:
>
> - **Osa A** on malliteksti tilitoimistolle. Tilitoimisto on asiakkaidensa
>   (metsänomistajien) tietojen rekisterinpitäjä ja voi ottaa tekstin osaksi
>   omaa tietosuojaselostettaan. Adepta Oy on käsittelijä
>   (`kasittelysopimus-luonnos.md`).
> - **Osa B** on Adepta Oy:n oma seloste palvelun käyttäjistä (tilitoimistojen
>   henkilökunta). Siitä lyhyt versio on sovelluksen julkisella sivulla
>   `/tietosuoja` (`src/app/tietosuoja/page.tsx`).
>
> **Miksi Adepta on käyttäjätietojen rekisterinpitäjä** (DECISIONS 28.9.2026):
> Adepta päättää itse, miten kirjautuminen, tunnusten luonti, palvelun
> tietoturvalokit ja kehitystoiveet toteutetaan, ja käyttää niitä omiin
> tarkoituksiinsa (palvelun tarjoaminen, suojaaminen ja kehittäminen,
> asiakassuhde tilitoimistoon). Tilitoimisto päättää taas, keitä se kutsuu
> käyttäjiksi, millä rooleilla ja mitä asiakkaita he hoitavat. Siksi käyttäjän
> nimi ja rooli tilitoimiston omassa työssä (muutosloki, vastuukirjanpitäjä,
> raportin laatija) ovat osa tilitoimiston rekisteriä ja kuuluvat
> käsittelysopimukseen.

---

## Osa A – Malliteksti tilitoimistolle: metsätalouden kirjanpito ja verotus

*Tilitoimisto täydentää hakasulkeissa olevat kohdat ja liittää tekstin omaan
selosteeseensa.*

### A1. Rekisterinpitäjä

[Tilitoimiston nimi, Y-tunnus, osoite]
Yhteyshenkilö tietosuoja-asioissa: [nimi, sähköposti, puhelin]

### A2. Mihin tietoja käytetään ja millä perusteella

Hoidamme asiakkaidemme metsätalouden kirjanpidon ja verotuksen: kirjaukset,
arvonlisäveron, poistot, metsävähennyksen, verosuunnitelman, veroraportin ja
metsätalouden veroilmoituksen (lomake 2C).

Käsittelyn peruste on sopimus kanssasi (tietosuoja-asetuksen 6 artiklan 1
kohdan b alakohta) ja lakisääteiset velvoitteemme, kuten kirjanpito- ja
verolainsäädäntö sekä rahanpesulaki (c alakohta). [Tilitoimisto tarkistaa
perusteet omasta toiminnastaan.]

### A3. Mitä tietoja käsittelemme

- Perustiedot: nimi, osoite, sähköposti, puhelin, kotikunta, Y-tunnus,
  ALV-numero, arvonlisäverorekisteröinti ja verotilin viite.
- Metsätilat: kiinteistötunnukset, pinta-alat, hankintahinnat ja -päivät,
  luovutukset sekä metsävähennyksen pohja ja käyttö.
- Kirjanpito- ja verotiedot: tulot ja menot, arvonlisävero, ennakonpidätykset,
  investoinnit ja poistot, verosuunnitelma ja veroraportit.
- Tositteet, jotka toimitat meille. Tositteissa voi olla myös muiden ihmisten
  tietoja, esimerkiksi urakoitsijan tai puunostajan yhteyshenkilön nimi.

Henkilötunnustasi emme tallenna ohjelmaan. Jos veroilmoitus sitä vaatii
(esimerkiksi sinulla ei ole Y-tunnusta, tai ilmoitukseen merkitään hankintatyön
tekijät), kirjoitamme tunnuksen vain veroilmoitustiedostoon, jonka lähetämme
Verohallinnolle Ilmoitin.fi-palvelun kautta.

### A4. Mistä tiedot saadaan

Sinulta itseltäsi, tositteista, jotka toimitat, ja tarvittaessa
viranomaisilta, esimerkiksi Verohallinnolta ja Maanmittauslaitokselta.

### A5. Kenelle tietoja luovutetaan

Verohallinnolle veroilmoituksen yhteydessä. Muille vain, jos laki sitä vaatii
tai pyydät sitä.

### A6. Käsittelijät

Käytämme kirjanpitoon Skog-palvelua, jonka tarjoaa Adepta Oy (Y-tunnus
2237131-2). Adepta käsittelee tietoja lukuumme henkilötietojen käsittelijänä,
ja olemme tehneet sen kanssa käsittelysopimuksen. Adepta käyttää
alikäsittelijöitä, joiden luettelo on osoitteessa skog.adepta.fi/tietosuoja.

Tiedot säilytetään EU:ssa (Irlanti). Jos pyydämme ohjelmaa lukemaan tositteen
puolestamme, tosite lähetetään Anthropic PBC:n tekoälypalveluun
Yhdysvaltoihin. Palvelu ehdottaa kirjauksia, ja kirjanpitäjämme tarkistaa ne
ennen tallennusta. Palveluun ei lähetetä nimeäsi eikä muita tietoja
ohjelmasta, vain tosite. Anthropic ei käytä tositetta tekoälyn
kouluttamiseen, ja se poistaa tositteen 30 päivän kuluessa. Siirron perusteena
ovat EU:n vakiosopimuslausekkeet.

### A7. Kuinka kauan tietoja säilytetään

Säilytämme kirjanpito- ja veroaineistoa niin kauan kuin laki vaatii ja sen
jälkeen [tilitoimiston oma käytäntö]. Metsätalouden muistiinpanot ja tositteet
säilytetään vähintään kuusi vuotta verovuoden päättymisestä
(verotusmenettelylaki). Jos metsätalouden harjoittaja on kirjanpitovelvollinen,
kirjanpito ja tilinpäätös säilytetään kymmenen vuotta ja tositteet kuusi vuotta
tilikauden päättymisvuoden lopusta (kirjanpitolaki 2 luvun 10 §). Kun
asiakkuus päättyy, tiedot säilytetään arkistoituina säilytysajan loppuun.

### A8. Oikeutesi

Voit pyytää nähdä tietosi, korjata ne ja rajoittaa niiden käsittelyä. Voit
pyytää tietojen poistoa, kun laki ei enää vaadi säilyttämään niitä. Voit
tehdä valituksen tietosuojavaltuutetulle (tietosuoja.fi), jos katsot, että
tietojasi käsitellään lain vastaisesti.

---

## Osa B – Adepta Oy: Skog-palvelun käyttäjät

### B1. Rekisterinpitäjä

Adepta Oy, Y-tunnus 2237131-2, Joutsa
Yhteystiedot tietosuoja-asioissa: [sähköposti, esim. tietosuoja@adepta.fi]

### B2. Keitä tämä koskee

Tilitoimistojen henkilökuntaa, joka käyttää Skogia (pääkäyttäjät ja
kirjanpitäjät).

Metsänomistajien eli tilitoimistojen asiakkaiden tiedoista vastaa tilitoimisto.
Adepta käsittelee niitä vain tilitoimiston lukuun. Jos olet metsänomistaja,
ota yhteyttä tilitoimistoosi.

### B3. Mitä tietoja käsittelemme ja miksi

| Tiedot | Mihin | Peruste |
|---|---|---|
| Nimi, sähköposti, organisaatio ja rooli | Tunnuksen luonti, kutsu, kirjautuminen ja oikeudet | Sopimus tilitoimiston kanssa; oikeutettu etu antaa sen henkilökunnalle pääsy palveluun |
| Kirjautumistunniste (Auth0), kirjautumisajat, kirjautumistapahtumat | Kirjautuminen ja palvelun suojaaminen | Oikeutettu etu: tietoturva |
| Palvelimen tekniset lokit (esim. virheet, kutsujen ajat) | Vianselvitys ja tietoturva | Oikeutettu etu: palvelun toimivuus ja tietoturva |
| Kehitystoiveet: otsikko, kuvaus, sivu, jolla toive jätettiin, ja kuka sen jätti | Palvelun kehittäminen ja vastaaminen toiveeseen | Oikeutettu etu: palvelun kehittäminen yhdessä käyttäjien kanssa |
| Yhteydenotot ja tukipyynnöt | Asiakastuki | Sopimus tilitoimiston kanssa; oikeutettu etu |

Muutosloki (kuka muutti mitä kirjanpidossa ja milloin) on osa tilitoimiston
kirjanpitoaineistoa. Sen rekisterinpitäjä on tilitoimisto.

Emme käytä tietoja markkinointiin emmekä profilointiin. Palvelussa ei ole
analytiikka- eikä mainosevästeitä, vain kirjautumisen ja istunnon evästeet.

### B4. Mistä tiedot saadaan

Tilitoimiston pääkäyttäjä antaa nimesi ja sähköpostisi, kun hän kutsuu sinut.
Muut tiedot syntyvät, kun käytät palvelua.

### B5. Kenelle tietoja luovutetaan

Tietoja ei luovuteta. Käytämme alikäsittelijöitä (B7).

### B6. Kuinka kauan tietoja säilytetään

- Käyttäjätiedot: niin kauan kuin olet tilitoimiston käyttäjä. Kun
  pääkäyttäjä poistaa sinut käytöstä, pääsy katkeaa heti. Nimesi säilyy, koska
  se näkyy tekemiesi muutosten kohdalla tilitoimiston kirjanpidossa.
  [Päätettävä: kirjautumistunnuksen poisto Auth0:sta käytöstä poiston jälkeen,
  esim. 12 kuukauden kuluttua.]
- Kirjautumistapahtumat Auth0:ssa: Auth0:n tilauksen mukaan [tarkistettava].
- Palvelimen tekniset lokit: Vercelin tilauksen mukaan [tarkistettava].
- Kehitystoiveet: palvelun elinkaaren ajan. [Päätettävä.]

### B7. Alikäsittelijät ja siirrot EU:n ulkopuolelle

| Alikäsittelijä | Tehtävä | Sijainti |
|---|---|---|
| Supabase Inc. | Tietokanta ja tiedostot | Irlanti |
| Vercel Inc. | Sovelluspalvelin | Irlanti (Dublin) |
| Okta Inc. (Auth0) | Kirjautuminen | Yhdysvallat |
| Resend Inc. | Kutsusähköpostit (ei vielä käytössä) | [tarkistettava] |

Kirjautumispalvelu on nyt Yhdysvalloissa. Siirron perusteena ovat EU:n
vakiosopimuslausekkeet. [Suunnitelma: siirto EU-alueelle, BLOCKERS 8 b.]
Supabase, Vercel ja Okta ovat yhdysvaltalaisia yhtiöitä, ja niiden
mahdollinen tukipääsy perustuu samoin vakiosopimuslausekkeisiin.

Anthropic ei saa käyttäjien tietoja. Tositteen tunnistuksesta kerrotaan
osassa A ja käsittelysopimuksen liitteessä 3.

### B8. Oikeutesi

Voit pyytää nähdä tietosi, korjata ne, rajoittaa niiden käsittelyä ja vastustaa
oikeutettuun etuun perustuvaa käsittelyä. Voit pyytää tietojen poistoa, kun
et enää käytä palvelua. Tilitoimistosi pääkäyttäjä voi myös korjata nimesi ja
poistaa sinut käytöstä. Voit tehdä valituksen tietosuojavaltuutetulle
(tietosuoja.fi).

### B9. Tietoturva

- Jokainen tilitoimisto näkee vain omat tietonsa, ja kirjanpitäjä vain omat
  asiakkaansa. Rajaus on tietokannassa.
- Tiedot ovat salattuina liikenteessä ja tallennettuina.
- Ohjelmaan ei voi rekisteröityä itse. Käyttäjä lisätään kutsulla.
- Suljettua verovuotta ei voi muuttaa ilman avausta, ja muutokset kirjataan
  lokiin.
- Henkilötunnuksia ei tallenneta.
