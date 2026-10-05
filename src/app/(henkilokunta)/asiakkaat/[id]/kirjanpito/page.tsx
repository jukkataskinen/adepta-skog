import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Stat, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listAssets, listFarmOptions, listPropertyOptions, listTransactions, listYears } from "@/lib/ledger/queries";
import { summarize } from "@/lib/ledger/summary";
import { vatOf } from "@/lib/tax/amounts";
import { activityRows, formatSharePct, isPartialShare } from "@/lib/tax/share";
import { inView, isFilterActive, matchesLedgerFilter, menuCategories, MONTH_NAMES, parseLedgerFilter, rowFromStored } from "@/lib/ledger/grid";
import { loadSuggestionRows } from "@/lib/ledger/suggestion-rows";
import { receiptRecognizer } from "@/lib/ai/receipts";
import { ACTIVITY_LABEL, ACTIVITY_PARAM, activitiesOf, category, ledgerView, type Activity } from "@/lib/tax/rules";
import { formatDate, formatEur, isoDateHelsinki } from "@/lib/format";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";
import { TransactionForm } from "./TransactionForm";
import { saveLedgerGridAction, saveTransactionAction } from "./actions";
import { LedgerGrid } from "./LedgerGrid";
import { toFinnishDate } from "@/lib/ledger/transaction-input";
import { listYearReceipts } from "@/lib/documents/year-receipts";
import { YearReceipts } from "./YearReceipts";
import { documentHref, parsePagesColumn, sourceDocumentLabel } from "@/lib/ai/receipts/schema";

export const metadata = { title: "Kirjanpito" };
// Tositteen tunnistus osissa: yksi pala (server action tältä sivulta) kestää enintään
// noin 100 s (CHUNK_TIMEOUT_MS, src/lib/ai/receipts/config.ts).
export const maxDuration = 120;

