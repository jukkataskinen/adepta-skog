# Skog – rakennusohje Claude Codelle

Metsätalouden kirjanpito- ja verosuunnitteluohjelma kirjanpitotoimistolle. Toimisto hoitaa asiakkaidensa (metsänomistajien) metsätilat, kirjaukset, arvonlisäveron, poistot, metsävähennyksen, verosuunnitelman ja veroraportin. Tuotanto: skog.adepta.fi.

Ohjelma rakennetaan uudelleen samalle pohjalle kuin eRappu (`../Claude-cowork/PROJECTS/erappu`) ja Mittarilukema (`../Claude-cowork/PROJECTS/mittarilukema`). Mittarilukema on pohjan siistein versio: kopioi yhteinen runko sieltä ja muuta vain se, mikä on Skogille omaa. Vanha sovellus (`app/`, `lib/`, HTML-sivut) on käytössä, kunnes uusi on otettu käyttöön, ja se toimii laskentasääntöjen lähteenä.

**Älä kysy käyttäjältä mitään, mikä on tässä tai DECISIONS.md:ssä päätetty.** Jos joudut tekemään uuden päätöksen, tee se tämän dokumentin hengessä ja kirjaa se `DECISIONS.md`:ään. Jos et voi edetä puuttuvan tiedon takia, kirjaa asia `BLOCKERS.md`:hen ja jatka seuraavaan tehtävään.

## Työskentelyprotokolla

1. Lue `CLAUDE.md`, `PLAN.md`, `DECISIONS.md` ja `BLOCKERS.md`.
2. Tee `PLAN.md`:n seuraava tekemätön tehtävä kokonaan: koodi, testit, migraatio ja dokumentaatio.
3. Aja `npm run lint && npm run typecheck && npm run test`. Korjaa virheet ennen jatkamista.
4. Merkitse tehtävä tehdyksi `PLAN.md`:ssä ja kirjaa päätökset `DECISIONS.md`:ään (päivä, päätös, perustelu 1–3 riviä).
5. Commitoi. Pushaa vain Jukan luvalla: push `main`-haaraan julkaisee Verceliin tuotantoon.

Uusi sovellus rakennetaan `v2`-haaraan (DECISIONS 26.9.2026). `main` on vanha tuotantosovellus, ja siihen tehdään vain korjauksia, kunnes `v2` yhdistetään.

## Säännöt

- **Käyttöliittymä suomeksi, koodi ja tietokanta englanniksi.** Kommentit suomeksi ja ne kertovat *miksi*. Sävy: sinuttelu, rauhallinen, ei huutomerkkejä, ei emojeita.
- **Jokainen uusi taulu:** etuliite `sk_`, `organization_id`, RLS päälle, policyt ja eksplisiittiset GRANTit (`authenticated`, `service_role`). Viittaus toiseen tauluun saman organisaation sisällä varmistetaan triggerillä `sk_check_same_org`. Lisää taulu `tests/db/rls.test.ts`:n listaan.
- **Kaikki kantakutsut `src/lib/db`-kerroksen kautta:** `db.asUser(sub, tx => ...)` käyttäjän RLS-transaktiossa. `db.asService` vain skripteihin, kirjautumiseen ja taustatöihin. Ei supabase-js:ää, ei service role -avainta sivuilla, ei kantakutsuja selaimesta. Tämä on vanhan sovelluksen suurin virhe: rajaus oli jokaisen reitin varassa, ja se unohtui.
- **Henkilötiedot:** asiakastiedostot, tositteet, varmuuskopiot ja viennit eivät koskaan gittiin (`.gitignore`, CI-vahti). Skriptit tulostavat vain määriä. Ei henkilötietoja URL-osoitteisiin, lokeihin tai virheviesteihin. Henkilötunnuksia ei tallenneta; niitä voi kysyä vain ilmoitustiedostoa muodostettaessa (2C: ilmoittaja ilman Y-tunnusta ja hankintatyön tekijät), ja ne ovat vain palautettavassa tiedostossa: ei kantaan, Storageen, lokeihin, audit-tietoihin, URL-osoitteisiin eikä virheviesteihin (Jukan päätös 28.9.2026). Y-tunnus ja kiinteistötunnus saa tallentaa.
- **Muutokset lokiin:** `audit()` samassa transaktiossa kuin muutos.
- **Lomakkeet:** server action → `parseForm(schema, formData, backTo)`. Virhe `?virhe=`-parametrilla, sivu näyttää sen `<FormError>`-komponentilla.
- **Päivämäärät ja rahat:** kanta `date` ja `numeric(14,2)`, näyttö `src/lib/format.ts` (Europe/Helsinki). Pinta-alat `numeric(12,2)`, kuutiot `numeric(12,1)`, prosentit `numeric(5,2)`.
- **Verolaskenta puhtaina funktioina** `src/lib/tax/`-kansiossa: ei kantakutsuja, syöte sisään ja tulos ulos, yksikkötestit `tests/unit/tax/`. Verosäännöt, joilla on vuosikohtainen arvo (prosentit, rajat), ovat `src/lib/tax/rules.ts`:ssä verovuoden mukaan eikä koodin seassa.
- **Suljettu verovuosi on lukittu.** Kun vuosi suljetaan, sen kirjauksia, poistoja ja metsävähennyksiä ei voi muuttaa ilman avausta, ja avaus kirjataan lokiin.
- **Tiedostot** (tositteet, arkistoidut raportit) Supabase Storageen organisaation kansioon, ei kantaan base64:nä.
- **Ulkoiset palvelut** (sähköposti, tekoälytunnistus) moduulin `index.ts`-rajapinnan takana, ja mock-toteutus on oletus, kun avain puuttuu.
- **Ohjeet:** kun toiminto muuttuu tai syntyy, päivitä sen ohje `src/lib/help/topics.ts`:ssä samassa muutoksessa, selkokielisenä: lyhyet lauseet, arkisanat, vaiheet numeroituina, ei teknisiä termejä. Kesken oleva toiminto merkitään `upcoming: true`. Uusi sivu lisätään ohjekarttaan `src/lib/help/routes.ts` (testi `tests/unit/help-routes.test.ts`).
- **Vanhaan tuotantokantaan ei kirjoiteta.** Tiedot siirretään sieltä vain lukemalla, ja vain Jukan luvalla.

