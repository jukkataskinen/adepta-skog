# Verohallinnon rajapinnat ja Skog – muistio

Päivitetty 28.9.2026. Lähteet luettu vero.fi:stä, ilmoitin.fi:stä ja suomi.fi:stä. Mihinkään palveluun ei kirjauduttu.

## Yhteenveto

- Verohallinnolla on kaksi rajapintaa: **ApitamoPKI** (SOAP, tiedostomuotoiset ilmoitukset, ei reaaliaikaisia vastauksia) ja **Vero API** (REST/JSON, reaaliaikainen).
- **2C-metsäveroilmoitus kulkee vain tiedostona** (tietovirta VSY02C, tunnus-tietopari-teksti). Sen voi lähettää Ilmoitin.fi:ssä käsin tai ApitamoPKI:llä koneellisesti. Vero API:ssa ei ole tuloveroilmoituksia.
- **Metsänomistajan alv-ilmoitus** onnistuu Vero API:lla ("Lähetä arvonlisäveroilmoitus") tai tiedostona (VSRALVKV). Vero API vaatii asiakkaalta Suomi.fi-valtuuden tilitoimistolle.
- **Lomake 9 (kiinteistön/metsän luovutusvoitto), henkilön lisäennakko ja puukauppatietojen haku** eivät ole missään rajapinnassa. Ne hoidetaan OmaVerossa.
- Verotilin saldo, tapahtumat, viitenumerot ja kirjeet ovat Vero API:ssa, mutta todennäköisesti vain Y-tunnuksellisille asiakkaille.
- **Henkilötunnus on pakollinen**: 2C:n tunnisteen (kenttä 010) pitää olla henkilötunnus tai Y-tunnus. Henkilöasiakkaalla ilman Y-tunnusta se on henkilötunnus. Alv-ilmoitukseen riittää Y-tunnus.
- Tunnistautuminen tapahtuu Verohallinnon varmennepalvelun antamalla organisaatiovarmenteella, joka on voimassa 2 vuotta. Vero API tarvitsee lisäksi ohjelmistokohtaisen API-avaimen ja hyväksymistestauksen. Kuluista ei mainita mitään.
- **Suositus**: ensin 2C-tiedosto, jonka tilitoimisto lataa itse Ilmoitin.fi:hin (noin 1–2 viikkoa). Sen jälkeen alv-ilmoitus Vero API:lla (noin 3–5 viikkoa). ApitamoPKI-automaatio 2C:lle myöhemmin, jos määrät kasvavat.
- **Suurin riski on henkilötunnus.** Skog joutuu käsittelemään henkilötunnuksia, jos se tuottaa 2C:n henkilöasiakkaille. Pienin vaikutus syntyy, kun henkilötunnus annetaan vain tiedostoa muodostettaessa eikä sitä tallenneta.

---

## 1. Mitä rajapintojen kautta voi lähettää tai hakea (Skogin käyttötapaus)

