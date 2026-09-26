import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { formatDateTime, formatNumber } from "@/lib/format";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";

export const metadata = { title: "Veroraportti ja arkisto" };

const KIND = { report: "Veroraportti", receipt: "Tosite", other: "Muu" } as const;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vuosi?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    const years = await listYears(tx, id);
    const requested = Number(sp.vuosi);
    const year = years.some((y) => y.year === requested) ? requested : defaultYear(years);
    const docs = year
      ? await tx.query<{ id: string; kind: keyof typeof KIND; file_name: string; size_bytes: number; created_at: string; description: string | null }>(
          `select d.id, d.kind, d.file_name, d.size_bytes, d.created_at, t.description
             from sk_documents d left join sk_transactions t on t.id = d.transaction_id
            where d.client_id = $1 and d.tax_year = $2 order by d.kind = 'report' desc, d.created_at desc`,
          [id, year],
        )
      : [];
    return { client, years, year, docs };
  });
  if (!data) notFound();
  const { client: c, years, year, docs } = data;
  const closed = years.find((y) => y.year === year)?.status === "closed";
  const reports = docs.filter((d) => d.kind === "report");

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Veroraportti ja arkisto" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="raportti" year={year} />
      {year === null ? (
        <EmptyState title="Ei verovuosia">Avaa verovuosi asiakkaan tiedoissa.</EmptyState>
      ) : (
        <>
          <YearNav years={years} year={year} basePath={`/asiakkaat/${id}/raportti`} />
          <Panel className="mb-8 max-w-3xl">
            <h2 className="text-lg font-bold">Veroraportti {year}</h2>
            <p className="mt-1 text-sm text-ink/70">
              {closed
                ? "Vuosi on suljettu. Virallinen raportti tallentui arkistoon sulkemishetkellä. Alla olevasta linkistä saat raportin nykyisillä luvuilla."
                : "Vuosi on avoin, joten raportti on luonnos. Kun pääkäyttäjä sulkee vuoden, lopullinen raportti tallentuu arkistoon."}
            </p>
            <a
              href={`/asiakkaat/${id}/veroraportti/${year}`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink/85"
            >
              {closed ? "Avaa raportti" : "Avaa luonnos"}
            </a>
          </Panel>
          {closed && reports.length === 0 ? (
            <div className="mb-5 max-w-3xl">
              <Notice tone="warn" title="Arkistossa ei ole raporttia tälle vuodelle.">Vuosi on suljettu ennen arkistointia tai tuotu vanhasta ohjelmasta.</Notice>
            </div>
          ) : null}

          <SectionTitle>Arkisto {year}</SectionTitle>
          {docs.length === 0 ? (
            <EmptyState title="Ei tiedostoja">Tositteet lisätään kirjanpidossa kirjauksen sivulla.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Tiedosto</Th>
                  <Th>Laji</Th>
                  <Th>Kirjaus</Th>
                  <Th numeric>Koko</Th>
                  <Th>Tallennettu</Th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <a href={`/asiakkaat/${id}/tositteet/${d.id}`} target="_blank" rel="noreferrer" className="font-semibold text-sky hover:underline">
                        {d.file_name}
                      </a>
                    </Td>
                    <Td>{KIND[d.kind]}</Td>
                    <Td>{d.description || "–"}</Td>
                    <Td numeric>{formatNumber(Math.ceil(d.size_bytes / 1024), "kt")}</Td>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(d.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </>
  );
}