const KIND_LABEL = { income: "Tulo", expense: "Meno", investment: "Investointi" } as const;
const VIEW_TITLE: Record<Activity, string> = { forestry: "Metsätalouden kirjanpito", agriculture: "Maatalouden kirjanpito" };

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vuosi?: string; virhe?: string; lisatty?: string; syotto?: string; toiminta?: string; luokka?: string; kk?: string; haku?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  // Helsingin päivä: oletuspäivä ei vaihdu vuodenvaihteessa UTC:n mukaan.
  const today = isoDateHelsinki();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    const years = await listYears(tx, id);
    const requested = Number(sp.vuosi);
    const year = years.some((y) => y.year === requested) ? requested : defaultYear(years);
    // Kirjanpito toiminnoittain: pelkällä metsäasiakkaalla ei rajausta (null).
    const view = ledgerView({ hasForestry: client.has_forestry, hasAgriculture: client.has_agriculture }, sp.toiminta);
    const rows = year ? await listTransactions(tx, id, year) : [];
    const defaultDate = year && today.startsWith(String(year)) ? today : `${year}-01-01`;
    return {
      client,
      years,
      year,
      view,
      rows,
      assets: await listAssets(tx, id),
      properties: await listPropertyOptions(tx, id),
      farms: await listFarmOptions(tx, id),
      receipts: year ? await listYearReceipts(tx, id, year) : [],
      // Tunnistuksen ehdotukset taulukon riveinä tiliöintimuistin ehdotuksineen (src/lib/ledger/suggestion-rows.ts).
      suggestionRows: year
        ? await loadSuggestionRows(
            tx,
            { organizationId: ctx.org.organizationId, clientId: id, year, view, vatRegistered: client.vat_registered, defaultDate: toFinnishDate(defaultDate) },
            rows,
          )
        : [],
    };
  });
  if (!data) notFound();
  const { client: c, years, year, view, rows: allRows } = data;
  // Näkymä näyttää vain oman toimintonsa kirjaukset. Kortit lasketaan kaikista riveistä, koska
  // toisen toiminnon menosta voi kuulua osuus tälle toiminnolle (activityRows).
  const rows = allRows.filter((r) => inView(r.category, view));
  const status = years.find((y) => y.year === year)?.status;
  const closed = status === "closed";
  // Kortit ja summat ovat metsätalouden osuuksia (src/lib/tax/share.ts). Maatalousasiakkaalle
  // kortit näytetään toiminnoittain: kummankin toiminnon oma osuus ja toiselta saatu osuus.
  const inputs = allRows.map((r) => ({
    ...r, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), withholding: Number(r.withholding),
    businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct),
  }));
  const sum = summarize(inputs.filter((r) => inView(r.category, view)));
  const activities = view ? [view] : activitiesOf({ hasForestry: c.has_forestry, hasAgriculture: c.has_agriculture });
  const byActivity = c.has_agriculture
    ? activities.map((a) => ({ activity: a, sum: summarize(activityRows(inputs, a).map((r) => ({ ...r, withholding: r.cross ? 0 : r.withholding }))) }))
    : null;
  const both = c.has_forestry && c.has_agriculture;
  const viewParam = view === "agriculture" && both ? `&toiminta=${ACTIVITY_PARAM.agriculture}` : "";
  const otherView: Activity | null = both && view ? (view === "agriculture" ? "forestry" : "agriculture") : null;
  const viewHref = (a: Activity) => `/asiakkaat/${id}/kirjanpito?vuosi=${year}${a === "agriculture" ? `&toiminta=${ACTIVITY_PARAM.agriculture}` : ""}`;
  const defaultDate = year && today.startsWith(String(year)) ? today : `${year}-01-01`;
  // Avoimen vuoden oletusnäkymä on taulukko, jossa kaikki vuoden rivit ovat muokattavina
  // kuten vanhassa sovelluksessa. Lomake on vaihtoehto rivi kerrallaan kirjaamiseen.
  const gridMode = !closed && sp.syotto !== "lomake";
  const modeHref = (grid: boolean) => `/asiakkaat/${id}/kirjanpito?vuosi=${year}${grid ? "" : "&syotto=lomake"}${viewParam}`;
  // Suodatin ja haku (luokka, kuukausi, teksti). Taulukko suodattaa selaimessa, luettelo osoitteen parametreista.
  const filter = parseLedgerFilter(sp);
  const filtering = isFilterActive(filter);
  const shownRows = filtering
    ? rows.filter((r) =>
        matchesLedgerFilter({ bookedOn: r.booked_on, category: r.category, description: r.description, reference: r.reference, amountGross: Number(r.amount_gross) }, filter),
      )
    : rows;
  const shownIds = new Set(shownRows.map((r) => r.id));
  const shownSum = filtering ? summarize(inputs.filter((r) => shownIds.has(r.id))) : sum;
  const filterCategories = menuCategories({ hasForestry: c.has_forestry, hasAgriculture: c.has_agriculture }, view);

  return (
    // Avain vuoden mukaan: vuoden vaihto rakentaa sivun alusta, jotta lomakkeiden ja taulukon tila ei jää edellisestä vuodesta.
    <Fragment key={`${year}${viewParam ?? ""}`}>
      <PageHeader
        title={`${c.first_name} ${c.last_name}`.trim()}
        subtitle={view ? VIEW_TITLE[view] : "Kirjanpito"}
        back={{ href: "/asiakkaat", label: "Asiakkaat" }}
      />
      <ClientTabs
        clientId={id}
        active={view === "agriculture" && both ? "kirjanpito-maatalous" : "kirjanpito"}
        year={year}
        agriculture={c.has_agriculture}
        forestry={c.has_forestry}
      />
      <FormError message={sp.virhe} />

      {year === null ? (
        <EmptyState title="Ei verovuosia">Avaa verovuosi asiakkaan tiedoissa.</EmptyState>
      ) : (
        <>
          <YearNav years={years} year={year} basePath={`/asiakkaat/${id}/kirjanpito`} query={viewParam ? viewParam.slice(1) : undefined} />

          {otherView ? (
            <p className="-mt-2 mb-5 text-sm text-ink/70">
              Näet vain {view === "agriculture" ? "maatalouden" : "metsätalouden"} kirjaukset ja luokat.{" "}
              <Link href={viewHref(otherView)} className="font-semibold text-sky hover:underline">
                Siirry {otherView === "agriculture" ? "maatalouden" : "metsätalouden"} kirjanpitoon
              </Link>
            </p>
          ) : null}

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

          {byActivity ? (
            byActivity.map((b) => (
              <div key={b.activity} className="mb-4">
                {byActivity.length > 1 ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">{ACTIVITY_LABEL[b.activity]}</p> : null}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Tulot ilman alv" value={formatEur(b.sum.income.net)} />
                  <Stat label="Menot ilman alv" value={formatEur(b.sum.expense.net)} />
                  <Stat label="Investoinnit ilman alv" value={formatEur(b.sum.investment.net)} />
                  <Stat label="Tulos ennen poistoja" value={formatEur(b.sum.netResult)} tone={b.sum.netResult < 0 ? "alert" : undefined} />
                </div>
              </div>
            ))
          ) : (
            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Tulot ilman alv" value={formatEur(sum.income.net)} />
              <Stat label="Menot ilman alv" value={formatEur(sum.expense.net)} />
              <Stat label="Investoinnit ilman alv" value={formatEur(sum.investment.net)} />
              <Stat label="Tulos ennen poistoja" value={formatEur(sum.netResult)} tone={sum.netResult < 0 ? "alert" : undefined} />
            </div>
          )}
          {byActivity && both ? (
            <p className="mb-6 text-sm text-ink/70">
              {view === "agriculture"
                ? "Luvuissa on maatalouden osuus, myös metsätalouden kirjauksista maataloudelle annettu osuus. Yksityinen osuus jää pois."
                : "Luvuissa on metsätalouden osuus, myös maatalouden kirjauksista metsätaloudelle annettu osuus. Yksityinen osuus jää pois."}
            </p>
          ) : byActivity ? (
            <div className="mb-2" />
          ) : sum.partialCount ? (
            <p className="-mt-3 mb-6 text-sm text-ink/70">
              {sum.partialCount === 1 ? "Yhdestä kirjauksesta" : `${sum.partialCount} kirjauksesta`} vain osa kuuluu metsätaloudelle. Luvuissa on vain
              metsätalouden osuus.{sum.nonDeductibleVat ? ` Ostojen verosta ${formatEur(sum.nonDeductibleVat)} kuuluu muulle toiminnalle.` : ""}
            </p>
          ) : null}

          <YearReceipts
            clientId={id}
            year={year}
            receipts={data.receipts}
            readOnly={closed}
            testMode={receiptRecognizer().mode === "mock"}
            gridMode={gridMode}
            gridHref={modeHref(true)}
            view={view}
            otherViewHref={otherView ? viewHref(otherView) : null}
          />

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
              suggestionRows={data.suggestionRows}
              properties={view === "agriculture" ? [] : data.properties}
              farms={view === "agriculture" ? data.farms : []}
              initialFilter={filter}
              assets={data.assets.filter((a) => !view || a.activity === view)}
              vatRegistered={c.vat_registered}
              defaultDate={toFinnishDate(defaultDate)}
              hasForestry={c.has_forestry}
              hasAgriculture={c.has_agriculture}
              activity={view}
            />
          ) : rows.length === 0 ? (
            <EmptyState title="Ei kirjauksia">{closed ? "Vuodelle ei ole kirjauksia." : "Lisää ensimmäinen kirjaus alla olevalla lomakkeella."}</EmptyState>
          ) : (
            <>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Suodata kirjauksia">
              <input type="hidden" name="vuosi" value={year} />
              {!closed ? <input type="hidden" name="syotto" value="lomake" /> : null}
              {viewParam ? <input type="hidden" name="toiminta" value={ACTIVITY_PARAM.agriculture} /> : null}
              <Field label="Luokka" htmlFor="luokka">
                <Select id="luokka" name="luokka" defaultValue={filter.category}>
                  <option value="">Kaikki luokat</option>
                  {filterCategories.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.no} {x.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Kuukausi" htmlFor="kk">
                <Select id="kk" name="kk" defaultValue={filter.month ? String(filter.month) : ""}>
                  <option value="">Koko vuosi</option>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Haku" htmlFor="haku">
                <Input id="haku" name="haku" defaultValue={filter.text} placeholder="Selite, viite tai summa" autoComplete="off" />
              </Field>
              <Button>Suodata</Button>
              {filtering ? (
                <Link href={closed ? `/asiakkaat/${id}/kirjanpito?vuosi=${year}${viewParam}` : modeHref(false)} className="pb-2 text-sm font-semibold text-sky hover:underline">
                  Näytä kaikki
                </Link>
              ) : null}
            </form>
            {filtering ? (
              <p className="mb-3 text-sm text-ink/70">
                Näytetään {shownRows.length} / {rows.length} kirjausta. Summat ovat näytetyistä kirjauksista.
              </p>
            ) : null}
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
                {shownRows.map((r) => {
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
                        {isPartialShare(r.business_share_pct) || Number(r.other_share_pct) ? (
                          <span className="block text-xs text-ink/55">
                            {r.activity === "agriculture" ? "Maatalouden" : "Metsätalouden"} osuus {formatSharePct(Number(r.business_share_pct))} %
                            {Number(r.other_share_pct) ? `, toisen toiminnon ${formatSharePct(Number(r.other_share_pct))} %` : ""}
                          </span>
                        ) : null}
                      </Td>
                      <Td numeric className="font-semibold">
                        {formatEur(gross)}
                      </Td>
                      <Td numeric>{Number(r.vat_rate).toLocaleString("fi-FI")}</Td>
                      <Td numeric>{formatEur(vatOf(net, gross))}</Td>
                      <Td numeric>{formatEur(net)}</Td>
                      <Td numeric>{Number(r.withholding) ? formatEur(r.withholding) : "–"}</Td>
                      <Td>
                        {r.document_count ? `${r.document_count} kpl` : r.source_document_id ? null : <span className="text-ink/45">Ei</span>}
                        {r.source_document_id ? (
                          <a href={documentHref(id, r.source_document_id, parsePagesColumn(r.source_pages))} target="_blank" rel="noreferrer" className="block font-semibold text-sky hover:underline">
                            {sourceDocumentLabel(parsePagesColumn(r.source_pages))}
                          </a>
                        ) : null}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold">
                  <Td>Yhteensä</Td>
                  <Td />
                  <Td>Alv maksettava {formatEur(shownSum.vatPayable)}</Td>
                  <Td />
                  <Td />
                  <Td numeric>{formatEur(shownSum.income.vat + shownSum.expense.vat + shownSum.investment.vat)}</Td>
                  <Td numeric>{formatEur(shownSum.income.net - shownSum.expense.net - shownSum.investment.net)}</Td>
                  <Td numeric>{formatEur(shownSum.withholding)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
            </>
          )}

          {!closed && !gridMode ? (
            <section className="mt-8" id="uusi">
              <SectionTitle>Uusi kirjaus</SectionTitle>
              <Panel>
                <TransactionForm
                  action={saveTransactionAction}
                  clientId={id}
                  assets={data.assets}
                  properties={view === "agriculture" ? [] : data.properties}
                  farms={view === "agriculture" ? data.farms : []}
                  defaultDate={defaultDate}
                  submitLabel="Lisää kirjaus"
                  vatRegistered={c.vat_registered}
                  hasForestry={c.has_forestry}
                  hasAgriculture={c.has_agriculture}
                  activity={view}
                  compact
                />
              </Panel>
            </section>
          ) : null}
        </>
      )}
    </Fragment>
  );
}
