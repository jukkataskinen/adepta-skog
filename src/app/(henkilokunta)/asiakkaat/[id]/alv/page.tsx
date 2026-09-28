import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, SectionTitle, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listTransactions, listYears } from "@/lib/ledger/queries";
import { vatSummary } from "@/lib/tax/vat";
import { formatEur } from "@/lib/format";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";

export const metadata = { title: "Arvonlisävero" };

export default async function VatPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ vuosi?: string }> }) {
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
    return { client, years, year, rows: year ? await listTransactions(tx, id, year) : [] };
  });
  if (!data) notFound();
  const { client: c, years, year } = data;
  // Ostojen verosta vain metsätalouden osuus, myynnin vero kokonaan (src/lib/tax/share.ts).
  const s = vatSummary(
    data.rows.map((r) => ({
      bookedOn: r.booked_on, kind: r.kind, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), vatRate: Number(r.vat_rate),
      businessSharePct: Number(r.business_share_pct),
    })),
  );

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Arvonlisävero" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="alv" year={year} />
      {year === null ? (
        <EmptyState title="Ei verovuosia">Avaa verovuosi asiakkaan tiedoissa.</EmptyState>
      ) : (
        <>
          <YearNav years={years} year={year} basePath={`/asiakkaat/${id}/alv`} />
          {!c.vat_registered ? (
            <div className="mb-5">
              <Notice tone="info" title="Asiakas ei ole arvonlisäverorekisterissä.">
                Yhteenveto on silti laskettu kirjauksista. Tarkista, onko rekisteröinti oikein asiakkaan tiedoissa.
              </Notice>
            </div>
          ) : null}
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat label="Myynnin vero" value={formatEur(s.year.output)} />
            <Stat label="Ostojen vero" value={formatEur(s.year.input)} />
            <Stat label={s.year.payable < 0 ? "Palautettavaa" : "Maksettavaa"} value={formatEur(Math.abs(s.year.payable))} tone={s.year.payable < 0 ? "ok" : undefined} />
          </div>
          {s.year.nonDeductible ? (
            <p className="-mt-3 mb-6 text-sm text-ink/70">
              Ostojen verosta {formatEur(s.year.nonDeductible)} kuuluu muulle toiminnalle, koska kirjauksesta vain osa on metsätaloutta. Sitä ei vähennetä tässä.
            </p>
          ) : null}

          <SectionTitle>Neljännekset</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Jakso</Th>
                <Th numeric>Myynnin vero</Th>
                <Th numeric>Ostojen vero</Th>
                <Th numeric>Maksettava</Th>
              </tr>
            </thead>
            <tbody>
              {[...s.quarters, s.year].map((q) => (
                <tr key={q.label} className={q === s.year ? "border-t-2 border-line font-semibold" : undefined}>
                  <Td>{q.label}</Td>
                  <Td numeric>{formatEur(q.output)}</Td>
                  <Td numeric>{formatEur(q.input)}</Td>
                  <Td numeric>{formatEur(q.payable)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <section className="mt-8">
            <SectionTitle>Myynnit verokannoittain</SectionTitle>
            {s.year.byRate.length === 0 ? (
              <p className="text-sm text-ink/65">Ei myyntejä.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Verokanta</Th>
                    <Th numeric>Myynti ilman alv</Th>
                    <Th numeric>Vero</Th>
                  </tr>
                </thead>
                <tbody>
                  {s.year.byRate.map((r) => (
                    <tr key={r.rate}>
                      <Td>{r.rate.toLocaleString("fi-FI")} %</Td>
                      <Td numeric>{formatEur(r.net)}</Td>
                      <Td numeric>{formatEur(r.vat)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}
    </>
  );
}
