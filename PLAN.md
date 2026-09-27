# Skog – PLAN

Merkinnät: `[x]` valmis, `[ ]` tekemättä, `[~]` kesken tai odottaa estettä (BLOCKERS.md).

## Käyttäjät

| Käyttäjä | Mitä tekee |
|---|---|
| Kirjanpitotoimisto (organisaatio) | Hoitaa metsänomistajien metsätalouden kirjanpidon ja verotuksen |
| Pääkäyttäjä (`owner`) | Kaikki asiakkaat, käyttäjien kutsut, verovuoden sulkeminen |
| Kirjanpitäjä (`staff`) | Omat asiakkaat: kirjaukset, raportit ja arkisto |

## Toimialan perusasiat

- Asiakas on metsänomistaja. Hänellä on yksi tai useampi metsätila (kiinteistötunnus, pinta-ala, hankintahinta ja -päivä, metsämaan osuus).
- Kirjaukset ovat metsätalouden tuloja ja menoja verovuosittain: summa ilman arvonlisäveroa, arvonlisäveroprosentti, luokka, ennakonpidätys.
- Investoinnit (koneet, tiet, ojat) poistetaan tasapoistona tai menojäännöspoistona (25 %). Myyty kone poistuu poistolaskelmasta, ja myynnistä lasketaan myyntivoitto.
- Metsävähennyksen pohja on 60 % metsämaan hankintamenosta. Kertymää seurataan metsätiloittain.
- Arvonlisävero lasketaan niille asiakkaille, jotka ovat arvonlisäverorekisterissä.
- Verosuunnitelma arvioi vuoden verotettavan pääomatulon ja auttaa valitsemaan metsävähennyksen ja poistojen määrän. Kun suunnitelma vahvistetaan, vuoden poistot ja metsävähennys tallentuvat ja vuosi voidaan sulkea.
- Veroraportti on PDF, jossa on kansilehti ja sisällysluettelo. Se tukee veroilmoitusta (2C-lomake) ja arkistoidaan verovuosittain tositteineen.

## Tietomallin runko (luonnos)

- **Organisaatio** (kirjanpitotoimisto) → **käyttäjät** (rooli)
- **Asiakas** (vastuukirjanpitäjä, arvonlisäverorekisteröinti, yhteystiedot) → **metsätila** → **metsävähennyskertymä** verovuosittain
- **Verovuosi** asiakkaalle: avoin / suljettu, sulkemisen tekijä ja aika
- **Kirjaus**: päivä, tyyppi (tulo / meno), luokka, summa ilman arvonlisäveroa, arvonlisäveroprosentti, ennakonpidätys, viite, tosite
- **Investointi** → **poisto** verovuosittain (määrä ja jäännösarvo vuoden lopussa)
- **Arkisto**: verovuoden raportti ja tositteet (Storage)

## Vaiheet

### 0. Vanhan sovelluksen korjaukset (`main`)
- [x] Päivittäinen ping pitää Supabase-projektit hereillä (26.9.2026)
- [x] API-reitit tarkistavat asiakkaan organisaation (26.9.2026)
- [x] Selvitä, ovatko taulut auki anon-avaimelle: eivät ole (BLOCKERS 1, 26.9.2026)
- [ ] Erilliset kirjanpito-, alv-, veroraportti-, verosuunnitelma- ja käyttäjäsivut eivät saa tietoja, koska ne käyttävät kantaa selaimesta. Asiakassivun välilehdet korvaavat ne, paitsi arkiston "Avaa raportti" -linkki veroraporttiin. Päätä: siirrä veroraportin kantakutsut API-reiteille vai poista vanhat sivut ja linkki.
- [ ] Poista kovakoodattu verovuosi 2025 kuudesta reitistä: käytä asiakkaan avointa vuotta tai kuluvaa vuotta.
- [ ] Varmista Auth0:ssa, että itserekisteröinti on suljettu (BLOCKERS 2).

