import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { listClientAssets, type ClientAssetRow } from "@/lib/assets/prior";
import { agriPoolHistory, forestAssetHistory, type AssetHistory, type HistoryRow, type PoolHistory } from "@/lib/assets/history";
import { loadAgriDepreciationSource } from "@/lib/tax/agri-load";
import { priorOpening } from "@/lib/tax/load";
import { ACTIVITY_LABEL, agriAssetClass, agriAssetLabel, assetClassLabel } from "@/lib/tax/rules";
import { formatDate, formatEur } from "@/lib/format";
import { ClientTabs } from "../../ClientTabs";

export const metadata = { title: "Investoinnit" };

export default async function AssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vuosi?: string; virhe?: string; tallennettu?: string; poistettu?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    const agri = client.has_agriculture ? agriPoolHistory(await loadAgriDepreciationSource(tx, id)) : [];
    return { client, years: await listYears(tx, id), assets: await listClientAssets(tx, id), pools: agri };
  });
  if (!data) notFound();
  const requested = Number(sp.vuosi);
  const year = data.years.some((y) => y.year === requested) ? requested : defaultYear(data.years);

  return (
    <>
      <PageHeader
        title={`${data.client.first_name} ${data.client.last_name}`.trim()}
        subtitle="Investoinnit"
        back={{ href: "/asiakkaat", label: "Asiakkaat" }}
        actions={<LinkButton href={`/asiakkaat/${id}/investoinnit/uusi`}>Lisää aiempi investointi</LinkButton>}
      />
      <ClientTabs clientId={id} active="investoinnit" year={year} agriculture={data.client.has_agriculture} forestry={data.client.has_forestry} />
      <FormError message={sp.virhe} />
      {sp.tallennettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Investointi tallennettu.">
            {sp.tallennettu === "poistot" ? "Investoinnin vahvistetut poistot poistettiin, koska arvo muuttui. Vahvista verosuunnitelma uudelleen." : null}
          </Notice>
        </div>
      ) : null}
      {sp.poistettu ? (
        <div className="mb-5">
          <Notice tone="ok" title="Investointi poistettu." />
        </div>
      ) : null}

      {data.client.has_agriculture ? (
        <p className="mb-5 max-w-3xl text-sm text-ink/70">
          Maatalouden investoinnit poistetaan ryhmittäin (lomake 2). Ryhmien menojäännökset, investointituet ja poistot ovat Lomake 2 -välilehdellä.
        </p>
      ) : null}
      {data.assets.length === 0 ? (
        <EmptyState
          title="Ei investointeja"
          action={<LinkButton href={`/asiakkaat/${id}/investoinnit/uusi`}>Lisää aiempi investointi</LinkButton>}
        >
          Uusi investointi syntyy, kun kirjaat hankinnan kirjanpitoon. Ennen Skogia hankitun tien, ojan tai koneen voit lisätä tästä.
        </EmptyState>
      ) : (
        <section>
          <SectionTitle>Investoinnit ja lähtöarvot</SectionTitle>
          <Table>
            <thead>
              <tr>
                <Th>Investointi</Th>
                <Th>Hankintavuosi</Th>
                <Th numeric>Hankintahinta</Th>
                <Th numeric>Kertynyt poisto</Th>
                <Th numeric>Menojäännös</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a) => (
                <AssetItem key={a.id} a={a} clientId={id} showActivity={data.client.has_agriculture} />
              ))}
            </tbody>
          </Table>
          <p className="mt-3 max-w-3xl text-xs text-ink/55">
            Menojäännös on viimeisen kirjatun vuoden lopussa: vahvistettu verosuunnitelma tai vanhasta ohjelmasta tuotu poisto. Avaa Poistohistoria
            nähdäksesi poistot vuosittain. Maatalouden investointien menojäännös on poistoryhmässä.
          </p>
        </section>
      )}
      {data.pools.length ? <PoolSection pools={data.pools} /> : null}
    </>
  );
}

