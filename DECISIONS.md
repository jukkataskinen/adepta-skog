# Skog – DECISIONS

## 2026-09-26

**Uudelleenrakennus eRapun ja Mittarilukeman pohjalle.** Vanha sovellus käyttää service role -avainta, joten organisaatiorajaus on jokaisen reitin varassa, ja se oli unohtunut tapahtumista, arkistosta ja investoinneista. Osa sivuista käyttää kantaa suoraan selaimesta anon-avaimella. Yhteisellä pohjalla rajaus tulee kannan RLS:stä, ja kaikissa projekteissa on samat toiminnot ja käytännöt.

**Rakennetaan samaan repoon `v2`-haaraan.** Vanha sovellus pysyy tuotannossa `main`-haarassa, kunnes uusi on ajettu rinnakkain. Vanha koodi siirretään `v2`:ssa `legacy/`-kansioon, koska laskentasäännöt luetaan sieltä ja vertailu tehdään sitä vasten.

**Oma Supabase-projekti.** Nykyinen `skog`-projekti on yhteinen Kasamasterin ja adepta-ppr:n kanssa, ja 3.9.2026 huomattiin, että yhden sovelluksen julkinen avain avasi naapurien tiedot (Mittarilukeman DECISIONS 24.9.2026). Asiakkaiden verotiedot kuuluvat omaan projektiin. Alue eu-central-1 kuten nykyinen (korvattu: eu-west-1, ks. alempana).

**Taulut englanniksi etuliitteellä `sk_`.** Sama käytäntö kuin eRapussa (`er_`) ja Mittarilukemassa (`ml_`). Vanhan kannan suomenkieliset nimet muunnetaan tiedonsiirrossa.

**Roolit `owner` ja `staff`.** Vastaavat vanhan sovelluksen pääkäyttäjää ja kirjanpitäjää. Kirjanpitäjä näkee vain asiakkaat, joiden vastuukirjanpitäjä hän on, kuten vanhassa asiakaslistassa.

**Push vain luvalla.** `brief.md`:n sessiosääntö ("commit and push") korvautuu tällä: push `main`-haaraan julkaisee tuotantoon.

**Runko kopioidaan Mittarilukemasta, ei eRapusta.** Mittarilukemassa on eRapun runko ja lisäksi ohjeet ja ohjekartta. Kopioinnissa `ml_` muuttui `sk_`:ksi, ja vesihuoltoon liittyvä jäi pois.

**Oma kanta pingataan SQL:llä.** Uusi sovellus ei käytä supabase-js:ää eikä anon-avainta, joten ping tehdään kantakerroksen kautta (`select 1`). Kasamaster pingataan edelleen sen omalla anon-avaimella.

**Vercelin alue fra1.** Kanta on Frankfurtissa (eu-central-1), joten funktiot ajetaan samassa paikassa. (Korvattu: dub1, ks. alempana.)

**Kehitystoiveet myöhemmin.** Mittarilukeman kehitystoiveet vaativat oman taulunsa ja sivunsa. Linkki poistettiin sivun yläkulmasta, kunnes ne tuodaan (PLAN vaihe 3).

**Luokat koodissa, ei kannassa.** Kirjauksen luokka on tunnus (`standing_sale` jne.), ja luokat oletusverokantoineen ovat tiedostossa `src/lib/tax/rules.ts`. Luokkia on vähän ja ne muuttuvat harvoin, ja vanhan sovelluksen nimet ovat samassa listassa tiedonsiirtoa varten.

**Verovuosi tulee kirjauksen päivästä.** Metsätalouden verovuosi on kalenterivuosi, joten `tax_year` on päivästä laskettu sarake. Vanhassa kannassa vuosi oli erillinen kenttä; ristiriitaiset rivit jätetään tuonnissa pois ja listataan.

**Suljetun vuoden lukitus kannassa.** Triggeri estää suljetun vuoden kirjausten, poistojen ja metsävähennysten lisäämisen, muuttamisen ja poistamisen, myös kirjauksen siirron vuodelta toiselle. Vanhassa sovelluksessa lukitus oli vain käyttöliittymässä.

**Asiakastaulun säännöt ilman apufunktiota.** `sk_can_access_client` ei näe samassa lauseessa lisättyä riviä, jolloin `insert ... returning` kaatui. Asiakastaulun säännöt lukevat siksi rivin omat sarakkeet; alaiset taulut käyttävät funktiota.

**Tiedonsiirron säännöt.** Vanhan sovelluksen lukija-rooli ei siirry (uudessa ei ole lukuroolia). Avointa vuotta aiemmat vuodet tuodaan suljettuina, koska vanhassa sovelluksessa vain avointa vuotta pystyi muokkaamaan. Myydyn investoinnin myyntipäivää ei ollut, joten se asetetaan viimeisen poistovuoden loppuun. Metsätilan "käytetty ennen ohjelmaa" on vanhan kentän ja ohjelmassa kirjattujen vähennysten erotus. Tositteet tallennetaan ennen transaktion loppua, jotta epäonnistunut tallennus perii rivit.

