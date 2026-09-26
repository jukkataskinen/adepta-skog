# Skog – BLOCKERS

Asiat, jotka odottavat tietoa tai päätöstä.

1. **Ovatko taulut auki anon-avaimelle?** Kirjanpito-, alv-, veroraportti-, verosuunnitelma- ja käyttäjäsivut käyttävät kantaa selaimesta anon-avaimella, vaikka kirjautuminen on Auth0:ssa. Joko taulut ovat auki kaikille avaimen saaneille tai sivut eivät toimi. Jukka tarkistaa Supabasen policyt (26.9.2026).
2. **Auth0:n itserekisteröinti.** Etusivu luo jokaiselle uudelle kirjautujalle oman organisaation. Varmistettava, että Skog-sovelluksessa rekisteröityminen on suljettu.
3. **Uusi Supabase-projekti.** Jukka luo projektin ja antaa osoitteen ja avaimet `.env.local`:iin ja Verceliin.
4. **Verosäännöt.** Metsävähennyksen, poistojen ja arvonlisäveron prosentit ja rajat vahvistetaan Verohallinnon ohjeista verovuosittain. Vanhan sovelluksen laskenta on lähtökohta, mutta sen lähteitä ei ole kirjattu.
5. **Hankintatyön 125 m³ ja koneen vaihto.** Mainitaan `brief.md`:ssä, mutta vanhassa sovelluksessa niitä ei ole. Tarvitaan kuvaus siitä, miten kirjanpitäjä käyttää niitä ja mihin raporttiin ne kuuluvat.
