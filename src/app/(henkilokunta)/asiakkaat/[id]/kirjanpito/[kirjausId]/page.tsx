import { notFound } from "next/navigation";
import { Button, Notice, PageHeader, Panel, SectionTitle } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { getTransaction, listAssets, listTransactionDocuments, listYears } from "@/lib/ledger/queries";
import { formatDateTime, formatNumber } from "@/lib/format";
import { TransactionForm } from "../TransactionForm";
import { deleteDocumentAction, deleteTransactionAction, saveTransactionAction, uploadReceiptAction } from "../actions";

export const metadata = { title: "Kirjaus" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function TransactionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; kirjausId: string }>;
  searchParams: Promise<{ virhe?: string }>;
}) {
  const { id, kirjausId } = await params;
  const sp = await searchParams;
  if (!UUID.test(id) || !UUID.test(kirjausId)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    const transaction = client ? await getTransaction(tx, id, kirjausId) : null;
    if (!client || !transaction) return null;
    return {
      client,
      transaction,
      documents: await listTransactionDocuments(tx, kirjausId),
      assets: await listAssets(tx, id),
      years: await listYears(tx, id),
    };
  });
  if (!data) notFound();
  const { transaction: t } = data;
  const closed = data.years.find((y) => y.year === t.tax_year)?.status === "closed";
  const back = { href: `/asiakkaat/${id}/kirjanpito?vuosi=${t.tax_year}`, label: `Kirjanpito ${t.tax_year}` };

  return (
    <>
      <PageHeader title="Kirjaus" subtitle={`${data.client.first_name} ${data.client.last_name}`.trim()} back={back} />
      <FormError message={sp.virhe} />
      {closed ? (
        <div className="mb-5">
          <Notice tone="warn" title={`Verovuosi ${t.tax_year} on suljettu.`}>Kirjausta ja sen tositteita ei voi muuttaa.</Notice>
        </div>
      ) : null}

      <Panel className="max-w-4xl">
        {closed ? (
          <fieldset disabled className="opacity-70">
            <TransactionForm action={saveTransactionAction} clientId={id} transaction={{ ...t, document_count: 0 }} assets={data.assets} defaultDate={t.booked_on} submitLabel="Tallenna" />
          </fieldset>
        ) : (
          <TransactionForm action={saveTransactionAction} clientId={id} transaction={{ ...t, document_count: 0 }} assets={data.assets} defaultDate={t.booked_on} submitLabel="Tallenna" />
        )}
      </Panel>

      <section className="mt-8 max-w-4xl">
        <SectionTitle>Tositteet</SectionTitle>
        <Panel>
          {data.documents.length === 0 ? <p className="text-sm text-ink/65">Ei tositteita.</p> : null}
          <ul className="divide-y divide-line">
            {data.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                <a href={`/asiakkaat/${id}/tositteet/${d.id}`} className="font-semibold text-sky hover:underline" target="_blank" rel="noreferrer">
                  {d.file_name}
                </a>
                <span className="text-sm text-ink/55">
                  {formatNumber(Math.ceil(d.size_bytes / 1024), "kt")} · {formatDateTime(d.created_at)}
                </span>
                {!closed ? (
                  <form action={deleteDocumentAction}>
                    <input type="hidden" name="clientId" value={id} />
                    <input type="hidden" name="transactionId" value={t.id} />
                    <input type="hidden" name="documentId" value={d.id} />
                    <button className="text-sm font-semibold text-coral">Poista</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {!closed ? (
            <form action={uploadReceiptAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <input type="hidden" name="clientId" value={id} />
              <input type="hidden" name="transactionId" value={t.id} />
              <div>
                <label htmlFor="file" className="text-sm font-semibold">
                  Lisää tosite
                </label>
                <input id="file" name="file" type="file" accept="application/pdf,image/*" required className="mt-1 block text-sm" />
              </div>
              <Button variant="secondary">Tallenna tosite</Button>
              <p className="w-full text-xs text-ink/55">PDF tai kuva, enintään 4 Mt.</p>
            </form>
          ) : null}
        </Panel>
      </section>

      {!closed ? (
        <form action={deleteTransactionAction} className="mt-8">
          <input type="hidden" name="clientId" value={id} />
          <input type="hidden" name="transactionId" value={t.id} />
          <button className="text-sm font-semibold text-coral">Poista kirjaus</button>
          <p className="mt-1 text-xs text-ink/55">Kirjaus ja sen tositteet poistuvat. Poisto jää lokiin.</p>
        </form>
      ) : null}
    </>
  );
}
