import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, SectionTitle, Stat, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listTransactions, listYears } from "@/lib/ledger/queries";
import { vatRowsFrom, vatSummary } from "@/lib/tax/vat";
import { formatEur } from "@/lib/format";
import { ACTIVITY_LABEL } from "@/lib/tax/rules";
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
  // Ostojen verosta metsän ja maatalouden osuudet, myynnin vero kokonaan (src/lib/tax/share.ts).
  // Yksi laskelma kaikista kirjauksista, koska metsä ja maatalous ilmoitetaan samalla alv-ilmoituksella.
  const s = vatSummary(vatRowsFrom(data.rows));

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Arvonlisävero" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="alv" year={year} agriculture={c.has_agriculture} forestry={c.has_forestry} />
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
              {c.has_agriculture
                ? `Ostojen verosta ${formatEur(s.year.nonDeductible)} on yksityistä, koska kirjauksesta vain osa kuuluu metsä- tai maataloudelle. Sitä ei vähennetä.`
                : `Ostojen verosta ${formatEur(s.year.nonDeductible)} kuuluu muulle toiminnalle, koska kirjauksesta vain osa on metsätaloutta. Sitä ei vähennetä tässä.`}
            </p>
          ) : null}

          {c.has_agriculture ? (
            <section className="mb-8">
              <SectionTitle>Metsä ja maatalous</SectionTitle>
              <p className="mb-3 max-w-3xl text-sm text-ink/70">
                Metsätalous ja maatalous ilmoitetaan samalla arvonlisäveroilmoituksella. Erittely näyttää, mistä toiminnosta vero tulee.
              </p>
              <Table>
                <thead>
                  <tr>
                    <Th>Toiminto</Th>
                    <Th numeric>Myynnin vero</Th>
                    <Th numeric>Ostojen vero</Th>
                    <Th numeric>Maksettava</Th>
                  </tr>
                </thead>
                <tbody>
                  {(["forestry", "agriculture"] as const).map((a) => (
                    <tr key={a}>
                      <Td>{ACTIVITY_LABEL[a]}</Td>
                      <Td numeric>{formatEur(s.year.byActivity[a].output)}</Td>
                      <Td numeric>{formatEur(s.year.byActivity[a].input)}</Td>
                      <Td numeric>{formatEur(s.year.byActivity[a].output - s.year.byActivity[a].input)}</Td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-line font-semibold">
                    <Td>Yhteensä</Td>
                    <Td numeric>{formatEur(s.year.output)}</Td>
                    <Td numeric>{formatEur(s.year.input)}</Td>
                    <Td numeric>{formatEur(s.year.payable)}</Td>
                  </tr>
                </tbody>
              </Table>
            </section>
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

          <section className="mt-8">
            <SectionTitle>Arvonlisäveroilmoituksen kentät</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">
              Näillä luvuilla täytät vuoden arvonlisäveroilmoituksen OmaVerossa (verokausi kalenterivuosi). Tarkista luvut ennen lähettämistä.
            </p>
            <Table>
              <tbody>
                {[
                  ["301", "Vero 25,5 %", s.year.form.general],
                  ["302", "Vero 14 % tai 13,5 %", s.year.form.reduced],
                  ["303", "Vero 10 %", s.year.form.ten],
                  ["307", "Verokauden vähennettävä vero", s.year.form.deductible],
                  ["308", s.year.form.payable < 0 ? "Palautettava vero" : "Maksettava vero", Math.abs(s.year.form.payable)],
                ].map(([code, label, value]) => (
                  <tr key={code as string}>
                    <Td className="w-16 tabular text-ink/55">{code}</Td>
                    <Td>{label}</Td>
                    <Td numeric>{formatEur(value as number)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        </>
      )}
    </>
  );
}