**Tiedostot palvelimen kautta.** Storage-ämpärille ei anneta käyttäjäkohtaisia sääntöjä. Palvelin tarkistaa oikeuden `sk_documents`-rivin kautta RLS:llä ja käyttää Storagea service role -avaimella, joka ei päädy selaimeen.

**Tuonnin ulkopuolelle jäävät kentät.** Vanhan kannan `henkilotunnus_hash` jätetään pois, koska henkilötunnuksia ei käsitellä. `alv_numero`, `metsämaa_ha` sekä kirjauksen ja investoinnin `metsatila_id` jäivät aluksi pois; ne lisättiin 27.9.2026 (migraatio 0004).

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

**Investoinnin myyntihinta ei ole verolaskelman tuloa.** Investointiin liitetyn myyntikirjauksen summa jätetään verosuunnitelman ja raportin tuloista pois, koska myyntivoitto tai -tappio lasketaan investoinnista. Aiemmin myyntihinta ja myyntivoitto tulivat laskelmaan kahteen kertaan. Kirjanpidon ja arvonlisäveron summissa myynti näkyy edelleen.

**Vertailu vanhaan sovellukseen: vanhan raportin yhteenveto sellaisenaan.** `vertaa:vero` laskee vanhan veroraportin luvut samalla kaavalla kuin legacy/app/veroraportti (poistot uudelleen hankintahinnasta, investoinnit pois tuloista ja menoista), jotta ero kertoo, mitä kirjanpitäjä näki. Tunnetut sääntöerot selitetään automaattisesti, ja muut listataan selvitettäviksi. Tuotantokantojen lukeminen vaatii Jukan ajon tai luvan.

**Tuonnista puuttuneet kentät (migraatio 0004).** Asiakkaan ALV-numero on oma kenttänsä, koska sen voi olla ilman Y-tunnusta. Metsämaan hehtaarit ovat vain tietoa. Kirjauksen ja investoinnin metsätila on vapaaehtoinen, ja tila tarkistetaan saman asiakkaan omaksi triggerillä. Uusintatuonti täydentää tyhjät kentät jo tuotuihin riveihin, mutta suljetun vuoden kirjaukseen tilaa ei lisätä (lukitus).

**Tositteen tiedosto poistetaan transaktion jälkeen.** Rivi poistetaan ensin ja tiedosto vasta tallennuksen jälkeen, jotta epäonnistunut transaktio ei vie tiedostoa. Jos tiedoston poisto epäonnistuu, se kirjataan palvelimen lokiin ilman henkilötietoja eikä näy käyttäjälle virheenä.

**Kehitystoiveet Mittarilukemasta (0005).** Taulu `sk_feature_requests`, sivut `/kehitystoiveet` ja linkki sivun yläkulmaan Ohje-linkin viereen. Toive kohdistetaan toimintoon, joka on sama kuin ohjesivuston aihe, kuten Mittarilukemassa. Migraation numero on 0005, koska 0004 on varattu toiselle työlle.

**Kehitystoiveen tilaa muuttaa vain pääkäyttäjä.** Mittarilukemassa käsittelijöitä ovat pääkäyttäjä ja toimisto. Skogissa kirjanpitäjä on tavallinen käyttäjä, joten hän jättää ja näkee toiveet mutta ei merkitse toisen toivetta tehdyksi. Rajaus on kannassa (RLS), ei vain käyttöliittymässä.

**Kehitystoiveista ei lähetetä ilmoituksia.** Mittarilukemassakaan ei ole sähköposti-ilmoituksia; pääkäyttäjä seuraa listaa. Ilmoitus lisätään sähköpostimoduulin kautta, jos tarvetta tulee.

**Käyttäjää ei poisteta, se poistetaan käytöstä (0006).** Jäsenyysriville tulee `deactivated_at`, ja RLS-funktiot `sk_my_org_ids` ja `sk_has_org_role` ohittavat käytöstä poistetut, joten pääsy katkeaa kaikista säännöistä kerralla. Rivi säilyy, jotta loki ja sulkijatiedot pysyvät, ja käyttäjän voi ottaa takaisin käyttöön.

**Vastuuasiakkaat siirretään käytöstä poiston yhteydessä.** Jos käyttäjä on arkistoimattomien asiakkaiden vastuukirjanpitäjä, käytöstä poisto estetään, kunnes valitaan käytössä oleva kirjanpitäjä, jolle asiakkaat siirtyvät samassa transaktiossa (myös arkistoidut). Muuten asiakkaat jäisivät kirjanpitäjälle, joka ei näe niitä. Käytöstä poistettua ei voi valita vastuukirjanpitäjäksi (triggeri tarkistaa vain vaihtuvan arvon).

**Ei itserekisteröintiä myöskään sovelluksessa.** Kirjautuminen tuntemattomalla osoitteella ei enää luo käyttäjäriviä; käyttäjä ohjataan Ei käyttöoikeutta -sivulle. Käyttäjä syntyy vain pääkäyttäjän lisäyksestä tai skriptistä, joten Auth0:n rekisteröinnin sulkeminen ei ole ainoa suoja.

