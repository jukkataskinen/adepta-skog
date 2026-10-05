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
- Kirjaukset ovat metsätalouden tuloja ja menoja verovuosittain: summa arvonlisäveron kanssa (kuten kuitissa), josta veroton summa lasketaan, arvonlisäveroprosentti, luokka, ennakonpidätys.
- Investoinnit (koneet, tiet, ojat) poistetaan tasapoistona tai menojäännöspoistona (25 %). Myyty kone poistuu poistolaskelmasta, ja myynnistä lasketaan myyntivoitto.
- Metsävähennyksen pohja on 60 % metsämaan hankintamenosta. Kertymää seurataan metsätiloittain.
- Arvonlisävero lasketaan niille asiakkaille, jotka ovat arvonlisäverorekisterissä.
- Verosuunnitelma arvioi vuoden verotettavan pääomatulon ja auttaa valitsemaan metsävähennyksen ja poistojen määrän. Kun suunnitelma vahvistetaan, vuoden poistot ja metsävähennys tallentuvat ja vuosi voidaan sulkea.
- Veroraportti on PDF, jossa on kansilehti ja sisällysluettelo. Se tukee veroilmoitusta (2C-lomake) ja arkistoidaan verovuosittain tositteineen.

## Tietomallin runko (luonnos)

- **Organisaatio** (kirjanpitotoimisto) → **käyttäjät** (rooli)
- **Asiakas** (vastuukirjanpitäjä, arvonlisäverorekisteröinti, yhteystiedot) → **metsätila** → **metsävähennyskertymä** verovuosittain
- **Verovuosi** asiakkaalle: avoin / suljettu, sulkemisen tekijä ja aika
- **Kirjaus**: päivä, tyyppi (tulo / meno), luokka, summa arvonlisäveron kanssa ja siitä laskettu veroton summa, arvonlisäveroprosentti, ennakonpidätys, viite, tosite
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
- [x] Osoite ja avaimet Verceliin (Preview, haara v2; DATABASE_URL transaktiopooleri 6543) (27.9.2026)
- [x] Vercelin v2-esikatselu omalla kannallaan, Auth0-kirjautuminen toimii: https://adepta-skog-git-v2-jukka-taskinens-projects.vercel.app (27.9.2026). Tuotanto pysyy vanhassa.
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
- [x] Summa arvonlisäveron kanssa kaikissa syöttökohdissa (lomake, taulukko, Excel, investoinnit), veroton ja vero lasketaan siitä yhdellä säännöllä; migraatio 0009 `amount_gross` (28.9.2026)
- [x] Oletus-alv 0 % asiakkaalle, joka ei ole arvonlisäverorekisterissä (Jukka vahvisti 28.9.2026)
- [x] Taulukko kirjanpidon oletusnäkymänä: koko vuoden kirjaukset muokattavina, vanhan sovelluksen näppäimet, luokan numerovalinta, ennakonpidätyksen ja hankintatyön ikkunat, investointien hankinta ja myynti, poisto ja Ctrl + Z, tallennus yhdessä transaktiossa paikallaan, varoitus tallentamattomista muutoksista (28.9.2026)
- [x] Tositteen liittäminen kirjaukseen, lataus RLS:n kautta, suljetun vuoden tositteita ei voi poistaa (26.9.2026)
- [x] Poistetun tositteen tiedosto pois Storagesta (27.9.2026)
- [x] Luokat ja oletusverokanta päivän mukaan, Hankintatyö-luokka vanhasta sovelluksesta (26.9.2026)
- [x] Investoinnin hankinta kirjauksesta luo investoinnin, myynti merkitsee sen myydyksi (26.9.2026)
- [x] Myyntivoitto (vaihe 5). Korjattu 27.9.2026: myyntihinta ei enää tule laskelmaan tulona myyntivoiton lisäksi
- [x] Osittain vähennettävä kulu: metsätalouden osuus % kirjaukselle (migraatio 0013), osuus kaikkeen verolaskentaan, alv-yhteenvetoon, raporttiin ja 2C:hen, investoinnin hankintameno osuudesta; taulukon Osuus %-sarake, lomake ja Excel (28.9.2026). Alv-tulkinta odottaa kirjanpitäjän vahvistusta (BLOCKERS 11)
- [x] Aiemmin hankittu investointi: asiakkaan Investoinnit-välilehti, Lisää aiempi investointi (hankintahinta, kertynyt poisto 31.12.X ja siitä laskettu menojäännös), poistot vuodesta X + 1, muokkaus ja poisto kunnes ensimmäinen poistovuosi suljetaan, näkyy verosuunnitelmassa, veroraportissa ja 2C:ssä (migraatio 0014, 28.9.2026)