### 1. Perusta (`v2`)
- [x] `v2`-haara. Vanha sovellus `legacy/`-kansiossa, rajattu pois buildista, tyyppitarkistuksesta ja lintistä (26.9.2026)
- [x] Runko Mittarilukemasta: Next 15, React 19, Tailwind 4, zod 4, vitest, eslint. Kantakerros, kirjautuminen, lomakkeet, muutosloki, ohjeet, ulkoasu, testiapurit ja migraatioskripti (26.9.2026)
- [x] Migraatio 0001: `sk_organizations`, `sk_users`, `sk_org_members` (owner, staff), `sk_audit_log`, `sk_check_same_org`, RLS-testit (26.9.2026)
- [x] Kirjautuminen: dev-tila toimii (26.9.2026)
- [ ] Auth0 tuotantoon: nykyinen Skog-sovellus Auth0:ssa, itserekisteröinti pois (BLOCKERS 2)
- [x] Oma Supabase-projekti (eu-west-1), migraatiot 0001–0003 ajettu, anon-roolin oikeudet poistettu (26.9.2026)
- [ ] Osoite ja avaimet Verceliin (DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STORAGE_MODE=supabase)
- [ ] Vercelin v2-esikatselu omalla kannallaan. Tuotanto pysyy vanhassa.
- [x] Ping-reitti ja cron uuteen runkoon: oma kanta SQL:llä, Kasamaster omalla avaimellaan (26.9.2026)
- [x] `.gitignore` ja CI-vahti henkilötiedoille (26.9.2026)
- [x] Työpöytä, asetukset (yhteystiedot, käyttäjät, loki) ja ohjeet (26.9.2026)

### 2. Tietomalli ja tiedonsiirto
- [x] Migraatio 0002: `sk_clients`, `sk_forest_properties`, `sk_tax_years`, `sk_transactions`, `sk_assets`, `sk_depreciations`, `sk_forest_deductions`, `sk_documents`. RLS: kirjanpitäjä näkee vain vastuuasiakkaansa. Suljetun vuoden lukitus kannassa. Saman asiakkaan tarkistus (26.9.2026)
- [x] Storage-ämpäri `documents` (vain Supabasessa) ja tallennusmoduuli `src/lib/storage` (paikallinen kansio oletuksena) (26.9.2026)
- [x] Demodata (`db:seed:demo`): kaksi toimistoa, kolme asiakasta, verovuodet 2024 (suljettu) ja 2025 (26.9.2026)
- [x] Tiedonsiirto vanhasta kannasta (`tuo:vanha`): muunnokset `src/lib/import/legacy.ts`, kirjoitus `src/lib/import/run.ts`, testit kuvitteellisella aineistolla, toistettava ajo (26.9.2026)
- [x] Tiedonsiirron koeajo oikealla aineistolla `--kuiva`: kaikki rivit siirtyvät, 2 kirjauksen luokka pääteltiin (26.9.2026)
- [x] Tuonti uuteen tuotantokantaan: Adepta Tilit Oy, 3 asiakasta, 22 kirjausta, 1 liite Storageen; Jukka pääkäyttäjäksi (26.9.2026)
- [x] Tuonnin ulkopuolelle jääneet kentät: ALV-numero, metsämaan hehtaarit, kirjauksen ja investoinnin metsätila (migraatio 0004, lomakkeet, uusintatuonti täydentää) (27.9.2026)
- [x] Vanhan kannan rakenne `legacy/schema.sql` (scripts/dump-legacy-schema.mts) (26.9.2026)
- [x] Kirjausten luokat ja arvonlisäverokannat `src/lib/tax/rules.ts` (26.9.2026)

### 3. Perusnäkymät
- [x] Asiakaslista ja haku, uusi asiakas, muokkaus, vastuukirjanpitäjän vaihto, arkistointi (26.9.2026)
- [x] Asiakkaan sivu: tiedot, metsätilat, verovuodet ja välilehdet kirjanpidolle, arvonlisäverolle, verosuunnitelmalle, veroraportille ja arkistolle (27.9.2026)
- [x] Metsätilat: lisäys, muokkaus, poisto, metsävähennyspohja ja jäljellä oleva määrä (26.9.2026)
- [x] Verovuodet asiakkaan sivulla: avaus, sulkeminen ja uudelleen avaus (pääkäyttäjä), loki (26.9.2026)
- [x] Verovuoden valinta kirjanpidon välilehdillä, suljettu vuosi vain luettavana (tarkistettu 27.9.2026)
- [x] Käyttäjät: kutsu sähköpostilla (Auth0), rooli, poisto käytöstä, vastuuasiakkaiden siirto, ei itserekisteröintiä (27.9.2026)
- [ ] Kutsujen käyttöönotto tuotannossa: Auth0-hallintasovellus ja Resend-avain Verceliin (BLOCKERS 7)
- [x] Ohjeet kaikille näkymille, ohjelinkki jokaiselle sivulle; uusi asiakas, uusi tila ja kirjauksen muokkaus osoittavat ohjeen kohtaan (27.9.2026)
- [x] Kehitystoiveet Mittarilukemasta (sivu, linkki sivun yläkulmaan) (27.9.2026)

