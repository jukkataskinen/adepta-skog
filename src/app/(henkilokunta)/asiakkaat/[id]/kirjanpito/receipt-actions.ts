"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import { confirmYearReceipts, planYearReceipts, ReceiptError, type PlannedUpload } from "@/lib/documents/year-receipts";
import { dismissSuggestion, recognizableDocument } from "@/lib/documents/receipt-suggestions";
import { cancelRecognitionJob, findRecognitionJob, finishRecognitionJob, startRecognitionJob, type JobChunk } from "@/lib/documents/recognition-jobs";
import { receiptRecognizer, RECOGNIZE_MAX_BYTES } from "@/lib/ai/receipts";
import { NOT_RECOGNIZED, recognitionContext, recognitionError } from "@/lib/documents/recognize-chunk";
import type { Activity } from "@/lib/tax/rules";
import { estimateText, failedPagesText, planChunks } from "@/lib/ai/receipts/chunks";
import { countPdfPages } from "@/lib/ai/receipts/pdf";

const uuid = z.string().uuid();
const yearSchema = z.number().int().min(2000).max(2100);
const activitySchema = z.enum(["forestry", "agriculture"]).nullable().optional();

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
    const [d] = await tx.query<{ closed: boolean; storage_path: string; booked: number }>(
      `select exists (select 1 from sk_tax_years y where y.client_id = d.client_id and y.year = d.tax_year and y.status = 'closed') as closed, d.storage_path,
              (select count(*)::int from sk_transactions t where t.source_document_id = d.id) as booked
         from sk_documents d where d.id = $1 and d.client_id = $2 and d.kind = 'receipt' and d.transaction_id is null`,
      [documentId, clientId],
    );
    if (!d) fail(back, "Tositetta ei löytynyt.");
    if (d.closed) fail(back, "Suljetun vuoden tositetta ei voi poistaa.");
    // Kokoomatiedosto on kirjausten tosite: sitä ei poisteta niiden alta.
    if (d.booked) fail(back, `Tositteeseen viittaa ${d.booked === 1 ? "yksi kirjaus" : `${d.booked} kirjausta`}. Poista ensin kirjaukset, jos tosite on lisätty väärin.`);
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

export interface StartedRecognition {
  jobId: string;
  pageCount: number;
  chunks: JobChunk[];
  resumed: boolean;
  /** "40 sivua, 6 osaa, noin 2–3 min" (jatkettaessa jäljellä olevista osista) */
  estimate: string;
}

/**
 * Tunnistus osissa, vaihe 1: palasuunnitelma. Palvelin hakee tiedoston,
 * laskee sivut ja tekee palat (8 sivua, 1 sivun limitys) ja tallentaa kesken
 * olevan tunnistuksen, jota voi jatkaa keskeytyksen jälkeen. Kesken jäänyt
 * tunnistus jatkuu, ellei restart ole annettu. Tiedosto haetaan vasta
 * oikeuksien ja avoimen vuoden tarkistuksen jälkeen.
 */
export async function startRecognitionAction(input: {
  clientId: string;
  year: number;
  documentId: string;
  restart?: boolean;
  /** Näkymä, josta tunnistus aloitettiin: epäselvä tosite ehdotetaan tälle toiminnolle. */
  activity?: Activity | null;
}): Promise<Result<StartedRecognition>> {
  const ctx = await requireStaff();
  const actor = { organizationId: ctx.org.organizationId, userId: ctx.user.id };
  try {
    const clientId = uuid.parse(input.clientId);
    const year = yearSchema.parse(input.year);
    const documentId = uuid.parse(input.documentId);
    const doc = await ctx.run((tx) => recognizableDocument(tx, { clientId, year, documentId }));
    if (!input.restart) {
      const existing = await ctx.run((tx) => findRecognitionJob(tx, clientId, documentId));
      if (existing) {
        const left = existing.chunks.filter((c) => c.status !== "done").length;
        return { ok: true, value: { jobId: existing.id, pageCount: existing.pageCount, chunks: existing.chunks, resumed: true, estimate: estimateText(existing.pageCount, left) } };
      }
    }
    let pageCount = 1;
    if (doc.content_type === "application/pdf") {
      let bytes: Buffer;
      try {
        bytes = await getStorage().get(doc.storage_path);
      } catch {
        console.error("Tositteen tiedostoa ei saatu tunnistukseen", { documentId });
        return { ok: false, error: NOT_RECOGNIZED };
      }
      // Jäsentymätön PDF luetaan kokonaan yhtenä palana kuten ennen (sivumäärä 0 = ei tiedossa).
      pageCount = (await countPdfPages(bytes)) ?? 0;
      if (!pageCount && bytes.length > RECOGNIZE_MAX_BYTES["application/pdf"]) {
        return { ok: false, error: "Tiedostoa ei voitu jakaa osiin, ja se on liian suuri luettavaksi kerralla (enintään 20 Mt)." };
      }
    }
    const chunks = planChunks(pageCount);
    const recognizer = receiptRecognizer();
    const requested = activitySchema.parse(input.activity);
    const { job, resumed } = await ctx.run(async (tx) => {
      const context = await recognitionContext(tx, clientId, requested);
      return startRecognitionJob(tx, { actor, clientId, year, documentId, pageCount, chunks, model: recognizer.model, restart: input.restart, activity: context.defaultActivity });
    });
    revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
    return { ok: true, value: { jobId: job.id, pageCount: job.pageCount, chunks: job.chunks, resumed, estimate: estimateText(job.pageCount, job.chunks.length) } };
  } catch (err) {
    return { ok: false, error: recognitionError(err) };
  }
}

