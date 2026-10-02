# Maatalouden tositteiden tunnistus: lajit, tuet ja kustannusarvio

2.10.2026. Täydentää suunnitelman kohtaa C5 (`docs/maatalous-suunnitelma-2026-10-02.md`). Oikeaa maatilan aineistoa ei ole vielä kokeiltu; säännöt on testattu kuvitteellisilla esimerkeillä (`src/lib/ai/receipts/mock-agri.ts`).

## 1. Asiakirjalajit

Ohje mallille on `src/lib/ai/receipts/anthropic.ts` (`AGRI_RULES`), jälkikäsittely `src/lib/ai/receipts/agri.ts`.

| Laji | Rivit | Sudenkuopat |
|---|---|---|
| `dairy_settlement` meijerin tilitys | maito 24 (lisät samaan riviin), rehu 43, eläinlääkäri ja seminointi 47, tarvikkeet ja jäsenmaksu 49, kuljetus 48, ylijäämä 32 | litrat eivät ole euroja; osuusmaksu ei ole kulu (huomautus, täsmäytys näyttää eron); vuosikooste toistaa kuukausitilitykset |
| `slaughter_settlement` teurastamo | eläimet 21 (25,5 %), kuljetus ja luokitus 48, Naseva/Sikava 47, ylijäämä 32 | koko karjan myynti: huomautus jaksotuksesta |
| `crop_settlement` vilja | myynti 25, kuivaus, varastointi ja kuljetus 48, siemen ja lannoite ostajalta 42/41 | laatuhinnan alennus kuuluu myyntiin, erillinen maksu omaksi rivikseen |
| `subsidy_payment` maksuilmoitus | rivi per tuki, maksupäivä, alv 0, `subsidy_type` | takaisinperintä tai kuittaus: nettomaksu ja huomautus |
| `subsidy_summary` Vipun maksetut tuet, vuosikooste | rivi per maksu ja maksupäivä | tukivuosi ≠ maksuvuosi; ennakko ja loppuerä erikseen; väli- ja loppusummat pois |
| `subsidy_decision` tukipäätös | yksi rivi, varmuus ≤ 0,3 | päätös ei ole maksu |
| `livestock_trade` eläinkauppa | myynti 21, eläinten osto 49, palkkiot 48 | huomautus jaksotuksesta (22/50) |
| `machine_trade` konekauppa | kone 58 + poistoryhmä, vaihtokone 59 omana rivinään, muut maksut | vaihtokonetta ei vähennetä koneesta; alle 1 200 € ei investointi |
| `fuel_invoice` polttoaine | 44 | energiaveron palautus erikseen (30) |
| `energy_tax_refund` palautus | 30, alv 0 | |
| `utility_invoice` sähkö, vesi, lämpö | 46 | yhteinen mittari asunnon kanssa: huomautus osuudesta |
| `insurance_invoice` vakuutus | 53 | koti, henkilö ja yksityisauto omille riveilleen, varmuus ≤ 0,4 |
| `myel_invoice` MYEL | MYEL 54, MATA 53 | erät; eräpäivä, jos laskun päivää ei ole |

Kaikille: `document_total` on laskun maksettava summa tai tilityksen tilille maksettu nettosumma, ja hyväksyntänäkymä täsmäyttää tulot − ennakonpidätys − menot siihen (`src/lib/ai/receipts/reconcile.ts`).

Alv: tositteen kanta ratkaisee. Jos alennettu kanta (14 % / 13,5 %) tai yleinen (24 % / 25,5 %) ei sovi rivin päivään, rivi saa huomautuksen (`vatRateNote`). Kantaa ei vaihdeta, koska tammikuun tilitys joulukuun toimituksista on oikein 14 %.

## 2. Tukilajit ja lomakkeen 2 kentät

Luokka tulee tukilajista (`SUBSIDY_TYPES`), ei mallilta. Tulkinnat on vahvistettava (BLOCKERS 14 a ja j–m).

