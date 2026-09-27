# Skog – DECISIONS

## 2026-09-27

**Veroraportti ja verosuunnitelma API-reittien kautta.** Asiakassivun Verosuunnitelma- ja Veroraportti-välilehdet näyttävät nämä sivut iframessa, ja arkiston "Avaa raportti" vie veroraporttiin, joten sivuja ei voinut poistaa. Kantakutsut siirrettiin reiteille `/api/veroraportti` ja `/api/verosuunnitelma`, jotka rajaavat asiakkaan organisaatioon kuten muut reitit. Selain ei enää saa anon-avainta. Ilman asiakasta sivut ohjaavat asiakassivulle.

**Käyttäjäsivu korjattiin, kirjanpito- ja ALV-sivut ohjataan asiakassivulle.** Käyttäjäsivulle vie etusivun kortti, eikä sille ole korvaavaa näkymää, joten lista, roolin vaihto ja käytöstä poisto siirrettiin reiteille `/api/kayttajat?kaikki=1` ja `/api/kayttajat/[id]` (vain pääkäyttäjä, ei omaa tiliä). Kirjanpidolle ja ALV:lle on välilehti ja ALV-yhteenveto asiakassivulla, joten niiden HTML poistettiin ja vanhat osoitteet ohjaavat `/asiakas`-sivulle.

**Verovuosi: pyydetty, asiakkaan avoin tai kuluva vuosi.** Valinta on yhdessä paikassa (`lib/vuosi.ts`), ja kuluva vuosi lasketaan Suomen ajassa. Vuosivalintojen listat lasketaan avoimen ja kuluvan vuoden ympäriltä. Hankintatyön "ohjetaksat 2025" jäi, koska se kertoo taksojen vuoden.

**Verosuunnitelmaa ei tallenneta suljetulle vuodelle.** Reitti hylkää tallennuksen, jos vuosi ei ole asiakkaan avoin vuosi, koska suljetun vuoden luvut on voitu jo ilmoittaa verottajalle.

## 2026-09-26

**Uudelleenrakennus eRapun ja Mittarilukeman pohjalle.** Vanha sovellus käyttää service role -avainta, joten organisaatiorajaus on jokaisen reitin varassa, ja se oli unohtunut tapahtumista, arkistosta ja investoinneista. Osa sivuista käyttää kantaa suoraan selaimesta anon-avaimella. Yhteisellä pohjalla rajaus tulee kannan RLS:stä, ja kaikissa projekteissa on samat toiminnot ja käytännöt.

**Rakennetaan samaan repoon `v2`-haaraan.** Vanha sovellus pysyy tuotannossa `main`-haarassa, kunnes uusi on ajettu rinnakkain. Vanha koodi siirretään `v2`:ssa `legacy/`-kansioon, koska laskentasäännöt luetaan sieltä ja vertailu tehdään sitä vasten.

**Oma Supabase-projekti.** Nykyinen `skog`-projekti on yhteinen Kasamasterin ja adepta-ppr:n kanssa, ja 3.9.2026 huomattiin, että yhden sovelluksen julkinen avain avasi naapurien tiedot (Mittarilukeman DECISIONS 24.9.2026). Asiakkaiden verotiedot kuuluvat omaan projektiin. Alue eu-central-1 kuten nykyinen.

**Taulut englanniksi etuliitteellä `sk_`.** Sama käytäntö kuin eRapussa (`er_`) ja Mittarilukemassa (`ml_`). Vanhan kannan suomenkieliset nimet muunnetaan tiedonsiirrossa.

**Roolit `owner` ja `staff`.** Vastaavat vanhan sovelluksen pääkäyttäjää ja kirjanpitäjää. Kirjanpitäjä näkee vain asiakkaat, joiden vastuukirjanpitäjä hän on, kuten vanhassa asiakaslistassa.

**Push vain luvalla.** `brief.md`:n sessiosääntö ("commit and push") korvautuu tällä: push `main`-haaraan julkaisee tuotantoon.