### 4. Kirjanpito
- [x] Kirjanpito asiakkaan välilehdellä: kirjaukset vuosittain, summat, lisäys, muokkaus ja poisto rivi kerrallaan, suljettu vuosi vain luettavana (26.9.2026)
- [x] Nopeampi syöttö taulukossa suoraan (kuten vanhassa sovelluksessa): Kirjanpito → Taulukkosyöttö, näppäimistö, liittäminen Excelistä, kaikki tai ei mitään (27.9.2026)
- [x] Tositteen liittäminen kirjaukseen, lataus RLS:n kautta, suljetun vuoden tositteita ei voi poistaa (26.9.2026)
- [x] Poistetun tositteen tiedosto pois Storagesta (27.9.2026)
- [x] Luokat ja oletusverokanta päivän mukaan, Hankintatyö-luokka vanhasta sovelluksesta (26.9.2026)
- [x] Investoinnin hankinta kirjauksesta luo investoinnin, myynti merkitsee sen myydyksi (26.9.2026)
- [x] Myyntivoitto (vaihe 5). Korjattu 27.9.2026: myyntihinta ei enää tule laskelmaan tulona myyntivoiton lisäksi

### 5. Verolaskenta (`src/lib/tax`)
- [x] Verosäännöt `rules.ts`: pääomatulon vero 30/34 % (raja 30 000 €), metsävähennys 60 % ja vähintään 1 500 €, menojäännöspoisto 25 % (26.9.2026)
- [x] Metsätilan myynti: käytetyn metsävähennyksen lisäys luovutusvoittoon, verovelvolliskohtainen pohja (migraatio 0007, 27.9.2026). Määräalan myynti myöhemmin
- [x] Säännöt Verohallinnon ohjeiden mukaan (27.9.2026): metsävähennys 60/75 % bruttotulosta, menojäännöspoisto lajeittain (25/15/10 %) vapaaehtoisena, 600 euron raja, koneen myynti luovutusvoittona, yrittäjävähennys 5 %
- [x] Arvonlisävero-välilehti: neljännekset, vuosi ja myynnit verokannoittain (26.9.2026)
- [x] Poistot: tasapoisto (pakollinen), menojäännöspoisto (vapaaehtoinen), poistamaton arvo, myyntivoitto ja -tappio (26.9.2026)
- [x] Metsävähennys: pohja, käytetty, vuoden enimmäismäärä, vähimmäismäärä, jako tiloille (26.9.2026)
- [~] Hankintatyön laskuri (taksat × m³, 125 m³ raja) (BLOCKERS 5). Luokka Hankintatyö on jo kirjanpidossa
- [x] Verosuunnitelma-välilehti: laskuri, palvelin laskee uudelleen vahvistettaessa, vahvistus tallentaa poistot ja vähennyksen, pääkäyttäjä voi sulkea vuoden samalla (26.9.2026)
- [x] Vertailu vanhaan sovellukseen (`vertaa:vero`), ajettu 27.9.2026: oikea asiakas täsmää. Testiasiakkaiden ero johtui vanhassa sovelluksessa tuonnin jälkeen tehdyistä muutoksista, joten uusintatuonti synkronoi nyt avoimet vuodet (DECISIONS 27.9.2026)

### 6. Raportit ja arkisto
- [x] Veroraportti PDF:nä: kansilehti, sisällysluettelo, tulot ja menot, verolaskelma, arvonlisävero, poistot, metsävähennys, kirjausluettelo, LUONNOS-vesileima avoimelle vuodelle (26.9.2026)
- [x] Verovuoden sulkeminen arkistoi lopullisen raportin samassa transaktiossa, myös verosuunnitelman "Vahvista ja sulje" (26.9.2026)
- [x] Veroraportti ja arkisto -välilehti: raportin avaus, arkistoidut raportit ja tositteet verovuosittain (26.9.2026)

### 7. Käyttöönotto
- [ ] Rinnakkaisajo: sama vuosi molemmissa, erot selitetty
- [ ] Lopullinen tiedonsiirto, `v2` → `main`, skog.adepta.fi uuteen
- [ ] Vanha Skog-data pois yhteisestä Supabase-projektista, kun Kasamaster ja adepta-ppr eivät sitä tarvitse
- [ ] `legacy/` pois

### Myöhemmin
- [ ] Kuittiskanneri mobiilissa: kuva tositteesta, tekoäly tunnistaa summan, päivän ja toimittajan (mock oletuksena)
- [ ] Metsänomistajan oma näkymä (vain luku)
- [ ] Yhteinen pohjarepo eRapulle, Mittarilukemalle ja Skogille (`TEMPLATES`)