function forestHistory(a: ClientAssetRow): AssetHistory {
  return forestAssetHistory(
    {
      acquiredOn: a.acquired_on, acquisitionCost: Number(a.acquisition_cost), method: a.method, usefulLifeYears: a.useful_life_years,
      decliningRatePct: a.declining_rate_pct === null ? null : Number(a.declining_rate_pct),
      openingBookValue: a.opening_book_value === null ? null : Number(a.opening_book_value),
      openingYear: a.opening_year === null ? null : Number(a.opening_year),
      disposedOn: a.disposed_on, salePrice: a.sale_price === null ? null : Number(a.sale_price),
    },
    (a.deps ?? []).map((d) => ({ taxYear: Number(d.taxYear), amount: Number(d.amount), bookValueEnd: Number(d.bookValueEnd) })),
  );
}

function AssetItem({ a, clientId, showActivity }: { a: ClientAssetRow; clientId: string; showActivity: boolean }) {
  const cost = Number(a.acquisition_cost);
  const opening = priorOpening({
    acquisitionCost: cost,
    openingBookValue: a.opening_book_value === null ? null : Number(a.opening_book_value),
    openingYear: a.opening_year,
    openingAccumulated: a.opening_accumulated_depreciation === null ? null : Number(a.opening_accumulated_depreciation),
  });
  const agri = a.activity === "agriculture";
  const history = agri ? null : forestHistory(a);
  const latest = history?.latest ?? null;
  const openingEnd = opening?.year ? `31.12.${opening.year - 1}` : null;
  const kind =
    agri
      ? `${agriAssetLabel(a.asset_class, a.accelerated)}, enintään ${a.accelerated ? 50 : (agriAssetClass(a.asset_class)?.pct ?? Number(a.declining_rate_pct))} %`
      : a.method === "declining_balance"
        ? `${assetClassLabel(a.declining_rate_pct === null ? null : Number(a.declining_rate_pct))}, enintään ${Number(a.declining_rate_pct)} %`
        : "Vanha tasapoisto";
  const prior = a.opening_year !== null;
  // Hankintavuosi; tarkka päivä pienellä, jos se tiedetään (vuoden viimeinen päivä tarkoittaa pelkkää vuotta).
  const acquiredDate = a.acquired_on.endsWith("-12-31") ? null : formatDate(a.acquired_on);
  return (
    <tr>
      <Td>
        <p className="font-semibold">{a.description}</p>
        <p className="text-xs text-ink/55">
          {showActivity ? `${ACTIVITY_LABEL[a.activity]} · ` : ""}
          {kind}
          {a.property_name ? ` · ${a.property_name}` : ""}
        </p>
        {history && history.rows.length ? <HistoryDetails rows={history.rows} /> : null}
      </Td>
      <Td>
        {a.acquired_on.slice(0, 4)}
        {acquiredDate ? <p className="text-xs text-ink/55">{acquiredDate}</p> : null}
      </Td>
      <Td numeric>{formatEur(cost)}</Td>
      <Td numeric>
        {history?.accumulated !== null && history?.accumulated !== undefined ? (
          <>
            {formatEur(history.accumulated)}
            <p className="text-xs text-ink/55">31.12.{latest!.year}</p>
          </>
        ) : opening ? (
          <>
            {formatEur(opening.accumulated)}
            {openingEnd ? <p className="text-xs text-ink/55">{openingEnd}</p> : null}
          </>
        ) : (
          "–"
        )}
      </Td>
      <Td numeric>
        {agri ? (
          <>
            {opening ? formatEur(opening.bookValue) : "–"}
            <p className="text-xs text-ink/55">{opening && openingEnd ? `lähtöarvo ${openingEnd}, ` : ""}ryhmässä</p>
          </>
        ) : history?.status === "sold" ? (
          <>
            {formatEur(0)}
            <p className="text-xs text-ink/55">myyty {a.disposed_on ? a.disposed_on.slice(0, 4) : ""}</p>
          </>
        ) : latest ? (
          <>
            {formatEur(latest.end)}
            <p className="text-xs text-ink/55">
              31.12.{latest.year}
              {history?.status === "fully_depreciated" ? " – poistettu kokonaan" : ""}
            </p>
          </>
        ) : opening ? (
          <>
            {formatEur(opening.bookValue)}
            {openingEnd ? <p className="text-xs text-ink/55">{openingEnd}</p> : null}
          </>
        ) : (
          "–"
        )}
      </Td>
      <Td className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          {a.disposed_on ? <Badge tone="neutral">Myyty {formatDate(a.disposed_on)}</Badge> : null}
          {history?.status === "fully_depreciated" ? <Badge tone="ok">Poistettu kokonaan</Badge> : null}
          {prior && !a.legacy_id ? (
            a.locked ? (
              <Badge tone="neutral">Aiempi, vuosi {a.opening_year} suljettu</Badge>
            ) : (
              <>
                <Badge tone="info">Aiempi</Badge>
                <Link href={`/asiakkaat/${clientId}/investoinnit/${a.id}`} className="font-semibold text-sky">
                  Muokkaa
                </Link>
              </>
            )
          ) : prior && !a.locked ? (
            <>
              <Badge tone="neutral">Tuotu</Badge>
              <Link href={`/asiakkaat/${clientId}/investoinnit/${a.id}`} className="font-semibold text-sky">
                Muokkaa
              </Link>
            </>
          ) : a.legacy_id ? (
            <Badge tone="neutral">Tuotu</Badge>
          ) : (
            <Badge tone="neutral">Kirjauksesta</Badge>
          )}
        </div>
      </Td>
    </tr>
  );
}