### 5. Verolaskenta (`src/lib/tax`)
- [x] Verosäännöt `rules.ts`: pääomatulon vero 30/34 % (raja 30 000 €), metsävähennys 60 % ja vähintään 1 500 €, menojäännöspoisto 25 % (26.9.2026)
- [x] Metsätilan myynti: käytetyn metsävähennyksen lisäys luovutusvoittoon, verovelvolliskohtainen pohja (migraatio 0007, 27.9.2026)
- [x] Määräalan tai määräosan myynti, useita luovutuksia tilasta, myyntikulut ja poistamattomat tie- ja ojamenot hankintamenoon (migraatio 0008, 27.9.2026)
- [x] Säännöt Verohallinnon ohjeiden mukaan (27.9.2026): metsävähennys 60/75 % bruttotulosta, menojäännöspoisto lajeittain (25/15/10 %) vapaaehtoisena, 600 euron raja, koneen myynti luovutusvoittona, yrittäjävähennys 5 %
- [x] Arvonlisävero-välilehti: neljännekset, vuosi ja myynnit verokannoittain (26.9.2026)
- [x] Poistot: tasapoisto (pakollinen), menojäännöspoisto (vapaaehtoinen), poistamaton arvo, myyntivoitto ja -tappio (26.9.2026)
- [x] Metsävähennys: pohja, käytetty, vuoden enimmäismäärä, vähimmäismäärä, jako tiloille (26.9.2026)
- [x] Hankintatyön laskuri: ohjetaksat (yhtenäistämisohje 2025, 4.1.9), 125 m³:n verovapaa osuus, täyttää kirjauksen (27.9.2026)
- [x] Verosuunnitelma-välilehti: laskuri, palvelin laskee uudelleen vahvistettaessa, vahvistus tallentaa poistot ja vähennyksen, pääkäyttäjä voi sulkea vuoden samalla (26.9.2026)
- [x] Vertailu vanhaan sovellukseen (`vertaa:vero`), ajettu 27.9.2026: oikea asiakas täsmää. Testiasiakkaiden ero johtui vanhassa sovelluksessa tuonnin jälkeen tehdyistä muutoksista, joten uusintatuonti synkronoi nyt avoimet vuodet (DECISIONS 27.9.2026)

### 6. Raportit ja arkisto
- [x] Veroraportti PDF:nä: kansilehti, sisällysluettelo, tulot ja menot, verolaskelma, arvonlisävero, poistot, metsävähennys, kirjausluettelo, LUONNOS-vesileima avoimelle vuodelle (26.9.2026)
- [x] Verovuoden sulkeminen arkistoi lopullisen raportin samassa transaktiossa, myös verosuunnitelman "Vahvista ja sulje" (26.9.2026)
- [x] Veroraportti ja arkisto -välilehti: raportin avaus, arkistoidut raportit ja tositteet verovuosittain (26.9.2026)
- [x] Sähköinen veroilmoitus 2C (tietovirta VSY02C, verovuodet 2025 ja 2026): puhdas muodostin `src/lib/filing/vsy02c.ts`, esikatselu ja lataus Veroraportti ja arkisto -välilehdellä, henkilötunnus vain tiedostoon, lataus Ilmoitin.fi:hin käsin (28.9.2026)

### 7. Käyttöönotto
- [x] Tietosuoja-asiakirjat luonnoksina (`docs/tietosuoja`: seloste, käsittelysopimus, alikäsittelijät) ja julkinen sivu /tietosuoja, linkit kirjautumissivulle ja ohjeiden alatunnisteeseen (28.9.2026)
- [ ] Tietosuoja-asiakirjojen hyväksyntä, käsittelysopimukset tilitoimistojen kanssa, alikäsittelijöiden ehdot ja Auth0 EU-tenanttiin (BLOCKERS 8 b)
- [ ] Tositteen tunnistus organisaatiokohtaisesti päälle tai pois (BLOCKERS 10, odottaa Jukan päätöstä)
- [ ] 2C-tiedosto Ilmoitin.fi:n Aineiston tarkastukseen oikealla asiakkaalla ja tuotantokäytön aloitusilmoitus Verohallinnolle (BLOCKERS 9)
- [ ] Rinnakkaisajo: sama vuosi molemmissa, erot selitetty
- [ ] Lopullinen tiedonsiirto, `v2` → `main`, skog.adepta.fi uuteen
- [ ] Vanha Skog-data pois yhteisestä Supabase-projektista, kun Kasamaster ja adepta-ppr eivät sitä tarvitse
- [ ] `legacy/` pois

