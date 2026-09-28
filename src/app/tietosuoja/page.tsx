import Link from "next/link";
import { Notice } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { SUBPROCESSORS, SUBPROCESSORS_UPDATED } from "@/lib/privacy/subprocessors";

export const metadata = { title: "Tietosuoja" };

/**
 * Julkinen tietosuojasivu: lyhyt seloste palvelun käyttäjille ja
 * alikäsittelijät. Pidempi teksti ja käsittelysopimus ovat luonnoksina
 * kansiossa docs/tietosuoja, ja sivu päivitetään, kun Jukka on hyväksynyt ne.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xl">{title}</h2>
      <div className="mt-3 grid gap-3 text-ink/80">{children}</div>
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-moss" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky">Skog</p>
      <h1 className="mt-2 text-3xl sm:text-4xl">Tietosuoja</h1>
      <p className="mt-4 text-lg text-ink/75">
        Tällä sivulla kerrotaan, miten Skog käsittelee henkilötietoja. Skog on Adepta Oy:n palvelu tilitoimistoille metsätalouden
        kirjanpitoon ja verotukseen.
      </p>

      <div className="mt-6">
        <Notice tone="warn" title="Luonnos">
          Teksti on luonnos, ja se tarkistetaan ennen palvelun käyttöönottoa.
        </Notice>
      </div>

      <Section title="Kuka vastaa tiedoista">
        <p>
          Metsänomistajien tiedoista vastaa tilitoimisto, joka hoitaa heidän kirjanpitonsa. Adepta Oy käsittelee niitä vain tilitoimiston
          lukuun, ja siitä on tehty käsittelysopimus. Jos olet metsänomistaja, kysy tiedoistasi tilitoimistoltasi.
        </p>
        <p>
          Palvelun käyttäjien eli tilitoimistojen henkilökunnan kirjautumistiedoista vastaa Adepta Oy (Y-tunnus 2237131-2, Joutsa).
        </p>
      </Section>

      <Section title="Mitä tietoja käyttäjistä käsitellään">
        <Bullets
          items={[
            "Nimi, sähköposti, tilitoimisto ja rooli. Niillä luodaan tunnus ja annetaan oikeudet.",
            "Kirjautumisen tiedot. Niillä suojataan palvelua.",
            "Kehitystoiveet, jotka jätät palvelussa.",
            "Muutosloki: kuka muutti mitä ja milloin. Loki kuuluu tilitoimiston kirjanpitoon.",
          ]}
        />
        <p>Tietoja ei käytetä markkinointiin. Palvelussa ei ole mainos- eikä seurantaevästeitä, vain kirjautumisen evästeet.</p>
      </Section>

      <Section title="Henkilötunnus">
        <p>
          Skog ei tallenna henkilötunnuksia. Kun teet metsätalouden veroilmoituksen tiedoston, ohjelma voi kysyä henkilötunnuksen. Se
          kirjoitetaan vain tiedostoon, jonka lataat koneellesi. Skog ei lähetä tiedostoa Verohallinnolle. Sinä lataat sen itse
          Ilmoitin.fi-palveluun.
        </p>
      </Section>

      <Section title="Tositteen tunnistus tekoälyllä">
        <p>
          Voit pyytää ohjelmaa lukemaan tositteen. Silloin tosite lähetetään Anthropicin tekoälypalveluun Yhdysvaltoihin. Palvelu ehdottaa
          kirjauksia, ja sinä tarkistat ne ennen tallennusta.
        </p>
        <Bullets
          items={[
            "Palveluun lähtee vain tositetiedosto. Asiakkaan nimeä tai muita tietoja ohjelmasta ei lähetetä.",
            "Anthropic ei käytä tositetta tekoälyn kouluttamiseen.",
            "Anthropic poistaa tositteen 30 päivän kuluessa.",
            "Voit aina kirjata tositteen käsin. Silloin se ei lähde palvelun ulkopuolelle.",
          ]}
        />
      </Section>

      <Section title="Missä tiedot ovat">
        <p>
          Tietokanta, tositteet ja raportit ovat EU:ssa, Irlannissa. Kirjautuminen ja tositteen tunnistus käsitellään Yhdysvalloissa. Siirrot
          perustuvat EU:n vakiosopimuslausekkeisiin.
        </p>
      </Section>

      <Section title="Alikäsittelijät">
        <p>Adepta Oy käyttää näitä palveluja Skogin tuottamiseen.</p>
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-paper">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line text-ink/60">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Palvelu</th>
                <th className="px-4 py-2.5 font-semibold">Mihin</th>
                <th className="px-4 py-2.5 font-semibold">Tiedot</th>
                <th className="px-4 py-2.5 font-semibold">Sijainti</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {SUBPROCESSORS.map((s) => (
                <tr key={s.name}>
                  <td className="px-4 py-2.5 font-semibold">{s.name}</td>
                  <td className="px-4 py-2.5">
                    {s.purpose}
                    {s.notInUse ? <span className="block text-ink/55">Ei vielä käytössä</span> : null}
                  </td>
                  <td className="px-4 py-2.5">{s.data}</td>
                  <td className="px-4 py-2.5">{s.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-ink/60">Päivitetty {formatDate(SUBPROCESSORS_UPDATED)}.</p>
      </Section>

      <Section title="Tietoturva">
        <Bullets
          items={[
            "Jokainen tilitoimisto näkee vain omat tietonsa, ja kirjanpitäjä vain omat asiakkaansa. Rajaus on tietokannassa.",
            "Tiedot ovat salattuina liikenteessä ja tallennettuina.",
            "Ohjelmaan ei voi rekisteröityä itse. Käyttäjä lisätään kutsulla.",
            "Suljettua verovuotta ei voi muuttaa ilman avausta.",
          ]}
        />
      </Section>

      <Section title="Oikeutesi">
        <p>
          Voit pyytää nähdä tietosi, korjata ne tai poistaa ne, kun et enää käytä palvelua. Tilitoimistosi pääkäyttäjä voi myös korjata
          nimesi ja poistaa sinut käytöstä. Jos katsot, että tietojasi käsitellään väärin, voit tehdä valituksen tietosuojavaltuutetulle
          (tietosuoja.fi).
        </p>
      </Section>

      <p className="mt-12 text-sm text-ink/60">
        <Link href="/ohjeet" className="underline hover:text-ink">
          Takaisin ohjeisiin
        </Link>
      </p>
    </article>
  );
}
