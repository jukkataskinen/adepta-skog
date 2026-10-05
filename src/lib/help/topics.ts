import type { IconName } from "@/components/NavIcon";

/**
 * Ohjesivujen sisältö (/ohjeet). Etusivu esittelee toiminnot, ja se sopii
 * myös myyntiesittelyyn, joten tekstit kertovat ensin hyödyn ja sitten
 * käytön. Sisällössä ei ole asiakastietoja. Kun toiminto muuttuu, päivitä
 * sen ohje samassa muutoksessa.
 */

export interface HelpSection {
  title: string;
  text?: string;
  steps?: string[];
  bullets?: string[];
}

export interface HelpTopic {
  slug: string;
  group: string;
  icon: IconName;
  title: string;
  /** Yhden lauseen hyöty etusivun kortille. */
  summary: string;
  /** Kortin ja ohjeen alun kohokohdat. */
  highlights: string[];
  /** Sovelluksen sivu, josta toiminto löytyy. */
  appPath?: string;
  appLabel?: string;
  sections: HelpSection[];
  tips?: string[];
  related?: string[];
  /** Kehitteillä oleva toiminto: näytetään merkinnällä. */
  upcoming?: boolean;
}

/**
 * Ohjekirjan luvut sisällysluettelon järjestyksessä. Etusivu näyttää ne tässä
 * järjestyksessä, ja jokaisella aiheella on yksi luku.
 */
