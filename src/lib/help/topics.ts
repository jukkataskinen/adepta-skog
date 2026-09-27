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

export const HELP_GROUPS = ["Aloitus", "Asiakkaat ja metsätilat", "Kirjanpito", "Verotus ja raportit", "Hallinta ja tietoturva"];

export const HELP_TOPICS: HelpTopic[] = [
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
        ],
      },
    ],
  },
  {
    slug: "asiakkaat",
    group: "Asiakkaat ja metsätilat",
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
          "Kirjoita nimi ja muut tiedot.",
          "Rastita Arvonlisäverorekisterissä, jos asiakas on rekisterissä. Kirjoita myös ALV-numero, jos se on tiedossa.",
          "Tallenna. Kuluva verovuosi avautuu asiakkaalle heti.",
        ],
      },
      {
        title: "Vastuukirjanpitäjän vaihto",
        text: "Pääkäyttäjä vaihtaa vastuukirjanpitäjän asiakkaan sivulla. Vanha kirjanpitäjä ei sen jälkeen näe asiakasta.",
      },
      {
        title: "Verovuodet",
        steps: [
          "Asiakkaan sivun alaosassa näet asiakkaan verovuodet.",
          "Avaa uusi vuosi kirjoittamalla vuosi ja valitsemalla Avaa vuosi.",
          "Kun vuosi on valmis, pääkäyttäjä valitsee Sulje vuosi.",
          "Suljetun vuoden kirjauksia ei voi muuttaa. Pääkäyttäjä voi avata vuoden uudelleen, ja avaus jää lokiin.",
        ],
      },
      {
        title: "Arkistointi",
        text: "Asiakasta ei poisteta, koska kirjanpito on säilytettävä. Pääkäyttäjä voi arkistoida asiakkaan, jolloin se piiloutuu listasta. Arkistoidut näet listan linkistä.",
      },
    ],
    related: ["metsatilat"],
  },
  {
    slug: "metsatilat",
    group: "Asiakkaat ja metsätilat",
    icon: "map",
    title: "Metsätilat",
    summary: "Asiakkaan metsätilat ja niiden hankintatiedot. Niistä lasketaan metsävähennyksen pohja.",
    highlights: ["Kiinteistötunnus ja pinta-ala", "Hankintahinta ja -päivä", "Metsävähennyksen pohja ja jäljellä oleva määrä"],
    sections: [
      {
        title: "Uusi metsätila",
        steps: [
          "Avaa asiakas ja valitse Lisää metsätila.",
          "Kirjoita tilan nimi ja kiinteistötunnus.",
          "Kirjoita hankintahinta ja metsän osuus hinnasta prosentteina. Metsä tarkoittaa metsämaata ja puustoa yhdessä. Rakennukset, pelto, tiet ja ojat eivät kuulu siihen.",
          "Metsämaan hehtaarit ovat vain tiedoksi. Ne eivät muuta laskelmia.",
          "Jos vähennystä on käytetty jo ennen Skogia, kirjoita se omaan kenttäänsä.",
          "Tallenna.",
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
    highlights: ["Koko vuosi taulukossa, näppäimistöllä", "Summa kuten kuitissa, arvonlisävero lasketaan", "Rivit Excelistä", "Tosite jokaiseen kirjaukseen"],
    sections: [
      {
        title: "Taulukkosyöttö",
        text: "Kirjanpito aukeaa taulukkona. Siinä näkyvät kaikki valitun vuoden kirjaukset, ja voit muuttaa niitä suoraan. Uudet rivit tulevat loppuun.",
        steps: [
          "Avaa asiakas, valitse välilehti Kirjanpito ja verovuosi.",
          "Uusi rivi: paina taulukon lopussa Lisää rivi tai Enter viimeisen rivin lopussa. Uusi rivi saa saman päivän kuin edellinen.",
          "Kirjoita päivä. Lyhyt muoto riittää, esimerkiksi 5.3., niin vuosi tulee valitusta verovuodesta.",
          "Kirjoita selite.",
          "Valitse luokka. Valikko aukeaa itse. Voit kirjoittaa luokan numeron, esimerkiksi 1 Pystykauppa tai 10 Käyttöomaisuuden hankinta.",
          "Kirjoita summa niin kuin se on kuitissa, eli arvonlisäveron kanssa.",
          "Alv % tulee luokasta. Voit vaihtaa sen. Veroton summa näkyy sen vieressä.",
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
        title: "Näppäimet taulukossa",
        bullets: [
          "Enter tai Tab: seuraava kenttä. Rivin lopussa seuraava rivi tai uusi rivi.",
          "Shift + Tab tai Shift + Enter: edellinen kenttä.",
          "Nuoli ylös tai alas: sama kenttä edellisellä tai seuraavalla rivillä. Selitteessä nuolet liikkuvat tekstissä.",
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
        title: "Rivit Excelistä",
        steps: [
          "Järjestä Excelin sarakkeet näin: päivä, selite, luokka, summa arvonlisäveron kanssa, alv %, ennakonpidätys, metsätila ja viite. Metsätila jätetään pois, jos asiakkaalla ei ole tiloja.",
          "Valitse rivit Excelissä ja kopioi ne.",
          "Napsauta uuden rivin päiväkenttää ja liitä (Ctrl + V).",
          "Tarkista rivit ja tallenna.",
        ],
        bullets: [
          "Päivä voi olla muodossa 5.3.2025 tai 2025-03-05. Summissa saa olla pilkku ja välilyönti, esimerkiksi 1 234,50.",
          "Luokaksi käy luokan nimi, esimerkiksi Pystykauppa, tai sen numero. Metsätilaksi tilan nimi.",
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
          "Jätä Alv % tyhjäksi, niin ohjelma käyttää oletusta.",
          "Valitse Lisää kirjaus.",
        ],
      },
      {
        title: "Muokkaus ja poisto",
        text: "Avaa kirjaus päivästä. Voit muuttaa tietoja, lisätä tositteen tai poistaa kirjauksen. Muutokset jäävät lokiin.",
      },
      {
        title: "Vuoden tositteet",
        steps: [
          "Avaa asiakkaan kirjanpito ja valitse vuosi.",
          "Valitse Lisää tositteet.",
          "Vedä tiedostot laatikkoon tai valitse ne. Voit lisätä useita kerralla. PDF, JPG tai PNG, enintään 25 Mt tiedostoa kohden.",
          "Tositteet tallentuvat heti ja näkyvät listassa. Nimestä tositteen voi avata.",
          "Kun vuosi suljetaan, kaikki vuoden tositteet liitetään lopullisen veroraportin loppuun.",
        ],
        bullets: [
          "Myös yksittäisten kirjausten tositteet tulevat raportin liitteiksi.",
          "Veroraportti ja arkisto -välilehdeltä voit avata luonnoksen tositteineen jo ennen sulkemista.",
          "Suljetun vuoden tositteita ei voi poistaa eikä lisätä.",
        ],
      },
      {
        title: "Tositteet",
        steps: [
          "Avaa kirjaus.",
          "Valitse tiedosto kohdasta Lisää tosite. PDF tai kuva, enintään 4 Mt.",
          "Valitse Tallenna tosite.",
          "Tosite aukeaa, kun klikkaat sen nimeä.",
          "Väärän tositteen voit poistaa, jos vuosi on auki. Silloin myös tiedosto poistuu.",
        ],
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
    related: ["asiakkaat", "investoinnit"],
  },
  {
    slug: "investoinnit",
    group: "Kirjanpito",
    icon: "hammer",
    title: "Investoinnit ja poistot",
    summary: "Koneet, tiet ja ojat poistetaan vuosittain. Ohjelma laskee poistot ja jäljellä olevan arvon.",
    highlights: ["Kone 25 %, tie tai oja 15 %, rakennus 10 %", "Koneen myynti: luovutusvoitto tai -tappio", "Poistot valitaan verosuunnitelmassa"],
    sections: [
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
    ],
    related: ["kirjanpito", "verosuunnitelma"],
  },
  {
    slug: "alv",
    group: "Verotus ja raportit",
    icon: "stamp",
    title: "Arvonlisävero",
    summary: "Arvonlisävero lasketaan kirjauksista neljänneksittäin ja koko vuodelta.",
    highlights: ["Myynnin ja ostojen vero", "Maksettava tai palautettava", "Myynnit verokannoittain"],
    sections: [
      {
        title: "Näin luet yhteenvedon",
        bullets: [
          "Myynnin vero lasketaan tuloista, esimerkiksi puukaupasta.",
          "Ostojen vero lasketaan menoista ja investoinneista.",
          "Maksettava on myynnin vero miinus ostojen vero. Jos luku on miinuksella, veroa palautetaan.",
          "Neljännekset auttavat, jos asiakas ilmoittaa useammin kuin kerran vuodessa.",
        ],
      },
    ],
    tips: ["Jos asiakas ei ole arvonlisäverorekisterissä, sivulla näkyy muistutus."],
    related: ["kirjanpito"],
  },
  {
    slug: "verosuunnitelma",
    group: "Verotus ja raportit",
    icon: "coins",
    title: "Verosuunnitelma",
    summary: "Arvio vuoden verotettavasta tulosta. Valitse, paljonko metsävähennystä ja poistoja käytetään.",
    highlights: ["Verotettava pääomatulo ja vero", "Metsävähennyksen rajat valmiina", "Vahvistus tallentaa poistot ja vähennyksen"],
    sections: [
      {
        title: "Suunnitelman teko",
        steps: [
          "Avaa asiakas ja valitse välilehti Verosuunnitelma.",
          "Valitse vuosi.",
          "Sivun yläosassa näet verosäästön ja arvioidun veron. Niiden alla ovat tulot, menot ja tulos ennen vähennyksiä.",
          "Valitse jokaisen investoinnin poisto liukusäätimellä tai kirjoita summa. Aseta kaikki enimmäismäärään valitsee suurimmat poistot kerralla.",
          "Valitse metsävähennys liukusäätimellä, kirjoita summa tai valitse Käytä enimmäismäärä.",
          "Laskelma oikealla päivittyy heti. Näet myös veroasteen ja veron ilman vähennyksiä.",
          "Katso sivun lopusta Huomiot ja suositukset. Siellä kerrotaan esimerkiksi, paljonko käyttämätön metsävähennys säästäisi.",
          "Valitse Vahvista suunnitelma. Poistot ja metsävähennys tallentuvat.",
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
        title: "Metsätilan myynti",
        text: "Jos tila tai sen osa on myyty tänä vuonna, suunnitelmassa on laskelma jokaisesta kaupasta: kauppahinta, hankintameno tai olettama, tie- ja ojamenot, myyntikulut, metsävähennyksen lisäys ja luovutusvoitto. Voitto tai tappio ilmoitetaan lomakkeella 9. Luovutukset kirjataan metsätilan sivulla.",
      },
      {
        title: "Vuoden sulkeminen",
        text: "Pääkäyttäjä voi valita Vahvista ja sulje vuosi. Suljetun vuoden suunnitelmaa ei voi muuttaa.",
      },
    ],
    tips: [
      "Pääomatulon vero on 30 prosenttia 30 000 euroon asti ja 34 prosenttia sen yli.",
      "Yrittäjävähennys: 5 prosenttia metsätalouden tuloksesta metsävähennyksen jälkeen jää verottamatta. Laskelma tekee sen itse.",
      "Vero on arvio. Asiakkaan muut pääomatulot ja aiempien vuosien tappiot eivät ole mukana.",
    ],
    related: ["investoinnit", "metsatilat"],
  },
  {
    slug: "veroraportti",
    group: "Verotus ja raportit",
    icon: "folder",
    title: "Veroraportti ja arkisto",
    summary: "Veroilmoitusta tukeva raportti PDF:nä. Raportit ja tositteet säilyvät arkistossa verovuosittain.",
    highlights: ["Kansilehti ja sisällysluettelo", "LUONNOS-merkintä avoimelle vuodelle", "Raportti arkistoon, kun vuosi suljetaan"],
    sections: [
      {
        title: "Raportin avaaminen",
        steps: [
          "Avaa asiakas ja valitse välilehti Veroraportti ja arkisto.",
          "Valitse vuosi.",
          "Valitse Avaa luonnos tai Avaa raportti. Raportti aukeaa uuteen välilehteen, josta voit tulostaa tai tallentaa sen.",
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
          "Kaikki vuoden kirjaukset.",
        ],
      },
      {
        title: "Arkisto",
        bullets: [
          "Kun pääkäyttäjä sulkee vuoden, lopullinen raportti tallentuu arkistoon.",
          "Jos vuosi avataan ja suljetaan uudelleen, arkistoon tulee uusi versio. Vanha säilyy.",
          "Arkistossa näkyvät myös vuoden tositteet.",
        ],
      },
    ],
    tips: ["Avoimen vuoden raportissa on LUONNOS-merkintä jokaisella sivulla."],
    related: ["verosuunnitelma", "kirjanpito"],
  },
  {
    slug: "asetukset",
    group: "Hallinta ja tietoturva",
    icon: "gear",
    title: "Asetukset",
    summary: "Asetuksissa päätetään toimiston tiedot ja käyttäjät. Asetukset näkee vain pääkäyttäjä.",
    highlights: ["Toimiston yhteystiedot", "Käyttäjät ja roolit", "Viimeisimmät muutokset"],
    appPath: "/asetukset",
    appLabel: "Asetukset",
    sections: [
      {
        title: "Yhteystiedot",
        text: "Sähköposti, puhelin ja postiosoite tulevat veroraportin kansilehdelle.",
      },
      {
        title: "Käyttäjän lisääminen",
        steps: [
          "Kirjoita uuden käyttäjän sähköposti ja nimi.",
          "Valitse rooli: pääkäyttäjä tai kirjanpitäjä.",
          "Paina Lisää. Käyttäjä saa sähköpostiin kutsun.",
          "Jos hänellä ei ole vielä tunnusta, hän asettaa kutsun linkistä salasanan.",
          "Hän kirjautuu samalla sähköpostiosoitteella, jolla lisäsit hänet.",
        ],
      },
      {
        title: "Kutsu uudelleen",
        steps: [
          "Etsi käyttäjä listasta. Hänen kohdallaan lukee Ei vielä kirjautunut.",
          "Paina Lähetä kutsu uudelleen.",
        ],
      },
      {
        title: "Roolin vaihto",
        steps: ["Valitse käyttäjän riviltä uusi rooli.", "Paina Tallenna."],
        text: "Toimistolla on aina oltava ainakin yksi pääkäyttäjä. Viimeistä pääkäyttäjää ei voi vaihtaa kirjanpitäjäksi.",
      },
      {
        title: "Käytöstä poisto",
        steps: [
          "Etsi käyttäjä listasta.",
          "Jos hänellä on asiakkaita, valitse kenelle ne siirtyvät.",
          "Paina Poista käytöstä.",
        ],
        text: "Käytöstä poistettu ei pääse enää kirjautumaan. Hänen tietonsa ja tekemänsä muutokset säilyvät. Voit ottaa hänet takaisin käyttöön painamalla Ota käyttöön. Et voi poistaa itseäsi etkä viimeistä pääkäyttäjää.",
      },
    ],
    tips: ["Alimpana näkyvät viimeisimmät muutokset: kuka teki mitä ja milloin."],
    related: ["kayttajat"],
  },
  {
    slug: "kehitystoiveet",
    group: "Hallinta ja tietoturva",
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
          "Valitse, kuinka tärkeä asia on.",
          "Lähetä.",
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
          "Tallenna.",
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
    group: "Hallinta ja tietoturva",
    icon: "shield",
    title: "Käyttäjät, roolit ja tietoturva",
    summary: "Jokainen toimisto näkee vain omat tietonsa, ja jokainen muutos jää lokiin.",
    highlights: ["Roolit: pääkäyttäjä ja kirjanpitäjä", "Toimistojen tiedot erillään tietokannassa", "Kirjautuminen kaksivaiheisella tunnistuksella"],
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
          "Henkilötunnuksia ei käsitellä. Henkilötietoja ei kirjoiteta osoitteisiin, lokeihin eikä virheviesteihin.",
          "Tietokanta sijaitsee EU:ssa.",
        ],
      },
    ],
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
