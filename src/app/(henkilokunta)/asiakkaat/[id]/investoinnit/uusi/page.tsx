import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { listPropertyOptions, listYears } from "@/lib/ledger/queries";
import { PriorAssetForm } from "../PriorAssetForm";
import { savePriorAssetAction } from "../actions";
import { defaultBalanceYear } from "../defaults";

export const metadata = { title: "Lisää aiempi investointi" };

export default async function NewPriorAssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    return { client, years: await listYears(tx, id), properties: await listPropertyOptions(tx, id) };
  });
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title="Lisää aiempi investointi"
        subtitle={data.client.has_agriculture ? "Tie, oja, kone, rakennus tai maatalouden poistoryhmän menojäännös ennen Skogia" : "Tie, oja, kone tai rakennus, joka on hankittu ennen Skogia"}
        back={{ href: `/asiakkaat/${id}/investoinnit`, label: `${data.client.first_name} ${data.client.last_name}`.trim() }}
      />
      <FormError message={sp.virhe} />
      <Panel className="max-w-4xl">
        <PriorAssetForm
          action={savePriorAssetAction}
          clientId={id}
          defaultBalanceYear={defaultBalanceYear(data.years)}
          properties={data.properties}
          submitLabel="Lisää investointi"
          hasForestry={data.client.has_forestry}
          hasAgriculture={data.client.has_agriculture}
        />
      </Panel>
    </>
  );
}
