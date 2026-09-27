# Skog – BLOCKERS

Asiat, jotka odottavat tietoa tai päätöstä.

1. ~~**Ovatko taulut auki anon-avaimelle?**~~ Ratkaistu 26.9.2026 rivimäärillä: eivät ole. `asiakkaat`, `tapahtumat`, `metsatilat`, `investoinnit` ja `metsavahennykset` antavat anon-avaimella virheen (policy lukee asetusta `app.current_org_id`, jota ei ole asetettu). `kayttajat`, `organisaatiot`, `arkisto` ja `poistot` palauttavat nolla riviä. Kirjoitusoikeutta ei testattu. Seuraus: selaimesta kantaa käyttävät sivut (kirjanpito, alv, veroraportti, verosuunnitelma, käyttäjät) eivät saa tietoja. Korjattu 27.9.2026 (DECISIONS), myös `/asiakkaat`-sivut ja etusivu.
2. **Auth0:n itserekisteröinti.** Etusivu loi jokaiselle uudelle kirjautujalle oman organisaation. 27.9.2026 alkaen ei enää luo, ja tuntematon kirjautuja näkee tyhjät sivut. Varmistettava, että Skog-sovelluksessa rekisteröityminen on suljettu.
3. **Uusi Supabase-projekti.** Jukka luo projektin ja antaa osoitteen ja avaimet `.env.local`:iin ja Verceliin.
4. **Verosäännöt.** Metsävähennyksen, poistojen ja arvonlisäveron prosentit ja rajat vahvistetaan Verohallinnon ohjeista verovuosittain. Vanhan sovelluksen laskenta on lähtökohta, mutta sen lähteitä ei ole kirjattu.
5. **Hankintatyön 125 m³ ja koneen vaihto.** Mainitaan `brief.md`:ssä, mutta vanhassa sovelluksessa niitä ei ole. Tarvitaan kuvaus siitä, miten kirjanpitäjä käyttää niitä ja mihin raporttiin ne kuuluvat.
