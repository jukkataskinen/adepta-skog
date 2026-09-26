import { PageHeader, Panel } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { listResponsibleOptions } from "@/lib/clients/queries";
import { ClientForm } from "../ClientForm";
import { createClientAction } from "../actions";

export const metadata = { title: "Uusi asiakas" };

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ virhe?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const options = ctx.can("owner") ? await ctx.run((tx) => listResponsibleOptions(tx, ctx.org.organizationId)) : undefined;
  return (
    <>
      <PageHeader title="Uusi asiakas" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <FormError message={sp.virhe} />
      <Panel className="max-w-3xl">
        <ClientForm action={createClientAction} submitLabel="Lisää asiakas" responsibleOptions={options} />
      </Panel>
    </>
  );
}