| Asia | Rajapinta / kanava | Tila | Varmuus |
|---|---|---|---|
| Metsätalouden veroilmoitus 2C | Tietovirta **VSY02C**: Ilmoitin.fi (tiedoston lataus) tai ApitamoPKI | On nyt. Tietuekuvaus verovuodelle 2026 julkaistu 22.9.2026 (v1.0) | varma |
| 2C:n kanssa samassa tiedostossa | Liitteet 2, 2Y, 5, 7K ja **7L** (vuokratulot, myös metsämaa) | Sallitut yhdistelmät, taulukko 2026 | varma |
| Metsävähennys, poistot, varaukset | Eivät ole erillisiä liitteitä vaan 2C:n kenttiä: metsävähennys 615/655–720, poistot 642–644 ja 660–694, meno- ja tuhovaraukset 616–617 ja 637–851 | Tietuekuvauksessa | varma |
| Hankintatyö | 2C:n osatietoryhmä 700–706, jossa **hankintatyön tekijän henkilötunnus** (701) on pakollinen, jos määrät annetaan | Tietuekuvauksessa | varma |
| Lomake 9 (muun omaisuuden, esim. metsätilan, luovutusvoitto) | Ei ole sähköisissä tietovirroissa. Vain 9A (arvopaperit) on | Vain OmaVero tai paperi | todennäköinen |
| Verotusyhtymä (metsäyhtymä) | Yhtymä antaa 2C:n omalla Y-tunnuksellaan. Lomake 36 (yhtymäselvitys) on myös tietovirtana (VSY036) | On nyt | todennäköinen |
| Kuolinpesä | 2C kuolinpesän nimissä. Tunniste on Y-tunnus, jos sellainen on, muuten vainajan henkilötunnus | On nyt | todennäköinen |
| Arvonlisäveroilmoitus (oma-aloitteiset verot, kalenterivuoden verokausi) | **Vero API**: "Lähetä arvonlisäveroilmoitus", "Hae annettu arvonlisäveroilmoitus", "Hae arvonlisäveron kaudet". Tiedostona **VSRALVKV** (Ilmoitin.fi tai ApitamoPKI) | On nyt | varma |
| Oma-aloitteisten verojen viitetiedot | Tiedostokysely **VSGVIITE** (ApitamoPKI). Vero API:ssa "Verolajikohtaisten viitenumeroiden kysely" | On nyt | varma |
| Verotilin saldo ja tapahtumat | Vero API "Maksutiedot": saldokysely ja tapahtumahaku, vaatii Suomi.fi-valtuuden | On nyt. Toimiiko henkilöasiakkaalle, on epävarmaa | epävarma |
| Verotuspäätökset ja kirjeet | Vero API "Kirjeet ja päätökset": kirjeiden ja selvityspyyntöjen haku ja niihin vastaaminen | On nyt, henkilöasiakkaiden osalta epävarma | epävarma |
| Ennakkovero / lisäennakko | Vero API:ssa ja tietovirrassa VSYENN vain **yhteisön** ennakkovero. Henkilön lisäennakko tai ennakon muutos ei ole rajapinnassa | Vain OmaVero | todennäköinen |
| Puukauppatiedot (puun ostajien vuosi-ilmoitukset) | **VSPUERIE/VSPUVYHT** on vain ostajan lähetettäviä tietovirtoja. Hakurajapintaa metsänomistajalle tai tilitoimistolle ei ole. Tiedot näkyvät esitäytettyinä OmaVerossa | Ei haettavissa | todennäköinen |
| Alv-velvollisuuden tarkistus (esim. puun ostaja tai myyjä) | Tiedostokysely VSALVTAR ja Vero API "Veronumerorekisterin/rekisteröintitietojen kysely" | On nyt | varma |

Lähteet:
- https://www.ilmoitin.fi/webtamo/sivut/IlmoituslajiRoolit (tietovirtaluettelo, roolit)
- https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2026_2c.pdf
- https://www.vero.fi/tietoa-verohallinnosta/kehittaja/tietuekuvaukse/tietuekuvaukset__tuloveroilmoitu/ (sallitut lomakeyhdistelmät, xlsx)
- https://www.vero.fi/tietoa-verohallinnosta/kehittaja/vero-api/
- https://www.vero.fi/henkiloasiakkaat/omaisuus/metsa/metsatalouden-veroilmoitus/
- https://www.vero.fi/henkiloasiakkaat/omaisuus/metsa/mets%C3%A4nomistajan-arvonlis%C3%A4veroilmoitus/

## 2. Tekniikka