/**
 * Vaihe 2: palat luetaan reitillä /api/tunnistus/pala (src/lib/documents/recognize-chunk.ts),
 * koska selain ajaa server actionit jonossa eikä rinnakkain.
 */

export type FinishedRecognition =
  | { status: "done"; lines: number; byActivity: Partial<Record<Activity, number>> }
  | { status: "incomplete"; chunks: JobChunk[]; message: string | null };

/**
 * Vaihe 3: palat yhdeksi ehdotukseksi. Jos pala epäonnistui, palautetaan
 * "Sivuja … ei voitu lukea", ja käyttäjä voi yrittää uudelleen tai tehdä
 * ehdotuksen luetuista sivuista (allowPartial).
 */
export async function finishRecognitionAction(input: { clientId: string; jobId: string; allowPartial?: boolean }): Promise<Result<FinishedRecognition>> {
  const ctx = await requireStaff();
  const actor = { organizationId: ctx.org.organizationId, userId: ctx.user.id };
  try {
    const clientId = uuid.parse(input.clientId);
    const jobId = uuid.parse(input.jobId);
    const out = await ctx.run((tx) => finishRecognitionJob(tx, { actor, clientId, jobId, allowPartial: input.allowPartial === true }));
    revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
    if (out.status === "empty") return { ok: false, error: NOT_RECOGNIZED };
    if (out.status === "incomplete") return { ok: true, value: { status: "incomplete", chunks: out.chunks, message: failedPagesText(out.chunks) } };
    return { ok: true, value: { status: "done", lines: out.lines, byActivity: out.byActivity } };
  } catch (err) {
    return { ok: false, error: recognitionError(err) };
  }
}

/** Kesken olevan tunnistuksen peruutus (esimerkiksi aika-arvion jälkeen). Tosite jää ennalleen. */
export async function cancelRecognitionAction(input: { clientId: string; jobId: string }): Promise<Result<boolean>> {
  const ctx = await requireStaff();
  try {
    const clientId = uuid.parse(input.clientId);
    const jobId = uuid.parse(input.jobId);
    const done = await ctx.run((tx) => cancelRecognitionJob(tx, { clientId, jobId }));
    revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
    return { ok: true, value: done };
  } catch (err) {
    return { ok: false, error: recognitionError(err, "Tunnistusta ei voitu perua. Yritä uudelleen.") };
  }
}

/** Ehdotuksen hylkäys taulukosta. Tosite jää vuoden tositteeksi. */
export async function dismissSuggestionAction(input: { clientId: string; suggestionId: string }): Promise<Result<boolean>> {
  const ctx = await requireStaff();
  const actor = { organizationId: ctx.org.organizationId, userId: ctx.user.id };
  try {
    const clientId = uuid.parse(input.clientId);
    const suggestionId = uuid.parse(input.suggestionId);
    const done = await ctx.run((tx) => dismissSuggestion(tx, { actor, clientId, suggestionId }));
    revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
    return { ok: true, value: done };
  } catch (err) {
    if (err instanceof Error && /suljettu/.test(err.message)) return { ok: false, error: "Verovuosi on suljettu." };
    console.error("Ehdotuksen hylkäys epäonnistui", { error: err instanceof Error ? err.name : "tuntematon" });
    return { ok: false, error: "Ehdotusta ei voitu hylätä. Yritä uudelleen." };
  }
}