**Kutsu: Auth0-tunnus ja sähköposti rajapintojen takana.** Kutsu luo tarvittaessa Auth0-tunnuksen (Management API) ja lähettää salasanan asetuslinkin, joka myös varmentaa osoitteen. Sähköposti on Mittarilukeman moduuli (Resend). Molempien oletus on testitila (`AUTH0_ADMIN_MODE=mock`, `EMAIL_MODE=mock`), eikä kumpaakaan ole ajettu oikeaa palvelua vasten.

**Kutsun epäonnistuminen ei peru lisäystä.** Ulkoiset kutsut tehdään transaktion ulkopuolella. Jos viesti ei lähde, käyttäjä jää listaan ja kutsun voi lähettää uudelleen; `invited_at` kertoo viimeisimmän onnistuneen lähetyksen.

**Uusintatuonti korvaa avoimen vuoden vanhan kannan nykytilalla.** Vertailu (27.9.2026) näytti, että vanha sovellus tallentaa vuoden poistamalla ja kirjoittamalla kirjaukset uudelleen uusilla tunnisteilla, jolloin uusintatuonti olisi tuplannut ne. Nyt avoimen vuoden vanhasta tuodut kirjaukset lisätään, päivitetään ja poistetaan vanhan kannan mukaan, ja poistot ja metsävähennykset päivitetään. Uudessa sovelluksessa tehdyt kirjaukset ja suljetut vuodet jäävät ennalleen, ja ohitetut muutokset lasketaan. Jukka hyväksyi poistavan synkronoinnin.

**Verolaskenta Verohallinnon ohjeiden mukaan (Jukan päätös 27.9.2026).** Lähde docs/verosaannot-selvitys-2026-09-27.md. Metsävähennyksen vuosiraja lasketaan veronalaisesta metsätalouden tulosta ennen kuluja ja poistoja, ja siitä vähennetään oman hankintatyön arvo. Prosentti on 60 % vuoteen 2025 ja 75 % vuodesta 2026, ja sama prosentti koskee pohjaa (vanha pohja × 1,25). Poistot ovat vapaaehtoisia menojäännöspoistoja hyödykelajin mukaan (kone 25 %, tie tai oja 15 %, rakennus 10 %), ja enintään 600 euron jäännöksen saa poistaa kerralla. Koneen myyntivoitto tai -tappio on luovutusvoittoa metsätalouden tuloksen ulkopuolella, ja enintään 1 000 euron myynnit ovat verovapaita. Metsätalouden tuloksesta tehdään 5 %:n yrittäjävähennys.

**Vanhat tasapoistot säilyvät vapaaehtoisina.** Vanhasta sovelluksesta tuoduille tasapoistoille lasketaan sama vuosiosuus enimmäismääränä, koska hyödykkeen lajia ei tiedetä. Uusille hankinnoille tasapoistoa ei voi valita. Kirjanpitäjä voi tehdä pienemmän poiston.

**Enintään 600 euron hankinta ohjataan vuosimenoksi.** Kirjaus estetään luokalla Käyttöomaisuuden hankinta ja ohjeistetaan käyttämään Muut vuosimenot. Enintään kolmen vuoden käyttöajan sääntö on ohjeessa, koska käyttöaikaa ei kysytä.

**Metsävähennyksen tilakohtainen jako jää tallennukseen.** Verotuksessa metsät ovat yksi kokonaisuus, mutta vähennys tallennetaan edelleen tiloille vanhin pohja ensin, jotta seuranta pysyy. Tilan myynnin luovutusvoittolisäystä ei vielä lasketa.

**Metsätilan myynti: käytetyn metsävähennyksen lisäys luovutusvoittoon (0007).** Tilalle tallennetaan luovutuspäivä, kauppahinta ja merkintä vastikkeettomasta tai verovapaasta luovutuksesta. Lisäys lasketaan ohjelmassa aina uudelleen eikä sitä tallenneta, jotta se pysyy oikeana, vaikka aiempia vähennyksiä korjattaisiin. Säännöt Verohallinnon ohjeen Metsävähennys luvusta 7: kaikki käytetty vähennys miinus aiemmin lisätty, enintään myydyn metsän vähennysoikeus (60 %, verovuodesta 2027 75 %), myös tappioon, samana vuonna myytyjen kesken vähennysoikeuksien suhteessa, ei samana vuonna hankitulle. Luovutusvoitto lasketaan hankintamenolla tai hankintameno-olettamalla, kumpi on edullisempi, ja se tulee verolaskelmaan luovutusvoittona.

**Metsävähennyspohja on verovelvolliskohtainen.** Verosuunnitelman käyttämätön pohja on omistettujen metsien pohja miinus käytetty vähennys, jota ei ole lisätty luovutusvoittoon. Tilakohtainen jäännös on vain tallennusta varten; jos yhteinen pohja on suurempi kuin tilojen jäännökset, ylimenevä osa kirjataan viimeiselle tilalle.

**Rajaukset.** Määräalan tai määräosan myynti, myyntikulut ja poistamattomien tie- ja ojamenojen lisääminen hankintamenoon eivät vielä ole laskelmassa. Ne mainitaan ohjeessa ja laskurin huomautuksessa.
