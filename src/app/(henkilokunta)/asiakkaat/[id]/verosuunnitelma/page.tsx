import { notFound } from "next/navigation";
import { EmptyState, Notice, PageHeader } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { loadPlanData } from "@/lib/tax/load";
import { loadAgriPlanData } from "@/lib/tax/agri-form-load";
import Link from "next/link";
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
    return {
      client, years, year, plan: year ? await loadPlanData(tx, id, year) : null,
      // Maatalousasiakkaalle suunnitelma kattaa myös maatalouden (lomake 2, yritystulon jako).
      agri: year && client.has_agriculture ? await loadAgriPlanData(tx, id, year) : null,
    };
  });
  if (!data) notFound();
  const { client: c, years, year, plan } = data;
  const closed = years.find((y) => y.year === year)?.status === "closed";

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Verosuunnitelma" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="verosuunnitelma" year={year} agriculture={c.has_agriculture} forestry={c.has_forestry} />
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
          {data.agri ? (
            <div className="mb-5">
              <Notice tone="info" title="Suunnitelma kattaa metsä- ja maatalouden.">
                Maatalouden poistot, tasausvaraus ja jakovaatimus tallentuvat samoihin tietoihin kuin{" "}
                <Link href={`/asiakkaat/${id}/maatalous?vuosi=${year}`} className="font-semibold text-sky">
                  Lomake 2 -välilehdellä
                </Link>
                , joten voit muuttaa niitä kummassa tahansa.
              </Notice>
            </div>
          ) : null}
          {closed ? (
            <div className="mb-5">
              <Notice tone="warn" title={`Verovuosi ${year} on suljettu.`}>Suunnitelma näkyy vahvistetuilla luvuilla eikä sitä voi muuttaa.</Notice>
            </div>
          ) : plan.confirmed || data.agri?.depreciationConfirmed ? (
            <div className="mb-5">
              <Notice tone="info" title="Vuodelle on vahvistettu suunnitelma.">Näet vahvistetut luvut. Voit muuttaa niitä ja vahvistaa uudelleen.</Notice>
            </div>
          ) : null}
          <PlanForm
            action={confirmPlanAction}
            clientId={id}
            year={year}
            data={plan}
            readOnly={closed}
            canClose={ctx.can("owner")}
            agri={data.agri}
            forestry={c.has_forestry}
          />
          <p className="mt-6 max-w-3xl text-xs text-ink/55">
            Säännöt perustuvat Verohallinnon ohjeisiin (tarkistettu 27.9.2026): metsävähennys enintään 60 % tai vuodesta 2026 75 % metsätalouden tuloista,
            poistot vapaaehtoisina menojäännöspoistoina ja koneiden myynnit luovutusvoittoina.
            {data.agri
              ? " Maatalouden yritystulo jaetaan pääoma- ja ansiotuloon edellisen vuoden nettovarallisuuden mukaan (tarkistettu 2.10.2026)."
              : null}
          </p>
        </>
      )}
    </>
  );
}
