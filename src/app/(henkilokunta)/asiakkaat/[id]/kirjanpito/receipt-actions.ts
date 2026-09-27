"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import { confirmYearReceipts, planYearReceipts, ReceiptError, type PlannedUpload } from "@/lib/documents/year-receipts";

const uuid = z.string().uuid();
const yearSchema = z.number().int().min(2000).max(2100);

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function toError(err: unknown): string {
  if (err instanceof ReceiptError) return err.message;
  if (err instanceof Error && /row-level security/.test(err.message)) return "Sinulla ei ole oikeutta tähän asiakkaaseen.";
  // Muut virheet lokiin ilman tiedostonimiä, käyttäjälle yleinen viesti.
  console.error("Tositteiden lataus epäonnistui", { error: err instanceof Error ? err.name : "tuntematon" });
  return "Tositteiden lataus epäonnistui. Yritä uudelleen.";
}

/** Vaihe 1: oikeuksien ja vuoden tarkistus sekä latausosoitteet. */
export async function planYearReceiptsAction(input: {
  clientId: string;
  year: number;
  files: { name: string; size: number; type: string }[];
}): Promise<Result<PlannedUpload[]>> {
  const ctx = await requireStaff();
  try {
    const clientId = uuid.parse(input.clientId);
    const year = yearSchema.parse(input.year);
    const files = input.files.slice(0, 50).map((f) => ({ name: String(f.name), size: Number(f.size), type: String(f.type) }));
    const uploads = await ctx.run((tx) => planYearReceipts(tx, { organizationId: ctx.org.organizationId, clientId, year, files }));
    return { ok: true, value: uploads };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Vaihe 2: ladatut tiedostot kantaan ja lokiin. */
export async function confirmYearReceiptsAction(input: {
  clientId: string;
  year: number;
  uploads: { id: string; fileName: string; contentType: string }[];
}): Promise<Result<number>> {
  const ctx = await requireStaff();
  try {
    const clientId = uuid.parse(input.clientId);
    const year = yearSchema.parse(input.year);
    const uploads = input.uploads.map((u) => ({ id: uuid.parse(u.id), fileName: String(u.fileName).slice(0, 200), contentType: String(u.contentType) }));
    const saved = await ctx.run((tx) => confirmYearReceipts(tx, { organizationId: ctx.org.organizationId, clientId, year, userId: ctx.user.id, uploads }));
    revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
    revalidatePath(`/asiakkaat/${clientId}/raportti`);
    return { ok: true, value: saved };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Vuoden tositteen poisto. Suljetun vuoden tositetta ei poisteta, koska kirjanpitoaineisto säilytetään. */
export async function deleteYearReceiptAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const documentId = uuid.parse(formData.get("documentId"));
  const year = Number(formData.get("year"));
  const back = `/asiakkaat/${clientId}/kirjanpito?vuosi=${year}`;
  const storagePath = await ctx.run(async (tx) => {
    const [d] = await tx.query<{ closed: boolean; storage_path: string }>(
      `select exists (select 1 from sk_tax_years y where y.client_id = d.client_id and y.year = d.tax_year and y.status = 'closed') as closed, d.storage_path
         from sk_documents d where d.id = $1 and d.client_id = $2 and d.kind = 'receipt' and d.transaction_id is null`,
      [documentId, clientId],
    );
    if (!d) fail(back, "Tositetta ei löytynyt.");
    if (d.closed) fail(back, "Suljetun vuoden tositetta ei voi poistaa.");
    await tx.query("delete from sk_documents where id = $1", [documentId]);
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "document.delete", entity: "sk_documents", entityId: documentId });
    return d.storage_path;
  });
  // Tiedosto poistetaan vasta, kun rivin poisto on tallentunut (kuten kirjauksen tositteessa).
  try {
    await getStorage().remove(storagePath);
  } catch (err) {
    console.error("Tositteen tiedoston poisto epäonnistui", { documentId, error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(back);
  redirect(`${back}#tositteet`);
}
