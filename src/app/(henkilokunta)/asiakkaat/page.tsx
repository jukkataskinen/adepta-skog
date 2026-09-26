import Link from "next/link";
import { Badge, Button, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { listClients } from "@/lib/clients/queries";

export const metadata = { title: "Asiakkaat" };

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; arkisto?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const archived = sp.arkisto === "1";
  const rows = await ctx.run((tx) => listClients(tx, ctx.org.organizationId, { q: sp.q, archived }));

  return (
    <>
      <PageHeader
        title={archived ? "Arkistoidut asiakkaat" : "Asiakkaat"}
        subtitle={ctx.can("owner") ? "Kaikki toimiston asiakkaat" : "Asiakkaat, joiden vastuukirjanpitäjä olet"}
        actions={<LinkButton href="/asiakkaat/uusi">Lisää asiakas</LinkButton>}
      />
      <form className="mb-5 flex flex-wrap items-center gap-3" role="search">
        {archived ? <input type="hidden" name="arkisto" value="1" /> : null}
        <label htmlFor="q" className="sr-only">
          Hae
        </label>
        <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Nimi, Y-tunnus tai kunta" className="max-w-sm" />
        <Button variant="secondary">Hae</Button>
        <Link href={archived ? "/asiakkaat" : "/asiakkaat?arkisto=1"} className="text-sm font-semibold text-sky">
          {archived ? "Näytä nykyiset asiakkaat" : "Näytä arkistoidut"}
        </Link>
      </form>
      {rows.length === 0 ? (
        <EmptyState title={sp.q ? "Ei hakutuloksia" : "Ei asiakkaita"}>{sp.q ? "Kokeile toista hakua." : "Lisää ensimmäinen asiakas."}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Nimi</Th>
              <Th>Kunta</Th>
              <Th numeric>Metsätiloja</Th>
              <Th>Avoin vuosi</Th>
              <Th>Vastuukirjanpitäjä</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="row-link hover:bg-cloud/50">
                <Td>
                  <Link href={`/asiakkaat/${c.id}`} className="row-link-main font-semibold">
                    {c.name}
                  </Link>
                  {c.vat_registered ? (
                    <span className="ml-2">
                      <Badge>ALV</Badge>
                    </span>
                  ) : null}
                </Td>
                <Td>{c.municipality ?? "–"}</Td>
                <Td numeric>{c.property_count}</Td>
                <Td className="tabular">{c.open_year ?? "–"}</Td>
                <Td>{c.responsible_name ?? <span className="text-ink/50">Ei valittu</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