| Tukilaji | Esimerkit | Luokka | Kenttä | Epävarma |
|---|---|---|---|---|
| Perustulotuki | suorat tuet | 27 Maataloustuet | 217 | |
| Uudelleenjakotulotuki | | 27 | 217 | |
| Nuoren viljelijän tulotuki | | 27 | 217 | |
| Tuotantosidonnainen tuki | naudat, uuhet, valkuaiskasvit, ruis, sokerijuurikas, tärkkelysperuna | 27 | 217 | |
| Ekojärjestelmätuki | ilmasto- ja ympäristötuki, kasvipeitteisyys | 27 | 217 | |
| Luonnonhaittakorvaus | ja kansallinen lisäosa | 27 | 217 | kyllä (14 a) |
| Ympäristö- ja luomukorvaus | ympäristösitoumus, luomu, alkuperäisrodut | 27 | 217 | kyllä (14 a) |
| Eläinten hyvinvointikorvaus | | 27 | 217 | kyllä (14 a) |
| Pohjoinen tuki | kotieläintuki, maidon tuotantotuki, hehtaarituki | 27 | 217 | |
| Etelä-Suomen kansallinen tuki | kotieläintalouden tuki, 141-tuki | 27 | 217 | |
| Muu kansallinen tuki | kasvihuone, varastointi, kriisituki | 27 | 217 | |
| Ostajan kautta maksettu tuki | meijerin tai ostajan maksama tuki | 28 Muut tuet | 218 | |
| Vahinkokorvaus | riista-, peto-, sato- ja eläintautikorvaus | 29 Muut alv 0 % tulot | 220 | kyllä (14 j) |
| Aloitustuki | nuoren viljelijän aloitustuki | 28 | 218 | kyllä (14 k) |
| Investointituki | | 28, varmuus ≤ 0,4 | ei tuloa | huomautus: Lomake 2 -välilehden investointitukiin |
| Energiaveron palautus | | 30 | 222 | |
| Muu tuki | | 28, varmuus ≤ 0,5 | 218 | kyllä |

Maksuperuste: rivin päivä on maksupäivä, ja se ratkaisee verovuoden. Muun vuoden maksu saa taulukossa päivävaroituksen.

## 3. Aika ja kustannus: maatilan vuosiaineisto 150–300 sivua

Oletukset: pala 8 sivua ja 1 sivun limitys (`config.ts`), pala 30–70 s (koe 28.9.2026), skannattu sivu noin 2 500 syötetokenia (kuva ja teksti; vaihtelee 1 500–3 000), maatalouden ohje noin 5 000 tokenia, vastaus palaa kohden 2 000–6 000 tokenia ajatteluineen (effort medium).

| | 150 sivua | 300 sivua |
|---|---|---|
| Palat | 22 | 43 |
| Luettavat sivut limityksineen | 171 | 342 |
| Kesto ennen muutosta (server actionit jonossa, käytännössä 1 kerrallaan) | 11–26 min | 22–50 min |
| Kesto nyt (reitti, 3 rinnakkain yli 6 palan tiedostolle) | 4–10 min | 8–18 min |
| Vercel-kutsut (≤ 120 s kukin) | 22 | 43 |
| Funktioaika seinäkellona | 11–26 min | 22–50 min |
| Anthropic, syöte (4 $/Mt) | 0,43 Mt ≈ 1,7 $ | 0,86 Mt ≈ 3,4 $ |
| Anthropic, ohje välimuistista (0,20 $/Mt) | ≈ 0,03 $ (ilman välimuistia 0,44 $) | ≈ 0,05 $ (ilman 0,86 $) |
| Anthropic, vastaus (20 $/Mt) | 0,04–0,13 Mt ≈ 0,9–2,6 $ | 0,09–0,26 Mt ≈ 1,7–5,2 $ |
| Anthropic yhteensä (Opus 5.5) | noin 3–5 $ | noin 5–9 $ |

Vercel: jokainen pala on oma kutsunsa, joten 120 s:n raja koskee palaa eikä koko tiedostoa. Fluid computessa laskutetaan aktiivinen CPU (PDF:n palan erotus ja JSON, arviolta 1–3 s palaa kohden) ja varattu muisti seinäkelloajalta. 300 sivua on enintään noin 50 min × 2 Gt ≈ 1,7 Gt-h ja 1–2 min CPU:ta, eli senttejä, ja se mahtuu Pro-tilin kuukausikiintiöön moninkertaisesti. Hinnat on tarkistettava Vercelin hinnastosta ennen käyttöönottoa (BLOCKERS 8 c). Kustannus on käytännössä Anthropicin.

Säädöt tässä muutoksessa:

1. Palat luetaan reitillä `/api/tunnistus/pala` eikä server actionilla. Next.js ajaa selaimen server actionit jonossa yksi kerrallaan (`app-router-instance.js`, action queue), joten `CHUNK_PARALLEL = 2` ei toteutunut, ja aika-arvio oli puolet todellisesta.
2. Yli 6 palan tiedosto luetaan kolmena rinnakkaisena (`chunkParallel`). Kolme palaa noin minuutissa on noin 75 000 syötetokenia minuutissa. Jos Anthropicin käyttötason minuuttiraja on tätä pienempi, osa paloista epäonnistuu (429) ja selain yrittää ne uudelleen; tarvittaessa `CHUNK_PARALLEL_LONG` takaisin kahteen.
3. Järjestelmäohje merkitään välimuistiin (`cache_control`), koska jokainen pala lähettää saman ohjeen. Lyhyt metsäohje jää alle välimuistin alarajan, jolloin merkintä ei maksa mitään.
4. Ehdotuksen rivien yläraja 400 → 1000 (migraatio 0017). Maatilan vuosiaineistosta tulee helposti yli 400 riviä, ja raja katkaisi ylimenevät rivit ilman ilmoitusta.
