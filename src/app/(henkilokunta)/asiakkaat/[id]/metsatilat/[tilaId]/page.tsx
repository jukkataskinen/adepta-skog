import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Field, Input, PageHeader, Panel, SectionTitle, Table, Td, Textarea, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient, getProperty, listDisposals, type DisposalRow } from "@/lib/clients/queries";
import { formatDate, formatEur, formatNumber } from "@/lib/format";
import { PropertyForm } from "../../../PropertyForm";
import { deleteDisposalAction, deletePropertyAction, saveDisposalAction, updatePropertyAction } from "../../../actions";

export const metadata = { title: "Metsätila" };

// Lomakkeella luvut näytetään suomalaisittain pilkulla.
const fi = (v: string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)).replace(".", ","));

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; tilaId: string }>;
  searchParams: Promise<{ virhe?: string; luovutus?: string }>;
}) {
  const { id, tilaId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(tilaId)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => ({
    client: await getClient(tx, ctx.org.organizationId, id),
    property: await getProperty(tx, id, tilaId),
    disposals: await listDisposals(tx, id, tilaId),
  }));
  if (!data.client || !data.property) notFound();
  const sold = data.disposals.reduce((s, d) => s + Number(d.share_pct), 0);
  // Muokata voi vain avoimen vuoden luovutusta, kuten kirjausta.
  const editing = data.disposals.find((d) => d.id === sp.luovutus && d.year_status === "open") ?? null;
  const left = Math.round((100 - sold + (editing ? Number(editing.share_pct) : 0)) * 100) / 100;
  const back = `/asiakkaat/${id}/metsatilat/${tilaId}`;

  return (
    <>
      <PageHeader title={data.property.name} back={{ href: `/asiakkaat/${id}#metsatilat`, label: `${data.client.first_name} ${data.client.last_name}` }} />
      <FormError message={sp.virhe} />
      <Panel className="max-w-3xl">
        <PropertyForm action={updatePropertyAction} clientId={id} property={data.property} submitLabel="Tallenna" />
      </Panel>

      <section id="luovutukset" className="mt-8 max-w-3xl">
        <SectionTitle>Myynnit ja luovutukset</SectionTitle>
        {data.disposals.length ? (
          <div className="mb-5">
            <Table>
              <thead>
                <tr>
                  <Th>Päivä</Th>
                  <Th numeric>Osuus</Th>
                  <Th numeric>Kauppahinta</Th>
                  <Th numeric>Myyntikulut</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.disposals.map((d) => (
                  <DisposalItem key={d.id} d={d} clientId={id} propertyId={tilaId} />
                ))}
              </tbody>
            </Table>
          </div>
        ) : (
          <p className="mb-5 text-sm text-ink/65">Tilasta ei ole myyty mitään.</p>
        )}

        {left > 0 ? (
          <Panel>
            <form action={saveDisposalAction} className="grid gap-5">
              <input type="hidden" name="clientId" value={id} />
              <input type="hidden" name="propertyId" value={tilaId} />
              {editing ? <input type="hidden" name="disposalId" value={editing.id} /> : null}
              <p className="font-semibold">{editing ? "Muokkaa luovutusta" : sold > 0 ? "Uusi luovutus" : "Tilan tai sen osan myynti"}</p>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Luovutuspäivä" htmlFor="disposedOn" hint="Lopullisen kauppakirjan päivä.">
                  <Input id="disposedOn" name="disposedOn" type="date" defaultValue={editing?.disposed_on ?? ""} required />
                </Field>
                <Field label="Kauppahinta (€)" htmlFor="salePrice">
                  <Input id="salePrice" name="salePrice" inputMode="decimal" defaultValue={fi(editing?.sale_price)} required />
                </Field>
                <Field label="Myyty osuus (%)" htmlFor="sharePct" hint={`Osuus tilan hankintamenosta, enintään ${formatNumber(left)} %.`}>
                  <Input id="sharePct" name="sharePct" inputMode="decimal" defaultValue={editing ? fi(editing.share_pct) : fi(String(left))} required />
                </Field>
              </div>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field label="Myyntikulut (€)" htmlFor="sellingCosts" hint="Esimerkiksi välityspalkkio ja lohkomisen kulut.">
                  <Input id="sellingCosts" name="sellingCosts" inputMode="decimal" defaultValue={fi(editing?.selling_costs ?? "0")} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Lisätieto" htmlFor="note" hint="Esimerkiksi määräalan nimi tai pinta-ala.">
                    <Textarea id="note" name="note" rows={2} defaultValue={editing?.note ?? ""} />
                  </Field>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="noDeductionAddition" defaultChecked={editing?.no_deduction_addition ?? false} className="size-4" />
                Lahja tai verovapaa luovutus, esimerkiksi sukupolvenvaihdos: metsävähennystä ei lisätä luovutusvoittoon
              </label>
              <p className="text-sm text-ink/65">
                Jos myyt vain osan, osuus on myydyn osan osuus tilan hankintamenosta. Jos sitä ei tiedetä, laske se metsämaan pinta-aloista. Laskelma näkyy
                myyntivuoden verosuunnitelmassa.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <Button>{editing ? "Tallenna luovutus" : "Lisää luovutus"}</Button>
                {editing ? (
                  <Link href={`${back}#luovutukset`} className="text-sm font-semibold text-sky">
                    Peruuta
                  </Link>
                ) : null}
              </div>
            </form>
          </Panel>
        ) : (
          <p className="text-sm text-ink/65">Koko tila on myyty.</p>
        )}
      </section>

      <form action={deletePropertyAction} className="mt-8">
        <input type="hidden" name="clientId" value={id} />
        <input type="hidden" name="propertyId" value={tilaId} />
        <button className="text-sm font-semibold text-coral">Poista metsätila</button>
        <p className="mt-1 text-xs text-ink/55">
          Tilan metsävähennykset ja luovutukset poistuvat samalla. Suljetun vuoden vähennys tai luovutus estää poiston. Myytyä tilaa ei poisteta.
        </p>
      </form>
    </>
  );
}

