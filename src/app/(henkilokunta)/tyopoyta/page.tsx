import Link from "next/link";
import { PageHeader, Panel, SectionTitle, Stat } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { HELP_TOPICS } from "@/lib/help/topics";

export const metadata = { title: "Työpöytä" };

export default async function Dashboard() {
  const ctx = await requireStaff();
  const orgId = ctx.org.organizationId;
  const members = await ctx.run(
    async (tx) => (await tx.query<{ n: number }>("select count(*)::int as n from sk_org_members where organization_id = $1 and deactivated_at is null", [orgId]))[0].n,
  );
  // Tulossa olevat toiminnot näkyvät, jotta käyttäjä tietää, mitä on tekeillä (PLAN.md).
  const upcoming = HELP_TOPICS.filter((t) => t.upcoming);

  return (
    <>
      <PageHeader title={ctx.org.organizationName} subtitle="Metsätalouden kirjanpito ja verosuunnittelu" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Käyttäjiä" value={members} />
      </div>
      <section className="mt-10">
        <SectionTitle>Tulossa</SectionTitle>
        <Panel>
          <ul className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((t) => (
              <li key={t.slug}>
                <Link href={`/ohjeet/${t.slug}`} className="font-semibold text-sky hover:underline">
                  {t.title}
                </Link>
                <p className="text-sm text-ink/70">{t.summary}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </>
  );
}
