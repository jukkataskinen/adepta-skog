# Skog – BLOCKERS

Asiat, jotka odottavat tietoa tai päätöstä.

1. ~~**Ovatko taulut auki anon-avaimelle?**~~ Ratkaistu 26.9.2026 rivimäärillä: eivät ole. `asiakkaat`, `tapahtumat`, `metsatilat`, `investoinnit` ja `metsavahennykset` antavat anon-avaimella virheen (policy lukee asetusta `app.current_org_id`, jota ei ole asetettu). `kayttajat`, `organisaatiot`, `arkisto` ja `poistot` palauttavat nolla riviä. Kirjoitusoikeutta ei testattu. Seuraus: selaimesta kantaa käyttävät sivut (kirjanpito, alv, veroraportti, verosuunnitelma, käyttäjät) eivät saa tietoja.
2. **Auth0:n itserekisteröinti.** Etusivu luo jokaiselle uudelle kirjautujalle oman organisaation. Varmistettava, että Skog-sovelluksessa rekisteröityminen on suljettu.
3. ~~**Uusi Supabase-projekti.**~~ Ratkaistu 26.9.2026: projekti luotu (eu-west-1), migraatiot 0001–0003 ajettu. Alkuperäinen: Jukka luo projektin ja antaa osoitteen ja avaimet `.env.local`:iin ja Verceliin.
4. **Verosäännöt.** Vahvistettava Verohallinnon ohjeista (26.9.2026). Uusi sovellus poikkeaa vanhasta kahdessa kohdassa:
   1) Metsävähennyksen vuosiraja: uusi 60 % metsätalouden puhtaasta pääomatulosta (poistojen jälkeen, ennen vähennystä), vanha 60 % bruttotuloista.
   2) Menojäännöspoiston pohja: uusi poistamaton arvo vuoden alussa (edellisen vuoden loppuarvo), vanha hankintahinta miinus jäännösarvo joka vuosi.
   Lisäksi: myyntivuonna ei poistoa, myyntihinnan ja poistamattoman arvon erotus on myyntivoittoa tai -tappiota; metsävähennys jaetaan tiloille järjestyksessä.
5. **Hankintatyön 125 m³ ja koneen vaihto.** Korjaus 26.9.2026: vanhassa sovelluksessa on hankintatyön laskuri (legacy/app/asiakas/asiakas.html, HT_TAKSAT: puutavaralajin taksa €/m³ ja kuljetuslisä, 125 m³ raja), joka kirjaa menorivin luokalla Hankintatyö. Taksojen vuosi ja lähde on vahvistettava, ja laskuri kysyi tekijän henkilötunnuksen, jota uusi sovellus ei käsittele. Koneen vaihto: myynti on luokka Käyttöomaisuuden myynti, myyntivoiton laskenta vaiheessa 5. Tarvitaan kuvaus siitä, miten kirjanpitäjä käyttää niitä ja mihin raporttiin ne kuuluvat.
6. ~~**Vanhan kannan osoite tiedonsiirtoon.**~~ Ratkaistu 26.9.2026: lukukäyttäjä `skog_lukija` (bypassrls, vain select). Alkuperäinen: `npm run tuo:vanha` tarvitsee `.env.local`:iin `LEGACY_DATABASE_URL`:n (vanhan skog-projektin tietokantaosoite, Supabase → Connect). Sen jälkeen: `--lista` näyttää organisaatiot, ja `--kuiva` koeajaa tuonnin paikalliseen kantaan. Samalla vanhan kannan rakenne talteen `legacy/schema.sql`:ään.