export const HELP_GROUPS = [
  "Aloitus",
  "Kirjanpito",
  "Tositteet ja tunnistus",
  "Investoinnit ja poistot",
  "Metsätalous",
  "Maatalous",
  "Arvonlisävero",
  "Verosuunnitelma",
  "Raportit ja veroilmoitus",
  "Käyttäjät ja asetukset",
  "Vanhoista ohjelmista siirtyminen",
  "Usein kysyttyä",
];

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "aloitus",
    group: "Aloitus",
    icon: "door",
    title: "Näin pääset alkuun",
    summary: "Ensimmäiset askeleet: kirjaudu, lisää asiakas, avaa verovuosi ja kirjaa. Lopuksi teet verosuunnitelman ja raportin ja suljet vuoden.",
    highlights: ["Kirjautuminen kutsun sähköpostilla", "Asiakas ja hänen toimintonsa", "Verovuoden avaus ja sulkeminen", "Vuoden työ järjestyksessä"],
    appPath: "/tyopoyta",
    appLabel: "Työpöytä",
    sections: [
      {
        title: "Kirjautuminen",
        steps: [
          "Saat sähköpostiin kutsun, kun pääkäyttäjä lisää sinut.",
          "Jos sinulla ei vielä ole tunnusta, aseta salasana kutsun linkistä.",
          "Avaa Skog selaimessa ja valitse Kirjaudu.",
          "Kirjaudu samalla sähköpostiosoitteella, johon kutsu tuli.",
          "Ohjelma avaa työpöydän.",
        ],
        bullets: [
          "Itse ei voi rekisteröityä. Jos et pääse sisään, pyydä pääkäyttäjää lähettämään kutsu uudelleen.",
          "Kun lopetat, valitse Kirjaudu ulos.",
        ],
      },
      {
        title: "Ohjelman osat",
        bullets: [
          "Vasemmalla on valikko: Työpöytä, Asiakkaat, Asetukset, Kehitystoiveet ja Ohjeet. Asetukset näkyy vain pääkäyttäjälle.",
          "Asiakkaan sivulla on välilehdet Tiedot, Kirjanpito, Investoinnit, Arvonlisävero, Verosuunnitelma sekä Veroraportti ja arkisto.",
          "Jos asiakkaalla on maatila, kirjanpito on kahdella välilehdellä: Metsätalouden kirjanpito ja Maatalouden kirjanpito. Lisäksi on välilehti Lomake 2.",
          "Välilehdillä on ylhäällä Verovuosi-valikko. Kun valitset vuoden, sivu vaihtuu heti.",
          "Jokaisen sivun yläkulmassa on Ohje. Se avaa sen sivun ohjeen uuteen välilehteen.",
          "Sen vieressä on Kehitystoive. Sillä kerrot, mitä toivot sivulle.",
        ],
      },
      {
        title: "Asiakkaan lisäys",
        steps: [
          "Valitse valikosta Asiakkaat.",
          "Valitse Lisää asiakas.",
          "Kirjoita nimi. Yhtymän tai kuolinpesän nimi kirjoitetaan kenttään Sukunimi tai yrityksen nimi.",
          "Valitse toiminnot: Harjoittaa metsätaloutta (2C), Harjoittaa maataloutta (lomake 2) tai molemmat.",
          "Rastita Arvonlisäverorekisterissä, jos asiakas on rekisterissä.",
          "Valitse Lisää asiakas. Kuluva verovuosi avautuu heti.",
          "Jos asiakkaalla on metsää, lisää metsätilat asiakkaan sivulla: Lisää metsätila.",
        ],
      },
      {
        title: "Verovuoden avaus",
        steps: [
          "Avaa asiakas. Verovuodet ovat Tiedot-välilehden alaosassa.",
          "Kirjoita vuosi kohtaan Uusi vuosi. Ohjelma ehdottaa seuraavaa vuotta.",
          "Valitse Avaa vuosi.",
          "Vuosi näkyy nyt kaikkien välilehtien Verovuosi-valikossa.",
        ],
      },
      {
        title: "Vuoden työ järjestyksessä",
        steps: [
          "Kirjaa vuoden tulot ja menot kirjanpitoon. Voit lisätä tositteet ja antaa ohjelman ehdottaa kirjaukset.",
          "Tarkista Arvonlisävero-välilehti, jos asiakas on arvonlisäverorekisterissä.",
          "Tee verosuunnitelma: valitse poistot ja metsävähennys. Maatilalla valitset myös tasausvarauksen ja pääomatulo-osuuden.",
          "Valitse Vahvista suunnitelma.",
          "Avaa Veroraportti ja arkisto. Tarkista raportti ja lataa veroilmoituksen tiedosto.",
          "Kun kaikki on valmista, pääkäyttäjä sulkee vuoden.",
        ],
      },
      {
        title: "Vuoden sulkeminen",
        steps: [
          "Pääkäyttäjä avaa asiakkaan Tiedot-välilehden.",
          "Hän valitsee vuoden kohdalta Sulje vuosi. Toinen tapa on verosuunnitelman painike Vahvista ja sulje vuosi.",
          "Lopullinen veroraportti tallentuu arkistoon.",
        ],
        bullets: [
          "Suljetun vuoden kirjauksia, tositteita, poistoja ja metsävähennystä ei voi muuttaa.",
          "Jos jotain pitää korjata, pääkäyttäjä valitsee Avaa vuosi. Avaus jää lokiin.",
          "Kun vuosi suljetaan uudelleen, arkistoon tulee uusi raportti. Vanha säilyy.",
        ],
      },
    ],
    tips: ["Kokeile ohjelmaa ensin yhdellä tutulla asiakkaalla.", "Jos jokin ei toimi niin kuin odotat, katso Usein kysyttyä tai jätä kehitystoive."],
    related: ["asiakkaat", "kirjanpito", "usein-kysyttya"],
  },
  {
    slug: "tyopoyta",
    group: "Aloitus",
    icon: "home",
    title: "Työpöytä",
    summary: "Työpöydältä näet, mitä toimistossa on meneillään.",
    highlights: ["Toimiston nimi ja käyttäjät", "Tulossa olevat toiminnot"],
    appPath: "/tyopoyta",
    appLabel: "Työpöytä",
    sections: [
      {
        title: "Mitä työpöydällä on",
        bullets: [
          "Ylhäällä on toimiston nimi.",
          "Luku kertoo, montako käyttäjää toimistolla on.",
          "Tulossa-listassa ovat toiminnot, joita tehdään. Ne tulevat valikkoon, kun ne valmistuvat.",
          "Vasemman reunan valikosta pääset asiakkaisiin, asetuksiin, kehitystoiveisiin ja ohjeisiin.",
        ],
      },
    ],
  },
  {
    slug: "asiakkaat",
    group: "Aloitus",
    icon: "users",
    title: "Asiakkaat",
    summary: "Kaikki metsänomistajat yhdessä listassa. Jokaisella asiakkaalla on vastuukirjanpitäjä.",
    highlights: ["Haku nimellä, Y-tunnuksella tai kunnalla", "Vastuukirjanpitäjä", "Verovuodet ja niiden sulkeminen"],
    appPath: "/asiakkaat",
    appLabel: "Asiakkaat",
    sections: [
      {
        title: "Kuka näkee asiakkaan",
        bullets: [
          "Pääkäyttäjä näkee kaikki toimiston asiakkaat.",
          "Kirjanpitäjä näkee asiakkaat, joiden vastuukirjanpitäjä hän on.",
          "Kun kirjanpitäjä lisää asiakkaan, hänestä tulee sen vastuukirjanpitäjä.",
        ],
      },
      {
        title: "Uusi asiakas",
        steps: [
          "Avaa Asiakkaat ja valitse Lisää asiakas.",
          "Kirjoita nimi ja muut tiedot. Yhtymän tai kuolinpesän nimi kirjoitetaan kenttään Sukunimi tai yrityksen nimi.",
          "Valitse toiminnot: Harjoittaa metsätaloutta (2C), Harjoittaa maataloutta (lomake 2) tai molemmat.",
          "Rastita Arvonlisäverorekisterissä, jos asiakas on rekisterissä. Kirjoita myös ALV-numero, jos se on tiedossa.",
          "Valitse Lisää asiakas. Kuluva verovuosi avautuu asiakkaalle heti.",
        ],
      },
      {
        title: "Tietojen muokkaus",
        steps: [
          "Avaa asiakas ja valitse Muokkaa.",
          "Muuta tiedot, esimerkiksi osoite, verotilin viite tai arvonlisäverorekisteröinti.",
          "Valitse Tallenna.",
        ],
        bullets: [
          "Verotilin viite tulee veroraportin maksutiedotteeseen.",
          "Toimintoa ei voi poistaa, jos sillä on jo kirjauksia tai investointeja.",
          "Kun lisäät maatalouden, asiakkaalle tulevat välilehdet Maatalouden kirjanpito ja Lomake 2.",
        ],
      },
      {
        title: "Vastuukirjanpitäjän vaihto",
        text: "Pääkäyttäjä vaihtaa vastuukirjanpitäjän asiakkaan Tiedot-välilehdellä kohdassa Vaihda vastuukirjanpitäjä ja valitsee Tallenna. Vanha kirjanpitäjä ei sen jälkeen näe asiakasta.",
      },
      {
        title: "Verovuodet",
        steps: [
          "Asiakkaan Tiedot-välilehden alaosassa on taulukko Verovuodet. Siinä näkyy jokaisen vuoden tila, kirjausten määrä ja sulkemispäivä.",
          "Avaa uusi vuosi: kirjoita vuosi kohtaan Uusi vuosi ja valitse Avaa vuosi.",
          "Kun vuosi on valmis, pääkäyttäjä valitsee vuoden kohdalta Sulje vuosi.",
          "Suljetun vuoden kirjauksia ei voi muuttaa. Pääkäyttäjä voi avata vuoden uudelleen valitsemalla Avaa vuosi, ja avaus jää lokiin.",
        ],
        bullets: [
          "Kaikilla asiakkaan välilehdillä on ylhäällä Verovuosi-valikko. Kun valitset siitä vuoden, sivu vaihtuu heti.",
          "Suljetun vuoden perässä valikossa lukee (suljettu).",
          "Vanhasta ohjelmasta tuodut vanhat vuodet ovat valmiiksi suljettuja. Katso ohje Siirtyminen vanhoista ohjelmista.",
        ],
      },
      {
        title: "Arkistointi",
        text: "Asiakasta ei poisteta, koska kirjanpito on säilytettävä. Pääkäyttäjä voi arkistoida asiakkaan, jolloin se piiloutuu listasta. Arkistoidut näet listan linkistä.",
      },
    ],
    related: ["aloitus", "metsatilat"],
  },
  {
    slug: "metsatilat",
    group: "Metsätalous",
    icon: "map",
    title: "Metsätilat ja metsävähennys",
    summary: "Asiakkaan metsätilat ja niiden hankintatiedot. Niistä lasketaan metsävähennyksen pohja. Tilan myynti kirjataan tilan sivulla.",
    highlights: ["Kiinteistötunnus ja pinta-ala", "Hankintahinta ja -päivä", "Metsävähennyksen pohja ja jäljellä oleva määrä"],
    sections: [
      {
        title: "Uusi metsätila",
        steps: [
          "Avaa asiakas. Metsätilat ovat Tiedot-välilehdellä. Valitse Lisää metsätila.",
          "Kirjoita tilan nimi ja kiinteistötunnus.",
          "Kirjoita hankintahinta ja metsän osuus hinnasta prosentteina. Metsä tarkoittaa metsämaata ja puustoa yhdessä. Rakennukset, pelto, tiet ja ojat eivät kuulu siihen.",
          "Metsämaan hehtaarit ovat vain tiedoksi. Ne eivät muuta laskelmia.",
          "Jos vähennystä on käytetty jo ennen Skogia, kirjoita se kenttään Metsävähennystä käytetty ennen Skogia.",
          "Valitse Lisää metsätila.",
        ],
      },
      {
        title: "Metsävähennyksen pohja",
        bullets: [
          "Pohja on 60 prosenttia metsän osuudesta hankintahinnasta. Vuodesta 2026 se on 75 prosenttia.",
          "Verotuksessa kaikkien tilojen pohja on yhteinen. Tilakohtainen luku auttaa vain seurannassa.",
          "Käytetty on ennen Skogia käytetty määrä ja Skogissa kirjatut vähennykset yhteensä.",
          "Jäljellä on pohja miinus käytetty.",
          "Jos hankintahinta tai metsän osuus puuttuu, pohjaa ei lasketa.",
        ],
      },
      {
        title: "Tilan myynti",
        text: "Voit myydä koko tilan tai sen osan. Osan voi myydä monta kertaa. Jokainen kauppa kirjataan omana luovutuksenaan.",
        steps: [
          "Avaa myyntivuosi asiakkaan sivulla, jos sitä ei ole vielä avattu.",
          "Avaa tila asiakkaan sivulta.",
          "Kirjoita kohtaan Myynnit ja luovutukset kaupan päivä ja kauppahinta. Päivä on lopullisen kauppakirjan päivä.",
          "Kirjoita myyty osuus prosentteina. Koko tila on 100. Osuus on myydyn osan osuus tilan hankintahinnasta. Jos sitä ei tiedetä, laske se metsämaan hehtaareista.",
          "Kirjoita myyntikulut, esimerkiksi välittäjän palkkio. Jos kuluja ei ole, jätä nolla.",
          "Jos tila tai osa annetaan lahjana tai luovutus on verovapaa, rastita ruutu. Silloin metsävähennystä ei lisätä.",
          "Valitse Lisää luovutus.",
          "Avaa myyntivuoden verosuunnitelma. Siinä näkyy luovutusvoitto. Voit avata sen myös luovutuksen Laskelma-linkistä.",
        ],
        bullets: [
          "Hankintamenoksi tulee myytyä osuutta vastaava osa tilan hankintahinnasta.",
          "Jos tilalle on kirjattu metsätie tai ojitus, sen poistamaton arvo lisätään hankintamenoon. Osan myynnissä lisätään sama osuus. Loput poistetaan kuten ennenkin.",
          "Myyntikulut vähennetään, kun käytetään hankintamenoa.",
          "Ohjelma käyttää hankintameno-olettamaa, jos se on edullisempi. Olettama on 20 prosenttia kauppahinnasta, tai 40 prosenttia, jos tila on omistettu vähintään 10 vuotta. Olettaman lisäksi ei vähennetä myyntikuluja eikä tie- ja ojamenoja.",
          "Luovutusvoittoon lisätään kaikki käytetty metsävähennys, myös muilta tiloilta käytetty. Myyntivuoden omaa vähennystä ei lisätä.",
          "Lisäys on kuitenkin enintään 60 prosenttia myydyn osan metsän hankintamenosta. Vuodesta 2027 raja on 75 prosenttia.",
          "Kerran lisättyä vähennystä ei lisätä uudelleen seuraavassa myynnissä.",
          "Jos tila on ostettu ja myyty samana vuonna, lisäystä ei tehdä.",
          "Myyty osa ei tuo metsävähennyksen pohjaa enää myyntivuonna. Kun koko tila on myyty, tila ei tuo pohjaa ollenkaan.",
          "Luovutusta voi muuttaa tai poistaa vain, kun myyntivuosi on auki. Jos vuoden suunnitelma on jo vahvistettu, vahvista se uudelleen.",
        ],
      },
    ],
    tips: ["Suljetun vuoden metsävähennys tai luovutus estää tilan poistamisen. Myytyä tilaa ei poisteta, vaan myynti kirjataan luovutuksena."],
    related: ["asiakkaat", "verosuunnitelma"],
  },
  {
    slug: "kirjanpito",
    group: "Kirjanpito",
    icon: "list",
    title: "Kirjanpito",
    summary: "Metsätalouden tulot, menot ja investoinnit verovuosittain, tositteet mukana.",
    highlights: ["Koko vuosi taulukossa, näppäimistöllä", "Summa kuten kuitissa, arvonlisävero lasketaan", "Rivit Excelistä", "Tosite jokaiseen kirjaukseen", "Tekoäly ehdottaa kirjaukset tositteesta", "Tiliöintiehdotukset aiemmista kirjauksista"],
    sections: [
      {
        title: "Taulukkosyöttö",
        text: "Kirjanpito aukeaa taulukkona. Siinä näkyvät kaikki valitun vuoden kirjaukset, ja voit muuttaa niitä suoraan. Uudet rivit tulevat loppuun.",
        steps: [
          "Avaa asiakas ja valitse välilehti Kirjanpito. Jos asiakkaalla on myös maatila, välilehti on Metsätalouden kirjanpito.",
          "Valitse verovuosi sivun yläosan Verovuosi-valikosta.",
          "Uusi rivi: paina taulukon lopussa Lisää rivi tai Enter viimeisen rivin lopussa. Uusi rivi saa saman päivän kuin edellinen.",
          "Kirjoita päivä. Lyhyt muoto riittää, esimerkiksi 5.3., niin vuosi tulee valitusta verovuodesta.",
          "Kirjoita selite.",
          "Valitse luokka. Valikko aukeaa itse. Voit kirjoittaa luokan numeron, esimerkiksi 1 Pystykauppa tai 10 Käyttöomaisuuden hankinta.",
          "Kirjoita summa niin kuin se on kuitissa, eli arvonlisäveron kanssa.",
          "Alv % tulee luokasta. Voit vaihtaa sen. Veroton summa näkyy sen vieressä.",
          "Osuus % jää yleensä tyhjäksi. Tyhjä tarkoittaa, että koko summa kuuluu metsätaloudelle.",
          "Tallenna, kun olet valmis: Ctrl + S tai painike taulukon alla.",
        ],
        bullets: [
          "Mitään ei tallennu ennen kuin tallennat. Jos yrität lähteä sivulta, ohjelma kysyy ensin.",
          "Muutettu kirjaus tallentuu paikalleen. Sen tositteet ja investointi säilyvät.",
          "Peru muutokset palauttaa taulukon siihen, mitä on tallennettu.",
          "Tositteen lisäät rivin Tosite-linkistä, kun rivi on tallennettu.",
        ],
      },
      {
        title: "Tiliöintiehdotukset",
        text: "Kun kirjoitat selitteen, ohjelma katsoo, miten asiakkaan aiemmat samanlaiset kirjaukset on tiliöity. Se ehdottaa luokkaa, alv-prosenttia, osuutta ja maatilaa. Ehdotus on aina vain ehdotus. Mikään ei muutu, ennen kuin valitset sen, eikä mikään tallennu, ennen kuin tallennat.",
        steps: [
          "Kirjoita uudelle riville selite, esimerkiksi tiemaksu.",
          "Hetken päästä selitteen alle tulee lista Ehdotus aiemmista tiliöinneistä. Ylimpänä on paras ehdotus, alla enintään kaksi muuta.",
          "Jokaisen ehdotuksen alla lukee, mistä se tulee. Esimerkiksi: Tiliöity kuten 4/2024: 9 Muut vuosimenot, alv 25,5 %, osuus 50 %; 3 kertaa vuosina 2022–2024.",
          "Jos haluat käyttää ehdotusta, paina nuoli alas ja sitten Enter tai Tab. Voit myös napsauttaa ehdotusta.",
          "Ohjelma täyttää luokan, alv %:n, osuuden ja maatilan. Kursori siirtyy summaan.",
          "Kirjoita summa ja tarkista rivi. Tallenna kuten ennenkin.",
        ],
        bullets: [
          "Jos et halua ehdotusta, jatka vain kirjoittamista. Enter ja Tab toimivat kuten ennen, kun et ole valinnut ehdotusta. Esc sulkee listan.",
          "Päivä, summa ja selite jäävät aina sinulle.",
          "Ehdotus tulee ensin saman asiakkaan omista kirjauksista kaikilta vuosilta. Uudet ja usein toistuneet kirjaukset painavat eniten.",
          "Jos alv-kanta on sen jälkeen muuttunut, ehdotuksessa on nykyinen kanta, esimerkiksi 24 % → 25,5 %. Peruste kertoo sen.",
          "Jos asiakkaalla ei ole samanlaista kirjausta, ehdotus voi tulla toimiston muilta asiakkailta. Silloin siinä on merkki toimisto. Siinä on vain luokka ja alv, joten tarkista osuus itse. Muiden asiakkaiden selitteitä tai summia et näe.",
          "Saat ehdotuksia vain asiakkaista, joiden kirjanpidon näet.",
          "Ehdotukset tulevat vain uusille riveille. Tallennetun kirjauksen ja tositteen ehdotusrivin tiliöinti ei muutu, kun muokkaat selitettä.",
          "Lomakkeella toimii sama: ehdotukset tulevat selitteen alle, ja valinta täyttää kentät.",
        ],
      },
      {
        title: "Suodatus ja haku",
        text: "Voit näyttää vain osan vuoden kirjauksista. Suodatin on taulukon ja luettelon yläpuolella.",
        steps: [
          "Valitse luokka, jos haluat nähdä vain yhden luokan kirjaukset.",
          "Valitse kuukausi, jos haluat nähdä vain yhden kuukauden.",
          "Kirjoita hakuun sana selitteestä tai viitteestä, luokan nimi tai summa, esimerkiksi 1 255,50.",
          "Näytä kaikki palauttaa koko vuoden.",
        ],
        bullets: [
          "Rivin alla oleva summa näyttää vain näkyvät rivit.",
          "Uudet ja tallentamattomat rivit näkyvät aina, vaikka ne eivät osuisi suodattimeen.",
          "Tallennus koskee kaikkia rivejä, myös piilossa olevia.",
          "Nuolet ja Enter hyppäävät piilossa olevien rivien yli.",
        ],
      },
      {
        title: "Näppäimet taulukossa",
        bullets: [
          "Enter tai Tab: seuraava kenttä. Rivin lopussa seuraava rivi tai uusi rivi.",
          "Enter hyppää Osuus %:n yli, koska se on harvoin tarpeen. Tab tai hiiren napsautus vie siihen.",
          "Shift + Tab tai Shift + Enter: edellinen kenttä.",
          "Nuoli ylös tai alas: sama kenttä edellisellä tai seuraavalla rivillä. Selitteessä nuolet liikkuvat tekstissä.",
          "Selitteessä, kun ehdotuslista näkyy: nuoli alas valitsee ehdotuksen, Enter tai Tab käyttää sitä ja Esc sulkee listan. Ilman valintaa Enter ja Tab siirtävät kuten ennen.",
          "Luokassa: numero valitsee suoraan. Numerot 10, 11 ja 12 kirjoitetaan peräkkäin. Nuolet liikkuvat valikossa, Enter valitsee ja Esc sulkee.",
          "T vaihtaa tulon menoksi tai menon tuloksi. Investoinnissa tyyppi ei vaihdu.",
          "Delete tyyppisarakkeessa poistaa rivin. Ctrl + Z palauttaa sen.",
          "Ctrl + S tallentaa. Ctrl + N lisää rivin. Jos selain ei päästä Ctrl + N -näppäintä läpi, käytä Lisää rivi -painiketta.",
        ],
      },
      {
        title: "Puukauppa ja ennakonpidätys",
        steps: [
          "Kun kirjoitat pystykaupan, hankintakaupan tai polttopuukaupan summan, ohjelma kysyy ennakonpidätyksen.",
          "Kirjoita ostajan pidättämä summa ja paina Enter.",
          "Jos pidätystä ei ole, paina Enter tyhjällä. Ohjelma varmistaa vielä: paina Enter uudelleen, niin kirjataan, ettei pidätystä ole.",
          "Esc sulkee kysymyksen. Pidätystä voi muuttaa myöhemmin rivin EP-merkistä.",
        ],
      },
      {
        title: "Hankintatyö",
        steps: [
          "Hankintakaupan jälkeen ohjelma tarjoaa hankintatyön kirjausta, jos rivin alla ei vielä ole hankintatyötä.",
          "Kirjoita halutessasi tekijän nimi. Se tulee selitteeseen.",
          "Kirjoita kuutiot puutavaralajeittain. Enter vie seuraavaan lajiin.",
          "Valitse, sisältyykö työhön kuljetus.",
          "Valitse Kirjaa hankintatyö. Uusi Hankintatyö-rivi tulee hankintakaupan alle. Peruuta jättää sen pois.",
        ],
        bullets: [
          "Työn arvo lasketaan Verohallinnon ohjetaksoilla.",
          "Hankintatyön arvo vähennetään puukaupan tulosta. Myös metsävähennyksen vuosiraja lasketaan tulosta, josta arvo on vähennetty.",
          "Työ on tekijöille verovapaata 125 kuutioon asti vuodessa. Sen yli menevä osa on tekijöiden ansiotuloa, ja he ilmoittavat sen itse.",
          "Ohjelma ei kysy tekijän henkilötunnusta.",
          "Lomakkeella sama laskuri on kohdassa Hankintatyön laskuri.",
        ],
      },
      {
        title: "Investoinnit taulukossa",
        steps: [
          "Hankinta: valitse luokka 10 ja kirjoita summa. Ohjelma kysyy hyödykkeen lajin: 1 kone, 2 tie tai oja, 3 rakennus.",
          "Myynti: valitse luokka 11. Ohjelma kysyy, mikä investointi myytiin. Kirjoita sitten myyntihinta.",
          "Investointi syntyy tai merkitään myydyksi, kun tallennat.",
        ],
      },
      {
        title: "Arvonlisävero",
        bullets: [
          "Summa kirjoitetaan aina arvonlisäveron kanssa, kuten kuitissa. Ohjelma laskee verottoman summan ja veron.",
          "Veroton summa pyöristetään senteille, ja vero on summan ja verottoman erotus. Näin kuitin summa pysyy tarkkana.",
          "Jos asiakas ei ole arvonlisäverorekisterissä, uuden rivin alv on 0 %. Hän ei voi vähentää ostojen veroa, joten kulu on koko kuitin summa.",
          "Rekisterissä olevalla alv tulee luokasta: puukaupassa ja ostoissa yleinen verokanta, tuissa ja korvauksissa 0 %.",
        ],
      },
      {
        title: "Osittain vähennettävä kulu",
        text: "Joskus vain osa kuitista kuuluu metsätaloudelle. Esimerkiksi tiekunnan maksusta puolet voi kuulua metsälle ja puolet muulle toiminnalle. Silloin kirjoitat koko kuitin ja kerrot, kuinka monta prosenttia siitä on metsätaloutta.",
        steps: [
          "Kirjoita rivi tavalliseen tapaan. Summa on koko kuitin summa arvonlisäveron kanssa.",
          "Siirry Osuus %-kenttään Tabilla tai napsauttamalla sitä.",
          "Kirjoita metsätalouden osuus, esimerkiksi 50. Desimaalit kirjoitetaan pilkulla, esimerkiksi 33,33.",
          "Rivin alle tulee teksti, jossa näkyy, paljonko menee metsätaloudelle ja paljonko muulle.",
          "Tallenna.",
        ],
        bullets: [
          "Esimerkki: Tiemaksu tiekunnalle: osuus 50 %, loput kuuluvat muulle toiminnalle.",
          "Selite pysyy samana. Osuus näkyy omassa sarakkeessaan.",
          "Tuloihin, menoihin, verosuunnitelmaan, veroraporttiin ja veroilmoitukseen tulee vain metsätalouden osuus.",
          "Ostojen arvonlisäverosta vähennetään vain metsätalouden osuus. Loppu näkyy erikseen, eikä sitä vähennetä.",
          "Myynnin arvonlisävero lasketaan aina koko myynnistä.",
          "Investoinnissa hankintahinnaksi tulee metsätalouden osuus. Myös myyntihinta lasketaan osuudesta.",
          "Lomakkeella sama kenttä on kohdassa Lisätiedot: vain osa kuuluu metsätaloudelle.",
          "Tyhjä osuus on 100 %. Osuuden on oltava yli 0 ja enintään 100.",
        ],
      },
      {
        title: "Metsä ja maatalous erikseen",
        text: "Jos asiakas harjoittaa myös maataloutta, metsän ja maatalouden kirjanpito ovat eri välilehdillä. Työkalut ovat samat. Katso ohje Maatalouden kirjanpito.",
        steps: [
          "Avaa asiakas.",
          "Valitse välilehti Metsätalouden kirjanpito tai Maatalouden kirjanpito.",
          "Kirjaa ja tallenna tavalliseen tapaan. Taulukossa näkyvät vain sen toiminnon kirjaukset ja luokat.",
        ],
        bullets: [
          "Jos asiakkaalla on vain maataloutta, välilehti Kirjanpito on maatalouden kirjanpito.",
          "Pelkän metsäasiakkaan kirjanpito on ennallaan.",
        ],
      },
      {
        title: "Rivit Excelistä",
        steps: [
          "Järjestä Excelin sarakkeet näin: päivä, selite, luokka, summa arvonlisäveron kanssa, alv %, ennakonpidätys, metsätila ja viite. Metsätila jätetään pois, jos asiakkaalla ei ole tiloja. Viimeiseksi voit lisätä osuuden prosentteina ja sen jälkeen toisen toiminnon osuuden. Jos asiakkaalla on useampi maatila, maatilan nimi voi tulla aivan viimeiseksi. Nämä voi myös jättää pois.",
          "Valitse rivit Excelissä ja kopioi ne.",
          "Napsauta uuden rivin päiväkenttää ja liitä (Ctrl + V).",
          "Tarkista rivit ja tallenna.",
        ],
        bullets: [
          "Päivä voi olla muodossa 5.3.2025 tai 2025-03-05. Summissa saa olla pilkku ja välilyönti, esimerkiksi 1 234,50.",
          "Luokaksi käy luokan nimi, esimerkiksi Pystykauppa, tai sen numero. Maatalouden luokissa numerot ovat 21–59. Metsätilaksi tilan nimi.",
          "Jos otsikkorivi tulee mukaan, ohjelma jättää sen pois.",
          "Liittäminen ei muuta tallennettuja kirjauksia. Jos liität tallennetun rivin kohdalle, liitetyt rivit tulevat uusina sen yläpuolelle.",
        ],
      },
      {
        title: "Kun taulukossa on virhe",
        bullets: [
          "Ohjelma tarkistaa jokaisen rivin samoin kuin lomakkeella. Jos yhdessäkin rivissä on virhe, mitään ei tallenneta.",
          "Virheellinen kenttä näkyy punaisena, ja ohje on rivin alla. Korjaa rivi ja tallenna uudelleen.",
          "Päivän on oltava valitulla verovuodella.",
          "Jos investoinnista on jo tehty poistoja, sen hankintaa ei voi poistaa. Palauta rivi painamalla Ctrl + Z.",
          "Suljetun vuoden kirjaukset näkyvät, mutta niitä ei voi muuttaa.",
        ],
      },
      {
        title: "Lomake",
        steps: [
          "Valitse taulukon yläpuolelta Lomake, jos haluat kirjata yhden rivin kerrallaan.",
          "Täytä päivä, luokka, selite ja summa arvonlisäveron kanssa.",
          "Kun kirjoitat selitteen, sen alle voi tulla ehdotus aiemmista tiliöinneistä. Napsauta sitä, jos haluat käyttää sitä. Luokka, alv ja osuus täyttyvät, mutta mitään ei tallenneta vielä.",
          "Jätä Alv % tyhjäksi, niin ohjelma käyttää oletusta.",
          "Jos vain osa kuuluu metsätaloudelle, avaa Lisätiedot ja kirjoita metsätalouden osuus prosentteina.",
          "Valitse Lisää kirjaus.",
        ],
      },
      {
        title: "Muokkaus ja poisto",
        text: "Avaa kirjaus päivästä. Voit muuttaa tietoja ja valita Tallenna. Kohdasta Lisää tosite lisäät kirjauksen tositteen, ja Poista kirjaus poistaa kirjauksen. Muutokset jäävät lokiin.",
      },
      {
        title: "Tositteet ja tunnistus",
        text: "Vuoden tositteet ja tekoälyn ehdotukset ovat kirjanpidon sivulla kohdassa Vuoden tositteet. Katso ohje Tositteet ja tunnistus.",
      },
      {
        title: "Investoinnit",
        bullets: [
          "Koneen, tien, ojan tai rakennuksen hankinta kirjataan luokalla Käyttöomaisuuden hankinta. Valitse samalla hyödykkeen laji, niin ohjelma luo investoinnin.",
          "Investoinnin hankintahinta on veroton summa.",
          "Enintään 600 euron hankinta kirjataan vuosimenona luokalla Muut vuosimenot. Samoin hankinta, joka kestää enintään kolme vuotta.",
          "Myynti kirjataan luokalla Käyttöomaisuuden myynti. Valitse myytävä investointi, niin se merkitään myydyksi.",
          "Poistot lasketaan verosuunnitelmassa.",
        ],
      },
      {
        title: "Suljettu vuosi",
        text: "Kun verovuosi on suljettu, sen kirjauksia ja tositteita ei voi muuttaa. Pääkäyttäjä voi avata vuoden asiakkaan tiedoissa, ja avaus jää lokiin.",
      },
    ],
    related: ["tositteet", "investoinnit", "maatalouden-kirjanpito", "alv"],
  },
  {
    slug: "maatalouden-kirjanpito",
    group: "Maatalous",
    icon: "list",
    title: "Maatalouden kirjanpito",
    summary: "Maatilan tulot, menot ja investoinnit samoilla työkaluilla kuin metsässä: taulukko, lomake, Excel ja tositteiden tunnistus.",
    highlights: [
      "Oma välilehti maatalouden kirjanpidolle",
      "Taulukko, lomake ja rivit Excelistä",
      "Tekoäly lukee meijerin, teurastamon ja tukien tositteet",
      "Yhteiset tositteet metsän kanssa",
    ],
    appPath: "/asiakkaat",
    appLabel: "Avaa asiakkaat",
    sections: [
      {
        title: "Mistä löydät",
        steps: [
          "Avaa asiakas.",
          "Valitse välilehti Maatalouden kirjanpito. Jos asiakkaalla on vain maataloutta, välilehden nimi on Kirjanpito.",
          "Valitse verovuosi Verovuosi-valikosta.",
        ],
        bullets: [
          "Välilehti näkyy, kun asiakkaan tiedoissa on rasti kohdassa Harjoittaa maataloutta.",
          "Metsätalouden kirjanpito on omalla välilehdellään. Sivun yläosassa on myös linkki toiseen kirjanpitoon.",
          "Lomakkeen 2 tiedot, kuten poistot ja varaukset, ovat välilehdellä Lomake 2.",
        ],
      },
      {
        title: "Tiliöintiehdotukset",
        text: "Kun kirjoitat selitteen, ohjelma ehdottaa tiliöintiä asiakkaan aiemmista maatalouden kirjauksista: luokan, alv-prosentin, osuuden ja maatilan. Ehdotus ei täytä mitään itse. Käyttö on sama kuin metsätaloudessa: katso ohjeen Kirjanpito kohta Tiliöintiehdotukset.",
      },
      {
        title: "Kirjaaminen taulukkoon",
        text: "Taulukko toimii samalla tavalla kuin metsän kirjanpidossa. Siinä näkyvät vain maatalouden kirjaukset.",
        steps: [
          "Kirjoita päivä ja selite.",
          "Valitse luokka. Maatalouden luokat ovat numeroilla 21–59. Kirjoita kaksi numeroa peräkkäin, esimerkiksi 24 Maito tai 41 Lannoitteet.",
          "Kirjoita summa niin kuin se on kuitissa, eli arvonlisäveron kanssa.",
          "Tarkista alv. Maito, liha, vilja ja rehu ovat 14 % vuonna 2025 ja 13,5 % vuodesta 2026. Muut ostot ovat yleensä 25,5 %.",
          "Tallenna: Ctrl + S tai painike taulukon alla.",
        ],
        bullets: [
          "Uusi rivi on aina maataloutta. Metsän luokkaa ei voi valita tässä taulukossa. Kirjaa metsän rivit metsätalouden kirjanpitoon.",
          "Jos meno kuuluu osittain metsätaloudelle, kirjoita osuudet. Esimerkiksi sähkölasku: Osuus % 70 ja Toinen % 20. Silloin 20 % menee metsätaloudelle ja 10 % on yksityistä.",
          "Kortit taulukon yllä näyttävät maatalouden tulot ja menot. Niissä on myös metsän kirjauksista maataloudelle annettu osuus.",
          "Lomake ja rivit Excelistä toimivat samoin kuin metsässä. Excelissä luokaksi käy numero 21–59 tai luokan nimi.",
          "Jos asiakkaalla on useampi maatila, Excelin viimeiseen sarakkeeseen voi kirjoittaa maatilan nimen. Tyhjä solu tarkoittaa, että kirjaus on yhteinen kaikille tiloille.",
          "Maatalouden investointi (58) kysyy poistoryhmän. Enintään 1 200 euron hankinta kirjataan menona.",
        ],
      },
      {
        title: "Maatila kirjaukselle",
        text: "Jos asiakkaalla on useampi maatila, taulukossa on sarake Maatila. Tasausvaraus lasketaan maatiloittain, joten valitse tila niille kirjauksille, jotka kuuluvat vain yhdelle tilalle.",
        steps: [
          "Lisää maatilat Lomake 2 -välilehdellä kohdassa Maatilat.",
          "Valitse kirjauksen rivillä sarakkeesta Maatila oikea tila.",
          "Jätä tilaksi Yhteinen, jos kulu tai tulo kuuluu kaikille tiloille.",
        ],
        bullets: [
          "Yhteiset kirjaukset ja poistot jaetaan tiloille niiden tulojen suhteessa.",
          "Jos asiakkaalla on vain yksi tila, saraketta ei ole. Kaikki kuuluu silloin samalle tilalle.",
        ],
      },
      {
        title: "Kotieläinten jaksotus",
        text: "Kotieläinten myynnin tai hankinnan voi jakaa kolmelle vuodelle. Myynnin voi jaksottaa, jos samana vuonna myydään merkittävä osa eläimistä.",
        steps: [
          "Kirjaa myynti luokalla 21 Kotieläinten myynti tai hankinta luokalla 40 Kotieläinten hankinta.",
          "Rastita luokan alla Jaksota 3 vuodelle. Lomakkeessa valinta on Jaksota kolmelle vuodelle.",
          "Tallenna. Rivin alla näkyvät vuosien osuudet.",
        ],
        bullets: [
          "Summa jaetaan kolmeen yhtä suureen osaan: tälle vuodelle ja kahdelle seuraavalle. Laki ei salli muuta jakoa.",
          "Jaksotus näkyy Lomake 2 -välilehdellä kohdassa Kotieläinten jaksotukset. Sitä muutetaan kirjanpidossa.",
          "Jos poistat rastin tai kirjauksen, jaksotus poistuu.",
        ],
      },
      {
        title: "Tositteet",
        text: "Vuoden tositteet ovat asiakkaan yhteisiä. Sama lista näkyy metsän ja maatalouden kirjanpidossa, ja ne tulevat kerran veroraportin liitteiksi.",
        steps: [
          "Valitse Lisää tositteet.",
          "Vedä tiedostot laatikkoon tai valitse ne. Voit skannata koko vuoden paperit yhdeksi tiedostoksi.",
        ],
        bullets: [
          "Tositetta ei tarvitse lajitella ennen lisäystä. Tunnistus päättelee, kumpaan toimintoon rivi kuuluu.",
          "Tositteen kohdalla näkyy, odottaako sen ehdotus tässä vai toisessa kirjanpidossa.",
        ],
      },
      {
        title: "Tositteiden tunnistus maataloudelle",
        text: "Tekoäly lukee maatilan tositteet ja ehdottaa kirjauksia. Sinä tarkistat ehdotukset ennen tallennusta.",
        steps: [
          "Avaa Maatalouden kirjanpito ja valitse Lisää tositteet.",
          "Lisää tiedosto ja valitse Tunnista. Tunnista kaikki lukee kaikki tositteet, joista ei vielä ole ehdotusta.",
          "Odota. Pitkä tiedosto luetaan osissa, ja näet, mitä sivuja luetaan. Koko vuoden aineisto (150–300 sivua) kestää noin 4–18 minuuttia.",
          "Maatalouden ehdotukset tulevat taulukon loppuun sinisinä riveinä. Tilitys, jossa on monta riviä, näkyy ryhmänä.",
          "Katso ryhmän otsikosta, täsmäävätkö rivit tositteeseen. Jos näkyy ero, tarkista rivit.",
          "Lue keltaiset huomautukset rivien alla. Ne kertovat, mitä sinun pitää päättää itse.",
          "Tarkista jokainen rivi: päivä, luokka, summa ja alv.",
          "Tallenna taulukko. Voit hyväksyä kaikki rivit kerralla tai jättää osan odottamaan.",
          "Jos ilmoitus kertoo, että rivejä odottaa metsätalouden kirjanpidossa, avaa se ja tallenna ne siellä.",
        ],
        bullets: [
          "Kun aloitat tunnistuksen maatalouden kirjanpidosta, epäselvä tosite, esimerkiksi polttoaine tai korjaus, ehdotetaan maataloudelle.",
          "Selvästi metsän tosite, esimerkiksi puukauppa tai taimikonhoito, ehdotetaan metsätalouteen, jos asiakkaalla on metsää. Se odottaa metsätalouden kirjanpidossa.",
          "Kun aloitat tunnistuksen metsätalouden kirjanpidosta, toimii toisin päin: selvästi maatilan tosite menee maatalouden kirjanpitoon.",
          "Jos tiedostosta tulee rivejä molempiin kirjanpitoihin, tiedosto jää vuoden tositteisiin. Jokaisessa kirjauksessa on linkki oikealle sivulle.",
        ],
      },
      {
        title: "Mitä tunnistus tekee maatilan tositteista",
        bullets: [
          "Meijerin tilitys: maito omalle rivilleen. Rehu, seminointi, kuljetus ja jäsenmaksu omiksi menoriveikseen. Osuuskunnan ylijäämä on tulo omalla luokallaan.",
          "Meijerin osuusmaksu ei ole kulu. Siitä ei tule riviä, mutta se näkyy huomautuksena, ja täsmäytyksessä näkyy ero.",
          "Teurastamon tilitys: eläinten myynti ja vähennykset, kuten kuljetus ja Naseva, omina riveinään.",
          "Viljan tilitys: myynti, kuivaus ja varastointi omina riveinään.",
          "Tuen maksuilmoitus ja Vipun maksetut tuet: jokaisesta maksusta oma rivi maksupäivän mukaan. Lisätietoa kohdassa Tuet.",
          "Tukipäätös ei ole maksu. Sen rivillä on huomautus, ja varmuus on pieni. Kirjaa tuki, kun se on maksettu.",
          "Kotieläinten kauppa: huomautus kertoo, että myynnin tai oston voi jaksottaa kolmelle vuodelle. Vaihda silloin luokaksi jaksotettava.",
          "Konekauppa: kone on investointi, ja poistoryhmä Koneet ja kalusto on valmiina. Vaihtokone on oma myyntirivinsä. Valitse myytävä kone ennen tallennusta.",
          "Polttoaine: energiaveron palautusta ei vähennetä laskusta. Palautus kirjataan omasta päätöksestään luokkaan Energiaveron palautus ja muut lisäykset.",
          "Sähkö: jos sama mittari on myös asunnossa, huomautus muistuttaa. Merkitse maatalouden osuus Osuus-sarakkeeseen.",
          "Vakuutus: kodin ja henkilön vakuutukset eivät ole maatalouden menoa. Ne tulevat omille riveilleen huomautuksen kanssa.",
          "MYEL-lasku: MYEL-maksu ja tapaturmavakuutus omille riveilleen.",
          "Lainan vuosi-ilmoitus: vain korot ovat kuluja. Maatilan lainan korot tulevat luokkaan Korot (lomakkeen 2 kohta 465). Metsälainan korot tulevat luokkaan Muut vuosimenot.",
          "Lainan lyhennykset eivät ole kuluja. Niistä ei tule kirjausta, vaan summa näkyy huomautuksessa. Jos lyhennyksestä on kuitenkin tullut rivi, se jää odottamaan eikä tallennu. Poista se.",
          "Alv: maito, vilja ja rehu 14 % vuonna 2025 ja 13,5 % vuodesta 2026. Ohjelma käyttää tositteen kantaa. Jos kanta ei sovi päivään, rivillä on huomautus. Tammikuun tilitys voi koskea joulukuun maitoa, ja silloin 14 % on oikein.",
        ],
      },
      {
        title: "Tuet",
        text: "Tuki kirjataan sinä vuonna, jona se maksetaan tilille. Tukivuosi voi olla eri. Esimerkiksi vuoden 2024 ympäristökorvauksen loppuerä, joka maksetaan huhtikuussa 2025, kuuluu vuoteen 2025.",
        steps: [
          "Tallenna Vipu-palvelusta maksetut tuet tai Ruokaviraston vuosikooste PDF-tiedostona.",
          "Lisää tiedosto vuoden tositteisiin ja valitse Tunnista.",
          "Jokaisesta maksusta tulee oma rivi: maksupäivä, tuen nimi ja tukivuosi sekä summa.",
          "Tarkista, että rivien summa täsmää koonnin loppusummaan.",
          "Jos maksu on toiselta vuodelta, rivillä on varoitus. Poista rivi tai jätä se odottamaan, ja kirjaa se oikean vuoden kirjanpitoon.",
          "Tallenna.",
        ],
        bullets: [
          "Perustulotuki, uudelleenjakotulotuki, nuoren viljelijän tulotuki, tuotantosidonnaiset tuet ja ekojärjestelmätuki ovat luokassa Maataloustuet (lomakkeen 2 kohta 217).",
          "Luonnonhaittakorvaus, ympäristö- ja luomukorvaus sekä eläinten hyvinvointikorvaus ovat myös kohdassa 217. Tämä on tulkinta, jonka kirjanpitäjä vahvistaa.",
          "Pohjoinen tuki, Etelä-Suomen kansallinen tuki ja muut kansalliset tuet ovat kohdassa 217.",
          "Ostajan, esimerkiksi meijerin, kautta maksettu tuki on luokassa Muut tuet ja korvaukset (kohta 218).",
          "Riista- ja satovahinkojen korvaukset ovat luokassa Muut alv 0 % tulot (kohta 220).",
          "Energiaveron palautus on luokassa Energiaveron palautus ja muut lisäykset (kohta 222).",
          "Investointituki ei ole tuloa. Sen rivi jää valmiiksi odottamaan, joten se ei tallennu tuloksi.",
          "Kirjaa investointituki Lomake 2 -välilehdellä kohtaan Investointituet sille investoinnille, johon se on myönnetty. Poista sen jälkeen rivi taulukosta.",
          "Aloitustuki ja tuki, jonka lajia ei tunnistettu, ovat luokassa Muut tuet ja korvaukset. Rivillä on huomautus. Tarkista luokka.",
          "Jos sama tuki on jo kirjattu maksuilmoituksesta, rivillä on päällekkäisyysvaroitus. Poista toinen.",
        ],
      },
      {
        title: "Veroraportti",
        bullets: [
          "Veroraportin kirjausluettelo on jaettu kahteen osaan: metsätalous ja maatalous.",
          "Maatalouden tulos lomakkeen 2 mukaan on raportin osassa Maatalous (lomake 2).",
        ],
      },
    ],
    tips: ["Jos rivi meni väärään kirjanpitoon, avaa kirjaus päivästä ja vaihda luokka. Rivi siirtyy toisen toiminnon kirjanpitoon."],
    related: ["kirjanpito", "tositteet", "maatalous", "alv"],
  },
  {
    slug: "tositteet",
    group: "Tositteet ja tunnistus",
    icon: "registry",
    title: "Tositteet ja tunnistus",
    summary: "Tositteet tallessa verovuosittain. Tekoäly lukee tositteen ja ehdottaa kirjaukset, ja sinä tarkistat ne.",
    highlights: [
      "Koko vuoden paperit yhtenä tiedostona",
      "Ehdotukset taulukkoon tarkistettaviksi",
      "Täsmäytys tositteen summaan",
      "Tositteet veroraportin liitteiksi",
    ],
    sections: [
      {
        title: "Mistä löydät",
        steps: [
          "Avaa asiakas ja valitse kirjanpidon välilehti.",
          "Valitse verovuosi Verovuosi-valikosta.",
          "Kohta Vuoden tositteet on korttien alla. Valitse Lisää tositteet tai Näytä tositteet.",
        ],
        bullets: [
          "Vuoden tositteet ovat asiakkaan yhteisiä. Sama lista näkyy metsän ja maatalouden kirjanpidossa.",
          "Yksittäisen kirjauksen tositteen lisäät kirjauksen sivulla.",
        ],
      },
      {
        title: "Vuoden tositteet",
        steps: [
          "Avaa asiakkaan kirjanpito ja valitse verovuosi Verovuosi-valikosta.",
          "Valitse Lisää tositteet.",
          "Vedä tiedostot laatikkoon tai valitse ne. Voit lisätä useita kerralla. PDF, JPG tai PNG, enintään 25 Mt tiedostoa kohden.",
          "Tositteet tallentuvat heti ja näkyvät listassa. Nimestä tositteen voi avata.",
          "Kun vuosi suljetaan, kaikki vuoden tositteet liitetään lopullisen veroraportin loppuun.",
        ],
        bullets: [
          "Myös yksittäisten kirjausten tositteet tulevat raportin liitteiksi.",
          "Veroraportti ja arkisto -välilehdeltä voit avata luonnoksen tositteineen jo ennen sulkemista: Avaa luonnos tositteineen.",
          "Suljetun vuoden tositteita ei voi poistaa eikä lisätä.",
        ],
      },
      {
        title: "Tositteiden tunnistus",
        text: "Ohjelma voi lukea vuoden tositteen ja ehdottaa kirjauksia. Tekoäly tekee vain ehdotuksen. Sinä tarkistat sen ja päätät, mitä kirjataan.",
        steps: [
          "Lisää tosite kohtaan Vuoden tositteet. Voit skannata koko vuoden paperit yhdeksi tiedostoksi.",
          "Valitse tositteen kohdalta Tunnista. Tunnista kaikki lukee kerralla kaikki tositteet, joista ei vielä ole ehdotusta.",
          "Pitkästä tiedostosta ohjelma kertoo ensin, kauanko lukeminen kestää, esimerkiksi 40 sivua, 6 osaa, noin 2–4 min. Valitse OK.",
          "Odota. Ohjelma lukee tiedoston osissa ja näyttää, mitä sivuja se lukee, esimerkiksi Luetaan sivuja 9–16 / 40.",
          "Ehdotukset tulevat taulukon loppuun sinisinä riveinä, ja niissä on merkki Ehdotus.",
          "Tarkista jokainen rivi: päivä, selite, luokka, summa, alv ja puukaupan ennakonpidätys. Rivin alla näkyy, kuinka varma tekoäly oli ja mistä se päätteli tiedot. Merkistä Ehdotus tosite aukeaa.",
          "Korjaa, mikä on väärin. Valitse tarvittaessa metsätila.",
          "Tallenna taulukko (Ctrl + S). Vasta nyt rivit tallentuvat kirjauksiksi.",
        ],
        bullets: [
          "Jos tiedostossa on vain yksi tosite, se liitetään ensimmäiseen kirjaukseen. Se ei enää ole vuoden tosite vaan kirjauksen tosite. Saman tositteen muissa kirjauksissa on linkki Tosite (s. 1).",
          "Puukaupan tilityksestä tulee usein monta riviä: puukauppa ennakonpidätyksineen ja esimerkiksi mittauskulut.",
          "Tilisiirtolomake, viitenumero, tilinumero ja eräpäivä eivät ole kuluja. Ne kuuluvat samaan laskuun, eikä niistä tule omaa riviä.",
          "Jos ehdotus on väärä, valitse Hylkää ehdotus. Tosite jää vuoden tositteisiin. Voit myös poistaa yksittäisen ehdotusrivin.",
          "Jos päivä puuttuu tai on toiselta vuodelta, rivillä on varoitus. Päivän on oltava valitulla vuodella.",
          "Pitkä tiedosto luetaan kahdeksan sivun osissa, kaksi tai kolme osaa yhtä aikaa. Kaikista osista tulee yksi ehdotus. Jos sama tosite näkyy kahdessa osassa, se tulee ehdotukseen vain kerran.",
          "Koko vuoden aineisto, esimerkiksi 300 sivua, kestää noin 8–18 minuuttia. Pidä sivu auki sen ajan.",
          "Jos suljet sivun tai yhteys katkeaa kesken, luetut osat säilyvät. Tositteen kohdalla lukee Tunnistus kesken. Valitse Jatka tunnistusta, niin ohjelma jatkaa siitä, mihin jäi.",
          "Jos jotain osaa ei voitu lukea, näet esimerkiksi Sivuja 17–24 ei voitu lukea. Valitse Yritä uudelleen. Voit myös valita Tee ehdotus luetuista sivuista ja kirjata puuttuvat sivut käsin.",
          "Aloita alusta lukee koko tiedoston uudelleen.",
          "Jos tositetta ei voitu tunnistaa, kirjaa se käsin tavalliseen tapaan.",
          "Tosite lähetetään tunnistuspalveluun (Anthropic) Yhdysvaltoihin. Palveluun ei lähetetä asiakkaan nimeä. Tositteen lisäksi palvelu saa vihjeeksi asiakkaan tavallisimmat tiliöinnit: selitteen avainsanat, luokan, alv-prosentin ja osuuden, ei summia eikä viitteitä. Palvelu ei käytä tositetta tekoälyn kouluttamiseen, ja se poistaa tositteen 30 päivän kuluessa. Lisää tietoa on sivulla Tietosuoja (skog.adepta.fi/tietosuoja).",
          "Suljetun vuoden tositteita ei tunnisteta.",
          "Kun kokeilet ohjelmaa ilman tunnistuspalvelua, ehdotus tehdään tiedoston nimestä, eikä tositetta lähetetä minnekään. Nimi, jossa on sana kokooma, antaa esimerkin monen tositteen tiedostosta, ja nimi, jossa on sana maatila, maatilan tositteista. Maatalousasiakkaalla myös nimet meijeri, teurastamo, vilja, vipu, konekauppa, eläinkauppa, sähkö, myel, laina ja osuusmaksu antavat esimerkin. Yli kahdeksan sivun tiedostosta tulee esimerkkilaskuja sivujen mukaan.",
        ],
      },
      {
        title: "Tiliöintiehdotus tunnistuksessa",
        text: "Tunnistuksessa ohjelma vertaa jokaista riviä asiakkaan aiempiin kirjauksiin. Jos samanlainen kirjaus on aiemmin tiliöity selvästi samalla tavalla, ohjelma käyttää sitä tiliöintiä tekoälyn arvauksen sijaan. Kaikki on silti ehdotusta: mitään ei tallenneta, ennen kuin tallennat taulukon.",
        steps: [
          "Katso ehdotusrivin alta kohta Tiliöintiehdotus aiemmista kirjauksista. Siinä lukee peruste, esimerkiksi Tiliöity kuten 4/2024: 9 Muut vuosimenot, alv 25,5 %; 3 kertaa vuosina 2022–2024.",
          "Jos tekoäly ehdotti jotain muuta, se näkyy kohdassa Tekoäly ehdotti. Valitse Käytä tätä, jos se on oikein.",
          "Jos aiemmista kirjauksista löytyy muitakin tiliöintejä, ne näkyvät kohdassa Aiemmin myös. Käytä tätä vaihtaa rivin tiliöinnin.",
          "Tarkista rivi ja tallenna taulukko.",
        ],
        bullets: [
          "Ohjelma käyttää aiempaa tiliöintiä vain, kun se on selvä: samanlaiset kirjaukset on tiliöity lähes aina samoin. Muuten rivillä on tekoälyn arvaus, ja aiemmat tiliöinnit näkyvät vaihtoehtoina.",
          "Alv % tulee aina tositteelta. Jos aiemmin käytettiin eri kantaa, rivillä on huomautus.",
          "Puukauppa ennakonpidätyksineen, investoinnit ja tuet pitävät tekoälyn tiliöinnin, koska ne riippuvat tositteesta.",
          "Jos asiakkaalla ei ole samanlaista kirjausta, vaihtoehto voi tulla toimiston muilta asiakkailta. Sitä ohjelma ei käytä itse, vaan näyttää sen vaihtoehtona.",
        ],
      },
      {
        title: "Tilitys, jossa on monta riviä",
        text: "Yhdestä tositteesta tulee usein monta kirjausta. Esimerkiksi puukaupan tilityksessä on puukauppa ja kulut, ja meijerin tilityksessä maito ja vähennykset. Ohjelma näyttää tällaisen tositteen ryhmänä.",
        steps: [
          "Ryhmän yläpuolella on otsikko: tositteen laji, nimi, rivien määrä ja linkki tositteeseen.",
          "Otsikon alla lukee, täsmäävätkö rivit tositteeseen. Esimerkiksi: Tulot 7 152,50 €, vähennykset 1 677,00 €. Erotus 5 475,50 €. Täsmää tositteen summaan.",
          "Jos lukee ero, tarkista rivit tositteesta. Ero näkyy punaisena. Puuttuuko rivi, onko summa väärin tai onko tulo merkitty menoksi?",
          "Korjaa rivit. Täsmäytys päivittyy heti.",
          "Hyväksy kaikki kerralla: tallenna taulukko. Kaikki ryhmän rivit tallentuvat.",
          "Hyväksy riveittäin: poista ruksi kohdasta Hyväksy tallennettaessa niiltä riveiltä, joita et vielä halua kirjata. Tallenna.",
        ],
        bullets: [
          "Rivi, jolta poistit ruksin, ei tallennu. Se palaa ehdotukseksi tallennuksen jälkeen, ja voit hyväksyä sen myöhemmin.",
          "Odottamaan jätetty rivi palaa sellaisena kuin tunnistus sen teki. Jos muutit riviä, muutos ei säily.",
          "Otsikon painike Jätä tosite odottamaan poistaa ruksin kaikilta ryhmän riveiltä. Hyväksy kaikki rivit palauttaa ruksit.",
          "Jos poistat rivin (×), sitä ei kirjata eikä se palaa ehdotukseksi.",
          "Jos tositteesta jää rivejä odottamaan, tiedosto jää vuoden tositteisiin, ja jokaisessa kirjauksessa on linkki oikealle sivulle.",
          "Jos tositteen loppusummaa ei tunnistettu, täsmäytystä ei tehdä. Tarkista silloin summat itse.",
        ],
      },
      {
        title: "Monta tositetta samassa tiedostossa",
        text: "Skannaat ehkä monta paperia yhteen tiedostoon, esimerkiksi puukaupan vuosi-ilmoituksen ja pari laskua. Ohjelma käy läpi kaikki sivut ja tekee rivit jokaisesta tositteesta erikseen.",
        steps: [
          "Tunnista tiedosto tavalliseen tapaan.",
          "Katso rivin alta, mistä tositteesta rivi on ja millä sivulla. Esimerkiksi: Lasku 1182, Metsäpalvelu · Tosite (s. 3).",
          "Klikkaa sivulinkkiä, niin tiedosto aukeaa oikealta sivulta.",
          "Tarkista ja tallenna rivit.",
        ],
        bullets: [
          "Tiedosto jää vuoden tositteisiin, koska se kuuluu moneen kirjaukseen. Vuoden tositteissa lukee, montako kirjausta siitä on tehty.",
          "Jokaisessa kirjauksessa on linkki Tosite (s. 3), joka avaa tiedoston oikealta sivulta. Linkki näkyy taulukossa ja kirjauksen sivulla.",
          "Raportin liitteissä tiedosto on vain kerran. Kirjausluettelossa näkyy liitteen numero ja sivu.",
          "Tiedostoa ei voi poistaa, jos siitä on tehty kirjauksia. Poista ensin kirjaukset, jos tiedosto lisättiin väärin.",
        ],
      },
      {
        title: "Puukaupan vuosi-ilmoitus",
        text: "Puun ostaja lähettää vuoden lopussa vuosi-ilmoituksen. Se on koko vuoden yhteenveto kaikista kaupoista, ei uusi kauppa.",
        bullets: [
          "Ohjelma tekee vuosi-ilmoituksesta rivin jokaisesta kaupasta: myyntitulo arvonlisäveron kanssa ja ennakonpidätys. Pystykauppa ja hankintakauppa ovat eri riveillä.",
          "Menekinedistämismaksu tulee omaksi menorivikseen, jos se on suurempi kuin nolla.",
          "Jos ilmoituksessa ei ole kaupan päivää, rivin päivä on vuoden viimeinen päivä.",
          "Sopimusnumero tallentuu kirjauksen viitteeksi.",
          "Jos kauppa on jo kirjattu tilityksestä, älä kirjaa sitä toista kertaa. Poista silloin vuosi-ilmoituksen rivi ennen tallennusta.",
        ],
      },
      {
        title: "Mahdollinen päällekkäisyys",
        text: "Ohjelma varoittaa, jos ehdotusrivi näyttää jo kirjatulta.",
        bullets: [
          "Varoitus näkyy punaisena rivin alla: Mahdollinen päällekkäisyys ja kirjaus tai ehdotus, joka on samanlainen.",
          "Ohjelma vertaa saman vuoden kirjauksiin ja muiden tositteiden ehdotuksiin.",
          "Samanlainen tarkoittaa: sama sopimusnumero, sama laskunumero tai sama luokka ja lähes sama summa (euron tarkkuudella).",
          "Varoitus ei estä tallennusta. Päätä itse, kumpi rivi jää. Poista ylimääräinen rivi ennen tallennusta.",
        ],
      },
      {
        title: "Kirjauksen tosite",
        steps: [
          "Avaa kirjaus.",
          "Valitse tiedosto kohdasta Lisää tosite. PDF tai kuva, enintään 4 Mt.",
          "Valitse Tallenna tosite.",
          "Tosite aukeaa, kun klikkaat sen nimeä.",
          "Väärän tositteen voit poistaa, jos vuosi on auki. Silloin myös tiedosto poistuu.",
        ],
      },
    ],
    tips: ["Maatilan tositteista, kuten meijerin tilityksestä ja tuista, kerrotaan ohjeessa Maatalouden kirjanpito."],
    related: ["kirjanpito", "maatalouden-kirjanpito", "veroraportti"],
  },
  {
    slug: "investoinnit",
    group: "Investoinnit ja poistot",
    icon: "hammer",
    title: "Investoinnit ja poistot",
    summary: "Koneet, tiet ja ojat poistetaan vuosittain. Ohjelma laskee poistot ja jäljellä olevan arvon.",
    highlights: [
      "Kone 25 %, tie tai oja 15 %, rakennus 10 %",
      "Ennen Skogia hankittu tie tai kone menojäännöksineen",
      "Koneen myynti: luovutusvoitto tai -tappio",
      "Poistot valitaan verosuunnitelmassa",
    ],
    sections: [
      {
        title: "Investoinnit-sivu",
        text: "Avaa asiakas ja valitse välilehti Investoinnit. Näet kaikki asiakkaan investoinnit. Uusi investointi syntyy, kun kirjaat hankinnan kirjanpitoon.",
        bullets: [
          "Jokaisesta investoinnista näet hankintavuoden, hankintahinnan, kertyneen poiston ja menojäännöksen.",
          "Menojäännös on viimeisen kirjatun vuoden lopussa. Esimerkiksi 0,00 € 31.12.2024 – poistettu kokonaan.",
          "Kirjattu vuosi on vuosi, jonka verosuunnitelma on vahvistettu, tai vuosi, joka on tuotu vanhasta ohjelmasta.",
          "Poistettu kokonaan tarkoittaa, että arvoa ei ole jäljellä. Siitä ei tule enää poistoa, eikä se näy verosuunnitelmassa.",
          "Myyty investointi näyttää myyntivuoden ja myyntihinnan.",
          "Merkki kertoo, mistä investointi tuli: Kirjauksesta, Aiempi (lisätty käsin) tai Tuotu (vanhasta ohjelmasta). Aiemman investoinnin voit avata Muokkaa-linkistä.",
        ],
        steps: [
          "Valitse investoinnin alta Poistohistoria.",
          "Näet jokaisen vuoden rivinä: arvo alussa, poisto ja arvo lopussa.",
          "Maatalouden poistoryhmät ovat sivun lopussa omana taulukkonaan. Niissäkin on Poistohistoria.",
        ],
      },
      {
        title: "Vanhasta ohjelmasta tuodut investoinnit",
        text: "Tilituki-ohjelmasta tuodaan koko historia: jokainen kone, tie, oja ja rakennus omana investointinaan, ja jokaisen vuoden poisto. Näin seuraavan vuoden kirjanpito alkaa oikeasta menojäännöksestä.",
        bullets: [
          "Tuodussa investoinnissa on merkki Tuotu.",
          "Hankintavuosi ja hankintahinta tulevat vanhan ohjelman kortilta.",
          "Jos vanha ohjelma ei laskenut jotain vuotta, sen vuoden poisto on 0.",
          "Jos muutat tuotua investointia Skogissa, uusi tuonti ei enää muuta sitä.",
          "Suljetun vuoden poistoja tuonti ei muuta.",
          "Maatalouden ryhmät alkavat ensimmäisen Skogiin tuodun vuoden menojäännöksestä. Sitä vanhempi historia on vanhassa ohjelmassa.",
        ],
      },
      {
        title: "Aiemmin hankittu investointi ja menojäännös",
        text: "Jos asiakkaalla on tie, oja, kone tai rakennus, joka on hankittu ennen Skogia, lisää se tästä. Tarvitset hankintahinnan ja tähän mennessä tehdyt poistot. Ne löytyvät yleensä edellisen vuoden veroilmoituksen poistolaskelmasta. Esimerkki: metsäautotien menojäännös 31.12.2024 on 3 265,60 euroa.",
        steps: [
          "Avaa asiakas ja valitse välilehti Investoinnit.",
          "Valitse Lisää aiempi investointi.",
          "Kirjoita kuvaukseksi Metsäautotie.",
          "Valitse lajiksi Metsätie tai ojitus. Silloin vuodessa saa poistaa enintään 15 prosenttia.",
          "Menojäännöksen vuosi on 2024. Ohjelma ehdottaa vuotta valmiiksi.",
          "Hankintavuoden voit jättää tyhjäksi, jos et tiedä sitä.",
          "Valitse metsätila, jolla tie on. Jos tila myydään, tien arvo siirtyy kauppaan oikein.",
          "Kirjoita tien alkuperäinen hankintahinta.",
          "Kirjoita kertynyt poisto 31.12.2024 eli kaikki tähän mennessä tehdyt poistot. Jos poistoja ei ole tehty, kirjoita 0.",
          "Tarkista laskettu menojäännös. Sen pitää olla 3 265,60 euroa. Hankintahinta miinus kertynyt poisto on menojäännös.",
          "Valitse Lisää investointi.",
          "Avaa Verosuunnitelma ja vuosi 2025. Tie näkyy poistoissa. Poisto on enintään 489,84 euroa eli 15 prosenttia menojäännöksestä.",
        ],
        bullets: [
          "Kalusto lisätään samalla tavalla. Valitse lajiksi Kone tai laite, jolloin poisto on enintään 25 prosenttia.",
          "Investointi näkyy vasta menojäännöksen vuotta seuraavana vuonna. Aiemmille vuosille ei tule poistoa.",
          "Jos menojäännös on enintään 600 euroa, sen saa poistaa kerralla.",
          "Veroraportissa investoinnin alla lukee hankintahinta, kertynyt poisto ja menojäännös.",
          "Voit muuttaa tai poistaa aiemman investoinnin, kunnes sen ensimmäinen poistovuosi on suljettu.",
          "Jos muutat hinnan, poiston, lajin tai vuoden, jo vahvistetut poistot poistetaan. Vahvista verosuunnitelma silloin uudelleen.",
        ],
      },
      {
        title: "Poistotavat",
        bullets: [
          "Poisto lasketaan arvosta, joka on vielä poistamatta. Ostovuonna se on koko hankintahinta.",
          "Enintään: kone tai laite 25 prosenttia, metsätie tai ojitus 15 prosenttia, rakennus 10 prosenttia.",
          "Poisto on vapaaehtoinen. Voit tehdä pienemmän tai jättää sen tekemättä.",
          "Jos poistamatta on enintään 600 euroa, sen saa poistaa kerralla.",
          "Kun metsätila tai sen osa myydään, tilan metsätien ja ojituksen poistamaton arvo siirtyy myynnin hankintamenoon samassa suhteessa. Valitse siksi tie tai oja kirjatessa oikea metsätila.",
          "Metsätaloudessa ei ole tasapoistoa. Vanhasta ohjelmasta tuodut tasapoistot näkyvät vapaaehtoisina.",
        ],
      },
      {
        title: "Koneen myynti",
        steps: [
          "Kirjaa myynti kirjanpitoon luokalla Käyttöomaisuuden myynti ja valitse myytävä investointi.",
          "Myyntivuonna konetta ei poisteta.",
          "Myyntihinta ei ole metsätalouden tuloa.",
          "Jos hinta on suurempi kuin poistamaton arvo, erotus on luovutusvoittoa. Jos pienempi, erotus on luovutustappiota.",
          "Voitto tai tappio ilmoitetaan erikseen lomakkeella 9. Laskelma näyttää sen omalla rivillään.",
          "Jos vuoden myynnit ovat yhteensä enintään 1 000 euroa, voitto on verovapaa.",
        ],
      },
      {
        title: "Maatalouden investoinnit",
        text: "Maatalouden investoinnit poistetaan ryhmittäin, kuten lomakkeella 2. Esimerkiksi kaikilla koneilla on yksi yhteinen menojäännös. Poiston valitset ryhmälle Lomake 2 -välilehdellä.",
        steps: [
          "Kirjaa uusi investointi kirjanpitoon luokalla Maatalouden investointi (58) ja valitse poistoryhmä.",
          "Jos kone on uusi ja otettu käyttöön vuonna 2025, voit valita korotetun poiston 50 %.",
          "Ennen Skogia hankitut investoinnit lisäät Investoinnit-sivulla: valitse Lisää aiempi investointi ja laji Maatalous-ryhmästä.",
          "Koneet ja kalusto voi lisätä yhtenä rivinä: kirjoita kuvaukseksi Koneet ja kalusto yhteensä, hankintahinta ja kertynyt poisto. Menojäännös on edellisen vuoden veroilmoituksen kohdassa Menojäännös verovuoden lopussa.",
          "Avaa Lomake 2 -välilehti. Ryhmien menojäännökset ja enimmäispoistot näkyvät siellä.",
        ],
        bullets: [
          "Poistoryhmät: tuotantorakennus 10 %, asuinrakennus 6 %, kasvihuone 20 %, ympäristönsuojelun rakennelma 25 %, koneet ja kalusto 25 %, sillat ja asfaltointi 10 %, salaojat 20 %.",
          "Enintään 1 200 euron maatalouden hankinta kirjataan menona.",
          "Jos koneiden ryhmässä on enintään 1 200 euroa, sen saa poistaa kerralla. Rakennuksissa raja on 1 000 euroa.",
          "Kun myyt maatalouden koneen, myyntihinta vähennetään ryhmän menojäännöksestä. Luovutusvoittoa ei lasketa.",
          "Investointituki ja investointiin käytetty tasausvaraus pienentävät poistopohjaa. Ne kirjataan Lomake 2 -välilehdellä.",
        ],
      },
    ],
    related: ["kirjanpito", "verosuunnitelma", "maatalous", "siirtyminen"],
  },
  {
    slug: "maatalous",
    group: "Maatalous",
    icon: "building",
    title: "Lomake 2 (maatalous)",
    summary: "Maatalouden veroilmoitus: poistot ryhmittäin, varaukset, jaksotukset ja lomakkeen 2 laskelma.",
    highlights: [
      "Maatalouden tulos lomakkeen 2 mukaan",
      "Poistot ryhmittäin",
      "Tasausvaraus, jälleenhankintavaraus ja kotieläinten jaksotus",
      "Ajoneuvo- ja matkaselvitys",
    ],
    sections: [
      {
        title: "Maatalouden käyttöönotto asiakkaalle",
        steps: [
          "Avaa asiakas ja valitse Muokkaa.",
          "Rastita Harjoittaa maataloutta. Jos asiakkaalla ei ole metsää, poista rasti kohdasta Harjoittaa metsätaloutta.",
          "Toimintoa ei voi poistaa, jos sillä on jo kirjauksia tai investointeja.",
          "Tallenna. Asiakkaalle tulevat välilehdet Maatalouden kirjanpito ja Lomake 2.",
          "Jos asiakkaalla on useampi maatila, lisää tilat Lomake 2 -välilehden alaosassa.",
        ],
      },
      {
        title: "Aloitus edellisen vuoden veroilmoituksesta",
        text: "Kun maatila tulee Skogiin, tarvitset edellisen vuoden lomakkeen 2. Siitä saat menojäännökset, varaukset ja jaksotukset.",
        steps: [
          "Avaa Investoinnit ja valitse Lisää aiempi investointi.",
          "Valitse laji Maatalous-ryhmästä, esimerkiksi Koneet ja kalusto.",
          "Kirjoita kuvaukseksi Koneet ja kalusto yhteensä. Kirjoita hankintahinta ja kertynyt poisto niin, että menojäännös on sama kuin veroilmoituksen kohdassa Menojäännös verovuoden lopussa.",
          "Tee sama rakennuksille, salaojille ja muille ryhmille, joissa on menojäännöstä.",
          "Avaa Lomake 2 -välilehti. Lisää purkamattomat tasausvaraukset kohdassa Tasausvaraus ja jälleenhankintavaraus.",
          "Lisää aiempien vuosien kotieläinten jaksotukset kohdassa Kotieläinten jaksotukset.",
        ],
      },
      {
        title: "Kirjaukset",
        bullets: [
          "Maatalouden tulot ja menot kirjataan välilehdellä Maatalouden kirjanpito samalla tavalla kuin metsän. Luokat ovat numeroilla 21–59.",
          "Ostot viedään veroilmoitukselle arvonlisäverokannan mukaan. Siksi alv-prosentin pitää olla oikein.",
          "Jos meno kuuluu osittain metsätaloudelle, kirjoita osuudet sarakkeisiin Osuus % ja Toinen %.",
          "MYEL-maksut kirjataan luokalla 54. Ne vähennetään maatalouden menoina.",
          "Kun valitset kotieläinten myynnille tai hankinnalle Jaksota, summa jaetaan kolmelle vuodelle tasan. Jaksotetut rivit näkyvät luokissa 22 ja 50.",
        ],
      },
      {
        title: "Maatalouden tulos",
        text: "Lomake 2 -välilehden yläosassa on maatalouden tulos lomakkeen 2 mukaan: tulot, menot ja poistot sekä tulos tai tappio.",
        bullets: [
          "Tulot ovat ilman arvonlisäveroa. Menot ovat ilman veroa, jos asiakas on arvonlisäverorekisterissä. Muuten menot ovat verollisina.",
          "Ostot jaetaan veroilmoituksella verokannan mukaan: 25,5 %, alennettu kanta ja 0 %.",
          "Avaa Lomakkeen 2 kentät, niin näet jokaisen kentän ja sen summan.",
          "Punainen huomautus kertoo virheestä, joka pitää korjata ennen veroilmoitusta. Keltainen huomautus kannattaa tarkistaa.",
          "Verosuunnitelma laskee metsän ja maatalouden veron yhdessä. Siellä voit valita poistot, tasausvarauksen ja pääomatulo-osuuden.",
        ],
      },
      {
        title: "Poistot ryhmittäin",
        text: "Maatalouden investoinnit poistetaan ryhmittäin. Lomake 2 -välilehdellä näet jokaisen ryhmän menojäännöksen ja enimmäispoiston.",
        steps: [
          "Avaa Lomake 2 -välilehti ja valitse verovuosi Verovuosi-valikosta.",
          "Katso taulukosta Poistot ryhmittäin ryhmän poistopohja ja enimmäismäärä.",
          "Kirjoita poisto jokaiselle ryhmälle. Poisto voi olla pienempi kuin enimmäismäärä tai nolla.",
          "Valitse Tallenna poistot.",
          "Voit valita poistot myös Verosuunnitelma-välilehdellä liukusäätimellä. Molemmat tallentavat samat poistot.",
        ],
        bullets: [
          "Menojäännös siirtyy seuraavalle vuodelle tallennetulla poistolla.",
          "Myyntihinnat, investointituet ja investointiin käytetty tasausvaraus pienentävät poistopohjaa.",
          "Vuonna 2025 uusille koneille on oma ryhmä, jossa poisto on enintään 50 %. Vuonna 2026 ne siirtyvät koneiden ryhmään.",
        ],
      },
      {
        title: "Vuoden tiedot",
        bullets: [
          "Varallisuuslaskelmaan kirjoitat maatalouden velat ja ne varat, joita Skog ei laske, esimerkiksi meijeriosuudet.",
          "Rakennusten ja koneiden arvot tulevat poistoista.",
          "Puolison osuudet täytetään vain, jos puolisot harjoittavat maataloutta yhdessä. Yrittäjän osuus on loppu.",
          "Jos maatalous on tappiollinen, voit kirjoittaa, paljonko tappiosta vähennetään pääomatuloista.",
          "Edellisen vuoden nettovarallisuus tarvitaan vain, jos edellinen vuosi ei ole Skogissa. Kirjoita se edellisen vuoden verotuksesta.",
          "Vaatimus yritystulon jaosta ja tappion vähennys pääomatuloista voidaan valita myös verosuunnitelmassa.",
        ],
      },
      {
        title: "Tasausvaraus ja jälleenhankintavaraus",
        steps: [
          "Kirjoita tämän vuoden tasausvaraus: laji, vuosi ja määrä. Valitse Lisää varaus.",
          "Kun aiempi varaus käytetään investointiin, valitse varauksen rivillä Investointiin, valitse investointi ja kirjoita määrä. Valitse Lisää. Painikkeessa on verovuosi, esimerkiksi Lisää 2025.",
          "Kun varaus tuloutetaan, valitse Tuloutus, kirjoita määrä ja valitse Lisää.",
        ],
        bullets: [
          "Purkamaton määrä näkyy taulukossa ja veroilmoituksella vuosittain.",
          "Verosuunnitelma laskee tämän vuoden tasausvarauksen enimmäismäärän. Siellä voit valita varauksen ja aiempien varausten tuloutuksen liukusäätimellä.",
        ],
      },
      {
        title: "Jälleenhankintavarauksen laskuri",
        steps: [
          "Avaa Lomake 2 ja mene kohtaan Tasausvaraus ja jälleenhankintavaraus.",
          "Kirjoita laskuriin rakennuksen tai rakennelman nimi ja valitse, myytiinkö se vai vahingoittuiko se.",
          "Kirjoita hinta tai korvaus ja hankintamenon osa, jota ei ole vielä poistettu.",
          "Laskuri näyttää, paljonko varausta voi enintään tehdä ja mihin vuoteen mennessä se on käytettävä.",
          "Jätä Varaus tyhjäksi, jos haluat enimmäismäärän. Voit myös kirjoittaa pienemmän summan.",
          "Valitse Tee jälleenhankintavaraus.",
        ],
        bullets: [
          "Varaus koskee vain rakennuksia ja rakennelmia, ei koneita.",
          "Varaus on enintään se osa hinnasta tai korvauksesta, joka ylittää poistamatta olevan hankintamenon.",
          "Varaus on käytettävä uuteen rakennukseen tai korjaukseen tai tuloutettava viimeistään kolmantena vuonna.",
          "Laskun pohja tallentuu varauksen lisätietoon.",
          "Skog ei vielä vähennä varausta lomakkeen 2 tuloksesta. Lomake 2 muistuttaa tästä. Tarkista, miten hinta tai korvaus on kirjattu.",
        ],
      },
      {
        title: "Kotieläinten jaksotukset",
        bullets: [
          "Jaksotus syntyy kirjanpidossa, kun valitset kirjaukselle Jaksota. Sellaisen rivin kohdalla on linkki kirjaukseen.",
          "Aiempien vuosien jaksotukset kirjoitetaan tähän. Jätä vuosien osat tyhjiksi, niin summa jaetaan tasan. Laki edellyttää tasaista jakoa, ja Skog huomauttaa, jos jako ei ole tasan.",
          "Verovuodelle kuuluva osa lasketaan kolmen vuoden jaksotuksista.",
        ],
      },
      {
        title: "Ajoneuvot ja matkat",
        text: "Kohdassa Ajoneuvot ja matkat annat auton ja matkojen tiedot. Skog laskee lomakkeen luvut.",
        steps: [
          "Maatalouden auto tai traktori: valitse peruste (ajopäiväkirja tai muu selvitys) ja kirjoita kilometrit yhteensä, yksityisajot, metsätalouden ajot ja kokonaismenot.",
          "Oma auto, jolla ajetaan maatalouden ajoja: kirjoita kilometrit yhteensä ja maatalouden ajot. Jos osa autokuluista on jo kirjattu menoksi, kirjoita se kohtaan Jo vähennetty kirjanpidossa.",
          "Työmatkat: kirjoita matkapäivät. Jos päivärahoja on jo kirjattu menoksi, kirjoita ne kohtaan Jo vähennetty.",
          "Valitse Tallenna selvitys.",
        ],
        bullets: [
          "Yksityisajojen ja metsätalouden ajojen osuus kuluista tulee maatalouden tuloksi.",
          "Metsätalouden ajojen osuus vähennetään metsätaloudessa. Se näkyy metsän veroilmoituksessa kohdassa 630 ja verosuunnitelman menoissa.",
          "Oman auton kilometrikorvaus ja päivärahat tulevat maatalouden muihin vähennyksiin.",
          "Älä kirjaa samaa yksityiskäyttöä lisäksi luokalla Tuloutus yksityiskäytöstä. Skog huomauttaa, jos molempia on.",
          "Jos annat metsätalouden osuuden kirjauksille Toinen %-sarakkeessa, älä anna samoja kuluja enää selvityksessä.",
          "Kun kentät ovat tyhjiä ja tallennat, selvitys poistuu.",
        ],
      },
      {
        title: "Veroilmoitustiedosto",
        text: "Lomakkeen 2 tiedosto tehdään Veroraportti ja arkisto -välilehdellä. Jos asiakkaalla on myös metsää, lomake 2C tulee samaan tiedostoon. Katso ohje Sähköinen veroilmoitus (2 ja 2C).",
      },
      {
        title: "Maatilat",
        text: "Maatiloja tarvitaan vain, jos asiakkaalla on useampi maatila. Silloin tasausvaraus lasketaan tiloittain.",
        steps: [
          "Mene Lomake 2 -välilehden alaosaan kohtaan Maatilat.",
          "Kirjoita maatilan nimi. Ruokaviraston tilatunnus on vapaaehtoinen.",
          "Valitse Lisää maatila.",
          "Valitse sen jälkeen kirjanpidossa jokaiselle tilan omalle kirjaukselle oikea maatila.",
        ],
      },
      {
        title: "Investointituet ja muut tiedot",
        bullets: [
          "Investointituki kirjataan investoinnille sinä vuonna, kun tuki on saatu. Se ei ole tuloa.",
          "Harvoin tarvittavat kentät, kuten käyttöön ottamattomat investoinnit, löytyvät kohdasta Muut lomakkeen tiedot. Valitse kenttä ja kirjoita arvo.",
          "Ajoneuvot ja matkat annetaan omassa kohdassaan. Jos niitä on annettu aiemmin käsin, selvitys korvaa ne.",
          "Maatilaa ei voi poistaa, jos sille on kirjauksia suljetulta vuodelta.",
        ],
      },
    ],
    tips: ["Suljetun vuoden maatalouden tietoja ei voi muuttaa. Pääkäyttäjä voi avata vuoden."],
    related: ["maatalouden-kirjanpito", "investoinnit", "verosuunnitelma", "veroilmoitus"],
  },
  {
    slug: "alv",
    group: "Arvonlisävero",
    icon: "stamp",
    title: "Arvonlisävero",
    summary: "Arvonlisävero lasketaan kirjauksista neljänneksittäin ja koko vuodelta.",
    highlights: ["Myynnin ja ostojen vero", "Maksettava tai palautettava", "Myynnit verokannoittain", "Metsä ja maatalous samalla ilmoituksella"],
    sections: [
      {
        title: "Näin luet yhteenvedon",
        bullets: [
          "Myynnin vero lasketaan tuloista, esimerkiksi puukaupasta.",
          "Ostojen vero lasketaan menoista ja investoinneista.",
          "Maksettava on myynnin vero miinus ostojen vero. Jos luku on miinuksella, veroa palautetaan.",
          "Jos kirjauksesta vain osa kuuluu metsätaloudelle, ostojen verosta on mukana vain se osa. Loppu näkyy korttien alla, eikä sitä vähennetä.",
          "Neljännekset auttavat, jos asiakas ilmoittaa useammin kuin kerran vuodessa.",
          "Vanhoilla vuosilla käytetään sen ajan verokantoja. Esimerkiksi yleinen verokanta oli 24 % vuodesta 2013 elokuuhun 2024.",
        ],
      },
      {
        title: "Metsä ja maatalous",
        text: "Kun asiakas harjoittaa metsä- ja maataloutta, molemmat ilmoitetaan samalla arvonlisäveroilmoituksella. Skog laskee yhden yhteenvedon kaikista kirjauksista.",
        bullets: [
          "Taulukko Metsä ja maatalous näyttää, paljonko veroa tulee kummastakin toiminnosta.",
          "Ostojen verosta vähennetään metsän ja maatalouden osuus. Vain yksityinen osuus jää vähentämättä.",
          "Maidon, viljan ja rehun alennettu verokanta on 14 % vuonna 2025 ja 13,5 % vuodesta 2026.",
          "Verokausi on yleensä kalenterivuosi. Ilmoita ja maksa vero viimeistään seuraavan helmikuun lopussa.",
        ],
      },
      {
        title: "Arvonlisäveroilmoituksen kentät",
        text: "Taulukko näkyy vain, kun asiakas on arvonlisäverorekisterissä.",
        steps: [
          "Avaa Arvonlisävero-välilehti ja valitse verovuosi Verovuosi-valikosta.",
          "Katso sivun alaosasta taulukko Arvonlisäveroilmoituksen kentät.",
          "Kirjoita luvut OmaVeron ilmoitukseen samoihin kohtiin: 301, 302, 303, 307 ja 308.",
          "Tarkista luvut ennen kuin lähetät ilmoituksen.",
        ],
      },
    ],
    tips: ["Jos asiakas ei ole arvonlisäverorekisterissä, sivulla näkyy muistutus."],
    related: ["kirjanpito", "maatalouden-kirjanpito"],
  },
  {
    slug: "verosuunnitelma",
    group: "Verosuunnitelma",
    icon: "coins",
    title: "Verosuunnitelma",
    summary: "Arvio vuoden verosta. Valitse, paljonko metsävähennystä, poistoja ja tasausvarausta käytetään.",
    highlights: [
      "Verotettava pääomatulo ja vero",
      "Metsävähennyksen rajat valmiina",
      "Maatalousasiakkaalla myös maatalous: poistot, tasausvaraus ja yritystulon jako",
      "Vahvistus tallentaa valinnat",
    ],
    sections: [
      {
        title: "Suunnitelman teko",
        steps: [
          "Avaa asiakas ja valitse välilehti Verosuunnitelma.",
          "Valitse verovuosi Verovuosi-valikosta.",
          "Sivun yläosassa näet verosäästön ja arvioidun veron. Niiden alla ovat tulot, menot ja tulos ennen vähennyksiä.",
          "Valitse jokaisen investoinnin poisto liukusäätimellä tai kirjoita summa. Aseta kaikki enimmäismäärään valitsee suurimmat poistot kerralla.",
          "Valitse metsävähennys liukusäätimellä, kirjoita summa tai valitse Käytä enimmäismäärä.",
          "Laskelma oikealla päivittyy heti. Näet myös veroasteen ja veron ilman vähennyksiä.",
          "Katso sivun lopusta Huomiot ja suositukset. Siellä kerrotaan esimerkiksi, paljonko käyttämätön metsävähennys säästäisi.",
          "Valitse Vahvista suunnitelma. Poistot ja metsävähennys tallentuvat.",
        ],
        bullets: [
          "Jos vuodelle on jo vahvistettu suunnitelma, näet vahvistetut luvut. Voit muuttaa niitä ja vahvistaa uudelleen.",
          "Kokonaan poistettu investointi ei näy suunnitelmassa, koska siitä ei voi enää tehdä poistoa.",
        ],
      },
      {
        title: "Metsävähennyksen rajat",
        bullets: [
          "Vähennys on vähintään 1 500 euroa tai ei lainkaan.",
          "Vuodessa enintään 60 prosenttia metsätalouden tuloista ennen kuluja ja poistoja. Vuodesta 2026 raja on 75 prosenttia.",
          "Oman hankintatyön arvo vähennetään tuloista ennen rajan laskemista.",
          "Yhteensä enintään tilojen käyttämätön pohja.",
        ],
      },
      {
        title: "Maatalousasiakkaan suunnitelma",
        text: "Jos asiakkaalla on maatalous, sama sivu laskee metsän ja maatalouden yhdessä. Yläosassa näet arvioidun veron yhteensä ja säästön.",
        steps: [
          "Valitse maatalouden poistot ryhmittäin liukusäätimellä tai kirjoita summa.",
          "Valitse tasausvaraus. Sivu näyttää, paljonko varausta voi tänä vuonna tehdä.",
          "Jos aiemmilta vuosilta on purkamatta varausta, valitse, paljonko siitä tuloutetaan tänä vuonna.",
          "Valitse pääomatulo-osuus: 20 %, 10 % tai 0 %.",
          "Jos maatalous on tappiollinen, valitse, vähennetäänkö tappio tämän vuoden pääomatuloista.",
          "Katso laskelma oikealla. Voit kirjoittaa asiakkaan muut ansiotulot ja kunnan veroprosentin, niin arvio tarkentuu. Niitä ei tallenneta.",
          "Valitse Vahvista suunnitelma. Poistot, tasausvaraus, tuloutukset ja valinta tallentuvat Lomake 2 -välilehdelle.",
        ],
      },
      {
        title: "Yritystulon jako",
        bullets: [
          "Maatalouden tuloksesta vähennetään ensin aiempien vuosien vahvistetut tappiot.",
          "Siitä vähennetään 5 % yrittäjävähennys.",
          "Pääomatuloa on 20 % edellisen vuoden lopun nettovarallisuudesta. Asiakas voi vaatia 10 % tai 0 %.",
          "Nettovarallisuuteen lisätään 30 % maatalouden palkoista. Jos velkoja on enemmän kuin varoja, kaikki on ansiotuloa.",
          "Loppu on ansiotuloa. Puolisoilla pääomatulo jaetaan varallisuusosuuksien ja ansiotulo työosuuksien mukaan.",
          "Nettovarallisuus tulee edellisen vuoden lomakkeesta 2, jos se vuosi on Skogissa. Muuten kirjoita se Lomake 2 -välilehden vuoden tietoihin.",
          "Metsätalouden ja maatalouden pääomatulot lasketaan yhteen. Yli 30 000 euron osasta vero on 34 %.",
          "Ansiotulon vero on arvio. Siinä ei ole vähennyksiä, kirkollisveroa eikä sairausvakuutusmaksuja.",
        ],
      },
      {
        title: "Tasausvaraus",
        bullets: [
          "Varaus on enintään 40 % maatalouden puhtaasta tuloksesta ennen korkoja.",
          "Varaus on 800–25 000 euroa, täysinä satoina euroina.",
          "Varaus käytetään investointiin tai tuloutetaan viimeistään kolmantena vuonna. Käyttö investointiin kirjataan Lomake 2 -välilehdellä.",
          "Jos asiakkaalla on useampi maatila, varaus tehdään tiloittain. Jokaisella tilalla on oma liukusäädin ja oma enimmäismäärä.",
          "Tilan tulo lasketaan kirjauksista, joille on valittu tila. Yhteiset kirjaukset ja poistot jaetaan tiloille tulojen suhteessa.",
          "Jos tilalle on tehty vuodelle useampi varaus, muuta niitä Lomake 2 -välilehdellä.",
        ],
      },
      {
        title: "Metsätilan myynti",
        text: "Jos tila tai sen osa on myyty tänä vuonna, suunnitelmassa on laskelma jokaisesta kaupasta: kauppahinta, hankintameno tai olettama, tie- ja ojamenot, myyntikulut, metsävähennyksen lisäys ja luovutusvoitto. Voitto tai tappio ilmoitetaan lomakkeella 9. Luovutukset kirjataan metsätilan sivulla.",
      },
      {
        title: "Vuoden sulkeminen",
        text: "Pääkäyttäjä voi valita Vahvista ja sulje vuosi. Silloin suunnitelma vahvistetaan, vuosi suljetaan ja lopullinen veroraportti tallentuu arkistoon. Suljetun vuoden suunnitelmaa ei voi muuttaa.",
      },
    ],
    tips: [
      "Pääomatulon vero on 30 prosenttia 30 000 euroon asti ja 34 prosenttia sen yli.",
      "Yrittäjävähennys: 5 prosenttia metsätalouden tuloksesta metsävähennyksen jälkeen jää verottamatta. Laskelma tekee sen itse.",
      "Vero on arvio. Asiakkaan muut pääomatulot eivät ole mukana.",
      "Maatalouden poistot ja varaukset voi muuttaa myös Lomake 2 -välilehdellä. Molemmat näyttävät samat luvut.",
    ],
    related: ["investoinnit", "metsatilat", "maatalous", "veroraportti"],
  },
  {
    slug: "veroraportti",
    group: "Raportit ja veroilmoitus",
    icon: "folder",
    title: "Veroraportti ja arkisto",
    summary: "Veroilmoitusta tukeva raportti PDF:nä. Raportit ja tositteet säilyvät arkistossa verovuosittain.",
    highlights: ["Kansilehti ja sisällysluettelo", "LUONNOS-merkintä avoimelle vuodelle", "Raportti arkistoon, kun vuosi suljetaan", "Veroilmoituksen tiedosto samalta välilehdeltä"],
    sections: [
      {
        title: "Raportin avaaminen",
        steps: [
          "Avaa asiakas ja valitse välilehti Veroraportti ja arkisto.",
          "Valitse verovuosi Verovuosi-valikosta.",
          "Valitse Avaa luonnos tai suljetulla vuodella Avaa raportti. Raportti aukeaa uuteen välilehteen, josta voit tulostaa tai tallentaa sen.",
          "Jos haluat tositteet raportin loppuun, valitse Avaa luonnos tositteineen tai Avaa tositteineen.",
        ],
      },
      {
        title: "Raportin sisältö",
        bullets: [
          "Kansilehti ja sisällysluettelo.",
          "Yhteenveto ja maksutiedote: tuleeko veroa maksettavaksi vai palautusta, ja paljonko arvonlisäveroa tilitetään ja milloin.",
          "Jos veroa jää maksettavaksi, raportti neuvoo pyytämään lisäennakon ja maksamaan sen 31.1. mennessä, niin korkoa ei tule.",
          "Asiakkaan verotilin viite näkyy maksutiedotteessa, jos se on tallennettu asiakkaan tietoihin.",
          "Tulot, menot ja verolaskelma.",
          "Arvonlisävero neljänneksittäin.",
          "Investoinnit ja poistot.",
          "Metsävähennys tiloittain.",
          "Maatalousasiakkaalla osa Maatalous (lomake 2): tulot ja menot luokittain, lomakkeen 2 kentät, poistot ryhmittäin ja huomautukset.",
          "Maatalousasiakkaan yhteenvedossa on myös maatalouden tulos, pääomatulo- ja ansiotulo-osuus sekä arvioitu vero yhteensä. Arvonlisävero on metsästä ja maataloudesta yhteensä.",
          "Jos asiakkaalla on vain maatalous, metsätalouden osat jäävät pois.",
          "Kaikki vuoden kirjaukset.",
          "Jos kirjauksesta vain osa kuuluu metsätaloudelle, kirjausluettelossa on sarake Osuus. Summa on koko kuitin, mutta tuloissa, menoissa ja verolaskelmassa on vain metsätalouden osuus.",
        ],
      },
      {
        title: "Sähköinen veroilmoitus",
        text: "Samalla välilehdellä teet veroilmoituksen tiedoston Ilmoitin.fi-palveluun. Katso ohje Sähköinen veroilmoitus (2 ja 2C).",
      },
      {
        title: "Arkisto",
        bullets: [
          "Kun pääkäyttäjä sulkee vuoden, lopullinen raportti tallentuu arkistoon.",
          "Jos vuosi avataan ja suljetaan uudelleen, arkistoon tulee uusi versio. Vanha säilyy.",
          "Arkistossa näkyvät myös vuoden tositteet.",
          "Jos vuosi on tuotu vanhasta ohjelmasta valmiiksi suljettuna, arkistossa ei ole raporttia. Sivulla lukee silloin Arkistossa ei ole raporttia tälle vuodelle. Voit silti avata raportin nykyisillä luvuilla.",
        ],
      },
    ],
    tips: ["Avoimen vuoden raportissa on LUONNOS-merkintä jokaisella sivulla."],
    related: ["veroilmoitus", "verosuunnitelma", "tositteet"],
  },
  {
    slug: "veroilmoitus",
    group: "Raportit ja veroilmoitus",
    icon: "pen",
    title: "Sähköinen veroilmoitus (2 ja 2C)",
    summary: "Skog tekee metsätalouden (2C) ja maatalouden (lomake 2) veroilmoituksesta tiedoston. Sinä lähetät sen Ilmoitin.fi-palveluun.",
    highlights: [
      "Esikatselu: mikä luku menee mihinkin kohtaan",
      "Metsä ja maatalous samaan tiedostoon",
      "Henkilötunnusta ei tallenneta",
      "Verovuodet 2025 ja 2026",
    ],
    sections: [
      {
        title: "Metsätalouden ilmoitus (2C)",
        text: "Skog tekee metsätalouden veroilmoituksesta (lomake 2C) tiedoston. Sinä lataat tiedoston Ilmoitin.fi-palveluun, ja se menee sieltä Verohallinnolle. Luvut ovat samat kuin veroraportissa.",
        steps: [
          "Vahvista ensin vuoden verosuunnitelma. Muuten poistot ja metsävähennys puuttuvat.",
          "Avaa asiakas ja valitse välilehti Veroraportti ja arkisto. Valitse verovuosi Verovuosi-valikosta.",
          "Katso kohdasta Sähköinen veroilmoitus (2C), mitkä luvut menevät mihinkin kohtaan. Maatalousasiakkaalla kohta on Sähköinen veroilmoitus (2 ja 2C). Lue myös varoitukset.",
          "Jos asiakkaalla ei ole Y-tunnusta, kirjoita hänen henkilötunnuksensa.",
          "Jos vuonna on hankintatyötä, tarkista tekijät. Kirjoita jokaiselle nimi, henkilötunnus, kuutiot ja arvo. Voit myös jättää tekijät erittelemättä.",
          "Valitse Lataa ilmoitustiedosto. Tiedosto tallentuu koneellesi.",
          "Mene osoitteeseen www.ilmoitin.fi ja kirjaudu. Tarkista tiedosto ensin toiminnolla Aineiston tarkastus.",
          "Kun tarkastus on kunnossa, lähetä sama tiedosto. Poista tiedosto sitten koneeltasi.",
        ],
        bullets: [
          "Henkilötunnusta ei tallenneta Skogiin. Se on vain ladatussa tiedostossa, joten kirjoitat sen joka kerta uudelleen.",
          "Koneen tai metsätilan myynnin luovutusvoitto ei kuulu tähän ilmoitukseen. Ilmoita se OmaVerossa (lomake 9).",
          "Ennakonpidätyksiä ei ilmoiteta. Verohallinto saa ne puun ostajilta.",
          "Jos asiakas ei ole alv-velvollinen, menot menevät ilmoitukselle arvonlisäveron kanssa. Tulot ovat aina ilman veroa.",
          "Tarvitset asiakkaalta Suomi.fi-valtuuden (Veroasioiden hoito tai Veroilmoittaminen).",
          "Tiedoston voi tehdä vuosille 2025 ja 2026, myös suljetulle vuodelle.",
          "Jos asiakas harjoittaa maataloutta, samaan tiedostoon tulee myös maatalouden veroilmoitus (lomake 2). Katso alta Maatalouden ilmoitus (lomake 2).",
        ],
      },
      {
        title: "Maatalouden ilmoitus (lomake 2)",
        text: "Skog tekee maatalouden veroilmoituksesta (lomake 2) tiedoston. Jos asiakkaalla on myös metsää, metsätalouden 2C tulee samaan tiedostoon.",
        steps: [
          "Vahvista ensin verosuunnitelma. Se tallentaa metsän ja maatalouden poistot ja valinnat.",
          "Avaa Veroraportti ja arkisto -välilehti ja valitse verovuosi Verovuosi-valikosta.",
          "Katso kohdasta Lomake 2: maatalous, mitkä luvut menevät mihinkin kohtaan. Korjaa punaiset virheet.",
          "Kirjoita henkilötunnus, jos asiakkaalla ei ole Y-tunnusta.",
          "Valitse Lataa ilmoitustiedosto.",
          "Lataa tiedosto Ilmoitin.fi-palveluun ja tarkista se ensin toiminnolla Aineiston tarkastus.",
        ],
        bullets: [
          "Lomake 2 annetaan joka vuosi, vaikka maataloutta ei olisi ollut. Silloin tiedostoon tulee tieto Ilmoitettavia tietoja ei ole.",
          "Tiedoston nimi kertoo lomakkeet, esimerkiksi 2_2C_2025_Nimi.txt.",
          "Lomakkeen 2 tiedostoa ei ole vielä kokeiltu Ilmoitin.fi:n tarkastuksessa. Tarkista tiedosto aina ennen lähettämistä.",
        ],
      },
      {
        title: "Kun tiedostoa ei voi ladata",
        bullets: [
          "Punainen huomautus Korjaa ennen latausta estää latauksen. Korjaa asia ja yritä uudelleen.",
          "Keltainen huomautus Tarkista ennen latausta ei estä latausta. Lue se silti.",
          "Jos sivulla lukee, ettei vuodelle voi vielä tehdä sähköistä ilmoitusta, Skogissa ei ole sen vuoden tiedostokuvausta. Vanhojen vuosien ilmoitukset on jo annettu.",
        ],
      },
    ],
    related: ["veroraportti", "verosuunnitelma", "maatalous"],
  },
  {
    slug: "asetukset",
    group: "Käyttäjät ja asetukset",
    icon: "gear",
    title: "Asetukset",
    summary: "Asetuksissa päätetään toimiston tiedot ja käyttäjät. Asetukset näkee vain pääkäyttäjä.",
    highlights: ["Toimiston yhteystiedot", "Käyttäjät ja roolit", "Viimeisimmät tapahtumat"],
    appPath: "/asetukset",
    appLabel: "Asetukset",
    sections: [
      {
        title: "Yhteystiedot",
        text: "Kohdassa Toimiston yhteystiedot kirjoitat sähköpostin, puhelimen ja postiosoitteen ja valitset Tallenna yhteystiedot. Ne tulevat veroraportin kansilehdelle.",
      },
      {
        title: "Käyttäjän lisääminen",
        steps: [
          "Mene kohtaan Lisää käyttäjä.",
          "Kirjoita uuden käyttäjän sähköposti ja nimi.",
          "Valitse rooli: pääkäyttäjä tai kirjanpitäjä.",
          "Valitse Lisää. Käyttäjä saa sähköpostiin kutsun.",
          "Jos hänellä ei ole vielä tunnusta, hän asettaa kutsun linkistä salasanan.",
          "Hän kirjautuu samalla sähköpostiosoitteella, jolla lisäsit hänet.",
        ],
      },
      {
        title: "Kutsu uudelleen",
        steps: [
          "Etsi käyttäjä listasta. Hänen kohdallaan lukee Ei vielä kirjautunut.",
          "Valitse Lähetä kutsu uudelleen.",
        ],
      },
      {
        title: "Roolin vaihto",
        steps: ["Valitse käyttäjän riviltä uusi rooli.", "Valitse Tallenna."],
        text: "Toimistolla on aina oltava ainakin yksi pääkäyttäjä. Viimeistä pääkäyttäjää ei voi vaihtaa kirjanpitäjäksi.",
      },
      {
        title: "Käytöstä poisto",
        steps: [
          "Etsi käyttäjä listasta.",
          "Jos hänellä on asiakkaita, valitse kenelle ne siirtyvät.",
          "Valitse Poista käytöstä.",
        ],
        text: "Käytöstä poistettu ei pääse enää kirjautumaan. Hänen tietonsa ja tekemänsä muutokset säilyvät. Voit ottaa hänet takaisin käyttöön valitsemalla Ota käyttöön. Et voi poistaa itseäsi etkä viimeistä pääkäyttäjää.",
      },
    ],
    tips: ["Alimpana on kohta Viimeisimmät tapahtumat: kuka teki mitä ja milloin."],
    related: ["kayttajat", "aloitus"],
  },
  {
    slug: "kehitystoiveet",
    group: "Käyttäjät ja asetukset",
    icon: "bolt",
    title: "Kehitystoiveet",
    summary: "Kerro, mitä toivot ohjelmaan. Toiveet kootaan yhteen paikkaan toiminnoittain.",
    highlights: ["Toive suoraan sivun yläkulmasta", "Tärkeys: olisi mukava, tärkeä tai estää työn", "Näet toiveen tilan ja vastauksen"],
    appPath: "/kehitystoiveet",
    appLabel: "Kehitystoiveet",
    sections: [
      {
        title: "Toiveen jättäminen",
        steps: [
          "Klikkaa sivun oikeassa yläkulmassa Kehitystoive. Toiminto on silloin valmiiksi valittu.",
          "Voit myös avata Kehitystoiveet valikosta ja valita Uusi kehitystoive.",
          "Valitse toiminto, jota toive koskee.",
          "Kirjoita lyhyt otsikko.",
          "Kerro, mitä yrität tehdä ja mikä nyt on hankalaa.",
          "Valitse, kuinka tärkeä asia on: Olisi mukava, Tärkeä tai Estää työn.",
          "Valitse Lähetä toive.",
        ],
      },
      {
        title: "Toiveiden lista",
        bullets: [
          "Kehitystoiveet-sivulla näet toimiston toiveet.",
          "Valitse Avoimet tai Tehdyt ja hylätyt.",
          "Voit rajata listan toiminnon mukaan. Valitse toiminto ja Näytä.",
        ],
      },
      {
        title: "Toiveen tila",
        bullets: [
          "Uusi: toive on tullut perille.",
          "Suunnitteilla: toive on otettu mukaan suunnitelmaan.",
          "Työn alla: toivetta tehdään.",
          "Tehty: toive on ohjelmassa.",
          "Ei toteuteta: toive ei sovi ohjelmaan. Vastauksessa kerrotaan syy.",
        ],
      },
      {
        title: "Toiveiden käsittely",
        steps: [
          "Pääkäyttäjä avaa toiveen listalta.",
          "Hän valitsee toiveelle tilan.",
          "Hän voi kirjoittaa vastauksen toiveen jättäjälle.",
          "Hän valitsee Tallenna.",
        ],
      },
    ],
    tips: [
      "Kaikki toimiston käyttäjät näkevät toimiston toiveet.",
      "Älä kirjoita toiveeseen asiakkaiden henkilötietoja. Sivun osoite tallentuu toiveeseen, ja se riittää.",
    ],
  },
  {
    slug: "kayttajat",
    group: "Käyttäjät ja asetukset",
    icon: "shield",
    title: "Käyttäjät, roolit ja tietoturva",
    summary: "Jokainen toimisto näkee vain omat tietonsa, ja jokainen muutos jää lokiin.",
    highlights: ["Roolit: pääkäyttäjä ja kirjanpitäjä", "Toimistojen tiedot erillään tietokannassa", "Sisään vain kutsulla"],
    appPath: "/asetukset",
    appLabel: "Asetukset",
    sections: [
      {
        title: "Roolit",
        bullets: [
          "Pääkäyttäjä: kaikki asiakkaat, käyttäjät ja verovuoden sulkeminen.",
          "Kirjanpitäjä: omat asiakkaat, kirjaukset ja raportit.",
        ],
      },
      {
        title: "Kuka pääsee sisään",
        bullets: [
          "Vain ne, jotka pääkäyttäjä on lisännyt. Itse ei voi rekisteröityä.",
          "Kirjautuminen tehdään sillä sähköpostiosoitteella, johon kutsu tuli.",
          "Käytöstä poistettu ei pääse sisään, mutta hänen tekemänsä muutokset näkyvät lokissa.",
        ],
      },
      {
        title: "Tietoturva",
        bullets: [
          "Tietokanta itse rajaa jokaisen haun käyttäjän toimistoon. Rajaus ei ole pelkästään ohjelman varassa.",
          "Muutokset kirjataan lokiin samalla kertaa kuin itse muutos.",
          "Henkilötunnuksia ei tallenneta. Tunnus kysytään vain veroilmoituksen tiedostoa tehtäessä, ja se on vain ladatussa tiedostossa.",
          "Henkilötietoja ei kirjoiteta osoitteisiin, lokeihin eikä virheviesteihin.",
          "Tietokanta sijaitsee EU:ssa.",
          "Lisää tietoa on sivulla Tietosuoja.",
        ],
      },
    ],
    related: ["asetukset"],
  },
  {
    slug: "tulossa",
    group: "Käyttäjät ja asetukset",
    icon: "megaphone",
    title: "Tulossa olevat toiminnot",
    summary: "Toiminnot, joita suunnitellaan tai tehdään. Ne tulevat ohjelmaan, kun ne valmistuvat.",
    highlights: ["Arvonlisäveroilmoitus tiedostona", "Pankin tiliotteen sisäänluku", "Yhtymän veroilmoitus", "Vuokratulot samaan tiedostoon"],
    upcoming: true,
    sections: [
      {
        title: "Mitä on tulossa",
        bullets: [
          "Arvonlisäveroilmoitus tiedostona. Nyt luvut kirjoitetaan OmaVeroon käsin.",
          "Pankin tiliotteen sisäänluku kirjanpitoon.",
          "Pellon ja metsämaan vuokratulot (lomake 7L) samaan tiedostoon veroilmoituksen kanssa.",
          "Yhtymän veroilmoitus (lomake 2Y) ja osakkaiden osuudet.",
          "Metsänomistajan oma näkymä, jossa hän näkee omat tietonsa.",
          "Lomakkeen 2 tiedoston koe Ilmoitin.fi-palvelussa. Siihen asti tarkista tiedosto aina ennen lähettämistä.",
        ],
      },
      {
        title: "Toivoisitko jotain muuta",
        text: "Jätä kehitystoive. Toiveet auttavat päättämään, mitä tehdään seuraavaksi.",
      },
    ],
    related: ["kehitystoiveet"],
  },
  {
    slug: "siirtyminen",
    group: "Vanhoista ohjelmista siirtyminen",
    icon: "split",
    title: "Siirtyminen vanhoista ohjelmista",
    summary: "Tiedot tuodaan vanhasta Skogista ja Tilituki-ohjelmasta. Näin tunnistat tuodut tiedot ja tarkistat ne.",
    highlights: ["Tilitukista koko historia vuodesta 2002", "Vanhat vuodet tulevat suljettuina", "Investoinnit poistohistorioineen", "Tuotu-merkki investoinneissa"],
    sections: [
      {
        title: "Kuka siirron tekee",
        text: "Tietojen siirron tekee ohjelman ylläpitäjä yhdessä toimiston kanssa. Sinun ei tarvitse tuoda mitään itse. Siirron jälkeen tarkistat, että luvut ovat oikein.",
      },
      {
        title: "Mitä Tilitukista tuodaan",
        bullets: [
          "Asiakas. Hänet tunnistetaan Y-tunnuksesta, joten sama asiakas ei tule kahteen kertaan.",
          "Kaikki vuodet, joilta asiakkaalla on kirjanpitoa Tilitukissa, vanhimmillaan vuodesta 2002. Tyhjiä vuosia ei tuoda.",
          "Kirjaukset luokittain. Arvonlisäverokanta on sama kuin Tilitukissa, myös vanhat kannat, kuten 22 tai 24 prosenttia.",
          "Metsän koneet, tiet, ojat ja rakennukset omina investointeinaan koko historian ajalta, myös myydyt ja kokonaan poistetut.",
          "Maatalouden poistoryhmät, vuoden tiedot, tasausvaraukset ja kotieläinten jaksotukset.",
        ],
      },
      {
        title: "Tuodut ja suljetut vuodet",
        bullets: [
          "Vuodet 2024 asti tuodaan suljettuina. Niiden verotus on jo valmis, joten niitä ei voi muuttaa vahingossa.",
          "Vuosi 2025 jää auki, koska sen veroilmoitus tehdään Skogissa. Vuosi 2026 avataan valmiiksi.",
          "Näet vuodet asiakkaan Tiedot-välilehdellä taulukossa Verovuodet. Siirron sulkemassa vuodessa on sulkemispäivä mutta ei sulkijan nimeä.",
          "Verovuosi-valikossa suljetun vuoden perässä lukee (suljettu).",
          "Siirrossa suljetuista vuosista ei ole arkistossa raporttia. Voit silti avata raportin nykyisillä luvuilla.",
          "Vanhan vuoden raportti lasketaan nykyisillä säännöillä. Se ei ole verotuksen asiakirja, koska verotus tehtiin jo vanhalla ohjelmalla.",
          "Jos vanhaa vuotta pitää korjata, pääkäyttäjä voi avata sen. Avaus jää lokiin.",
        ],
      },
      {
        title: "Investoinnit siirron jälkeen",
        steps: [
          "Avaa asiakas ja valitse välilehti Investoinnit.",
          "Tuoduissa investoinneissa on merkki Tuotu.",
          "Menojäännös on viimeisen kirjatun vuoden lopussa. Vertaa sitä vanhan ohjelman poistolaskelmaan.",
          "Valitse Poistohistoria, niin näet jokaisen vuoden poiston.",
          "Maatalouden poistoryhmät ovat sivun lopussa omana taulukkonaan.",
        ],
        bullets: [
          "Kokonaan poistettu investointi ei näy verosuunnitelmassa.",
          "Jos muutat tuotua investointia, uusi siirto ei enää muuta sitä.",
        ],
      },
      {
        title: "Mitä tarkistat siirron jälkeen",
        steps: [
          "Valitse kirjanpidossa vuosi 2025. Vertaa korttien tuloja ja menoja vanhaan ohjelmaan.",
          "Avaa Lomake 2 ja vertaa maatalouden tulosta vanhan ohjelman lomakkeeseen 2.",
          "Tarkista Investoinnit-sivulta menojäännökset.",
          "Tarkista Lomake 2 -välilehdeltä purkamattomat tasausvaraukset ja kotieläinten jaksotukset.",
          "Jos löydät eron, kerro siitä kehitystoiveella. Älä kirjoita toiveeseen asiakkaan nimeä.",
        ],
      },
      {
        title: "Vanha Skog",
        text: "Vanhasta Skogista tuodaan asiakkaat, metsätilat, kirjaukset, investoinnit ja tositteet. Vanha Skog on käytössä, kunnes uusi otetaan käyttöön.",
      },
      {
        title: "Asiakas, joka ei ole vanhassa ohjelmassa",
        text: "Lisää asiakas itse. Aloita edellisen vuoden veroilmoituksesta. Lisää aiemmat investoinnit menojäännöksineen Investoinnit-sivulla. Lisää maatalouden varaukset ja jaksotukset Lomake 2 -välilehdellä. Katso ohjeet Investoinnit ja poistot sekä Lomake 2.",
      },
    ],
    related: ["investoinnit", "maatalous", "asiakkaat"],
  },
  {
    slug: "usein-kysyttya",
    group: "Usein kysyttyä",
    icon: "info",
    title: "Usein kysyttyä",
    summary: "Lyhyet vastaukset tavallisiin kysymyksiin.",
    highlights: ["Miksi en voi muuttaa kirjausta", "Mihin kirjaukset katosivat", "Miksi tiedostoa ei voi ladata"],
    sections: [
      {
        title: "En näe asiakasta listassa",
        text: "Kirjanpitäjä näkee vain asiakkaat, joiden vastuukirjanpitäjä hän on. Pyydä pääkäyttäjää vaihtamaan sinut vastuukirjanpitäjäksi. Asiakas voi olla myös arkistoitu: valitse Näytä arkistoidut.",
      },
      {
        title: "Verovuosi puuttuu valikosta",
        text: "Vuotta ei ole vielä avattu. Avaa se asiakkaan Tiedot-välilehdellä: kirjoita vuosi kohtaan Uusi vuosi ja valitse Avaa vuosi.",
      },
      {
        title: "Tiliöintiehdotus on väärä",
        text: "Ehdotus tulee asiakkaan aiemmista kirjauksista. Jos samanlainen selite on tiliöity eri tavoin, ehdotus voi olla väärä. Älä valitse sitä, vaan valitse luokka itse. Ehdotus ei koskaan tallennu itsestään. Kun tallennat oikean tiliöinnin, se painaa jatkossa eniten, koska uudet kirjaukset painavat enemmän kuin vanhat.",
      },
      {
        title: "En voi muuttaa kirjausta",
        text: "Vuosi on suljettu. Sivulla lukee silloin, että verovuosi on suljettu. Pääkäyttäjä voi avata vuoden asiakkaan Tiedot-välilehdellä.",
      },
      {
        title: "Kirjaukset katosivat taulukosta",
        text: "Tarkista ensin suodatin. Näytä kaikki palauttaa koko vuoden. Tarkista myös verovuosi ja välilehti. Metsän ja maatalouden kirjaukset ovat eri välilehdillä.",
      },
      {
        title: "Kirjasin rivin väärään kirjanpitoon",
        text: "Avaa kirjaus päivästä ja vaihda luokka. Rivi siirtyy toisen toiminnon kirjanpitoon.",
      },
      {
        title: "Ehdotusrivit eivät tallentuneet",
        text: "Ehdotus tallentuu vasta, kun tallennat taulukon. Rivi, jolta poistit ruksin kohdasta Hyväksy tallennettaessa, jää odottamaan. Jos ilmoitus kertoo, että rivejä odottaa toisessa kirjanpidossa, avaa se ja tallenna rivit siellä.",
      },
      {
        title: "Investointi ei näy verosuunnitelmassa",
        text: "Kokonaan poistettu investointi ei näy. Aiemmin hankittu investointi näkyy vasta menojäännöksen vuotta seuraavana vuonna. Maatalouden investoinnit ovat ryhmissä, ja ne näkyvät kohdassa Maatalouden poistot.",
      },
      {
        title: "Metsävähennystä ei voi valita",
        text: "Vähennys on vähintään 1 500 euroa. Jos tuloja on vähän tai pohja puuttuu, vähennystä ei voi tehdä. Tarkista metsätilan hankintahinta ja metsän osuus asiakkaan sivulla.",
      },
      {
        title: "Veroilmoituksen tiedostoa ei voi ladata",
        text: "Korjaa ensin punaiset virheet. Vahvista verosuunnitelma. Tiedoston voi tehdä vain vuosille, joiden tiedostokuvaus on Skogissa, nyt 2025 ja 2026.",
      },
      {
        title: "Miksi henkilötunnus kysytään joka kerta",
        text: "Skog ei tallenna henkilötunnuksia. Tunnus on vain ladatussa tiedostossa. Poista tiedosto koneeltasi, kun olet lähettänyt sen.",
      },
      {
        title: "Mitä Tuotu tarkoittaa",
        text: "Investointi on tuotu vanhasta ohjelmasta. Katso ohje Siirtyminen vanhoista ohjelmista.",
      },
      {
        title: "Kutsu ei tullut perille",
        text: "Tarkista roskaposti. Pääkäyttäjä voi valita Asetuksissa Lähetä kutsu uudelleen.",
      },
      {
        title: "Miten annan palautetta",
        text: "Valitse sivun yläkulmasta Kehitystoive. Kerro, mitä yritit tehdä. Älä kirjoita toiveeseen asiakkaiden henkilötietoja.",
      },
    ],
    related: ["aloitus", "kehitystoiveet"],
  },
];

/** Ohjeen osion ankkuri otsikosta: "Kun hinta muuttuu" → "kun-hinta-muuttuu". */
export function sectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[äå]/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function helpTopic(slug: string) {
  return HELP_TOPICS.find((t) => t.slug === slug) ?? null;
}
