import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { loadPlanData } from "@/lib/tax/load";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";
import { PlanForm } from "./PlanForm";
import { confirmPlanAction } from "./actions";

export const metadata = { title: "Verosuunnitelma" };

export default async function TaxPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vuosi?: string; virhe?: string; vahvistettu?: string }>;
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
    return { client, years, year, plan: year ? await loadPlanData(tx, id, year) : null };
  });
  if (!data) notFound();
  const { client: c, years, year, plan } = data;
  const closed = years.find((y) => y.year === year)?.status === "closed";

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Verosuunnitelma" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="verosuunnitelma" year={year} />
      <FormError message={sp.virhe} />
      {year === null || !plan ? (
        <EmptyState title="Ei verovuosia">Avaa verovuosi asiakkaan tiedoissa.</EmptyState>
      ) : (
        <>
          <YearNav years={years} year={year} basePath={`/asiakkaat/${id}/verosuunnitelma`} />
          {sp.vahvistettu ? (
            <div className="mb-5">
              <Notice tone="ok" title={sp.vahvistettu === "suljettu" ? `Suunnitelma vahvistettu ja vuosi ${year} suljettu.` : "Suunnitelma vahvistettu."} />
            </div>
          ) : null}
          {closed ? (
            <div className="mb-5">
              <Notice tone="warn" title={`Verovuosi ${year} on suljettu.`}>Suunnitelma näkyy vahvistetuilla luvuilla eikä sitä voi muuttaa.</Notice>
            </div>
          ) : plan.confirmed ? (
            <div className="mb-5">
              <Notice tone="info" title="Vuodelle on vahvistettu suunnitelma.">Näet vahvistetut luvut. Voit muuttaa niitä ja vahvistaa uudelleen.</Notice>
            </div>
          ) : null}
          <PlanForm action={confirmPlanAction} clientId={id} year={year} data={plan} readOnly={closed} canClose={ctx.can("owner")} />
          <p className="mt-6 max-w-3xl text-xs text-ink/55">
            Laskelma on arvio. Metsävähennyksen vuosiraja lasketaan puhtaasta pääomatulosta, ja menojäännöspoiston pohja on poistamaton arvo vuoden alussa.
            Säännöt vahvistetaan Verohallinnon ohjeista.
          </p>
        </>
      )}
    </>
  );
}
