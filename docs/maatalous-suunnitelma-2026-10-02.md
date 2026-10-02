# Skog-maatalous: selvitys ja suunnitelma

Laadittu 2.10.2026. Lähteet on luettu samana päivänä (ks. lopun lähdeluettelo). Mihinkään palveluun ei kirjauduttu. Koodia ei ole muutettu. Merkintä **tarkistettava** tarkoittaa tulkintaa, jonka kirjanpitäjän tai Jukan pitää vahvistaa ennen toteutusta.

## Tiivistelmä

- **Lomakkeen nimi on nykyään 2 (Maatalouden veroilmoitus), ei 2A.** Maatalousyhtymällä on oma lomake 2Y. Sähköinen tietovirta on **VSY002** (tietuetunnus `VSY00225` verovuodelle 2025 ja `VSY00226` verovuodelle 2026), ja yhtymällä `VSY02Y26`. Tietuekuvaukset on julkaistu: 2025 v1.0 23.9.2025 ja 2026 v1.0 22.9.2026. Rakenne on sama kuin 2C:ssä (tunnus:tieto-rivit, 000/198/048/014/010 … 999), joten Skogin 2C-muodostin on hyvä malli.
- **Lomakkeet 2 ja 2C saa lähettää samassa tiedostossa** (sallitut lomakeyhdistelmät 2026: lomakkeen 2 liitteiksi kelpaavat 2C, 5, 7L, 9A, 67A, 67Y, 70, 74, 75). Skog voi siis tehdä yhden tiedoston, jossa ovat sekä metsä että maatalous.
- **Lomakkeella 2 ei ole varastoja eikä toimintavarausta.** Maatalouden tulos lasketaan maksuperusteella (tulo maksuvuonna, meno maksuvuonna). Varaukset ovat tasausvaraus ja jälleenhankintavaraus. Lomakkeet 62 ja 18 koskevat elinkeinotoimintaa (EVL), eivät maataloutta.
- **Menot eritellään lomakkeella arvonlisäverokannan mukaan** (ostot 25,5 %, ostot 13,5 % ja 10 %, alv 0 % menot), ja myynnit samoin. Kirjauksen alv-kanta ratkaisee siis suurimman osan kentistä, ja maatalouden luokkia tarvitaan vähemmän kuin luulisi.
- **Arvonlisävero:** sama verovelvollinen, yksi ilmoitus metsälle ja maataloudelle, verokausi kalenterivuosi (alkutuottaja). Alennettu kanta on 14 % vuonna 2025 ja 13,5 % 1.1.2026 alkaen. Alarajahuojennus poistui 1.1.2025.
- **Ehdotettu malli:** kirjauksella on toiminto (metsä tai maatalous), joka tulee luokasta. 0013:n osuus % laajenee kahteen osuuteen (oma toiminto ja toinen toiminto), ja loppu on yksityiskäyttöä. Maatalouden omat tiedot ovat uusissa tauluissa: maatilat, vuoden tiedot (varallisuuslaskelma, puoliso-osuudet, vaatimukset), varaukset, kotieläinten jaksotukset ja investointien vähennykset (tuet, tasausvaraus).
- **MVP:** maatalouden luokat taulukkoon ja lomakkeelle, yhteinen alv, maatalouden poistot ja alkutiedot, vuoden lisätiedot, 2-laskelma raporttiin ja VSY002-tiedosto 2C:n kanssa samaan tiedostoon. Noin 9 tehtävää. Yhtymät (2Y), tasausvarauksen laskuri, tiliotteen sisäänluku ja yritystulon jako verosuunnitelmassa ovat myöhemmin.

Huomio aikataulusta: verovuoden 2025 lomake 2 piti antaa viimeistään 1.4.2026 (yhtymän 2Y 2.3.2026). Jos asiakkaiden vuoden 2025 maatalous on vielä tekemättä, kyse on myöhästyneestä ilmoituksesta tai korjauksesta. Seuraava varsinainen määräpäivä on verovuoden 2026 ilmoitus keväällä 2027. Ks. avoimet kysymykset.

---

## 1. Lomake 2 (Maatalouden veroilmoitus) kentittäin

Lähteet: [TK2-26] ja [TK2-25] (tietuekuvaukset), [OHJE2] (vero.fi:n täyttöohje). Kentän tunnus on tietuekuvauksen tunnus. Tähdellä (*) merkityt ovat tietuekuvauksessa tietoja, jotka saavat olla 0. Muoto R13,2 = rahamäärä, +D3,2 = prosentti.

### 1.1 Tunnistetiedot ja yhteyshenkilö

| Tunnus | Tieto | Huomio |
|---|---|---|
| 000 | Tietuetunnus | `VSY00225` / `VSY00226` |
| 198 | Ohjelmiston aikaleima | kuten 2C |
| 045 | Välityspalvelun tunnus | Ilmoitin.fi lisää (BLOCKERS 9) |
| 048, 014 | Ohjelmisto ja sen yksilöivä tieto | samat kuin 2C: "Adepta Skog 2", `2237131-2_SK` |
| 010 | Verovelvollisen henkilö- tai Y-tunnus | henkilötunnus vain tiedostoon, kuten 2C |
| 967 | Ilmoitettavia tietoja ei ole (1) | lomake on annettava aina, myös ilman toimintaa |
| 041, 044, 042 | Täydentävien tietojen antaja: nimi, sähköposti, puhelin | kuten 2C |

### 1.2 Maatalouden tulot (kaikki maatilat yhteensä, ilman arvonlisäveroa)