function DisposalItem({ d, clientId, propertyId }: { d: DisposalRow; clientId: string; propertyId: string }) {
  return (
    <tr>
      <Td>
        {formatDate(d.disposed_on)}
        {d.no_deduction_addition ? <span className="ml-2 text-xs text-ink/55">Lahja tai verovapaa</span> : null}
        {d.note ? <p className="text-xs text-ink/55">{d.note}</p> : null}
      </Td>
      <Td numeric>{formatNumber(d.share_pct)} %</Td>
      <Td numeric>{formatEur(d.sale_price)}</Td>
      <Td numeric>{formatEur(d.selling_costs)}</Td>
      <Td className="text-right">
        {d.year_status === "open" ? (
          <div className="flex flex-wrap justify-end gap-3 text-sm">
            <Link href={`/asiakkaat/${clientId}/verosuunnitelma?vuosi=${d.tax_year}`} className="font-semibold text-sky">
              Laskelma
            </Link>
            <Link href={`/asiakkaat/${clientId}/metsatilat/${propertyId}?luovutus=${d.id}#luovutukset`} className="font-semibold text-sky">
              Muokkaa
            </Link>
            <form action={deleteDisposalAction}>
              <input type="hidden" name="clientId" value={clientId} />
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="hidden" name="disposalId" value={d.id} />
              <button className="font-semibold text-coral">Poista</button>
            </form>
          </div>
        ) : (
          <Badge tone={d.year_status === "closed" ? "neutral" : "warn"}>{d.year_status === "closed" ? `Vuosi ${d.tax_year} suljettu` : `Vuotta ${d.tax_year} ei ole avattu`}</Badge>
        )}
      </Td>
    </tr>
  );
}
