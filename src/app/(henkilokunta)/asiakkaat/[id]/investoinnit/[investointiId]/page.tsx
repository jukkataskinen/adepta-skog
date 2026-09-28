import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { listPropertyOptions } from "@/lib/ledger/queries";
import { getPriorAsset } from "@/lib/assets/prior";
import { formatEur } from "@/lib/format";
import { PriorAssetForm } from "../PriorAssetForm";
import { deletePriorAssetAction, savePriorAssetAction } from "../actions";

export const metadata = { title: "Aiempi investointi" };

// Lomakkeella luvut näytetään suomalaisittain pilkulla.
const fi = (v: string) => String(Number(v)).replace(".", ",");

export default async function PriorAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; investointiId: string }>;
  searchParams: Promise<{ virhe?: string }>;
}) {
  const { id, investointiId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(investointiId)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    const asset = await getPriorAsset(tx, id, investointiId);
    if (!asset) return null;
    return { client, asset, properties: await listPropertyOptions(tx, id) };
  });
  if (!data) notFound();
  const a = data.asset;
  const balanceYear = a.opening_year - 1;
  // Pelkkä vuosi tallennettiin vuoden viimeiseksi päiväksi, joten se näytetään vuotena.
  const acquired = a.acquired_on.endsWith("-12-31") ? a.acquired_on.slice(0, 4) : a.acquired_on.split("-").reverse().map(Number).join(".");
  const back = { href: `/asiakkaat/${id}/investoinnit`, label: `${data.client.first_name} ${data.client.last_name}`.trim() };

  return (
    <>
      <PageHeader title={a.description} subtitle="Aiempi investointi" back={back} />
      <FormError message={sp.virhe} />
      {a.locked ? (
        <div className="max-w-4xl">
          <Notice tone="warn" title={`Verovuosi ${a.opening_year} on suljettu.`}>
            Investoinnin ensimmäinen poistovuosi on suljettu, joten sen tietoja ei voi muuttaa eikä sitä voi poistaa. Pääkäyttäjä voi avata vuoden.
          </Notice>
          <Panel className="mt-5">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink/60">Hankintahinta</dt>
                <dd className="tabular font-semibold">{formatEur(a.acquisition_cost)}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Kertynyt poisto 31.12.{balanceYear}</dt>
                <dd className="tabular font-semibold">{formatEur(a.opening_accumulated_depreciation)}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Menojäännös 31.12.{balanceYear}</dt>
                <dd className="tabular font-semibold">{formatEur(a.opening_book_value)}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      ) : (
        <>
          <Panel className="max-w-4xl">
            <PriorAssetForm
              action={savePriorAssetAction}
              clientId={id}
              asset={{
                id: a.id, description: a.description, ratePct: Number(a.declining_rate_pct), balanceYear, acquired,
                acquisitionCost: fi(a.acquisition_cost), accumulatedDepreciation: fi(a.opening_accumulated_depreciation), forestPropertyId: a.forest_property_id,
              }}
              defaultBalanceYear={balanceYear}
              properties={data.properties}
              submitLabel="Tallenna"
            />
          </Panel>
          <p className="mt-3 max-w-4xl text-xs text-ink/55">
            Jos muutat hankintahintaa, kertynyttä poistoa, lajia tai vuotta, investoinnin vahvistetut poistot poistetaan. Vahvista silloin verosuunnitelma
            uudelleen.
          </p>
          {a.disposed_on ? (
            <p className="mt-8 text-sm text-ink/65">
              Investointi on myyty. Jos haluat poistaa sen, poista ensin myyntikirjaus{" "}
              <Link href={`/asiakkaat/${id}/kirjanpito?vuosi=${a.disposed_on.slice(0, 4)}`} className="font-semibold text-sky">
                kirjanpidosta
              </Link>
              .
            </p>
          ) : (
            <form action={deletePriorAssetAction} className="mt-8">
              <input type="hidden" name="clientId" value={id} />
              <input type="hidden" name="assetId" value={a.id} />
              <button className="text-sm font-semibold text-coral">Poista investointi</button>
              <p className="mt-1 text-xs text-ink/55">Investoinnin vahvistetut poistot poistuvat samalla.</p>
            </form>
          )}
        </>
      )}
    </>
  );
}