### 8. Maatalous (lomake 2), MVP
Suunnitelma: `docs/maatalous-suunnitelma-2026-10-02.md`. Verovuodet 2025 ja 2026, yksityinen maataloudenharjoittaja ja kuolinpesä. MVP tehty 2.10.2026 (tehtävät 1–9); demossa maatila-asiakas Maija Peltola vuodelle 2025 (`db:seed:demo`).
- [x] 1. Migraatio 0015: asiakkaan toiminnot, kirjauksen toiminto ja toisen toiminnon osuus, investoinnin toiminto ja poistoryhmä, maatilat, vuoden tiedot, ryhmäpoistot, investointituet, varaukset ja niiden käyttö, kotieläinten jaksotukset, harvinaiset kentät; RLS, triggerit, lukitus, testit (2.10.2026)
- [x] 2. Säännöt ja luokat: maatalouden luokat (21–59) lomakkeen 2 kenttiin, alennettu alv aikasarjana (14 → 13,5 %), maatalouden poistoryhmät ja rajat, 2025:n korotettu poisto, toiminnon osuudet; metsätalouden laskelmiin vain metsätalouden osa (2.10.2026)
- [x] 3. Syöttö: asiakkaan toiminnot (metsätalous, maatalous), taulukko, lomake ja Excel maatalouden luokilla, toisen toiminnon osuus, maatalouden investoinnin poistoryhmä ja myynti, kortit toiminnoittain; ohjeet (2.10.2026)
- [x] 4. Yhteinen arvonlisävero metsälle ja maataloudelle: vähennettävä vero oman ja toisen toiminnon osuudesta, erittely toiminnoittain alv-sivulla ja raportissa, ilmoituksen kentät 301–308 (2.10.2026)
- [x] 5. Maatalouden investoinnit, aiemmat investoinnit (myös koneet yhtenä menojäännöksenä) ja ryhmäpoistot: menojäännös ketjuna vuodesta toiseen, tuet, käytetty tasausvaraus, myynti menojäännöksestä, pieni menojäännös, 2025:n korotettu poisto omana ryhmänä (2.10.2026)
- [x] 6. Maatalous-välilehti: ryhmäpoistojen valinta, vuoden tiedot (varallisuus, puoliso-osuudet 413–416, vaatimus 418, tappio 420, palkat 437), tasaus- ja jälleenhankintavaraukset käyttöineen, kotieläinten jaksotukset, investointituet, harvinaiset kentät ja maatilat; ohje Maatalous (2.10.2026)
- [x] 7. Lomakkeen 2 laskenta puhtaana funktiona (`src/lib/tax/agriculture.ts`): tulot ja menot kentittäin alv-kannan mukaan, osingot ja osuuskunnan ylijäämä, kotieläinten jaksotukset kolmelta vuodelta, varaukset, ryhmäpoistot ja 2025:n erittely, varallisuuslaskelma, puoliso-osuudet ja tarkistukset; tulos Maatalous-välilehdellä ja tiedoksi verosuunnitelmassa (2.10.2026)
- [x] 8. Veroraportin maatalousosa: sisällysluettelossa Maatalous (lomake 2), tulot ja menot luokittain, lomakkeen 2 kentät, ryhmäpoistot; yhteenvedossa maatalouden tulos, alv yhteinen erittelyineen; pelkälle maatalousasiakkaalle ei metsän osia (2.10.2026)
- [x] 9. VSY002-tiedosto (`src/lib/filing/vsy002.ts`, tietuekuvaukset 2025 ja 2026): kentät ja tarkistukset, esikatselu Veroraportti ja arkisto -välilehdellä, sama latauspolku kuin 2C, yksi tiedosto (ensin lomake 2, sitten 2C), tyhjä lomake 967:1; Ilmoitin.fi:n aineiston tarkastus odottaa (BLOCKERS 13) (2.10.2026)
- [x] 10. Maatalouden kirjanpito omana näkymänään (Jukan palaute 2.10.2026): välilehdet Metsätalouden ja Maatalouden kirjanpito (`?toiminta=maatalous`), samat työkalut (taulukko, lomake, Excel, kortit, vuoden tositteet, tunnistus), näkymä näyttää ja tallentaa vain oman toimintonsa; tositteiden tunnistus maatalouden luokilla ja asiakirjalajeilla, oletustoiminto näkymästä, ehdotus jaetaan toiminnoittain (migraatio 0016); Maatalous-välilehti on nyt Lomake 2; kirjausluettelo toiminnoittain; ohje Maatalouden kirjanpito (2.10.2026)