| Tunnus | Tieto (2026) | Alv | Esimerkkejä |
|---|---|---|---|
| 210 | Myyntitulot kotieläimistä, ei jaksotetut | 25,5 % | teuraseläimet, eläinten myynti |
| 211 | Jaksotettavat myyntitulot kotieläimistä verovuonna | 25,5 % | jos merkittävä osa eläimistä myydään, tulo voidaan jaksottaa kolmelle vuodelle |
| 212 | Verovuoden tuloksi jaksotetut myyntitulot kotieläimistä (kolmelta vuodelta) | | lasketaan jaksotuksista |
| 213 | Muut myyntitulot | 25,5 % | työkorvaukset (koneurakointi), koneiden vuokrat, metsätalouden sivutulot |
| 214 | Kotieläintuotteiden myyntitulot | 13,5 % (2025: 14 %) | maito, munat |
| 215 | Kasvinviljelytuotteiden myyntitulot | 13,5 % (2025: 14 %) | vilja, nurmi, perunat, puutarhatuotteet |
| 216 | Majoituspalveluiden yms. myyntitulot | 13,5 % (2025: 14 %) | maatilamatkailu |
| 217 | Valtiolta saadut tuet | 0 % | ohjeen esimerkki: pellon metsityksen tulonmenetyskorvaus. **Tarkistettava**, kuuluvatko viljelijätuet (perustulotuki, luonnonhaittakorvaus, ympäristökorvaus) tähän vai 218:aan; OmaVero siirtää maksajien vuosi-ilmoitusten tuet itse "omiin kohtiinsa" |
| 218 | Muut arvonlisäverottomat tuet ja korvaukset | 0 % | ostajien välityksellä saadut tuet, muut kuin valtion tuet, suoraan tuloksi luettavat korvaukset |
| 219 | Tasausvarauksen suora tuloutus | 0 % | aiemman vuoden tasausvaraus, jota ei käytetä investointiin |
| 220 | Muut maatalouden arvonlisäverottomat tulot | 0 % | vahingonkorvaukset sadosta tai eläimistä, rakennusten ja koneiden vuokrat, jälleenhankintavarauksen suora tuloutus, maatalouden arvopapereiden luovutusvoitot |
| 221 | Tuloutus yksityiskäytöstä, jos yksityis- tai metsätalouden menot on vähennetty muistiinpanoissa | | yksityis- ja metsätalouden ajot maatalouden autolla, sähkö, vesi, puhelin |
| 222 | Muut lisäykset | | energiatuotteiden valmisteveron palautus, vuonna 2025 maksettu alarajahuojennus (viimeisen kerran vuodelta 2024) |
| 223 / 224 | Osingot julkisesti noteeratuista yhtiöistä / veronalainen osuus (85 %) | | |
| 321 / 322 | Osingot muista yhtiöistä / veronalainen osuus (75 %) | | |
| 325 / 326 | Ylijäämät julkisesti noteeratuista osuuskunnista / veronalainen osuus | | tietuekuvaus huomauttaa, ettei tällaisia osuuskuntia ollut 2025–2026 (#1990, #2048) |
| 327 / 328 | Ylijäämät muista osuuskunnista / veronalainen osuus | | meijeri- ja teurastamo-osuuskuntien ylijäämät: 25 % veronalaista 5 000 euroon asti (yhteensä kaikista osuuskunnista, henkilökohtainen lievennys), sen yli 75 %; tarkistus #1322: 328 ≥ 25 % × 327 |
| 332 | Tulot yhteensä | | #2045: 210 + 212 + 213 + 214 + 215 + 216 + 217 + 218 + 219 + 220 + 221 + 222 + 224 + 322 + 326 + 328 |

Huom. 211 ei ole summassa, vain 212. Pellon ja metsämaan vuokratulot eivät ole verovuodesta 2025 alkaen maatalouden tuloa vaan henkilökohtaista pääomatuloa (esitäytetty veroilmoitus tai lomake 7L). Maa-ainesten myyntitulot ovat muuta pääomatuloa (50B). Rakennusten, rakennelmien ja koneiden vuokrat ovat edelleen maatalouden tuloa.

### 1.3 Maatalouden menot ja varaukset

Menot ilmoitetaan ilman arvonlisäveroa. Jos maataloudenharjoittaja ei ole arvonlisäverovelvollinen, menot ilmoitetaan arvonlisäverollisina ([OHJE2], kuten 2C:ssä).

| Tunnus | Tieto | Esimerkkejä |
|---|---|---|
| 225 | Palkat (ja sivukulut) | ei puolisolle eikä alle 14-vuotiaalle lapselle maksettua palkkaa; lomitusmaksut eivät ole palkkoja |
| 226 | Vähennyskelpoiset ostot 25,5 % | lannoitteet, siemenet, kotieläimet, polttoaineet, korjaukset, kalusto, jota ei poisteta |
| 227 | Jaksotettavat kotieläinten hankintamenot verovuonna | voidaan jaksottaa kolmelle vuodelle tasaerinä |
| 228 | Verovuoden poistona vähennettävät jaksotetut kotieläinten hankintamenot (kolmelta vuodelta) | |
| 229 | Vähennyskelpoiset ostot 13,5 % ja 10 % (2025: 14 % ja 10 %) | rehut, eläinlääkkeet |
| 230 | Muut arvonlisäverottomat menot 0 % | vuokrat, vakuutukset, kiinteistövero maatalouden rakennuksista, lomitus- ja sijaisapumaksut kunnalle; MYEL-maksut tähän tai 464:ään tai henkilökohtaisesti |
| 231 | Poistot | #1886: = 524 + 525 + 526 + 527 + 511 + 513 + 515 |
| 232 | Verovuodelta tehty tasausvaraus | #2047: vaatii myös 172 |
| 465 | Korkomenot | maatalouteen kohdistuvien velkojen korot |
| 464 | Muut vähennykset | auton käytön ja matkojen lisävähennykset, työhuonevähennys (**tarkistettava**: työhuonevähennys poistuu hallituksen esityksen mukaan; voimassaolo vuodelle 2026), maataloudessa käytetty oma poltto- ja tarvepuu, T&K-lisävähennys |
| 357 | Menot yhteensä | #2046: 225 + 226 + 228 + 229 + 230 + 231 + 232 + 465 + 464 |
| 362 / 363 | Maatalouden tulos / tappio | #1450: 332 − 357; vain toinen nollasta poikkeava (#880) |
| 420 | Pääomatuloista vähennettävän tappion määrä | ≤ 363 (#392) |

### 1.4 Yritystulon jako yrittäjäpuolisoiden kesken

| Tunnus | Tieto |
|---|---|
| 413 / 414 | Osuus nettovarallisuudesta: yrittäjä / puoliso (yhteensä 100 %, #38) |
| 415 / 416 | Työskentely maataloudessa: yrittäjä / puoliso (yhteensä 100 %, #39) |
| 418 | Vaatimus jaettavasta yritystulosta: 1 = pääomatuloa enintään 10 % nettovarallisuudesta, 2 = kokonaan ansiotuloa (ilman vaatimusta 20 %) |

### 1.5 Maatalouden poistot

Rakennukset ja rakennelmat (poistamaton hankintameno). Jokaisella rivillä on neljä luokkaa: rakennukset 10 %, rakennukset 6 %, rakennelmat 20 %, rakennelmat 25 %.

| Rivi | 10 % | 6 % | 20 % | 25 % |
|---|---|---|---|---|
| Poistamaton hankintameno verovuoden alussa | 240 | 245 | 250 | 255 |
| Hankinta- ja perusparannusmenot verovuonna | 241 | 246 | 251 | 256 |
| Vähennetään tasausvaraus | 242 | 247 | 252 | 257 |
| Vähennetään myyntihinnat | 528 | 529 | 530 | 531 |
| Vähennetään korvaukset ja avustukset | 243 | 248 | 253 | 258 |
| Verovuoden poisto | 524 | 525 | 526 | 527 |
| Poistamaton hankintameno verovuoden lopussa | 244 | 249 | 254 | 259 |

Tarkistukset #1424, #1417, #1418, #1419: alku + lisäys − tasausvaraus − myynti − avustus − poisto = loppu.

Muut varallisuuserät (verotuksessa jäljellä oleva menojäännös):

| Rivi | Koneet ja kalusto (enintään 25 %) | Sillat, asfaltointi ym. (enintään 10 %) | Salaojat (enintään 20 %) |
|---|---|---|---|
| Menojäännös verovuoden alussa | 260 | 266 | 272 |
| Hankinta- ja perusparannusmenot | 261 | 267 | 273 |
| Vähennetään tasausvaraus | 262 | 268 | 274 |
| Vähennetään myyntihinnat | 263 | 269 | 275 |
| Vähennetään korvaukset ja avustukset | 264 | 270 | 276 |
| Verovuoden poisto | 511 | 513 | 515 |
| Menojäännös verovuoden lopussa | 265 | 271 | 277 |

Tarkistukset #1451, #1887, #1453 (sama kaava, jos alku + lisäys ≥ vähennykset).

Käyttöön ottamattomat: 279 rakennusten ja 278 koneiden hankintamenot verovuonna, 280 niihin käytetty tasausvaraus. Niistä ei saa tehdä poistoa, mutta ne kuuluvat varallisuuslaskelmaan.

**Vain verovuonna 2025** (poistettu 2026): erittely veronhuojennuspoistoista eli uusien koneiden korotetuista 50 %:n poistoista (käyttöön 2020–2025): 364 aiempien vuosien kone- ja laiteinvestoinnit, 365 niistä tehdyt poistot, 366 jäljellä oleva poistopohja (364 − 365), 367 verovuoden poisto niistä, 581 investoinnit verovuonna, 368 poisto niistä, 584 yhteensä (367 + 368). Korotettu poisto on oma poistokohteensa. Vuodesta 2026 koneiden enimmäispoisto on taas 25 % (**tarkistettava**, miten korotetun kohteen menojäännös yhdistyy vuonna 2026 tavalliseen koneiden menojäännökseen; tietuekuvaus 2026 ei enää erottele sitä).

Enimmäisprosentit ([TULOT-MENOT]): tuotantorakennukset 10 %, asuin- ja toimistorakennukset 6 %, kasvihuone ja vastaava rakennelma 20 %, ympäristönsuojeluun liittyvä rakennelma 25 %, koneet ja kalusto 25 % (uudet, 2020–2025 käyttöön otetut 50 %), omassa viljelyssä olevien peltojen salaojat 20 %, sillat, padot, kaivot ja asfaltointi 10 %. Vuokralle annetun pellon salaojat poistetaan tasapoistoina vuokratulon puolella (7L), ei lomakkeella 2.

Pienet erät: koneiden ja kaluston menojäännös enintään 1 200 euroa saa vähentää kerralla, rakennuksissa raja on 1 000 euroa. Poistoina vähennetään hyödykkeet, joiden käyttöaika on yli 3 vuotta tai hankintahinta yli 1 200 euroa ([OHJE2]). **Poikkeaa metsätaloudesta** (TVL:n 600 euroa, DECISIONS 27.9.2026), joten raja on toiminnon mukainen.

Rakennuksista poistot tehdään **tarkistettavasti** rakennuskohtaisesti (MVL 8 §), koneista yhteisestä menojäännöksestä. Skogin hyödykekohtainen malli toimii molemmissa, kun lomakkeelle viedään luokkien summat.

### 1.6 Ajoneuvot ja matkat

- 281 käyttötiedot perustuvat 1 = ajopäiväkirjaan, 2 = muuhun selvitykseen; 516 kokonaiskilometrit; 282 kokonaismenot muistiinpanoissa; 283 yksityistalouden osuus; 284 metsätalouden osuus (#826).
- Yksityistalouteen kuuluvan auton käyttö maataloudessa: 534, 287 kokonaiskilometrit, 288 maatalouden ajot, 518 enimmäismäärä, 519 muistiinpanoissa vähennetty, 285 lisävähennys (#827).
- Tilapäiset työmatkat: matkapäivät 401 (yli 10 h), 406 (yli 6 h), 411 (ulkomaa) ja euromäärät 402–405, 407–410, 423–425, 532, 533, 286.

**Yhteys metsätalouteen:** maatalouden kaluston metsätalouden ajot (284) tuloutetaan maataloudessa (221) ja vähennetään metsätaloudessa 2C:n kohdassa 630 (toisesta tulolähteestä siirrettävät menot). Skog jättää 630:n nyt pois (DECISIONS 28.9.2026); maatalouden myötä se kannattaa täyttää samasta luvusta.

### 1.7 Varallisuuslaskelma (kaikki maatilat yhteensä)

| Tunnus | Tieto | Lähde Skogissa |
|---|---|---|
| 432 | Maatalousmaa ja tuotantorakennusten rakennuspaikat | Verohallinto laskee kiinteistöverotuksesta (OmaVerossa ei voi muuttaa); paperilla likimääräinen arvo hehtaariarvoista. Skog: vapaaehtoinen syöttö |
| 466 | Tuotantorakennukset | rakennusten poistamaton hankintameno (lasketaan poistoista) + käyttöön ottamattomat |
| 431 | Lomamökit ym. vuokrattavat asuinrakennukset tontteineen | kiinteistöverotuspäätös, syöttö |
| 467 | Maatalouden koneet ja kalusto | koneiden menojäännös + käyttöön ottamattomat − tasausvaraus ja tuet |
| 468 | Maatalouteen kuuluvat osakkeet ja osuudet | syöttö (esim. meijeri- ja teurastamo-osuudet) |
| 469 | Muut maatalouteen kuuluvat varat | siltojen, asfaltointien ja salaojien poistamaton arvo, tuotanto-oikeudet; osin laskettavissa |
| 731 | Varat yhteensä | #1447 |
| 732 | Velat ja velvoitteet yhteensä | syöttö (vain maatalouden velat, ei yksityistalouden) |
| 735 / 736 | Positiivinen / negatiivinen nettovarallisuus | #419, #992 |
| 470 | Maatilan muut varat (kiven-, soranottopaikat) | eivät kuulu maatalouden varoihin |

Muut tiedot: 409 maatalouden arvopapereiden luovutusvoitot (lomake 9A), 437 verovuonna maksetut ennakonpidätyksen alaiset palkat (ilman sivukuluja; Verohallinto lisää 30 % niistä nettovarallisuuteen), purkamattomat varaukset 170–172 tasausvaraus vuosilta 2024–2026 ja 173–175 jälleenhankintavaraus (vuodelle 2025 vuodet 2023–2025).

### 1.8 Liitelomakkeet

| Lomake | Koskeeko Skogia | Huomio |
|---|---|---|
| 2C | Kyllä | samaan tiedostoon lomakkeen 2 kanssa |
| 2Y (päälomake) | Myöhemmin | maatalousyhtymä; osakkaiden osatietoryhmä 001/009: 701 nimi, 703 henkilö- tai Y-tunnus, 621 osuus tuloksesta %, 624 osuus varallisuudesta %, 618 vaatimus (10 % tai ansiotuloa). Henkilötunnukset vain tiedostoon, kuten 2C:n hankintatyön tekijät. Määräpäivä 2.3. |
| 9A | Harvoin | maatalouden arvopapereiden luovutusvoitot (409) |
| 7L | Myöhemmin | pellon ja metsämaan vuokratulot ja vuokrapellon salaojien tasapoistot vuodesta 2025; sama tiedosto sallittu |
| 5, 67A, 67Y, 70, 74, 75 | Ei | elinkeinotoiminta, T&K, kansainväliset |
| 62 | Ei | elinkeinoverolain varaukset ja poistot (toimintavaraus 871 jne.), ei maataloutta |
| 18 | Ei | elinkeinotoiminnan käyttöomaisuuskiinteistöt |
| 9 (kiinteistön luovutus) | Ei sähköisenä | kuten metsässä: OmaVero |
| 9 / "eläimet ja varastot" | Ei ole | lomaketta eläimistä tai varastoista ei ole; kotieläinten jaksotus on lomakkeen 2 kentissä |

---

## 2. Maatalouden verotuksen erityispiirteet metsätalouteen verrattuna

| Asia | Metsätalous (2C, TVL) | Maatalous (2, MVL) |
|---|---|---|
| Tulolähde | pääomatulo | yritystulo, jaetaan pääoma- ja ansiotuloksi |
| Jaksotus | maksuperuste | maksuperuste: tulo verovuonna, jona se on saatu, meno maksuvuonna ([TULOS]); varastoja ei oteta huomioon. Poikkeuksia: poistot, kotieläinten jaksotus, varaukset |
| Varaukset | meno- ja tuhovaraus | tasausvaraus (enintään 40 % maatilan puhtaasta tulosta ennen korkoja, 800–25 000 € tilaa kohden vuodessa, pyöristys alas sataan euroon, tilakohtainen, käytettävä investointiin tai tuloutettava viimeistään kolmantena vuonna) ja jälleenhankintavaraus |
| Poistot | kone 25 %, tie ja oja 15 %, rakennus 10 % | ks. 1.5; investointituet ja käytetty tasausvaraus vähennetään poistopohjasta |
| Koneen myynti | luovutusvoitto (lomake 9) | myyntihinta vähennetään menojäännöksestä (263 jne.); **tarkistettava**, menojäännöksen ylittävä osa on maatalouden tuloa |
| Pienhankinta | 600 € | 1 200 € (koneet), rakennusten menojäännös 1 000 € |
| Tuet | 609, tuloa | tuet ja korvaukset tuloa (217/218); investointituki vähennetään hankintamenosta |
| Oma käyttö | 614 omasta metsästä otettu puutavara | tilan omien tuotteiden käyttö omassa taloudessa ei ole veronalaista tuloa ([HAKU-OMA], **tarkistettava** tarkka lähde); yksityiskäytön menot tuloutetaan (221) tai jätetään vähentämättä |
| Luontoisedut, kilometrikorvaukset | – | maataloudenharjoittaja ei voi antaa itselleen luontoisetuja eikä päivärahoja; tilalle lisävähennykset (464) |
| Yrittäjävähennys | 5 % metsätalouden tuloksesta | 5 % maatalouden tuloksesta, josta on vähennetty vahvistetut tappiot; Verohallinto laskee itse |
| Tappio | – | vahvistetaan maatalouden tappioksi (10 vuotta) tai vähennetään saman vuoden pääomatuloista vaatimuksesta (420) |
| Pääomatulo-osuus | – | 20 % edellisen vuoden nettovarallisuudesta (+ 30 % palkoista), vaatimuksesta 10 % tai 0 %; aloitus- ja lopetusvuonna kuukausien suhteessa |
| Puolisot | erilliset 2C:t | yhdessä harjoitettu maatalous: osuudet nettovarallisuudesta ja työpanoksesta lomakkeella 2 |
| Yhtymä | metsäyhtymä 2C | maatalousyhtymä 2Y; korot ja velat ovat osakkaiden omia, tulo jaetaan työpanoksen ja varallisuuden mukaan |
| Määräpäivä (verovuosi 2025) | 2.3.2026, mutta 1.4.2026, jos myös maataloutta | 1.4.2026; yhtymä 2.3.2026 |

**Kotitalousvähennys** ei kuulu maatalouden laskentaan (henkilökohtainen vähennys). **Maatalouden menojen jako** kotitarvekäytön kanssa tehdään joko kirjaamalla vain maatalouden osuus (Skogin osuus %) tai kirjaamalla koko meno ja tulouttamalla yksityiskäyttö (221). Skog suosittelee ensimmäistä, koska se pitää myös alv:n oikeana.

### 2.1 Arvonlisävero

- **Yksi verovelvollinen, yksi ilmoitus.** "Jos harjoitat metsätalouden lisäksi myös maataloutta tai toimit liikkeen- tai ammatinharjoittajana, ilmoita kaikki arvonlisäverot samalla arvonlisäveroilmoituksella" ([ALV-METSÄ]).
- **Verokausi kalenterivuosi**, koska maataloudenharjoittaja ja metsänomistaja ovat alkutuottajia; lyhyempi kausi on mahdollinen pyynnöstä. Ilmoitus ja maksu verovuoden 2025 osalta viimeistään 2.3.2026.
- **Rekisteröintiraja** 20 000 euroa 1.1.2025 alkaen. **Alarajahuojennus poistui** 1.1.2025 alkavilta tilikausilta; viimeinen huojennus vuodelta 2024 (maksettu 2025, maatalouden tuloa 222).
- **Verokannat:** yleinen 25,5 % (1.9.2024 alkaen, ennen 24 %). Alennettu 14 % → 13,5 % 1.1.2026 (elintarvikkeet, rehut, ravintola- ja ateriapalvelut, majoitus, lääkkeet, henkilökuljetus; 1.1.2025 alkaen 14 %:iin siirtyivät myös kirjat ja lääkkeet, jotka olivat ennen 10 %). 10 % jää lähinnä sanoma- ja aikakauslehdille. Maatalouden myynnit: elävät eläimet 25,5 %, maito, vilja ja muut elintarvikkeet ja rehut 13,5 % (2025: 14 %), tuet 0 % (eivät ole myyntiä).
- **Tuloverotus on maksuperusteinen, alv suoriteperusteinen** (ellei asiakas käytä maksuperusteista alv:tä, VSRALVKV-kenttä 337). Joulukuun maito, joka tilitetään tammikuussa, on alv:ssä joulukuun myyntiä ja vanhalla kannalla, mutta tuloverotuksessa seuraavan vuoden tuloa. **Tarkistettava**, miten toimisto haluaa tämän käsitellä (avoin kysymys 4).
- **Oman käytön alv:** maataloudesta omaan tai perheen kulutukseen otetuista tavaroista on suoritettava alv kuten myynnistä, mutta vähäinen määrä (**tarkistettava** raja, haun mukaan enintään 850 € vuodessa) on vapautettu ([HAKU-OMA]). Tämä on alv-erä ilman tuloverovaikutusta.
- **Sähköinen alv-ilmoitus VSRALVKV** ([ALV-TK]): 301 vero 25,5 %, 302 vero 14 % / 13,5 %, 303 vero 10 %, 304 vero tavaroiden maahantuonnista EU:n ulkopuolelta, 305 vero tavaraostoista muista EU-maista, 306 vero palveluostoista muista EU-maista, 307 verokauden vähennettävä vero, 308 maksettava (tai palautettava) vero, 309 0-verokannan myynnit, 310–314 EU-kaupan ja maahantuonnin arvot, 318–320 rakentamispalvelut ja metalliromu, 337 maksuperusteinen alv, 050 verokauden pituus (V = vuosi), 052–053 kausi ja vuosi. Kentät 315–317 (alarajahuojennus) ovat vanhoja kausia varten.

---

## 3. Muiden ohjelmien tililuettelot

Maatalouskirjanpito-ohjelmista (Maatalousneuvos, Muuri ym.) ei löytynyt julkista tililuetteloa. Maatalousneuvoksen kuvauksen mukaan tilikartassa ovat maatalouden, metsätalouden ja kotitalouden tilit ja ohjelma tuottaa alv-laskelman ja veroilmoitukset ([MN]). Hyvä käytäntö on eritellä tärkeimmät myyntituotteet, tuet ja tuotantopanokset omille tileilleen eikä vain alv-kannoittain ([MN]). Skogin luokat johdetaan siksi suoraan lomakkeen 2 kentistä ja täydennetään raportointia palvelevilla menoluokilla (lannoitteet, rehut jne.), jotka kaikki viedään lomakkeelle alv-kannan mukaan. **Tarkistettava** kirjanpitäjältä: mitä tilejä nykyinen maatalousohjelma käyttää (siirtotaulukko Excel-liitosta varten).

---

## 4. Suunnitelma

### A. Tietomalli

Periaatteet: verovuosi, lukitus, tositteet, ehdotukset ja alv ovat asiakkaan yhteisiä. Toiminto erottaa vain tuloverotuksen laskelmat. Luokat pysyvät koodissa (`rules.ts`, DECISIONS 26.9.2026), ja jokaisella luokalla on toiminto.

**A1. Asiakas**

```sql
-- 0015 (tarkista vapaa numero): asiakkaan toiminnot ja verovelvollisen laji.
alter table sk_clients
  add column has_forestry boolean not null default true,
  add column has_agriculture boolean not null default false,
  -- person = luonnollinen henkilö, estate = kuolinpesä, partnership = verotusyhtymä (2Y tai metsäyhtymän 2C)
  add column taxpayer_type text not null default 'person' check (taxpayer_type in ('person', 'estate', 'partnership'));
```

Asiakassivun välilehdet näyttävät maatalouden osat vain, kun `has_agriculture`. Metsätilat ja maatilat ovat asiakkaan sivulla rinnakkain.

**A2. Kirjauksen toiminto ja jako (0013:n laajennus)**

Nykyinen `business_share_pct` tarkoittaa metsätalouden osuutta, ja loppu on "muuta toimintaa", jonka ostojen veroa ei vähennetä. Maatalouden myötä loppu voi olla toisen alv-velvollisen toiminnon osuutta, jonka vero vähennetään. Ehdotus:

```sql
alter table sk_transactions
  -- Kirjauksen toiminto tulee luokasta (rules.ts); kirjoituskerros asettaa sen, ja testi varmistaa vastaavuuden.
  add column activity text not null default 'forestry' check (activity in ('forestry', 'agriculture')),
  -- Toisen toiminnon osuus (metsä ↔ maatalous). Loppu 100 − business_share_pct − other_share_pct on yksityiskäyttöä.
  add column other_share_pct numeric(5,2) not null default 0 check (other_share_pct >= 0 and other_share_pct < 100),
  add column farm_id uuid references sk_farms(id) on delete set null;
alter table sk_transactions add constraint sk_transactions_shares check (business_share_pct + other_share_pct <= 100);
```

- `business_share_pct` säilyy (vanhat rivit ja koodi toimivat), mutta käyttöliittymässä se on "Osuus %" eli kirjauksen oman toiminnon osuus.
- Toisen toiminnon osuudelle tarvitaan luokka. Se johdetaan säännöllä `crossCategory(code, vatRate)` (esimerkiksi polttoaine maatalouden ostoista → metsätalouden Muut vuosimenot; metsätalouden Muut vuosimenot → maatalouden ostot alv-kannan mukaan). Näin rivillä on yksi luokka, eikä kuitti jakaudu kahteen kirjaukseen.
- `share.ts` saa funktion `activityShares(t)`, joka palauttaa metsän, maatalouden ja yksityisen osuudet (veroton, vero, brutto). Pyöristys kuten nyt: osuudet pyöristetään sentteinä, ja viimeinen osa saa erotuksen, jotta osat täsmäävät kuittiin.
- Alv: vähennettävä vero = metsän ja maatalouden osuuksien vero, ei-vähennettävä = vain yksityinen osa. Tämä ratkaisee BLOCKERS 11 b:n maatalouden osalta.
- Vaihtoehto, jos toimintoja tulee myöhemmin enemmän (esim. liiketoiminta): erillinen `sk_transaction_allocations`-taulu (kirjaus, toiminto, osuus, luokka). Kahdelle toiminnolle sarake on yksinkertaisempi ja tarkistus mahtuu yhteen check-ehtoon.

**A3. Maatilat**

```sql
create table sk_farms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  name text not null,
  -- Ruokaviraston tilatunnus (ei henkilötieto).
  farm_code text,
  property_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Triggerit: sk_check_same_org('sk_clients','client_id'), sk_touch_updated_at.
-- RLS: policy farms_all for all to authenticated using/with check (sk_can_access_client(client_id)).
-- revoke all from anon; grant select, insert, update, delete to authenticated; grant all to service_role.
-- tests/db/rls.test.ts: lisää sk_farms.
```

Tasausvaraus lasketaan maatiloittain, joten tila on mukana alusta asti. Asiakkaalle, jolla on yksi tila, taulukko ei näytä tilasaraketta.

**A4. Maatalouden vuoden tiedot**

Yksi rivi asiakkaalle ja vuodelle. Kentät ovat lomakkeen tietoja, joita ei saa kirjauksista.

```sql
create table sk_agri_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null,
  -- Puoliso-osuudet (413–416). Tyhjä = ei yrittäjäpuolisoa.
  spouse_wealth_share_pct numeric(5,2) check (spouse_wealth_share_pct between 0 and 100),
  spouse_work_share_pct numeric(5,2) check (spouse_work_share_pct between 0 and 100),
  -- 418: null = 20 %, 'ten' = 10 %, 'earned' = kokonaan ansiotuloa.
  income_split_claim text check (income_split_claim in ('ten', 'earned')),
  -- 420: pääomatuloista vähennettävä tappio.
  loss_to_capital_income numeric(14,2) check (loss_to_capital_income >= 0),
  -- 437: ennakonpidätyksen alaiset palkat ilman sivukuluja.
  wages_subject_to_withholding numeric(14,2) not null default 0,
  -- Varallisuuslaskelma: syötettävät erät (432, 431, 468, 469-lisä, 732, 470).
  land_value numeric(14,2), rental_dwellings_value numeric(14,2), shares_value numeric(14,2),
  other_assets_value numeric(14,2), liabilities numeric(14,2), other_farm_assets numeric(14,2),
  -- Edellisen vuoden nettovarallisuus (pääomatulo-osuuden laskentaa varten), jos vuotta ei ole Skogissa.
  prior_net_wealth numeric(14,2),
  -- Vahvistetut maatalouden tappiot aiemmilta vuosilta (seurantaan ja verosuunnitelmaan).
  confirmed_losses_carried numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, tax_year)
);
-- Lukitus: sama kuin luovutuksilla (sk_year_is_closed), RLS sk_can_access_client.
```

Harvoin tarvittavat kentät (ajoneuvoselvitys 281–288, matkapäivät 401–425, käyttöön ottamattomat 278–280, osingot ja 9A) ovat MVP:ssä erillisessä taulussa `sk_agri_form_extras (client_id, tax_year, code text, value numeric)`. Sallitut tunnukset ovat koodissa vuosittain, ja lomake näyttää ne nimillä. Näin harvinainen tieto ei estä tiedoston tekemistä, ja kentän voi myöhemmin siirtää omaan laskentaansa.

**A5. Kotieläinten jaksotukset**

```sql
create table sk_agri_deferrals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  tax_year smallint not null,               -- jaksotuksen syntyvuosi
  kind text not null check (kind in ('livestock_sale', 'livestock_purchase')),
  amount numeric(14,2) not null check (amount >= 0),
  -- Vuosille jaettu summa; oletus kolmasosa vuodessa.
  year1 numeric(14,2) not null, year2 numeric(14,2) not null, year3 numeric(14,2) not null,
  check (year1 + year2 + year3 = amount)
);
```

Jaksotus syntyy kirjauksista (luokat "Kotieläinten myynti, jaksotettava" ja "Kotieläinten hankinta, jaksotettava"), ja aiempien vuosien jaksotukset syötetään alkutietoina. 211 ja 227 ovat vuoden summat, 212 ja 228 lasketaan kolmen vuoden riveistä. **Tarkistettava**: jakautuuko myyntitulo vapaasti kolmelle vuodelle vai tasan (ohjeen mukaan hankintameno "yhtä suuriksi menoeriksi").

**A6. Varaukset**

```sql
create table sk_agri_reserves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  client_id uuid not null references sk_clients(id) on delete cascade,
  farm_id uuid references sk_farms(id) on delete cascade,
  kind text not null check (kind in ('equalization', 'replacement')),
  made_year smallint not null,
  amount numeric(14,2) not null check (amount >= 0),
  unique (farm_id, kind, made_year)
);
create table sk_agri_reserve_uses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  reserve_id uuid not null references sk_agri_reserves(id) on delete cascade,
  tax_year smallint not null,
  -- asset = käytetty investointiin (vähentää poistopohjaa), income = tuloutettu (219/220).
  use_kind text not null check (use_kind in ('asset', 'income')),
  asset_id uuid references sk_assets(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0)
);
```

Jäljellä olevat varaukset (170–175) lasketaan: tehty − käytetty − tuloutettu. Verosuunnitelma ehdottaa tasausvarauksen enimmäismäärän (40 % tilan puhtaasta tulosta ennen korkoja, 800–25 000 €, pyöristys alas sataan) ja varoittaa kolmantena vuonna tulouttamatta jäävästä. **Tarkistettava**, korotetaanko käyttämättä jäänyt varaus tuloutettaessa (MVL).

**A7. Investoinnit**

`sk_assets` saa sarakkeen `activity` ja maatalouden lajit. `ASSET_CLASSES` jaetaan toiminnoittain:

| Toiminto | Laji | Enimmäis-% | Lomakkeen ryhmä |
|---|---|---|---|
| forestry | kone, tie tai oja, rakennus | 25 / 15 / 10 | 2C 660–694 (nykyinen) |
| agriculture | tuotantorakennus | 10 | 240–244, 524 |
| agriculture | asuin- tai toimistorakennus | 6 | 245–249, 525 |
| agriculture | kasvihuone tai vastaava rakennelma | 20 | 250–254, 526 |
| agriculture | ympäristönsuojelun rakennelma | 25 | 255–259, 527 |
| agriculture | koneet ja kalusto | 25 (2025 uudet 50) | 260–265, 511 |
| agriculture | sillat, asfaltointi, padot, kaivot | 10 | 266–271, 513 |
| agriculture | salaojat (oma viljely) | 20 | 272–277, 515 |

Prosentti ei enää yksin kerro lajia (25 % on sekä metsän kone että maatalouden rakennelma), joten tarvitaan sarake `asset_class text` (koodi, esim. `agri_machinery`). Nykyiset metsän rivit saavat koodin prosentista migraatiossa. Vuoden 2025 korotettu poisto: `accelerated boolean` (uusi kone, käyttöön 2020–2025) ja oma poistokohde, josta täytetään 364–584.

Poistopohjaa pienentävät erät:

```sql
create table sk_asset_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references sk_organizations(id) on delete cascade,
  asset_id uuid not null references sk_assets(id) on delete cascade,
  tax_year smallint not null,
  -- grant = investointituki tai korvaus (243, 264…), equalization = käytetty tasausvaraus (242, 262…).
  kind text not null check (kind in ('grant', 'equalization')),
  amount numeric(14,2) not null check (amount > 0)
);
```

Myynti: maatalouden hyödykkeen myyntihinta vähennetään menojäännöksestä (528–531, 263, 269, 275) eikä siitä lasketa luovutusvoittoa. Kirjauksen myynti merkitsee investoinnin myydyksi kuten nyt, mutta laskenta haarautuu toiminnon mukaan.

**A8. Alkutiedot**

Uudelle maatalousasiakkaalle syötetään edellisen vuoden verotuksesta: menojäännökset lajeittain (tai rakennuksittain), purkamattomat varaukset vuosittain, kotieläinten jaksotukset kahdelta edelliseltä vuodelta, edellisen vuoden nettovarallisuus ja vahvistetut tappiot. Investoinneissa tämä on 0014:n "aiempi investointi" lajivalinnalla. Koneet voi syöttää yhtenä rivinä ("Koneet ja kalusto, menojäännös 31.12.2025"), koska maatalouden koneilla on yhteinen menojäännös.

### B. Arvonlisävero

1. **Yksi alv-laskelma asiakkaalle.** Alv-välilehti laskee kaikki asiakkaan kirjaukset toiminnosta riippumatta, kuten nyt. Uutena erittely: myynnit ja ostot verokannoittain sekä sarakkeet Metsä, Maatalous ja Yhteensä. Ei-vähennettävä vero on vain yksityinen osuus.
2. **`rules.ts`:** alennetun kannan aikasarja (`REDUCED_VAT`: 14 % → 13,5 % 1.1.2026) ja 10 %. Luokan oletus `vat: "general" | "reduced" | "none"`. `defaultVatRate` toimii ennallaan (rekisteröimättömälle 0 %).
3. **`vat.ts`:** `VatRow` saa `activity` ja `otherSharePct`; `period()` laskee `byActivity`. Lisäksi tulos VSRALVKV-kentittäin (301, 302, 303, 307, 308, 309) myöhempää alv-tiedostoa tai Vero API -lähetystä varten (rajapintamuistio, vaihe 2).
4. **Oman käytön alv:** luokka "Yksityiskäyttöönotto (alv)", jonka myynnin vero menee alv:hen mutta ei tuloverotukseen (luokan lippu `incomeTax: false`).
5. **Kirjausvuosi ja alv-kausi:** MVP käyttää kirjauspäivää kuten nyt. Ohje neuvoo kirjaamaan vuodenvaihteen tilitykset alv:n kannalta oikealle vuodelle tai käyttämään maksuperusteista alv:tä. Erillinen suoritepäivä (`vat_date`) on mahdollinen myöhemmin (avoin kysymys 4).
6. **Lomakkeen 2 menokentät alv-kannasta:** rekisteröidyllä kentän ratkaisee rivin kanta (226 / 229 / 230). Rekisteröimättömällä rivin kanta on 0 %, joten kenttä tulee luokan oletuskannasta ja summa on bruttona ([OHJE2]). **Tarkistettava**, että rekisteröimättömän ostot kuuluvat silti kohtiin 226/229 eikä kaikki 230:een.
7. **BLOCKERS 11** päivittyy: maatalouden osuus on vähennyskelpoista, jos asiakas on alv-velvollinen.

### C. Syöttö

**C1. Luokat (ehdotus, numerot 21–60)**

Numerot ovat yksilöllisiä koko luettelossa, jotta Excelin luokkanumero ja numerovalinta toimivat ilman toimintosaraketta. Metsän numerot 1–12 säilyvät. Numero 2 odottaa jatkoa (0,7 s) kuten nyt 1.

| Nro | Luokka | Laji | Alv-oletus | Lomake 2 |
|---|---|---|---|---|
| 21 | Kotieläinten myynti | tulo | yleinen | 210 |
| 22 | Kotieläinten myynti, jaksotettava | tulo | yleinen | 211 → 212 |
| 23 | Muu myynti (työt, koneiden vuokra, metsätalouden sivutulot) | tulo | yleinen | 213 |
| 24 | Maito ja muut kotieläintuotteet | tulo | alennettu | 214 |
| 25 | Kasvinviljelytuotteet | tulo | alennettu | 215 |
| 26 | Majoituspalvelut | tulo | alennettu | 216 |
| 27 | Maataloustuet (Ruokavirasto) | tulo | ei | 217 (tarkistettava) |
| 28 | Muut tuet ja korvaukset | tulo | ei | 218 |
| 29 | Muut alv 0 % tulot (vahingonkorvaukset, rakennusten vuokrat) | tulo | ei | 220 |
| 30 | Energiaveron palautus ja muut lisäykset | tulo | ei | 222 |
| 31 | Tuloutus yksityiskäytöstä | tulo | ei | 221 |
| 32 | Osuuskunnan ylijäämä | tulo | ei | 327 / 328 |
| 33 | Osingot | tulo | ei | 321 / 322 tai 223 / 224 (valinta) |
| 34 | Yksityiskäyttöönotto (vain alv) | tulo | alennettu | ei tuloverotukseen |
| 41 | Lannoitteet ja kalkki | meno | yleinen | kannan mukaan |
| 42 | Siemenet ja taimet | meno | yleinen | kannan mukaan |
| 43 | Rehut | meno | alennettu | kannan mukaan |
| 44 | Polttoaineet ja voiteluaineet | meno | yleinen | kannan mukaan |
| 45 | Koneiden ja rakennusten korjaukset | meno | yleinen | kannan mukaan |
| 46 | Sähkö, vesi ja lämpö | meno | yleinen | kannan mukaan |
| 47 | Eläinlääkäri ja eläinten hoito | meno | yleinen | kannan mukaan (lääkkeet alennettu) |
| 48 | Urakointi ja ostopalvelut | meno | yleinen | kannan mukaan |
| 49 | Muut ostot ja kalusto | meno | yleinen | kannan mukaan |
| 50 | Kotieläinten hankinta, jaksotettava | meno | yleinen | 227 → 228 |
| 51 | Palkat ja sivukulut | meno | ei | 225 |
| 52 | Vuokrat | meno | ei | 230 |
| 53 | Vakuutukset | meno | ei | 230 |
| 54 | MYEL-maksut | meno | ei | 230 |
| 55 | Kiinteistövero ja lomitusmaksut | meno | ei | 230 |
| 56 | Korot | meno | ei | 465 |
| 57 | Muut vähennykset | meno | ei | 464 |
| 58 | Maatalouden investointi | investointi | yleinen | lajin mukaan (ikkuna kuten metsässä) |
| 59 | Maatalouden käyttöomaisuuden myynti | tulo | yleinen | vähennetään menojäännöksestä |
| 60 | Investointituki | tulo | ei | ei tuloksi: vähennetään hankintamenosta (243, 264 …) |

Luokkia on paljon menoissa, koska kirjanpitäjä ja asiakas haluavat nähdä, mihin rahat menivät. Lomakkeelle ne yhdistyvät alv-kannan mukaan. Lista hyväksytetään kirjanpitäjällä (avoin kysymys 6).

**C2. Taulukkosyöttö**

- Sama `LedgerGrid` ja sama tallennus (`planGridChanges`, `write.ts`). Toiminto tulee luokasta, joten uutta pakollista saraketta ei tule.
- Taulukon yläpuolelle suodatin Kaikki / Metsä / Maatalous, kun asiakkaalla on molemmat. Uuden rivin oletusluokkalista painottaa suodatettua toimintoa.
- Sarakkeet: päivä, selite, luokka, summa, alv %, osuus %, toinen toiminto % (vain kun molemmat toiminnot), tila (metsätila tai maatila luokan mukaan), tyyppi. Enter ohittaa osuussarakkeet kuten nyt (`ENTER_SKIPS`).
- Rivin alle kuten nyt: "Maataloudelle X €, metsätaloudelle Y €, yksityiseen Z €".
- Ikkunat: maatalouden investointi kysyy lajin (ja 2025:n uuden koneen), myynti kohteen, investointituki kohteen, jaksotettava kotieläinkirjaus näyttää kolmen vuoden jaon.
- Lomake: sama kuin nyt, lisäksi toinen toiminto % Lisätiedoissa.

**C3. Excel-liitos**

Sarakejärjestys säilyy (päivä, selite, luokka, summa, alv, ennakonpidätys, tila, viite, osuus) ja loppuun valinnainen toinen toiminto %. Luokan voi antaa numerona tai nimenä. Lisäksi siirtotaulukko nykyisen maatalousohjelman tilinumeroista Skogin luokkiin, kun tililuettelo saadaan (avoin kysymys 6).

**C4. Tuonti vanhasta järjestelmästä**

Vanhassa Skogissa ei ole maataloutta (koodista tarkistettu), joten `tuo:vanha` ei muutu. Edellisen ohjelman tiedot tuodaan Excel-liitoksella ja alkutiedoilla (A8). Erillinen tuonti tehdään vain, jos kirjanpitäjän nykyisestä ohjelmasta saa vakiomuotoisen viennin.

**C5. Tekoälytunnistus**

- Skeemaan maatalouden luokat (`RECEIPT_CATEGORY_CODES` laajenee automaattisesti `CATEGORIES`-listasta) ja ohjeeseen luokkien kuvaukset. Kun asiakkaalla ei ole maataloutta, maatalouden luokat jätetään ohjeesta pois (asiakkaan tieto ei lähde palveluun, vain luokkalista vaihtuu).
- Uudet asiakirjalajit: `dairy_settlement` (meijeritilitys: maito 13,5/14 %, vähennykset kuten kuljetus ja jäsenmaksut omiksi menoriveikseen, ylijäämä omaksi rivikseen), `slaughter_settlement` (teurastamotilitys: eläimet 25,5 %), `subsidy_decision` (Ruokaviraston maksupäätös tai tukiyhteenveto: maksupäivä ja summa tukilajeittain, alv 0 %), `loan_statement` (pankin vuosi-ilmoitus: korot 465, velan saldo 732 ehdotuksena vuoden tietoihin).
- Meijerin ja teurastamon vuosikooste käsitellään kuten puukaupan vuosi-ilmoitus: rivi tuotteittain, vuoden viimeinen päivä, päällekkäisyysvaroitus kuukausitilitysten kanssa (`duplicates.ts`).
- Tyypilliset muut tositteet: lannoite-, siemen-, rehu- ja polttoaineostot, konehankinnat (investointi-ikkuna), salaojaurakat, sähkö (yksityisosuus).
- Ehdotus on aina osuudella 100 % (kuten nyt). Toiminto tulee luokasta.

**C6. Pankkitiliotteen sisäänluku (myöhemmin)**

Maataloudessa on paljon toistuvia tilityksiä ja suoraveloituksia, joten tiliote nopeuttaa syöttöä. Ehdotus: CSV- tai ISO 20022 camt.053 -tiedosto → taulukon ehdotusriveiksi, luokka vastapuolen nimestä toimiston omilla säännöillä (esim. meijeri → 24). Tositteen ja tilitapahtuman päällekkäisyys tarkistetaan samalla funktiolla kuin tunnistuksessa. Arvio 3–4 tehtävää; ei MVP:ssä.

**C7. Tuet Vipu-palvelusta**

Ruokaviraston Vipu-palvelussa voi katsoa maksutapahtumat ja tulostaa tai tallentaa tukiyhteenvedon ([VIPU]). Julkista rajapintaa tai vakiomuotoista vientiä ei löytynyt. Lisäksi maksajien vuosi-ilmoitusten tuet näkyvät OmaVerossa helmikuun alussa, mutta niitä ei voi hakea rajapinnasta. Ehdotus: asiakas tai kirjanpitäjä tallentaa Vipun tukiyhteenvedon PDF:nä, ja Skogin tunnistus lukee sen (`subsidy_decision`). **Tarkistettava**: millaisen tiedoston Vipu tallentaa (PDF vai taulukko); jos taulukko, sille tehdään oma liitos.

### D. Laskenta ja raportit

**D1. Puhtaat funktiot (`src/lib/tax/agriculture.ts`)**

- `agriResult(rows, assets, deferrals, reserves, year)` → lomakkeen 2 tuloslaskelma kentittäin (210–332, 225–357, 362/363). Rivien osuudet `activityShares`-funktiosta.
- `agriDepreciation(assets, adjustments, year)` → poistotaulukko luokittain (240–277, 511–527) ja enimmäispoistot; pienet erät (1 200 / 1 000 €); 2025 korotettu poisto.
- `equalizationReserveMax(farmNetIncome)` → 40 %, 800–25 000 €, pyöristys alas sataan.
- `agriNetWealth(details, depreciation)` → 731, 732, 735/736 ja pääomatulo-osuuden pohja (+ 30 % palkoista).
- `businessIncomeSplit(result, losses, priorNetWealth, claim, spouses, months)` → yrittäjävähennys 5 %, pääomatulo- ja ansiotulo-osuus puolisoittain.
- Vuosikohtaiset arvot (prosentit, rajat, kantojen nimet) `rules.ts`:ään.

**D2. Verosuunnitelma**

Suunnitelma kattaa molemmat toiminnot: metsätalouden pääomatulo ja maatalouden pääomatulo-osuus lasketaan yhteen 30/34 %:n rajaa varten. Valittavat: maatalouden poistot luokittain (0 – enimmäismäärä), tasausvaraus (0 – enimmäismäärä), tappion käsittely ja jakovaatimus (20/10/0 %). Ansiotulo-osuuden veroa ei voi laskea tarkasti ilman muita ansiotuloja, joten suunnitelma näyttää ansiotulo-osuuden ja arvion kirjanpitäjän antamalla marginaaliveroprosentilla. Vahvistus tallentaa maatalouden poistot ja tasausvarauksen kuten nyt metsän poistot.

**D3. Veroraportti**

Uusi osa "Maatalous (lomake 2)": tulot ja menot lomakkeen kentittäin ja luokittain, poistot, varaukset, kotieläinjaksotukset, varallisuuslaskelma ja yritystulon jako. Yhteenvetosivun laatikot kattavat molemmat toiminnot (mätkyt ja alv). Alv-osassa erittely metsä / maatalous. Kirjausluettelo näyttää toiminnon.

**D4. VSY002-tiedosto**

- Puhdas muodostin `src/lib/filing/vsy002.ts` samalla tavalla kuin `vsy02c.ts`: `VSY002_SPECS` vuosille 2025 ja 2026 (tietuetunnus, tarkistukset), kenttien nimet esikatseluun, vain tiedossa olevat kentät, tarkistukset #2045, #2046, #1450, #880, #1886, #1424, #1417–#1419, #1451, #1887, #1453, #1447, #419, #992, #38, #39, #392, #2047 ja #1322 ennen latausta.
- **Yksi tiedosto metsälle ja maataloudelle**: ensin VSY002-tietue, sitten VSY02C (sallittu yhdistelmä). Jos asiakkaalla on vain toinen, tiedostossa on vain se.
- Henkilötunnus vain tiedostoon (sama lomake kuin 2C). Loki `filing.2.download` ilman tunnuksia.
- Ilmoitin.fi:n aineiston tarkastus ja tuotantokäytön aloitusilmoitus koskevat myös ilmoituslajia VSY002 (BLOCKERS 9 c laajenee).
- 2Y (VSY02Y) myöhemmin: osakkaiden henkilötunnukset kysytään vain tiedostoa tehtäessä, kuten 2C:n hankintatyön tekijät.

### E. Vaiheistus

**MVP (verovuodet 2025 ja 2026, yksityinen maataloudenharjoittaja ja kuolinpesä)**

| # | Tehtävä | Sisältö |
|---|---|---|
| 1 | Migraatio 0015 | asiakkaan toiminnot, `activity`, `other_share_pct`, `sk_farms`, `sk_agri_years`, `sk_agri_form_extras`, `sk_assets.activity/asset_class/accelerated`, `sk_asset_adjustments`; RLS, triggerit, lukitus, testit |
| 2 | Säännöt ja luokat | maatalouden luokat, alennettu kanta aikasarjana, maatalouden poistolajit ja rajat, `crossCategory`, `activityShares`; yksikkötestit |
| 3 | Syöttö | taulukko (suodatin, toinen toiminto %, maatila, ikkunat), lomake, Excel; ohjeet |
| 4 | Alv | yhteinen laskelma ja erittely toiminnoittain, ei-vähennettävä vain yksityinen, VSRALVKV-kentät näkyviin; ohje |
| 5 | Maatalouden investoinnit ja alkutiedot | lajit, menojäännökset, investointituki ja myynti menojäännöksestä, 2025:n korotettu poisto |
| 6 | Maatalouden vuoden tiedot | varallisuuslaskelma, puolisot, vaatimukset, palkat, tasausvaraus ja purkamattomat varaukset käsin, kotieläinjaksotukset käsin, harvinaiset kentät |
| 7 | Laskenta | `agriculture.ts`: tulos, poistot, varallisuus, tarkistukset; verosuunnitelman maatalousosa ilman yritystulon jakoa (poistot valittavina) |
| 8 | Raportti | veroraportin maatalousosa, alv-erittely |
| 9 | VSY002-tiedosto | muodostin, esikatselu, yhteinen tiedosto 2C:n kanssa, testit tietuekuvausta vasten, aineiston tarkastus Ilmoitin.fi:ssä (Jukka) |

Tekoälyn luokat (C5 ilman uusia asiakirjalajeja) mahtuvat tehtävään 2 tai 3, koska luokkalista tulee `CATEGORIES`-listasta. Arvio: 9 tehtävää, yksi tehtävä on noin yhden Skogin PLAN-rivin kokoinen (esimerkiksi "aiempi investointi" tai "2C-tiedosto").

**Vaihe 2**

| # | Tehtävä |
|---|---|
| 10 | Tasausvarauksen laskuri tiloittain, käyttö investointiin ja tuloutus, jälleenhankintavaraus |
| 11 | Kotieläinten jaksotus kirjauksista automaattisesti |
| 12 | Yritystulon jako ja pääomatulo-osuus verosuunnitelmaan (puolisot, 20/10/0 %, tappiot) |
| 13 | Tunnistuksen asiakirjalajit (meijeri, teurastamo, tukipäätös, lainan vuosi-ilmoitus) |
| 14 | Ajoneuvo- ja matkaselvitys laskettuna, tulolähdesiirto 2C:n 630:een |

**Vaihe 3**

| # | Tehtävä |
|---|---|
| 15 | Maatalousyhtymä 2Y: verovelvollisen laji, osakkaat, VSY02Y-tiedosto |
| 16 | Pankkitiliotteen sisäänluku |
| 17 | Alv-ilmoitus tiedostona (VSRALVKV) tai Vero API:lla (rajapintamuistion vaihe 2) |
| 18 | 7L (pellon ja metsämaan vuokratulot) samaan tiedostoon |

---

## 5. Avoimet kysymykset (Jukka tai kirjanpitäjä)

1. **Aikataulu ja vuosi:** onko asiakkaiden verovuoden 2025 maatalous vielä tekemättä (myöhästynyt ilmoitus tai korjaus), vai tähdätäänkö verovuoteen 2026 (ilmoitus keväällä 2027)? Tämä ratkaisee, tarvitaanko vuoden 2025 korotetut poistot (364–584) heti.
2. **Montako maatalousasiakasta**, ja onko joukossa maatalousyhtymiä (2Y) tai yrittäjäpuolisoita? Jos yhtymiä on, 2Y siirtyy MVP:hen.
3. **Maksuperuste täysimääräisesti?** Lomake 2 on maksuperusteinen, eikä varastoja käytetä. Haluaako toimisto silti seurata varastoja tai suoriteperusteista tulosta asiakkaalle omana raporttinaan?
4. **Vuodenvaihteen alv:** kirjataanko alv kirjauspäivän (maksun) mukaan vai suoritevuoden mukaan? Käyttävätkö asiakkaat maksuperusteista alv:tä? Tarvitaanko kirjaukselle erillinen alv-päivä?
5. **Yhteiset kulut:** riittääkö kaksi osuutta (oma toiminto ja toinen toiminto, loppu yksityistä), vai jaetaanko kuluja myös liiketoiminnalle?
6. **Tililuettelo:** mitä ohjelmaa toimisto käyttää maatalouteen nyt, ja saako siitä tililuettelon ja viennin? Hyväksyttääkö ehdotettu luokkalista (C1), erityisesti tukien jako 217/218.
7. **Tasausvaraus:** käyttävätkö asiakkaat sitä yleisesti? Jos käyttävät, laskuri kannattaa tehdä MVP:hen.
8. **Kotieläimet:** onko asiakkailla kotieläintaloutta ja jaksotuksia (211/212, 227/228)?
9. **Rekisteröimättömän ostot:** vahvista, että ostot viedään kohtiin 226/229/230 kannan mukaan bruttona.
10. **MYEL ja tappio:** vähennetäänkö MYEL-maksut lomakkeella 2 (230 tai 464) vai henkilökohtaisesti; vaaditaanko tappion vähentämistä pääomatuloista?
11. **Tuotantokäytön aloitusilmoitus:** lisätäänkö ilmoituslaji VSY002 samaan ilmoitukseen kuin VSY02C (BLOCKERS 9 c)?

---

## Lähteet (luettu 2.10.2026)

- **[TK2-26]** Verohallinto: Maatalouden veroilmoitus 2, henkilöasiakas tai kuolinpesä, tietuekuvaus 2026, v1.0, 22.9.2026. https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2026_2.pdf
- **[TK2-25]** Sama verovuodelle 2025, v1.0, 23.9.2025. https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2025_2.pdf
- **[TK2Y-26]** Maatalouden veroilmoitus 2Y, maatalousyhtymä, tietuekuvaus 2026, v1.0, 22.9.2026. https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2026_2y.pdf
- **[TK62-26]** 62 Varaukset, arvonmuutokset ja kuluvan käyttöomaisuuden poistot, tietuekuvaus 2026, v1.0, 3.2.2026. https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2026_62.pdf
- **[TK18-26]** 18 Luettelo käyttöomaisuuskiinteistöistä, tietuekuvaus 2026. https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto_tietuekuvaus_2026_18.pdf
- **[YHD]** Yritysten tuloveroilmoituslomakkeet ja lomakeyhdistelmät (xlsx, 2.1.2026). https://www.vero.fi/contentassets/c6b01d0d1b71480eae0e06e07031af21/verohallinto-yritysten-tuloverolomakkeet-ja-lomakeyhdistelm%C3%A4t.xlsx
- **[TK-LISTA]** Tietuekuvaukset, tuloveroilmoitukset. https://www.vero.fi/tietoa-verohallinnosta/kehittaja/tietuekuvaukse/tietuekuvaukset__tuloveroilmoitu/
- **[OHJE2]** Maatalouden veroilmoitus 2 – ohje ilmoittamiseen (päivitetty 26.2.2026). https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/maatalousyrittaja/veroilmoitus/taytto-ohje-maataloudenharjoittajalle/
- **[OHJE2Y]** Maatalousyhtymän veroilmoituksen (2Y) täyttöohje. https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/maatalousyrittaja/veroilmoitus/tayttoohje-maatalousyhtymalle/
- **[TULOT-MENOT]** Maatalouden tulot ja menot. https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/maatalousyrittaja/maatalouden-tulot-ja-menot/
- **[TULOVERO]** Tuloverotus – maataloudenharjoittaja. https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/maatalousyrittaja/tuloverotus/
- **[VARAUS]** Maatalouden tasausvaraus ja jälleenhankintavaraus. https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/maatalousyrittaja/tuloverotus/tasausvaraus-ja-jalleenhankintavaraus/
- **[YHTYMÄ]** Maatalousyhtymä. https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/maatalousyrittaja/maatalousyhtyma/
- **[TULOS]** Maatalouden tuloksen laskeminen (maatilaosakeyhtiö; maksuperuste). https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/osakeyhtio-ja-osuuskunta/maatilaosakeyhti%C3%B6n-tuloverotus/maatalouden-tuloksen-laskeminen/
- **[NETTO]** Maatalouden nettovarallisuus tuloverotuksessa (syventävä ohje). https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/49201/maatalouden_nettovarallisuus_tuloverotu/
- **[ALV-METSÄ]** Metsänomistajan arvonlisäverotus. https://www.vero.fi/henkiloasiakkaat/omaisuus/metsa/mets%C3%A4nomistajan-arvonlis%C3%A4veroilmoitus/
- **[ALARAJA]** Alkutuottajien alarajahuojennuksen erityispiirteet. https://www.vero.fi/yritykset-ja-yhteisot/verot-ja-maksut/arvonlisaverotus/alarajahuojennus/alkutuottajien-alarajahuojennuksen-erityispiirteet/
- **[ALV-2026]** Muutokset veroperusteisiin vuonna 2026. https://www.vero.fi/tietoa-verohallinnosta/tilastot/verotulojen-kehitys/muutokset-veroperusteisiin-verovuosittain/2026/
- **[ALV-TK]** Tietuekuvaus VSRALVKV (oma-aloitteisten verojen veroilmoitus, voimassa 29.8.2024, päivitetty 3.12.2025). https://www.vero.fi/contentassets/ef5905e0f5b74bcba89aa9ba9c34015d/finnish-tax-administration_description-of-the-data-file_vsralvkv_290824.pdf
- **[HAKU-OMA]** Hakutulos vero.fi:stä (Tulolähdesiirrot, yksityiskäyttöönotot ja yksityissijoitukset luonnollisten henkilöiden ja henkilöyhtiöiden verotuksessa): oma käyttö ja 850 euron raja. Varsinaista sivua ei luettu, joten **tarkistettava**. https://www.vero.fi/syventavat-vero-ohjeet/ohje-hakusivu/80791/
- **[VIPU]** Ruokavirasto: Maatilan maksutapahtumat. https://www.ruokavirasto.fi/tuet/maatalous/maksuaikataulu/maataloustukien-maksaminen/Maatilan-maksutapahtumat/
- **[MN]** Suonentieto: Maatalousneuvos (kirjanpito, laskutus ja palkanlaskenta). https://www.suonentieto.fi/tuotteet/maatalousneuvos/
- Skogin omat: `docs/verosaannot-selvitys-2026-09-27.md`, `docs/verohallinto-rajapinnat-selvitys-2026-09-28.md`, DECISIONS 26.–28.9.2026, BLOCKERS 9 ja 11.