## Lukitut päätökset

| Aihe | Päätös |
|---|---|
| Runko | Next.js 15 App Router, React 19, TypeScript strict, Tailwind 4, zod 4. Palvelinkomponentit ja server actionit. |
| Ulkoasu | eRapun ja Mittarilukeman perusilme (`src/app/globals.css`, `src/components/ui.tsx`): `ink`, `cloud`, `line`, `sky` = toiminto, `coral` = vaatii huomiota, `moss` = valmis, `amber` = odottaa. Plus Jakarta Sans. Työpöytä ensin (`StaffShell`). |
| Tietokanta | Paikallisesti PGlite (`.data/pglite`), tuotannossa **oma** Supabase-projekti (eu-west-1, Irlanti), jota mikään muu sovellus ei käytä. Migraatiot `supabase/migrations/NNNN_nimi.sql`: paikallisesti automaattisesti, Supabaseen Vercelin tuotantobuildissa (`scripts/db/migrate-remote.mts`). |
| Kirjautuminen | `AUTH_MODE=dev` kehityksessä (käyttäjän valinta, estetty tuotannossa), `AUTH_MODE=auth0` tuotannossa. Ei itserekisteröintiä: käyttäjä lisätään kutsulla tai skriptillä. |
| Roolit | `owner` pääkäyttäjä (kaikki asiakkaat, käyttäjät, vuoden sulkeminen), `staff` kirjanpitäjä (asiakkaat, joiden vastuukirjanpitäjä hän on). |
| Organisaatio | Kirjanpitotoimisto. Asiakas (metsänomistaja) ei kirjaudu ohjelmaan ensimmäisessä versiossa. |

## Rakenne (tavoite)

