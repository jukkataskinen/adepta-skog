# Skog – DECISIONS

## 2026-09-26

**Uudelleenrakennus eRapun ja Mittarilukeman pohjalle.** Vanha sovellus käyttää service role -avainta, joten organisaatiorajaus on jokaisen reitin varassa, ja se oli unohtunut tapahtumista, arkistosta ja investoinneista. Osa sivuista käyttää kantaa suoraan selaimesta anon-avaimella. Yhteisellä pohjalla rajaus tulee kannan RLS:stä, ja kaikissa projekteissa on samat toiminnot ja käytännöt.

**Rakennetaan samaan repoon `v2`-haaraan.** Vanha sovellus pysyy tuotannossa `main`-haarassa, kunnes uusi on ajettu rinnakkain. Vanha koodi siirretään `v2`:ssa `legacy/`-kansioon, koska laskentasäännöt luetaan sieltä ja vertailu tehdään sitä vasten.

**Oma Supabase-projekti.** Nykyinen `skog`-projekti on yhteinen Kasamasterin ja adepta-ppr:n kanssa, ja 3.9.2026 huomattiin, että yhden sovelluksen julkinen avain avasi naapurien tiedot (Mittarilukeman DECISIONS 24.9.2026). Asiakkaiden verotiedot kuuluvat omaan projektiin. Alue eu-central-1 kuten nykyinen.

**Taulut englanniksi etuliitteellä `sk_`.** Sama käytäntö kuin eRapussa (`er_`) ja Mittarilukemassa (`ml_`). Vanhan kannan suomenkieliset nimet muunnetaan tiedonsiirrossa.

**Roolit `owner` ja `staff`.** Vastaavat vanhan sovelluksen pääkäyttäjää ja kirjanpitäjää. Kirjanpitäjä näkee vain asiakkaat, joiden vastuukirjanpitäjä hän on, kuten vanhassa asiakaslistassa.

**Push vain luvalla.** `brief.md`:n sessiosääntö ("commit and push") korvautuu tällä: push `main`-haaraan julkaisee tuotantoon.

**Runko kopioidaan Mittarilukemasta, ei eRapusta.** Mittarilukemassa on eRapun runko ja lisäksi ohjeet ja ohjekartta. Kopioinnissa `ml_` muuttui `sk_`:ksi, ja vesihuoltoon liittyvä jäi pois.

**Oma kanta pingataan SQL:llä.** Uusi sovellus ei käytä supabase-js:ää eikä anon-avainta, joten ping tehdään kantakerroksen kautta (`select 1`). Kasamaster pingataan edelleen sen omalla anon-avaimella.

**Vercelin alue fra1.** Kanta on Frankfurtissa (eu-central-1), joten funktiot ajetaan samassa paikassa.

**Kehitystoiveet myöhemmin.** Mittarilukeman kehitystoiveet vaativat oman taulunsa ja sivunsa. Linkki poistettiin sivun yläkulmasta, kunnes ne tuodaan (PLAN vaihe 3).

**Luokat koodissa, ei kannassa.** Kirjauksen luokka on tunnus (`standing_sale` jne.), ja luokat oletusverokantoineen ovat tiedostossa `src/lib/tax/rules.ts`. Luokkia on vähän ja ne muuttuvat harvoin, ja vanhan sovelluksen nimet ovat samassa listassa tiedonsiirtoa varten.

**Verovuosi tulee kirjauksen päivästä.** Metsätalouden verovuosi on kalenterivuosi, joten `tax_year` on päivästä laskettu sarake. Vanhassa kannassa vuosi oli erillinen kenttä; ristiriitaiset rivit jätetään tuonnissa pois ja listataan.

**Suljetun vuoden lukitus kannassa.** Triggeri estää suljetun vuoden kirjausten, poistojen ja metsävähennysten lisäämisen, muuttamisen ja poistamisen, myös kirjauksen siirron vuodelta toiselle. Vanhassa sovelluksessa lukitus oli vain käyttöliittymässä.

**Asiakastaulun säännöt ilman apufunktiota.** `sk_can_access_client` ei näe samassa lauseessa lisättyä riviä, jolloin `insert ... returning` kaatui. Asiakastaulun säännöt lukevat siksi rivin omat sarakkeet; alaiset taulut käyttävät funktiota.

**Tiedonsiirron säännöt.** Vanhan sovelluksen lukija-rooli ei siirry (uudessa ei ole lukuroolia). Avointa vuotta aiemmat vuodet tuodaan suljettuina, koska vanhassa sovelluksessa vain avointa vuotta pystyi muokkaamaan. Myydyn investoinnin myyntipäivää ei ollut, joten se asetetaan viimeisen poistovuoden loppuun. Metsätilan "käytetty ennen ohjelmaa" on vanhan kentän ja ohjelmassa kirjattujen vähennysten erotus. Tositteet tallennetaan ennen transaktion loppua, jotta epäonnistunut tallennus perii rivit.

**Tiedostot palvelimen kautta.** Storage-ämpärille ei anneta käyttäjäkohtaisia sääntöjä. Palvelin tarkistaa oikeuden `sk_documents`-rivin kautta RLS:llä ja käyttää Storagea service role -avaimella, joka ei päädy selaimeen.

**Tuonnin ulkopuolelle jäävät kentät.** Vanhan kannan `henkilotunnus_hash` jätetään pois, koska henkilötunnuksia ei käsitellä. `alv_numero`, `metsämaa_ha` sekä kirjauksen ja investoinnin `metsatila_id` jäävät toistaiseksi pois, koska uudessa mallissa niille ei vielä ole kenttää; ne lisätään, jos kirjanpitäjä tarvitsee niitä (PLAN vaihe 2).

