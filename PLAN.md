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
- Kirjaukset ovat metsätalouden tuloja ja menoja verovuosittain: summa ilman arvonlisäveroa, arvonlisäveroprosentti, luokka, ennakonpidätys.
- Investoinnit (koneet, tiet, ojat) poistetaan tasapoistona tai menojäännöspoistona (25 %). Myyty kone poistuu poistolaskelmasta, ja myynnistä lasketaan myyntivoitto.
- Metsävähennyksen pohja on 60 % metsämaan hankintamenosta. Kertymää seurataan metsätiloittain.
- Arvonlisävero lasketaan niille asiakkaille, jotka ovat arvonlisäverorekisterissä.
- Verosuunnitelma arvioi vuoden verotettavan pääomatulon ja auttaa valitsemaan metsävähennyksen ja poistojen määrän. Kun suunnitelma vahvistetaan, vuoden poistot ja metsävähennys tallentuvat ja vuosi voidaan sulkea.
- Veroraportti on PDF, jossa on kansilehti ja sisällysluettelo. Se tukee veroilmoitusta (2C-lomake) ja arkistoidaan verovuosittain tositteineen.

## Tietomallin runko (luonnos)

- **Organisaatio** (kirjanpitotoimisto) → **käyttäjät** (rooli)
- **Asiakas** (vastuukirjanpitäjä, arvonlisäverorekisteröinti, yhteystiedot) → **metsätila** → **metsävähennyskertymä** verovuosittain
- **Verovuosi** asiakkaalle: avoin / suljettu, sulkemisen tekijä ja aika
- **Kirjaus**: päivä, tyyppi (tulo / meno), luokka, summa ilman arvonlisäveroa, arvonlisäveroprosentti, ennakonpidätys, viite, tosite
- **Investointi** → **poisto** verovuosittain (määrä ja jäännösarvo vuoden lopussa)
- **Arkisto**: verovuoden raportti ja tositteet (Storage)

## Vaiheet

### 0. Vanhan sovelluksen korjaukset (`main`)
- [x] Päivittäinen ping pitää Supabase-projektit hereillä (26.9.2026)
- [x] API-reitit tarkistavat asiakkaan organisaation (26.9.2026)
- [~] Selvitä, ovatko taulut auki anon-avaimelle (BLOCKERS 1). Jos ovat: siirrä kirjanpito-, alv-, veroraportti-, verosuunnitelma- ja käyttäjäsivujen kantakutsut API-reiteille ja sulje anon-policyt.
- [ ] Poista kovakoodattu verovuosi 2025 kuudesta reitistä: käytä asiakkaan avointa vuotta tai kuluvaa vuotta.
- [ ] Varmista Auth0:ssa, että itserekisteröinti on suljettu (BLOCKERS 2).

### 1. Perusta (`v2`)
- [ ] `v2`-haara. Vanha `app/`, `lib/` ja `middleware.ts` siirretään `legacy/`-kansioon lähteeksi ja rajataan pois buildista ja tyyppitarkistuksesta.
- [ ] Runko Mittarilukemasta: Next 15, React 19, Tailwind 4, zod 4, vitest, eslint. Kopioi `src/lib/db`, `src/lib/auth`, `src/lib/forms.ts`, `src/lib/audit.ts`, `src/lib/format.ts`, `src/lib/help`, `src/components`, `tests/helpers`, `scripts/db`. Poista vesihuoltoon liittyvä.
- [ ] Migraatio 0001: `sk_organizations`, `sk_members` (rooli), `sk_audit_log`, `sk_check_same_org`, RLS-testit.
- [ ] Kirjautuminen: dev-tila ja Auth0 (nykyinen Skog-sovellus Auth0:ssa), ei itserekisteröintiä.
- [ ] Oma Supabase-projekti (BLOCKERS 3), osoite Verceliin, migraatiot buildissa.
- [ ] Vercelin v2-esikatselu omalla kannallaan. Tuotanto pysyy vanhassa.
- [ ] Ping-reitti ja cron uuteen runkoon.
- [ ] `.gitignore` ja CI-vahti henkilötiedoille.

