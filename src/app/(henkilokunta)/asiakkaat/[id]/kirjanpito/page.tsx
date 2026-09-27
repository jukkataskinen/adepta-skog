import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Panel, SectionTitle, Stat, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listAssets, listPropertyOptions, listTransactions, listYears } from "@/lib/ledger/queries";
import { grossAmount, summarize, vatAmount } from "@/lib/ledger/summary";
import { category } from "@/lib/tax/rules";
import { formatDate, formatEur } from "@/lib/format";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";
import { TransactionForm } from "./TransactionForm";
import { saveTransactionAction, saveTransactionBatchAction } from "./actions";
import { BatchEntry } from "./BatchEntry";
import { toFinnishDate } from "@/lib/ledger/transaction-input";

export const metadata = { title: "Kirjanpito" };

const KIND_LABEL = { income: "Tulo", expense: "Meno", investment: "Investointi" } as const;

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vuosi?: string; virhe?: string; lisatty?: string; syotto?: string }>;
}) {
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
    return {
      client,
      years,
      year,
      rows: year ? await listTransactions(tx, id, year) : [],
      assets: await listAssets(tx, id),
      properties: await listPropertyOptions(tx, id),
    };
  });
  if (!data) notFound();
  const { client: c, years, year, rows } = data;
  const status = years.find((y) => y.year === year)?.status;
  const closed = status === "closed";
  const sum = summarize(rows.map((r) => ({ kind: r.kind, amountNet: Number(r.amount_net), vatRate: Number(r.vat_rate), withholding: Number(r.withholding) })));
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = year && today.startsWith(String(year)) ? today : `${year}-01-01`;
  // Taulukkosyöttö on oma tilansa samalla sivulla, jotta kirjaukset näkyvät yläpuolella tallennuksen jälkeen.
  const tableMode = sp.syotto === "taulukko";
  const modeHref = (table: boolean) => `/asiakkaat/${id}/kirjanpito?vuosi=${year}${table ? "&syotto=taulukko" : ""}#uusi`;

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Kirjanpito" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="kirjanpito" year={year} />
      <FormError message={sp.virhe} />

      {year === null ? (
        <EmptyState title="Ei verovuosia">Avaa verovuosi asiakkaan tiedoissa.</EmptyState>
      ) : (
        <>
          <YearNav years={years} year={year} basePath={`/asiakkaat/${id}/kirjanpito`} />

          {closed ? (
            <div className="mb-5">
              <Notice tone="warn" title={`Verovuosi ${year} on suljettu.`}>
                Kirjauksia ei voi lisätä eikä muuttaa. Pääkäyttäjä voi avata vuoden asiakkaan tiedoissa.
              </Notice>
            </div>
          ) : null}
          {sp.lisatty ? (
            <div className="mb-5">
              <Notice tone="ok" title="Kirjaus lisätty." />
            </div>
          ) : null}

          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tulot ilman alv" value={formatEur(sum.income.net)} />
            <Stat label="Menot ilman alv" value={formatEur(sum.expense.net)} />
            <Stat label="Investoinnit ilman alv" value={formatEur(sum.investment.net)} />
            <Stat label="Tulos ennen poistoja" value={formatEur(sum.netResult)} tone={sum.netResult < 0 ? "alert" : undefined} />
          </div>

          {rows.length === 0 ? (
            <EmptyState title="Ei kirjauksia">{closed ? "Vuodelle ei ole kirjauksia." : "Lisää ensimmäinen kirjaus alla olevalla lomakkeella."}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Päivä</Th>
                  <Th>Luokka</Th>
                  <Th>Selite</Th>
                  <Th numeric>Ilman alv</Th>
                  <Th numeric>Alv %</Th>
                  <Th numeric>Alv</Th>
                  <Th numeric>Yhteensä</Th>
                  <Th numeric>Ennakko</Th>
                  <Th>Tosite</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const net = Number(r.amount_net);
                  const rate = Number(r.vat_rate);
                  return (
                    <tr key={r.id} className="row-link hover:bg-cloud/50">
                      <Td className="tabular whitespace-nowrap">
                        <Link href={`/asiakkaat/${id}/kirjanpito/${r.id}`} className="row-link-main">
                          {formatDate(r.booked_on)}
                        </Link>
                      </Td>
                      <Td>
                        <span className="text-xs font-semibold uppercase text-ink/50">{KIND_LABEL[r.kind]}</span>
                        <span className="block">{category(r.category)?.label ?? r.category}</span>
                      </Td>
                      <Td>
                        {r.description || "–"}
                        {r.asset_description ? <span className="block text-xs text-ink/55">Investointi: {r.asset_description}</span> : null}
                      </Td>
                      <Td numeric>{formatEur(net)}</Td>
                      <Td numeric>{rate.toLocaleString("fi-FI")}</Td>
                      <Td numeric>{formatEur(vatAmount(net, rate))}</Td>
                      <Td numeric className="font-semibold">
                        {formatEur(grossAmount(net, rate))}
                      </Td>
                      <Td numeric>{Number(r.withholding) ? formatEur(r.withholding) : "–"}</Td>
                      <Td>{r.document_count ? `${r.document_count} kpl` : <span className="text-ink/45">Ei</span>}</Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <Td>Yhteensä</Td>
                  <Td />
                  <Td>Alv maksettava {formatEur(sum.vatPayable)}</Td>
                  <Td numeric>{formatEur(sum.income.net - sum.expense.net - sum.investment.net)}</Td>
                  <Td />
                  <Td numeric>{formatEur(sum.income.vat + sum.expense.vat + sum.investment.vat)}</Td>
                  <Td />
                  <Td numeric>{formatEur(sum.withholding)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}

          {!closed && year !== null ? (
            <section className="mt-8" id="uusi">
              <SectionTitle
                actions={
                  <nav className="flex gap-1 text-sm" aria-label="Syöttötapa">
                    <Link href={modeHref(false)} className={`rounded-full px-3 py-1.5 font-semibold ${tableMode ? "text-ink/60 hover:text-ink" : "bg-ink text-paper"}`} aria-current={tableMode ? undefined : "page"}>
                      Lomake
                    </Link>
                    <Link href={modeHref(true)} className={`rounded-full px-3 py-1.5 font-semibold ${tableMode ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"}`} aria-current={tableMode ? "page" : undefined}>
                      Taulukkosyöttö
                    </Link>
                  </nav>
                }
              >
                {tableMode ? "Taulukkosyöttö" : "Uusi kirjaus"}
              </SectionTitle>
              {tableMode ? (
                <BatchEntry action={saveTransactionBatchAction} clientId={id} year={year} defaultDate={toFinnishDate(defaultDate)} properties={data.properties} />
              ) : (
                <Panel>
                  <TransactionForm action={saveTransactionAction} clientId={id} assets={data.assets} properties={data.properties} defaultDate={defaultDate} submitLabel="Lisää kirjaus" compact />
                </Panel>
              )}
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
