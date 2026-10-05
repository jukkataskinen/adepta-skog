import Link from "next/link";
import { NavIcon } from "@/components/NavIcon";
import { HELP_GROUPS, HELP_TOPICS, sectionId } from "@/lib/help/topics";

export const metadata = { title: "Ohjekirja" };

const PRINCIPLES = [
  { title: "Vuosi kerrallaan", text: "Kirjaukset, poistot ja metsävähennys verovuosittain. Suljettu vuosi pysyy sellaisenaan." },
  { title: "Laskelmat valmiina", text: "Arvonlisävero, poistot, metsävähennys ja lomake 2 lasketaan kirjauksista. Sinä tarkistat ja päätät." },
  { title: "Tiedot turvassa", text: "Jokainen toimisto näkee vain omat asiakkaansa. Rajaus on tietokannassa, ei pelkästään ohjelmassa." },
]

/**
 * Ohjekirjan etusivu: ensin sisällysluettelo luvuittain (HELP_GROUPS), jotta
 * aloittelija löytää oikean ohjeen, sitten luvut kortteina. Sama sivu käy
 * myös toimintojen esittelyyn.
 */
export default function HelpHome() {
  return (
    <>
      <section className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky">Metsä- ja maatalouden kirjanpito ja verosuunnittelu</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Skog</h1>
        <p className="mt-4 text-lg text-ink/75">
          Kirjanpitotoimiston työkalu metsänomistajien ja maatilojen verotukseen: kirjaukset, tositteet, arvonlisävero, poistot, metsävähennys,
          lomake 2, verosuunnitelma ja veroilmoitus samassa palvelussa.
        </p>
        <p className="mt-4 text-ink/75">
          Uusi käyttäjä:{" "}
          <Link href="/ohjeet/aloitus" className="font-semibold text-sky hover:underline">
            aloita tästä
          </Link>
          . Jos etsit vastausta tiettyyn kysymykseen, katso{" "}
          <Link href="/ohjeet/usein-kysyttya" className="font-semibold text-sky hover:underline">
            Usein kysyttyä
          </Link>
          .
        </p>
      </section>

      <nav aria-labelledby="sisallys" className="mt-8 rounded-[var(--radius-panel)] border border-line bg-paper p-5 sm:p-6">
        <h2 id="sisallys" className="text-xl">
          Sisällys
        </h2>
        <ol className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {HELP_GROUPS.map((group, i) => {
            const topics = HELP_TOPICS.filter((t) => t.group === group);
            if (!topics.length) return null;
            return (
              <li key={group}>
                <a href={`#${sectionId(group)}`} className="font-bold hover:text-sky">
                  {i + 1}. {group}
                </a>
                <ul className="mt-1 grid gap-1 text-sm">
                  {topics.map((t) => (
                    <li key={t.slug}>
                      <Link href={`/ohjeet/${t.slug}`} className="text-sky hover:underline">
                        {t.title}
                      </Link>
                      {t.upcoming ? <span className="ml-2 text-xs font-semibold text-amber">Tulossa</span> : null}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <div key={p.title} className="rounded-[var(--radius-panel)] border border-line bg-paper p-5">
            <p className="font-bold">{p.title}</p>
            <p className="mt-1 text-sm text-ink/70">{p.text}</p>
          </div>
        ))}
      </section>

      {HELP_GROUPS.map((group, i) => {
        const topics = HELP_TOPICS.filter((t) => t.group === group);
        if (!topics.length) return null;
        return (
          <section key={group} id={sectionId(group)} className="mt-12 scroll-mt-6">
            <h2 className="text-xl">
              {i + 1}. {group}
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {topics.map((t) => (
                <Link
                  key={t.slug}
                  href={`/ohjeet/${t.slug}`}
                  className="group flex flex-col rounded-[var(--radius-panel)] border border-line bg-paper p-5 transition hover:border-ink/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-sky-soft text-sky">
                      <NavIcon name={t.icon} size={22} />
                    </span>
                    {t.upcoming ? <span className="rounded-full border border-amber/25 bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber">Tulossa</span> : null}
                  </div>
                  <p className="mt-4 text-lg font-bold">{t.title}</p>
                  <p className="mt-1 text-sm text-ink/70">{t.summary}</p>
                  <ul className="mt-4 grid gap-1.5 text-sm">
                    {t.highlights.map((h) => (
                      <li key={h} className="flex gap-2">
                        <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-moss" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-auto pt-5 text-sm font-semibold text-sky group-hover:underline">Lue ohje →</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
