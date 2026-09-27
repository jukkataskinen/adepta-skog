import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader, Panel, SectionTitle, Stat, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listAssets, listPropertyOptions, listTransactions, listYears } from "@/lib/ledger/queries";
import { summarize } from "@/lib/ledger/summary";
import { vatOf } from "@/lib/tax/amounts";
import { rowFromStored } from "@/lib/ledger/grid";
import { category } from "@/lib/tax/rules";
import { formatDate, formatEur } from "@/lib/format";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";
import { TransactionForm } from "./TransactionForm";
import { saveLedgerGridAction, saveTransactionAction } from "./actions";
import { LedgerGrid } from "./LedgerGrid";
import { toFinnishDate } from "@/lib/ledger/transaction-input";
import { listYearReceipts } from "@/lib/documents/year-receipts";
import { YearReceipts } from "./YearReceipts";

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
      receipts: year ? await listYearReceipts(tx, id, year) : [],
    };
  });
  if (!data) notFound();
  const { client: c, years, year, rows } = data;
  const status = years.find((y) => y.year === year)?.status;
  const closed = status === "closed";
  const sum = summarize(rows.map((r) => ({ kind: r.kind, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), withholding: Number(r.withholding) })));
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = year && today.startsWith(String(year)) ? today : `${year}-01-01`;
  // Avoimen vuoden oletusnäkymä on taulukko, jossa kaikki vuoden rivit ovat muokattavina
  // kuten vanhassa sovelluksessa. Lomake on vaihtoehto rivi kerrallaan kirjaamiseen.
  const gridMode = !closed && sp.syotto !== "lomake";
  const modeHref = (grid: boolean) => `/asiakkaat/${id}/kirjanpito?vuosi=${year}${grid ? "" : "&syotto=lomake"}`;

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

          <YearReceipts clientId={id} year={year} receipts={data.receipts} readOnly={closed} />

          {!closed ? (
            <nav className="mb-4 flex gap-1 text-sm" aria-label="Syöttötapa">
              <Link href={modeHref(true)} className={`rounded-full px-3 py-1.5 font-semibold ${gridMode ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"}`} aria-current={gridMode ? "page" : undefined}>
                Taulukko
              </Link>
              <Link href={modeHref(false)} className={`rounded-full px-3 py-1.5 font-semibold ${gridMode ? "text-ink/60 hover:text-ink" : "bg-ink text-paper"}`} aria-current={gridMode ? undefined : "page"}>
                Lomake
              </Link>
            </nav>
          ) : null}

          {gridMode ? (
            <LedgerGrid
              action={saveLedgerGridAction}
              clientId={id}
              year={year}
              initialRows={rows.map(rowFromStored)}
              properties={data.properties}
              assets={data.assets}
              vatRegistered={c.vat_registered}
              defaultDate={toFinnishDate(defaultDate)}
            />
          ) : rows.length === 0 ? (
            <EmptyState title="Ei kirjauksia">{closed ? "Vuodelle ei ole kirjauksia." : "Lisää ensimmäinen kirjaus alla olevalla lomakkeella."}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Päivä</Th>
                  <Th>Luokka</Th>
                  <Th>Selite</Th>
                  <Th numeric>Summa (sis. alv)</Th>
                  <Th numeric>Alv %</Th>
                  <Th numeric>Alv</Th>
                  <Th numeric>Veroton</Th>
                  <Th numeric>Ennakko</Th>
                  <Th>Tosite</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const net = Number(r.amount_net);
                  const gross = Number(r.amount_gross);
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
                      <Td numeric className="font-semibold">
                        {formatEur(gross)}
                      </Td>
                      <Td numeric>{Number(r.vat_rate).toLocaleString("fi-FI")}</Td>
                      <Td numeric>{formatEur(vatOf(net, gross))}</Td>
                      <Td numeric>{formatEur(net)}</Td>
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
                  <Td />
                  <Td />
                  <Td numeric>{formatEur(sum.income.vat + sum.expense.vat + sum.investment.vat)}</Td>
                  <Td numeric>{formatEur(sum.income.net - sum.expense.net - sum.investment.net)}</Td>
                  <Td numeric>{formatEur(sum.withholding)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}

          {!closed && !gridMode ? (
            <section className="mt-8" id="uusi">
              <SectionTitle>Uusi kirjaus</SectionTitle>
              <Panel>
                <TransactionForm
                  action={saveTransactionAction}
                  clientId={id}
                  assets={data.assets}
                  properties={data.properties}
                  defaultDate={defaultDate}
                  submitLabel="Lisää kirjaus"
                  vatRegistered={c.vat_registered}
                  compact
                />
              </Panel>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