**Vanhan kannan lukukäyttäjä.** Tuonti lukee vanhaa kantaa käyttäjällä `skog_lukija`, jolla on vain lukuoikeus Skogin tauluihin. `postgres`-salasanaa ei tarvita eikä nollata, koska sama projekti on Kasamasterin ja adepta-ppr:n käytössä.

**Asiakasta ei poisteta, se arkistoidaan.** Kirjanpitoaineisto on säilytettävä, joten pääkäyttäjä voi vain arkistoida asiakkaan. Arkistoitu piiloutuu listasta, ja sen näkee erillisellä linkillä.

**Uudelle asiakkaalle avataan kuluva verovuosi heti.** Muuten kirjanpitoon ei voisi kirjata ennen kuin vuosi avataan erikseen.

**Kirjaus lomakkeella rivi kerrallaan.** Vanha sovellus tallensi koko vuoden kerralla poistamalla ja kirjoittamalla rivit uudelleen, jolloin loki ja tositteiden linkit katosivat. Uudessa jokainen kirjaus tallennetaan erikseen. Taulukkosyöttö voidaan lisätä myöhemmin (PLAN vaihe 4).

**Investointi syntyy hankintakirjauksesta.** Kun luokka on Käyttöomaisuuden hankinta, ohjelma luo investoinnin kirjauksen summalla ja päivällä. Hankinnan poisto poistaa investoinnin vain, jos sillä ei ole poistoja. Myyntikirjaus merkitsee investoinnin myydyksi, ja myynnin poisto palauttaa sen.

**Tositteet vain PDF:nä tai kuvana, enintään 4 Mt.** Raja tulee Vercelin pyynnön koosta (4,5 Mt). Suljetun vuoden tositetta ei voi poistaa, koska kirjanpitoaineisto on säilytettävä.

**Verolaskenta puhtaina funktioina, palvelin laskee uudelleen.** Verosuunnitelman laskuri toimii selaimessa samoilla funktioilla (`src/lib/tax`), mutta vahvistus laskee ja tarkistaa luvut palvelimella uudelleen eikä luota lomakkeen arvoihin.

**Vahvistus korvaa vuoden aiemmat luvut.** Vahvistus poistaa vuoden aiemmat poistot ja metsävähennykset ja kirjoittaa uudet. Suljetulle vuodelle tämä ei onnistu (lukitustriggeri), joten suljettu suunnitelma pysyy sellaisenaan.

**Poistorivi myös nollapoistolle.** Menojäännöspoiston voi jättää tekemättä. Rivi tallennetaan silti, jotta poistamaton arvo siirtyy seuraavan vuoden alkuun ketjuna.

**Raportti pdf-libillä, ei selaimen tulostuksella.** Vanha sovellus teki raportin HTML-sivuna. Uusi tekee PDF:n palvelimella (sama kirjasto kuin Mittarilukeman kirjeissä), jotta arkistoitu raportti on tiedosto, joka ei muutu, vaikka ohjelma muuttuu.

**Arkistoitu raportti syntyy sulkemisen transaktiossa.** Jos raportin teko tai tallennus epäonnistuu, vuosi jää avoimeksi. Uudelleen suljettaessa syntyy uusi versio, ja vanha säilyy. Raportti-välilehden linkki tekee raportin aina nykyisillä luvuilla; virallinen versio on arkistossa.

**Raportti käyttää vahvistettuja lukuja.** Poistot ja metsävähennys tulevat vahvistetusta verosuunnitelmasta, eivät laskurin oletuksista. Jos suunnitelmaa ei ole vahvistettu, raportissa on huomautus.

**Supabase-projekti Irlannissa (eu-west-1), Vercel dub1.** Projekti syntyi Irlantiin eikä Frankfurtiin kuten suunniteltiin. Sama alue kuin Mittarilukemalla, ja se on EU:ssa, joten projektia ei luoda uudelleen. Vercelin funktiot ajetaan samalla alueella (dub1).

**Anon-roolin oikeudet pois (migraatio 0003).** Supabase antaa oletuksena julkiselle anon-roolille oikeudet public-skeeman uusiin tauluihin ja funktioihin. Skog ei käytä julkista avainta, joten oikeudet poistetaan, ja migraatiokirjanpitoon laitetaan RLS.

## 2026-09-27

**Kehitystoiveet Mittarilukemasta (0005).** Taulu `sk_feature_requests`, sivut `/kehitystoiveet` ja linkki sivun yläkulmaan Ohje-linkin viereen. Toive kohdistetaan toimintoon, joka on sama kuin ohjesivuston aihe, kuten Mittarilukemassa. Migraation numero on 0005, koska 0004 on varattu toiselle työlle.

**Kehitystoiveen tilaa muuttaa vain pääkäyttäjä.** Mittarilukemassa käsittelijöitä ovat pääkäyttäjä ja toimisto. Skogissa kirjanpitäjä on tavallinen käyttäjä, joten hän jättää ja näkee toiveet mutta ei merkitse toisen toivetta tehdyksi. Rajaus on kannassa (RLS), ei vain käyttöliittymässä.

**Kehitystoiveista ei lähetetä ilmoituksia.** Mittarilukemassakaan ei ole sähköposti-ilmoituksia; pääkäyttäjä seuraa listaa. Ilmoitus lisätään sähköpostimoduulin kautta, jos tarvetta tulee.
