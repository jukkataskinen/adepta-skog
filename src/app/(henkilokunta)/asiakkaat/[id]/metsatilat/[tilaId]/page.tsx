import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient, getProperty } from "@/lib/clients/queries";
import { PropertyForm } from "../../../PropertyForm";
import { deletePropertyAction, updatePropertyAction } from "../../../actions";

export const metadata = { title: "Metsätila" };

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tilaId: string }>;
  searchParams: Promise<{ virhe?: string }>;
}) {
  const { id, tilaId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(tilaId)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => ({ client: await getClient(tx, ctx.org.organizationId, id), property: await getProperty(tx, id, tilaId) }));
  if (!data.client || !data.property) notFound();
  return (
    <>
      <PageHeader title={data.property.name} back={{ href: `/asiakkaat/${id}#metsatilat`, label: `${data.client.first_name} ${data.client.last_name}` }} />
      <FormError message={sp.virhe} />
      <Panel className="max-w-3xl">
        <PropertyForm action={updatePropertyAction} clientId={id} property={data.property} submitLabel="Tallenna" />
      </Panel>
      <form action={deletePropertyAction} className="mt-6">
        <input type="hidden" name="clientId" value={id} />
        <input type="hidden" name="propertyId" value={tilaId} />
        <button className="text-sm font-semibold text-coral">Poista metsätila</button>
        <p className="mt-1 text-xs text-ink/55">Tilan metsävähennykset poistuvat samalla. Suljetun vuoden vähennys estää poiston.</p>
      </form>
    </>
  );
}
