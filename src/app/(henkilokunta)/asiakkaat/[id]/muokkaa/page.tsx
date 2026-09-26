import { notFound } from "next/navigation";
import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { ClientForm } from "../../ClientForm";
import { updateClientAction } from "../../actions";

export const metadata = { title: "Muokkaa asiakasta" };

export default async function EditClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const client = await ctx.run((tx) => getClient(tx, ctx.org.organizationId, id));
  if (!client) notFound();
  return (
    <>
      <PageHeader title="Muokkaa asiakasta" back={{ href: `/asiakkaat/${id}`, label: `${client.first_name} ${client.last_name}` }} />
      <FormError message={sp.virhe} />
      <Panel className="max-w-3xl">
        <ClientForm action={updateClientAction} client={client} submitLabel="Tallenna" />
      </Panel>
    </>
  );
}
