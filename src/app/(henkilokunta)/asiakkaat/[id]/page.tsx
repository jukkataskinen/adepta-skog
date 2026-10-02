import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, DefinitionList, EmptyState, Input, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient, listProperties, listResponsibleOptions, listTaxYears } from "@/lib/clients/queries";
import { formatDate, formatEur, formatNumber } from "@/lib/format";
import { addTaxYearAction, setArchivedAction, setResponsibleAction, setTaxYearStatusAction } from "../actions";
import { ClientTabs } from "../ClientTabs";

export const metadata = { title: "Asiakas" };

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string; ilmoitus?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const owner = ctx.can("owner");
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    return {
      client,
      properties: await listProperties(tx, id),
      years: await listTaxYears(tx, id),
      options: owner ? await listResponsibleOptions(tx, ctx.org.organizationId) : [],
    };
  });
  if (!data) notFound();
  const { client: c, properties, years } = data;
  const address = [c.street, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const nextYear = years.length ? Math.max(...years.map((y) => y.year)) + 1 : new Date().getFullYear();

  return (
    <>
      <PageHeader
        title={`${c.first_name} ${c.last_name}`.trim()}
        subtitle={c.archived_at ? `Arkistoitu ${formatDate(c.archived_at)}` : c.municipality ?? undefined}
        back={{ href: "/asiakkaat", label: "Asiakkaat" }}
        actions={
          <LinkButton href={`/asiakkaat/${id}/muokkaa`} variant="secondary">
            Muokkaa
          </LinkButton>
        }
      />
      <ClientTabs clientId={id} active="tiedot" agriculture={c.has_agriculture} forestry={c.has_forestry} />
      <FormError message={sp.virhe} />
      {sp.ilmoitus === "tallennettu" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Tallennettu." />
        </div>
      ) : null}

      <Panel>
        <DefinitionList
          items={[
            { label: "Y-tunnus", value: c.business_id },
            { label: "Kotikunta", value: c.municipality },
            { label: "Sähköposti", value: c.email },
            { label: "Puhelin", value: c.phone },
            { label: "Osoite", value: address || null },
            { label: "Verotilin viite", value: c.tax_account_reference },
            { label: "Toiminnot", value: [c.has_forestry || !c.has_agriculture ? "Metsätalous" : null, c.has_agriculture ? "Maatalous" : null].filter(Boolean).join(", ") },
            { label: "Arvonlisävero", value: c.vat_registered ? (c.vat_number ? `Rekisterissä, ${c.vat_number}` : "Rekisterissä") : "Ei rekisterissä" },
            { label: "Vastuukirjanpitäjä", value: c.responsible_name ?? "Ei valittu" },
          ]}
        />
        {owner ? (
          <form action={setResponsibleAction} className="mt-5 flex flex-wrap items-end gap-3 border-t border-line pt-5">
            <input type="hidden" name="clientId" value={id} />
            <div className="min-w-64">
              <label htmlFor="responsibleUserId" className="text-sm font-semibold">
                Vaihda vastuukirjanpitäjä
              </label>
              <Select id="responsibleUserId" name="responsibleUserId" defaultValue={c.responsible_user_id ?? ""} className="mt-1">
                <option value="">Ei valittu</option>
                {data.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="secondary">Tallenna</Button>
          </form>
        ) : null}
      </Panel>

      <section id="metsatilat" className="mt-10 scroll-mt-6">
        <SectionTitle actions={<LinkButton href={`/asiakkaat/${id}/metsatilat/uusi`} variant="secondary">Lisää metsätila</LinkButton>}>Metsätilat</SectionTitle>
        {properties.length === 0 ? (
          <EmptyState title="Ei metsätiloja">Lisää tila, niin metsävähennyksen pohja lasketaan.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Tila</Th>
                <Th>Kiinteistötunnus</Th>
                <Th numeric>Pinta-ala</Th>
                <Th numeric>Hankintahinta</Th>
                <Th numeric>Vähennyspohja</Th>
                <Th numeric>Käytetty</Th>
                <Th numeric>Jäljellä</Th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => (
                <tr key={p.id} className="row-link hover:bg-cloud/50">
                  <Td>
                    <Link href={`/asiakkaat/${id}/metsatilat/${p.id}`} className="row-link-main font-semibold">
                      {p.name}
                    </Link>
                    {p.sold_share_pct > 0 ? (
                      <span className="ml-2 text-xs text-ink/55">
                        {p.sold_share_pct >= 100 ? "Myyty" : `Myyty ${p.sold_share_pct.toLocaleString("fi-FI", { maximumFractionDigits: 2 })} %`}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="tabular">{p.property_code ?? "–"}</Td>
                  <Td numeric>{p.area_ha ? formatNumber(p.area_ha, "ha") : "–"}</Td>
                  <Td numeric>{p.acquisition_price ? formatEur(p.acquisition_price) : "–"}</Td>
                  <Td numeric>{p.deduction.base === null ? <span className="text-ink/50">Tiedot puuttuvat</span> : formatEur(p.deduction.base)}</Td>
                  <Td numeric>{formatEur(p.deduction.used)}</Td>
                  <Td numeric className="font-semibold">
                    {p.deduction.remaining === null ? "–" : formatEur(p.deduction.remaining)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section id="verovuodet" className="mt-10 scroll-mt-6">
        <SectionTitle>Verovuodet</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Th>Vuosi</Th>
              <Th>Tila</Th>
              <Th numeric>Kirjauksia</Th>
              <Th>Suljettu</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.id}>
                <Td className="tabular font-semibold">{y.year}</Td>
                <Td>{y.status === "open" ? <Badge tone="ok">Avoin</Badge> : <Badge tone="warn">Suljettu</Badge>}</Td>
                <Td numeric>{y.transaction_count}</Td>
                <Td>{y.closed_at ? `${formatDate(y.closed_at)}${y.closed_by_name ? `, ${y.closed_by_name}` : ""}` : "–"}</Td>
                <Td className="text-right">
                  {owner ? (
                    <form action={setTaxYearStatusAction}>
                      <input type="hidden" name="clientId" value={id} />
                      <input type="hidden" name="yearId" value={y.id} />
                      <input type="hidden" name="status" value={y.status === "open" ? "closed" : "open"} />
                      <button className={`text-sm font-semibold ${y.status === "open" ? "text-sky" : "text-coral"}`}>
                        {y.status === "open" ? "Sulje vuosi" : "Avaa vuosi"}
                      </button>
                    </form>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <form action={addTaxYearAction} className="mt-4 flex items-end gap-3">
          <input type="hidden" name="clientId" value={id} />
          <div className="w-32">
            <label htmlFor="year" className="text-sm font-semibold">
              Uusi vuosi
            </label>
            <Input id="year" name="year" inputMode="numeric" defaultValue={nextYear} className="mt-1" />
          </div>
          <Button variant="secondary">Avaa vuosi</Button>
        </form>
        <p className="mt-2 text-xs text-ink/55">Suljetun vuoden kirjauksia, poistoja ja metsävähennyksiä ei voi muuttaa. Vain pääkäyttäjä voi sulkea ja avata vuoden.</p>
      </section>

      {owner ? (
        <form action={setArchivedAction} className="mt-10 border-t border-line pt-5">
          <input type="hidden" name="clientId" value={id} />
          <input type="hidden" name="archived" value={c.archived_at ? "0" : "1"} />
          <button className="text-sm font-semibold text-coral">{c.archived_at ? "Palauta asiakas" : "Arkistoi asiakas"}</button>
          <p className="mt-1 text-xs text-ink/55">Arkistoitu asiakas piiloutuu listasta. Tiedot säilyvät.</p>
        </form>
      ) : null}
    </>
  );
}
