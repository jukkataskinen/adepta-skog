import Link from "next/link";
import { NavIcon } from "@/components/NavIcon";
import { HELP_GROUPS, HELP_TOPICS } from "@/lib/help/topics";

export const metadata = { title: "Toiminnot ja ohjeet" };

const PRINCIPLES = [
  { title: "Vuosi kerrallaan", text: "Kirjaukset, poistot ja metsävähennys verovuosittain. Suljettu vuosi pysyy sellaisenaan." },
  { title: "Laskelmat valmiina", text: "Arvonlisävero, poistot ja metsävähennys lasketaan kirjauksista. Sinä tarkistat ja päätät." },
  { title: "Tiedot turvassa", text: "Jokainen toimisto näkee vain omat asiakkaansa. Rajaus on tietokannassa, ei pelkästään ohjelmassa." },
]

export default function HelpHome() {
  return (
    <>
      <section className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky">Metsätalouden kirjanpito ja verosuunnittelu</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Skog</h1>
        <p className="mt-4 text-lg text-ink/75">
          Kirjanpitotoimiston työkalu metsänomistajien verotukseen: kirjaukset, arvonlisävero, poistot, metsävähennys, verosuunnitelma ja
          veroraportti samassa palvelussa.
        </p>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {PRINCIPLES.map((p) => (
          <div key={p.title} className="rounded-[var(--radius-panel)] border border-line bg-paper p-5">
            <p className="font-bold">{p.title}</p>
            <p className="mt-1 text-sm text-ink/70">{p.text}</p>
          </div>
        ))}
      </section>

      {HELP_GROUPS.map((group) => {
        const topics = HELP_TOPICS.filter((t) => t.group === group);
        if (!topics.length) return null;
        return (
          <section key={group} className="mt-12">
            <h2 className="text-xl">{group}</h2>
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
