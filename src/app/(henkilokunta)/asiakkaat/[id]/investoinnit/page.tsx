import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, SectionTitle, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { listClientAssets, type ClientAssetRow } from "@/lib/assets/prior";
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
    return { client, years: await listYears(tx, id), assets: await listClientAssets(tx, id) };
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
                <Th>Hankittu</Th>
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
            Kertynyt poisto ja menojäännös näkyvät aiemmille ja vanhasta ohjelmasta tuoduille investoinneille. Vuoden poistot ja poistamaton arvo näet
            verosuunnitelmassa.
          </p>
        </section>
      )}
    </>
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
  const end = opening?.year ? ` 31.12.${opening.year - 1}` : "";
  const kind =
    a.activity === "agriculture"
      ? `${agriAssetLabel(a.asset_class, a.accelerated)}, enintään ${a.accelerated ? 50 : (agriAssetClass(a.asset_class)?.pct ?? Number(a.declining_rate_pct))} %`
      : a.method === "declining_balance"
        ? `${assetClassLabel(a.declining_rate_pct === null ? null : Number(a.declining_rate_pct))}, enintään ${Number(a.declining_rate_pct)} %`
        : "Vanha tasapoisto";
  const prior = a.opening_year !== null;
  return (
    <tr>
      <Td>
        <p className="font-semibold">{a.description}</p>
        <p className="text-xs text-ink/55">
          {showActivity ? `${ACTIVITY_LABEL[a.activity]} · ` : ""}
          {kind}
          {a.property_name ? ` · ${a.property_name}` : ""}
        </p>
      </Td>
      <Td>{prior && a.acquired_on.endsWith("-12-31") ? a.acquired_on.slice(0, 4) : formatDate(a.acquired_on)}</Td>
      <Td numeric>{formatEur(cost)}</Td>
      <Td numeric>
        {opening ? formatEur(opening.accumulated) : "–"}
        {end ? <p className="text-xs text-ink/55">{end.trim()}</p> : null}
      </Td>
      <Td numeric>
        {opening ? formatEur(opening.bookValue) : "–"}
        {end ? <p className="text-xs text-ink/55">{end.trim()}</p> : null}
      </Td>
      <Td className="text-right">
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          {a.disposed_on ? <Badge tone="neutral">Myyty {formatDate(a.disposed_on)}</Badge> : null}
          {prior ? (
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