### 2. Tietomalli ja tiedonsiirto
- [ ] Migraatiot: `sk_clients`, `sk_forest_properties`, `sk_tax_years`, `sk_transactions`, `sk_assets`, `sk_depreciations`, `sk_forest_deductions`, `sk_archive`, `sk_attachments`. RLS: `staff` näkee vain asiakkaat, joiden vastuukirjanpitäjä hän on.
- [ ] Storage-ämpäri tositteille ja raporteille organisaation kansioon, policyt.
- [ ] Demodata (`db:seed:demo`): kuvitteellinen toimisto, kolme asiakasta, kaksi verovuotta.
- [ ] Tiedonsiirto vanhasta kannasta (`tuo:vanha`): vain luku, `--kuiva` tulostaa määrät. Tositteet base64-kentästä Storageen.
- [ ] Vanhan kannan rakenne talteen `legacy/schema.sql`:ään vertailua varten (ilman tietoja).

### 3. Perusnäkymät
- [ ] Asiakaslista ja haku, uusi asiakas, vastuukirjanpitäjän vaihto
- [ ] Asiakkaan sivu välilehdillä: tiedot, kirjanpito, arvonlisävero, verosuunnitelma, veroraportti, arkisto
- [ ] Metsätilat: lisäys, muokkaus, metsävähennyspohja
- [ ] Verovuoden valinta asiakkaalle, suljettu vuosi vain luettavana
- [ ] Käyttäjät: kutsu sähköpostilla (Auth0), rooli, poisto käytöstä
- [ ] Ohjeet kaikille näkymille, ohjelinkki jokaiselle sivulle

### 4. Kirjanpito
- [ ] Kirjausten syöttö taulukkona, tallennus rivi kerrallaan (ei koko vuoden poistoa ja uudelleen kirjoitusta)
- [ ] Tositteen liittäminen kirjaukseen (Storage)
- [ ] Luokat ja arvonlisäveroprosentit verovuoden säännöistä
- [ ] Investoinnin kirjaus kirjauksesta, koneen myynti ja myyntivoitto

### 5. Verolaskenta (`src/lib/tax`)
- [ ] Verosäännöt verovuosittain (`rules.ts`): prosentit ja rajat, lähde kommenttiin (BLOCKERS 4)
- [ ] Arvonlisävero: kausiyhteenveto ja vuosi
- [ ] Poistot: tasapoisto ja menojäännöspoisto, jäännösarvo, myynti
- [ ] Metsävähennys: pohja, käytetty kertymä, vuoden enimmäismäärä
- [ ] Hankintatyön kertymä verovuodessa (BLOCKERS 5)
- [ ] Verosuunnitelma: verotettava pääomatulo, metsävähennyksen ja poistojen valinta, vahvistus tallentaa poistot ja vähennyksen
- [ ] Vertailu vanhaan sovellukseen (`vertaa:vero`): vuoden 2025 luvut asiakkaittain, erot selitettynä

### 6. Raportit ja arkisto
- [ ] Veroraportti PDF:nä: kansilehti, sisällysluettelo, tulot ja menot, arvonlisävero, poistot, metsävähennys, LUONNOS-vesileima avoimelle vuodelle
- [ ] Verovuoden sulkeminen: vahvistus, lukitus, raportti arkistoon
- [ ] Arkisto: raportit ja tositteet verovuosittain, lataus

### 7. Käyttöönotto
- [ ] Rinnakkaisajo: sama vuosi molemmissa, erot selitetty
- [ ] Lopullinen tiedonsiirto, `v2` → `main`, skog.adepta.fi uuteen
- [ ] Vanha Skog-data pois yhteisestä Supabase-projektista, kun Kasamaster ja adepta-ppr eivät sitä tarvitse
- [ ] `legacy/` pois

### Myöhemmin
- [ ] Kuittiskanneri mobiilissa: kuva tositteesta, tekoäly tunnistaa summan, päivän ja toimittajan (mock oletuksena)
- [ ] Metsänomistajan oma näkymä (vain luku)
- [ ] Yhteinen pohjarepo eRapulle, Mittarilukemalle ja Skogille (`TEMPLATES`)