**ApitamoPKI** (varma)
- SOAP ja WSDL. Kaksi operaatiota: SendOperation (lähetys) ja RetrievalOperation (vastauksen nouto). Tiedosto kulkee MTOM-liitteenä. Isoissa aineistoissa on taustakäsittely ja noutotunniste (ResultId).
- Rajapinta ei anna reaaliaikaista vastausta vaan tarkistusraportin. Verohallinto ei allekirjoita vastauksia.
- Tiedostomuoto on tietuekuvauksen mukainen **tunnus-tietopari-tekstitiedosto**. Perinteisten ilmoitusten merkistö on ISO-8859-1. Esimerkiksi 2C:ssä `000:VSY02C26`, aikaleima 198, ohjelmiston tiedot 048/014, tunniste 010 ja loppumerkki 999. Tarkistussäännöt (#-numerot) on kuvattu tietuekuvauksessa.
- Yleiset säännöt ovat dokumentissa "Sähköisen ilmoittamisen yleiskuvaus" (27.12.2024). Korjaus tehdään lähettämällä päälomake ja korjatut liitteet kokonaan uudelleen.
- Testiympäristö: `https://apitesti.ilmoitin.fi/wsapp/apitamopki` (WSDL `?wsdl`). Samaa tiedostoa voi testata ilman rajapintaa Ilmoitin.fi:n "Aineiston tarkastus" -toiminnolla.
- Tunnistautuminen tapahtuu asiakasvarmenteella. Testivarmenteen myöntää "Test Data Providers Issuing CA", tuotantovarmenteen "Data Providers Issuing CA".
- Lähteet: https://www.vero.fi/tietoa-verohallinnosta/kehittaja/apitamopki/apitamopkin-tekniset-ohjeet/ , https://www.vero.fi/tietoa-verohallinnosta/kehittaja/apitamopki/toteuta-ja-testaa/

**Vero API** (varma)
- REST/JSON. Vaatii käyttäjäkohtaisen varmenteen ja ohjelmistokohtaisen API-avaimen (otsake `vero-softwarekey`).
- Kokeiluun on hiekkalaatikko (api-sandbox / api-developer.vero.fi) ja käyttöönottoon portaali apiportal.vero.fi. Kehittäjä rekisteröityy portaaliin sähköpostilla ilman Suomi.fi-tunnistusta.
- Organisaatiolla pitää olla voimassa oleva Vero API -rajapintasopimus.
- Tuotantokäyttö edellyttää 20.11.2023 alkaen **hyväksymistestausta**. Se tehdään omatoimisesti portaalissa testiskenaarioilla ja tuotantovarmenteella, ja hyväksyntä tulee automaattisesti.
- Lähteet: https://www.vero.fi/tietoa-verohallinnosta/kehittaja/vero-api/miten-rajapinnat-otetaan-kayttoon/ , https://www.vero.fi/tietoa-verohallinnosta/kehittaja/vero-api/ohjelmiston-rekister%C3%B6inti/

**Varmenne ("Tamo-PKI" / tiedontuottajan varmenne)** (varma, paitsi kulut)
- Varmenne haetaan Verohallinnon varmennepalvelusta organisaation nimiin (Y-tunnus). Hakija tunnistautuu pankkitunnuksilla, mobiilivarmenteella tai varmennekortilla.
- Ensin tehdään rajapintahakemus (ApitamoPKI ja/tai Vero API) ja nimetään tekninen yhteyshenkilö. Hän saa noutotiedot, ja varmenne on noudettava 14 vuorokauden kuluessa.
- Test- ja tuotantovarmenne haetaan erikseen. Testivarmenteeseen ei tarvita Suomi.fi-valtuutta. Tuotantovarmenteeseen se voidaan tarvita, jos hakija toimii toisen organisaation puolesta.
- Varmenne on voimassa 2 vuotta, minkä jälkeen se uusitaan.
- Jos ohjelmistotoimittaja hoitaa varmenteen asiakkaan puolesta, niiden välillä pitää olla käyttöehtojen mukainen palvelusopimus.
- Kuluista sivuilla ei mainita mitään. Varmenne on todennäköisesti maksuton (epävarma).
- Lähteet: https://www.vero.fi/tietoa-verohallinnosta/kehittaja/varmennepalvelu/ , https://www.vero.fi/tietoa-verohallinnosta/kehittaja/varmennepalvelu/tuotantovarmenteet/

## 3. Valtuutus: tilitoimisto asiakkaiden puolesta

- **ApitamoPKI (esim. 2C ja alv tiedostona)**: taulukossa sanotaan "Varmenne riittää valtuudeksi – ei valtuustarkistusta". Tilitoimiston varmenteella voi siis lähettää asiakkaiden ilmoituksia. Ehtona on osapuolten välinen sopimus, kuten "jos tästä on sopimus osapuolten kesken". Varmuus: varma. Lähde: https://www.vero.fi/tietoa-verohallinnosta/kehittaja/apitamopki/siirry-tuotantoon/ ja Ilmoitin.fi-roolitaulukko.
- **Ilmoitin.fi käsin**: tilitoimiston työntekijä kirjautuu henkilökohtaisilla tunnuksilla. Hänellä pitää olla asiakkaalta Suomi.fi-valtuus "Veroasioiden hoito" tai "Veroilmoittaminen", tai rooli "Henkilöasiakas" (oma ilmoitus). Valtuus tarkistetaan kentästä 010. Varmuus: varma.
- **Vero API (alv, saldot, kirjeet)**: asiakkaan on annettava tilitoimistolle Suomi.fi-valtuus. Ohjelma hakee valtuus-tokenin ("Hae Suomi.fi valtuus-token"). Kitsaksen ohjeen mukaan tarvittava valtuusasia on "Veroasioiden hoito". Varmuus: todennäköinen. Lähteet: https://www.vero.fi/tietoa-verohallinnosta/kehittaja/vero-api/suomi.fi-valtuuden-kaytto , https://kitsas.fi/docs/toimisto/varmenne/
- **"Veroasioiden hoito" -valtuus kattaa henkilöasiakkaan** henkilökohtaiset veroasiat ja yksityisen elinkeinonharjoittajan kaikki veroasiat. Henkilö voi valtuuttaa yrityksen. Varmuus: varma. Lähde: https://www.suomi.fi/valtuudet/valtuusasiat/veroasioiden-hoito/724d970a56a51149e902a40e3f7c12f5
- **Kuolinpesä**: kuolinpesää ilman Y-tunnusta ei voi valtuuttaa Suomi.fi:ssä. Sähköinen asiointi vaatii Y-tunnuksen ja valtuuden. Muuten käytetään Verohallinnon valtakirjaa (lomake 3630), ja **verotusyhtymälle** lomaketta 3810. ApitamoPKI:n varmennetie ei tarkista valtuuksia, joten 2C:n voi lähettää sitä kautta. Varmuus: todennäköinen. Lähteet: https://www.suomi.fi/ohjeet-ja-tuki/valtuudet/henkilon-puolesta-asiointi/kuolinpesan-puolesta-asiointi , https://www.vero.fi/tietoa-verohallinnosta/yhteystiedot-ja-asiointi/lomakkeet/kuvaus/valtakirja-verotusyhtyman-veroasioita-varten-3810/
- **Epäselvää**: Vero API:n dokumentaatio puhuu vain organisaatioiden puolesta asioinnista. Toimiiko alv-ilmoitus, kun valtuuttaja on Y-tunnuksellinen luonnollinen henkilö (alv-rekisteröity metsänomistaja)? Tämä pitää varmistaa API-portaalista tai hiekkalaatikosta. Varmuus: epävarma.

## 4. Mitä on nyt, mitä tulossa, mitä vain OmaVerossa

| Nyt rajapinnassa | Vain OmaVero / paperi | Tulossa |
|---|---|---|
| 2C (+2, 2Y, 5, 7K, 7L) tiedostona; tietuekuvaus 2026 julkaistu 22.9.2026 | Lomake 9 (metsätilan luovutusvoitto) | Vero API:n suunnitteilla olevat rajapinnat näkyvät hiekkalaatikossa, mutta niiden käyttöönotosta "ei ole tehty päätöstä" |
| Alv-ilmoitus (Vero API ja VSRALVKV) | Henkilön ennakkoveron muutos ja lisäennakko | Tuloveroilmoituksia Vero API:iin ei ole ilmoitettu |
| Viitetiedot, saldot, kirjeet (Vero API, valtuus) | Esitäytetyt puukauppatiedot | Liitteet siirtyvät erilliseen "Send Attachment File" -rajapintaan 17.11.2025 alkaen |
| Alv-velvollisuuden ja ennakkoperintärekisterin kyselyt | Määräajan pidennys | |

- 2C:n määräajat verovuodelta 2025: 2.3.2026 (henkilöt, yhtymät, kuolinpesät) ja 1.4.2026, jos asiakkaalla on myös maa- tai liiketoimintaa. OmaVero avautui 13.1.2026. Alv-ilmoitus kalenterivuoden verokaudelta: 2.3.2026. Varmuus: varma.
- Kehittäjien vuosikello: https://www.vero.fi/tietoa-verohallinnosta/kehittaja/aikataulu-2026/ (sisältöä ei saatu luettua). Varmuus: epävarma.

## 5. Suositus Skogille

**Vaihe 1: 2C-tiedosto Ilmoitin.fi:hin (1–2 viikkoa).**
- Skog muodostaa VSY02C-tiedoston asiakaskohtaisesti tai useasta asiakkaasta kerralla, ja mukaan tarvittaessa 7L.
- Tilitoimisto lataa tiedoston itse Ilmoitin.fi:hin ja tarkistaa sen siellä ensin "Aineiston tarkastus" -toiminnolla.
- Varmennetta, sopimusta tai hyväksymistestausta ei tarvita. Työntekijä tarvitsee asiakkailta Suomi.fi-valtuuden tai valtakirjan.
- Tarkistussäännöt (esim. #819 metsävähennys enintään 60 %, #820 vähintään 1500 €, #1992–1994 menojäännökset) kannattaa toteuttaa Skogiin, jolloin virheet näkyvät jo ennen lähetystä.

**Vaihe 2: alv-ilmoitus Vero API:lla (3–5 viikkoa).**
- Työ sisältää REST-asiakkaan, varmenteen käsittelyn palvelimella, API-avaimen, Suomi.fi-tokenin ja hyväksymistestauksen.
- Alv-ilmoitukseen riittää Y-tunnus, joten henkilötunnusongelmaa ei ole.
- Saman kokonaisuuden jatkoksi sopivat saldo- ja viitenumerokyselyt.
- Vaihtoehto: VSRALVKV-tiedosto Ilmoitin.fi:hin samaan tapaan kuin 2C, arviolta 3–5 päivää.

**Vaihe 3 (valinnainen): ApitamoPKI-lähetys 2C:lle ja alv:lle (2–3 viikkoa).**
- Kannattaa vasta, kun asiakkaita on satoja.
- Sisältää SOAP/MTOM-toteutuksen, vastausten noudon ja palautteen näyttämisen käyttäjälle.

**Mitä Jukan pitää tehdä**
1. Varmennepalvelussa: rajapintahakemus (ApitamoPKI ja/tai Vero API) ja testivarmenne organisaation nimiin. Kirjautuminen omilla pankkitunnuksilla, ja Jukalla pitää olla Y-tunnuksen edustusoikeus.
2. Vero API -portaalissa: kehittäjärekisteröinti, ohjelmiston rekisteröinti ja API-avain. Vero API -rajapintasopimus tai käyttöehtojen hyväksyntä.
3. Jos Skog lähettää tilitoimistojen puolesta: palvelusopimus tilitoimistojen kanssa. Vaihtoehtoisesti kukin tilitoimisto hakee oman varmenteensa ja Skog käyttää sitä.
4. Tuotantovarmenne ja hyväksymistestaus ennen käyttöönottoa. Varmenteen uusiminen 2 vuoden välein kalenteriin.

**Riskit**
- **Henkilötunnus (suurin riski)**: 2C:n kenttä 010 on henkilötunnus tai Y-tunnus. Alv-rekisteröimättömillä henkilöasiakkailla ja Y-tunnuksettomilla kuolinpesillä (vainajan tunnus) se on henkilötunnus. Hankintatyön tekijän henkilötunnus (701) on lisäksi pakollinen, jos hankintatyö eritellään. Varmuus: varma. Vaihtoehdot:
  a) Henkilötunnus syötetään vain tiedostoa muodostettaessa. Sitä ei tallenneta, se ei näy lokeissa ja tiedosto ladataan suoraan käyttäjälle. Pienin vaikutus, mutta henkilötunnus syötetään joka vuosi uudelleen.
  b) Henkilötunnus tallennetaan salattuna omaan sarakkeeseen, sen katselu on rajattu ja kirjautuu lokiin. Tämä vaatii tietosuojaselosteen päivityksen ja vaikutustenarvioinnin.
  c) Skog tuottaa vain luvut, ja tilitoimisto syöttää ne OmaVeroon käsin. Ei henkilötunnusta, mutta ei myöskään automaatiota.
  Suositus: aloita vaihtoehdosta a. Alv-ilmoitus (Y-tunnus) ei vaadi päätöstä.
- **Valtuudet**: kuolinpesät ja yhtymät ilman Suomi.fi-valtuutta hidastavat Ilmoitin.fi:n käsinlatausta. ApitamoPKI ohittaa valtuustarkistuksen, mutta silloin sopimus- ja vastuukysymykset jäävät Skogin ja tilitoimiston väliin.
- **Vuosimuutokset**: tietuekuvaus julkaistaan joka syyskuu (2026 v1.0, 22.9.2026), ja tunnus-arvot päivitetään vuosittain.
- **Kattavuus**: lomake 9 ja lisäennakko jäävät käsityöksi OmaVeroon. Puukauppatietoja ei voi hakea rajapinnasta, vaan ne kirjataan tositteilta.
- **Tuotantovarmenne on arkaluonteinen**: sen yksityinen avain pitää säilyttää palvelimen salaisuutena. Se ei saa päätyä gittiin tai lokeihin.