```
src/app/(henkilokunta)/     sivut (StaffShell, requireStaff)
src/app/kirjaudu/           kirjautuminen
src/app/api/                ping (cron), tiedostojen lataus, tositteen palan tunnistus (tunnistus/pala)
src/app/tietosuoja/          julkinen tietosuojasivu (alikäsittelijät src/lib/privacy, asiakirjat docs/tietosuoja)
src/lib/db/                 kantakerros (PGlite / Postgres), kopio Mittarilukemasta
src/lib/auth/               istunto, käyttäjä ja roolit, kopio Mittarilukemasta
src/lib/forms.ts            parseForm, FormError
src/lib/audit.ts            muutosloki
src/lib/help/               ohjeet ja ohjekartta
src/lib/feature-requests.ts kehitystoiveet (toiminnot = ohjesivuston aiheet)
src/lib/members.ts          käyttäjien lisäys, kutsu, roolit, käytöstä poisto
src/lib/email/              sähköposti (mock / Resend)
src/lib/accounts/           Auth0-tunnusten luonti kutsussa (mock / Management API)
src/lib/clients/            asiakkaat ja vastuukirjanpitäjä
src/lib/properties/         metsätilat
src/lib/ledger/             kirjaukset ja tositteet
src/lib/assets/             aiemmin hankitut investoinnit (prior.ts: menojäännös, lisäys, muutos, poisto)
src/lib/tax/                verolaskenta: alv, poistot, metsävähennys, verosuunnitelma, säännöt; maatalous (agriculture.ts lomake 2, agri-depreciation.ts ryhmäpoistot, income-split.ts yritystulon jako, agri-plan.ts verosuunnitelman maatalousosa ja tasausvaraus tiloittain, vehicle.ts ajoneuvo- ja matkaselvitys)
src/lib/reports/            veroraportti PDF:nä, arkistointi
src/lib/filing/             sähköiset veroilmoitukset: 2C (vsy02c.ts) ja maatalouden lomake 2 (vsy002.ts, kentät vsy002-fields.ts) samaan tiedostoon (load, download)
src/lib/agriculture/        Maatalous-välilehden tiedot: vuoden tiedot, maatilat, varaukset, jaksotukset, tuet, harvinaiset kentät, ryhmäpoistot, ajoneuvoselvitys (vehicle.ts)
src/lib/years/              verovuoden avaus, sulkeminen ja lukitus
src/lib/compare/            vertailu vanhaan sovellukseen (legacy-tax) ja Tilitukin lomakkeeseen 2 (tilituki)
src/lib/import/             tiedonsiirto vanhasta kannasta: muunnokset (legacy.ts) ja kirjoitus (run.ts); tuotujen rivien tunnisteet (origin.ts)
src/lib/import/tilituki/    Tilituki Pro -tuonti: kartoitus veronumerosta ja vuoden suunnitelma (map.ts), metsän kaluston historia (history.ts), kirjoitus (run.ts)
scripts/tilituki/           Tilitukin DBF-taulujen jäsennys Pythonilla (dbf.py, parse.py) → data/private/tilituki
src/lib/storage/            tositteet ja raportit: paikallinen kansio tai Supabase Storage
src/lib/ai/receipts/        tositteiden tunnistus: index (tila), anthropic (Claude), mock ja mock-agri, schema (tarkistus), agri (maatalouden lajit, tukilajit, huomautukset), reconcile (täsmäytys), config/chunks/pdf/merge (osissa)
src/lib/documents/          vuoden tositteet ja tunnistuksen ehdotukset
supabase/migrations/        0001–
tests/db/                   RLS- ja kantatestit (tests/helpers/db.ts: freshDb, seedOrg)
tests/unit/                 puhdas logiikka, erityisesti tests/unit/tax/
scripts/                    kannan ylläpito, tiedonsiirto, vertailu vanhaan sovellukseen
legacy/                     vanha sovellus v2-haarassa vain lähteenä, poistetaan käyttöönoton jälkeen
```

## Komennot (tavoite)

```
npm run dev                  kehityspalvelin (PGlite)
npm run db:reset             tyhjä paikallinen kanta
npm run db:seed:demo         kuvitteellinen demodata
npm run tuo:vanha -- --org "Nimi" [--kuiva] [--tuotanto]      tiedot vanhasta Skog-kannasta
npm run vertaa:vero -- --vuosi 2025 [--tuotanto]             veroraportin luvut vanhaa sovellusta vasten
python scripts/tilituki/parse.py <Tilitukin datakansio>       Tilituki Pro -asiakkaat → data/private/tilituki/<kansio>.json
npm run tilituki:tuo -- [--kansio N,M] [--vuosi 2023,2024,2025] [--org "Nimi"] [--luo] [--metsa] [--avaa 2026] [--tarkista] [--kuiva] [--tuotanto]   asiakkaat Tilitukista, metsän kalusto koko historiana
npm run tilituki:tarkista -- [--kansio N,M] [--vuodet 2023,2024,2025] [--tuotanto]   menojäännökset Tilitukin kortistoa ja lomakkeita vasten
npm run tilituki:vertaa -- [--vuosi 2025] [--kansio N] [--tuotanto]   Skogin lomake 2 Tilitukin lomaketta vasten
npm run kayttaja:lisaa -- --email x --org "Nimi" --rooli owner [--luo-org] [--tuotanto]
npm run lint && npm run typecheck && npm run test
```

`--tuotanto` kirjoittaa uuteen Supabase-projektiin `.env.local`:n osoitteella. Käytä vain Jukan luvalla.