### 9. Maatalous, myöhemmin
- [ ] Lomakkeen 2 tiedosto Ilmoitin.fi:n aineiston tarkastukseen ja VSY002 tuotantokäytön aloitusilmoitukseen (Jukka, BLOCKERS 13)
- [ ] Tulkinnat kirjanpitäjältä (BLOCKERS 14) ja tarvittavat korjaukset
- [x] Tilituki-aineiston tuonti (BLOCKERS 12 ratkaistu, 5.10.2026): DBF-jäsennin `scripts/tilituki/parse.py`, kartoitus veronumerosta `src/lib/import/tilituki`, `tilituki:tuo` (asiakas Y-tunnuksella, viennit luokille, menojäännökset 31.12., Tilitukin poistot, vuoden tiedot, varaukset, jaksotukset, toistettava) ja `tilituki:vertaa` (lomake 2 kentittäin). Koeajo 2025: 5 maatalousasiakasta, 2 täsmää kokonaan, 3:n erot selitetty (tulkinnat BLOCKERS 14 y–ac); 2024 → 2025 menojäännösketju täsmää
- [x] Tilitukin investointihistoria (Jukan palaute 5.10.2026): metsän kalustokortit koko historiana (hankinta, poistot vuosittain, täysi poisto, myynti), Investoinnit-sivulle viimeisin menojäännös ja poistohistoria, maatalouden ryhmien historia, kokonaan poistettu pois verosuunnitelmasta, `tilituki:tuo --vuosi 2023,2024,2025 --avaa 2026 --tarkista` ja `tilituki:tarkista`. Paikallisesti ja tuotannon kuiva-ajona 27/28 kansiota täsmää (kansio 37: BLOCKERS 14 ab)
- [ ] Tilitukin kartoittamattomat erät: investointien myynnit ja avustukset (L21_113…), metsän muu pääomatulo (L2C_115); nyt raportissa käsin kirjattaviksi. Metsän investoinnit (KALUSTOMETSÄ) tulevat kalustokortistosta
- [x] Tasausvarauksen laskuri: enimmäismäärä (40 % puhtaasta tulosta ennen korkoja, 800–25 000 €, alas sataan) ja tuloutus verosuunnitelmassa, varoitus kolmannesta vuodesta (2.10.2026). Tilakohtainen laskenta usealle maatilalle: kirjauksen maatila, yhteiset erät tulojen suhteessa, liukusäädin ja enimmäismäärä tiloittain (0018, 2.10.2026). Jälleenhankintavarauksen laskuri Lomake 2 -välilehdellä: enimmäismäärä (korvaus − poistamatta oleva hankintameno), käyttöaika ja tallennus varaukseksi; tulosvaikutus odottaa vahvistusta (BLOCKERS 14 v–x, 2.10.2026)
- [x] Kotieläinten jaksotus kirjauksista: Jaksota-valinta taulukossa ja lomakkeella (luokat 21/22 ja uusi 40/50), kirjaus luo tai päivittää jaksotusrivin samassa transaktiossa, vuosierät rivin alla ja Lomake 2 -välilehdellä linkkinä kirjaukseen; laki (MVL 5 § ja 6 §) vaatii yhtä suuret erät, joten vapaata jakoa ei tehty, ja käsin syötetty epätasainen jako saa varoituksen (0018, 2.10.2026)
- [x] Yritystulon jako ja pääomatulo-osuus verosuunnitelmaan (puolisot, 20/10/0 %, 30 % palkoista, vahvistetut tappiot, tappio pääomatuloista), yhteinen pääomatulon vero metsän kanssa ja ansiotulon veron arvio; maatalouden vero veroraportin yhteenvetoon ja maksutiedotteeseen; suositukset (2.10.2026). Tulkinnat BLOCKERS 15
- [x] Maatalouden poistojen valinta verosuunnitelman laskuriin liukusäätimillä; vahvistus tallentaa samoihin tauluihin kuin Lomake 2 -välilehti (2.10.2026)
- [x] Maatalouden tositteiden tunnistus valmiiksi oikeaa aineistoa varten (2.10.2026, `docs/tunnistus-maatalous-2026-10-02.md`): asiakirjalajit ohjeineen ja sudenkuoppineen (meijeri, teurastamo, vilja, tuen maksuilmoitus, Vipun maksetut tuet, tukipäätös, eläinkauppa, konekauppa, polttoaine, energiaveron palautus, sähkö, vakuutus, MYEL), tukilajit luokkiin 217/218/220/222 maksupäivän mukaan, huomautukset (jaksotus, yksityisosuus, vaihtokone, verokanta vuoden mukaan), hyväksyntänäkymän ryhmät ja täsmäytys tositteen summaan, hyväksyntä kerralla tai riveittäin, testitilan esimerkit, palat reitillä rinnakkain ja ohje välimuistiin, rivien raja 1000 (migraatio 0017); ohjeet
- [~] Tositteiden tunnistus: lainan vuosi-ilmoitus (korot 465 tai metsän Muut vuosimenot, lyhennykset vain huomautuksena) ja investointituki oletuksena odottamaan huomautuksen kanssa (2.10.2026). Jäljellä: oikea koe maatilan aineistolla (Jukka: anonymisoitu vuosiaineisto, myös Vipun maksetut tuet PDF:nä)
- [x] Ajoneuvo- ja matkaselvitys laskettuna (281–288, 401–425, 516–534): kaluston ajoneuvon yksityis- ja metsäosuus kilometreistä, oman auton kilometrikorvaus ja päivärahat vuoden korvauksilla (`TRAVEL_RATES`), tuloutus 221 ja lisävähennys 464; metsätalouden ajot 2C:n kohtaan 630 ja verosuunnitelman metsämenoihin (0018, 2.10.2026)
- [x] Kirjauksen maatila (`farm_id`): taulukon sarake ja lomakkeen valinta, kun tiloja on useampi; tilan poisto estyy suljetun vuoden kirjauksilla (0018, 2.10.2026)
- [x] Katselmointi: verolaskennan load-tiedostojen kantakutsut tarkistettu; tx välitetään kutsujalta, joten ne ovat sallittu poikkeus, ja testi vahtii rajaa (2.10.2026)
- [x] Maatila Excel-liitokseen valinnaisena viimeisenä sarakkeena (usean tilan asiakas); investoinnille ei tilaa, koska varauksen käyttö on jo tilakohtainen varauksen kautta (2.10.2026)
- [x] Kirjanpidon suodatin ja haku: luokka, kuukausi ja teksti (selite, viite, luokka, summa) taulukossa ja luettelossa, summat näkyvistä riveistä (2.10.2026)
- [ ] Rakennusten pieni menojäännös rakennuksittain (nyt ryhmän summasta)
- [ ] Alv-ilmoitus tiedostona (VSRALVKV) tai Vero API:lla, ja erillinen alv-päivä vuodenvaihteen tilityksille
- [ ] Pankkitiliotteen sisäänluku (CSV tai camt.053)
- [ ] 7L (pellon ja metsämaan vuokratulot) samaan tiedostoon
- [ ] Yhtymät: lomake 2Y (VSY02Y), osakkaat ja osuudet, verovelvollisen laji asiakkaalle

### Myöhemmin
- [x] Tositteiden tunnistus tekoälyllä: kokoomaskannaus osissa, ehdotukset taulukkoon, sivuviittaukset; ensimmäinen oikea koe onnistui 28.9.2026. Kuvaus puhelimella myöhemmin
- [ ] Metsänomistajan oma näkymä (vain luku)
- [ ] Yhteinen pohjarepo eRapulle, Mittarilukemalle ja Skogille (`TEMPLATES`)
