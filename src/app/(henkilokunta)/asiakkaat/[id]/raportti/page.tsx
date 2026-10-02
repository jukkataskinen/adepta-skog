import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Panel, SectionTitle, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { formatDate, formatDateTime, formatEur, formatNumber } from "@/lib/format";
import { loadFilingSource } from "@/lib/filing/load";
import { compute2c, VSY02C_SPECS } from "@/lib/filing/vsy02c";
import { compute2, VSY002_SPECS } from "@/lib/filing/vsy002";
import { loadForm2 } from "@/lib/tax/agri-form-load";
import { Filing2cForm } from "./Filing2cForm";
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
    // Metsäasiakkaalle 2C kuten ennen, maatalousasiakkaalle lomake 2 samaan tiedostoon (DECISIONS 2.10.2026).
    const forestry = client.has_forestry || !client.has_agriculture;
    const filing = year && VSY02C_SPECS[year] && forestry ? await loadFilingSource(tx, ctx.org.organizationId, id, year) : null;
    const form2 = year && VSY002_SPECS[year] && client.has_agriculture ? await loadForm2(tx, id, year) : null;
    return { client, years, year, docs, filing, form2, forestry };
  });
  if (!data) notFound();
  const { client: c, years, year, docs, filing, form2, forestry } = data;
  const computed = filing ? compute2c(filing.data) : null;
  const computed2 = form2 ? compute2(form2) : null;
  const title = c.has_agriculture ? (forestry ? "Sähköinen veroilmoitus (2 ja 2C)" : "Sähköinen veroilmoitus (lomake 2)") : "Sähköinen veroilmoitus (2C)";
  const available = (forestry ? Boolean(computed) : true) && (c.has_agriculture ? Boolean(computed2) : true);
  const closed = years.find((y) => y.year === year)?.status === "closed";
  const reports = docs.filter((d) => d.kind === "report");

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Veroraportti ja arkisto" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="raportti" year={year} agriculture={c.has_agriculture} forestry={c.has_forestry} />
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
            {docs.some((d) => d.kind === "receipt") ? (
              <a
                href={`/asiakkaat/${id}/veroraportti/${year}?liitteet=1`}
                target="_blank"
                rel="noreferrer"
                className="ml-3 mt-4 inline-flex min-h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:border-ink/30"
              >
                {closed ? "Avaa tositteineen" : "Avaa luonnos tositteineen"}
              </a>
            ) : null}
          </Panel>
          {closed && reports.length === 0 ? (
            <div className="mb-5 max-w-3xl">
              <Notice tone="warn" title="Arkistossa ei ole raporttia tälle vuodelle.">Vuosi on suljettu ennen arkistointia tai tuotu vanhasta ohjelmasta.</Notice>
            </div>
          ) : null}

          <Panel className="mb-8 max-w-4xl">
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="mt-1 text-sm text-ink/70">
              {c.has_agriculture
                ? `Skog tekee ${forestry ? "maatalouden (lomake 2) ja metsätalouden (lomake 2C) veroilmoituksista yhden tiedoston" : "maatalouden veroilmoituksesta (lomake 2) tiedoston"}. Lataat tiedoston itse Ilmoitin.fi-palveluun, joka välittää sen Verohallinnolle. Maatalouden luvut ovat samat kuin Lomake 2 -välilehdellä ja veroraportissa.`
                : "Skog tekee metsätalouden veroilmoituksesta (lomake 2C) tiedoston. Lataat tiedoston itse Ilmoitin.fi-palveluun, joka välittää sen Verohallinnolle."}
              {forestry ? " Metsätalouden luvut ovat samat kuin veroraportissa: poistot ja metsävähennys tulevat vahvistetusta verosuunnitelmasta." : ""}
            </p>
            {!available ? (
              <div className="mt-4">
                <Notice tone="neutral" title={`Vuodelle ${year} ei voi vielä tehdä sähköistä ilmoitusta.`}>
                  Skogissa on Verohallinnon tiedostokuvaus vuosille {Object.keys(c.has_agriculture ? VSY002_SPECS : VSY02C_SPECS).join(" ja ")}.
                </Notice>
              </div>
            ) : (
              <div className="mt-4 grid gap-5">
                {computed2 ? (
                  <div className="grid gap-3">
                    <h3 className="font-semibold">Lomake 2: maatalous</h3>
                    {computed2.errors.map((e) => (
                      <Notice key={e} tone="alert" title="Korjaa ennen latausta">
                        {e}
                      </Notice>
                    ))}
                    {computed2.warnings.length ? (
                      <Notice tone="warn" title="Tarkista ennen latausta">
                        <ul className="list-disc pl-5">
                          {computed2.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </Notice>
                    ) : null}
                    {computed2.empty ? (
                      <Notice tone="info" title="Ei maataloutta tänä vuonna.">Lomake 2 annetaan silti: tiedostoon tulee tieto Ilmoitettavia tietoja ei ole (967).</Notice>
                    ) : (
                      <Table>
                        <thead>
                          <tr>
                            <Th>Tunnus</Th>
                            <Th>Kohta</Th>
                            <Th numeric>Arvo</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {computed2.fields.map((f) => (
                            <tr key={f.code}>
                              <Td className="tabular">{f.code}</Td>
                              <Td>{f.label}</Td>
                              <Td numeric>
                                {["413", "414", "415", "416"].includes(f.code)
                                  ? `${f.value.toLocaleString("fi-FI")} %`
                                  : ["418", "281", "534", "516", "287", "288", "401", "406", "411"].includes(f.code)
                                    ? f.value.toLocaleString("fi-FI")
                                    : formatEur(f.value)}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                    <p className="text-xs text-ink/55">
                      Tiedostokuvaus: Verohallinto, Maatalouden veroilmoitus 2, tietuekuvaus {computed2.spec.year}, versio {computed2.spec.version} (
                      {formatDate(computed2.spec.published)}). Tiedostoa ei ole vielä kokeiltu Ilmoitin.fi:n aineiston tarkastuksessa.
                    </p>
                  </div>
                ) : null}
                {computed && filing ? (
                <>
                <h3 className="font-semibold">{computed2 ? "Lomake 2C: metsätalous" : "Lomake 2C"}</h3>
                <Notice tone={filing.data.hasDisposals ? "warn" : "info"} title="Luovutusvoitot ilmoitetaan erikseen OmaVerossa.">
                  Koneen tai metsätilan myynnistä syntyvä luovutusvoitto tai -tappio ei kuulu 2C-ilmoitukseen. Ilmoita se OmaVerossa (lomake 9).
                  {filing.data.hasDisposals ? " Tänä vuonna on myyntejä: katso luvut veroraportin verolaskelmasta." : ""} Ennakonpidätyksiä ei ilmoiteta, koska Verohallinto saa ne puun ostajilta.
                </Notice>
                {computed.errors.map((e) => (
                  <Notice key={e} tone="alert" title="Korjaa ennen latausta">
                    {e}
                  </Notice>
                ))}
                {computed.warnings.length ? (
                  <Notice tone="warn" title="Tarkista ennen latausta">
                    <ul className="list-disc pl-5">
                      {computed.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}
                <div>
                  <h3 className="mb-2 font-semibold">Esikatselu: mitkä luvut menevät mihinkin kohtaan</h3>
                  <Table>
                    <thead>
                      <tr>
                        <Th>Tunnus</Th>
                        <Th>Kohta</Th>
                        <Th numeric>Summa</Th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <Td className="tabular">010</Td>
                        <Td>Verovelvollisen Y-tunnus tai henkilötunnus</Td>
                        <Td numeric>{c.business_id ? `${c.business_id} tai henkilötunnus` : "henkilötunnus (kysytään alla)"}</Td>
                      </tr>
                      {computed.fields.map((f) => (
                        <tr key={f.code}>
                          <Td className="tabular">{f.code}</Td>
                          <Td>{f.label}</Td>
                          <Td numeric>{formatEur(f.value)}</Td>
                        </tr>
                      ))}
                      {filing.workers.length ? (
                        <tr>
                          <Td className="tabular">700–706</Td>
                          <Td>Tehty hankintatyö tekijöittäin (nimi, henkilötunnus, määrät ja arvot lomakkeelta)</Td>
                          <Td numeric>{formatEur(computed.deliveryWork)}</Td>
                        </tr>
                      ) : null}
                    </tbody>
                  </Table>
                  <p className="mt-2 text-xs text-ink/55">
                    Tiedostokuvaus: Verohallinto, 2C Metsätalouden veroilmoitus, tietuekuvaus {computed.spec.year}, versio {computed.spec.version} ({formatDate(computed.spec.published)}).
                  </p>
                </div>
                </>
                ) : null}
                <Filing2cForm
                  clientId={id}
                  year={year}
                  businessId={c.business_id}
                  deliveryWork={computed?.deliveryWork ?? 0}
                  defaultWorkers={filing?.workers ?? []}
                  blocked={(computed?.errors.length ?? 0) > 0 || (computed2?.errors.length ?? 0) > 0}
                />
                <div className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm">
                  <p className="font-semibold">Lataa tiedosto Ilmoitin.fi-palveluun</p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                    <li>
                      Mene osoitteeseen{" "}
                      <a href="https://www.ilmoitin.fi" target="_blank" rel="noreferrer" className="font-semibold text-sky hover:underline">
                        www.ilmoitin.fi
                      </a>{" "}
                      ja kirjaudu Suomi.fi-tunnuksilla.
                    </li>
                    <li>Tarkista tiedosto ensin toiminnolla Aineiston tarkastus. Se kertoo virheet lähettämättä mitään.</li>
                    <li>Kun tarkastus on kunnossa, valitse Lähetä tiedosto ja lähetä sama tiedosto.</li>
                    <li>Tallenna kuittaus. Poista ladattu tiedosto koneeltasi, koska siinä on henkilötunnus.</li>
                  </ol>
                  <p className="mt-1 text-ink/65">Tarvitset asiakkaalta Suomi.fi-valtuuden (Veroasioiden hoito tai Veroilmoittaminen).</p>
                </div>
              </div>
            )}
          </Panel>

          <SectionTitle>Arkisto {year}</SectionTitle>
          {docs.length === 0 ? (
            <EmptyState title="Ei tiedostoja">Tositteet lisätään kirjanpidossa: koko vuoden tositteet painikkeella Lisää tositteet, yksittäisen kirjauksen tosite kirjauksen sivulla.</EmptyState>
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