function HistoryDetails({ rows }: { rows: HistoryRow[] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer font-semibold text-sky">Poistohistoria ({rows.length} {rows.length === 1 ? "vuosi" : "vuotta"})</summary>
      <table className="mt-2 w-full max-w-md tabular-nums">
        <thead className="text-ink/55">
          <tr>
            <th className="py-1 pr-3 text-left font-semibold">Vuosi</th>
            <th className="py-1 pr-3 text-right font-semibold">Arvo alussa</th>
            <th className="py-1 pr-3 text-right font-semibold">Poisto</th>
            <th className="py-1 text-right font-semibold">Arvo lopussa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} className="border-t border-line">
              <td className="py-1 pr-3">{r.year}</td>
              <td className="py-1 pr-3 text-right">{formatEur(r.start)}</td>
              <td className="py-1 pr-3 text-right">{r.sold ? `myyty ${formatEur(r.salePrice ?? 0)}` : formatEur(r.depreciation)}</td>
              <td className="py-1 text-right">{formatEur(r.end)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function PoolSection({ pools }: { pools: PoolHistory[] }) {
  return (
    <section className="mt-8">
      <SectionTitle>Maatalouden poistoryhmät</SectionTitle>
      <Table>
        <thead>
          <tr>
            <Th>Ryhmä</Th>
            <Th numeric>Menojäännös</Th>
          </tr>
        </thead>
        <tbody>
          {pools.map((p) => (
            <tr key={p.pool}>
              <Td>
                <p className="font-semibold">{p.label}</p>
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-sky">Poistohistoria ({p.rows.length} {p.rows.length === 1 ? "vuosi" : "vuotta"})</summary>
                  <table className="mt-2 w-full max-w-xl tabular-nums">
                    <thead className="text-ink/55">
                      <tr>
                        <th className="py-1 pr-3 text-left font-semibold">Vuosi</th>
                        <th className="py-1 pr-3 text-right font-semibold">Arvo alussa</th>
                        <th className="py-1 pr-3 text-right font-semibold">Lisäykset</th>
                        <th className="py-1 pr-3 text-right font-semibold">Myynnit ja tuet</th>
                        <th className="py-1 pr-3 text-right font-semibold">Poisto</th>
                        <th className="py-1 text-right font-semibold">Arvo lopussa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.rows.map((r) => (
                        <tr key={r.year} className="border-t border-line">
                          <td className="py-1 pr-3">{r.year}</td>
                          <td className="py-1 pr-3 text-right">{formatEur(r.start)}</td>
                          <td className="py-1 pr-3 text-right">{formatEur(r.additions)}</td>
                          <td className="py-1 pr-3 text-right">{formatEur(r.deductions)}</td>
                          <td className="py-1 pr-3 text-right">{formatEur(r.depreciation)}</td>
                          <td className="py-1 text-right">{formatEur(r.end)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </Td>
              <Td numeric>
                {p.latest ? formatEur(p.latest.end) : "–"}
                {p.latest ? (
                  <p className="text-xs text-ink/55">
                    31.12.{p.latest.year}
                    {p.latest.end <= 0 ? " – poistettu kokonaan" : ""}
                  </p>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
