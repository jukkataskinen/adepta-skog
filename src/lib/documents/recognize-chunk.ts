import "server-only";
import { z } from "zod";
import type { StaffContext } from "@/lib/auth/current-user";
import type { Sql } from "@/lib/db/types";
import { getStorage } from "@/lib/storage";
import { receiptRecognizer, recognizeChunk, type RecognitionContext, type RecognizeOutcome } from "@/lib/ai/receipts";
import { activitiesOf, ledgerView, type Activity } from "@/lib/tax/rules";
import { recognizableDocument, SuggestionError } from "./receipt-suggestions";
import { jobChunk, storeChunkResult, type JobChunk } from "./recognition-jobs";

/**
 * Yhden palan tunnistus (DECISIONS 28.9.2026 ja 2.10.2026). Sama toteutus
 * palvelee reittiä /api/tunnistus/pala, jota selain kutsuu rinnakkain.
 * Server action ei käy tähän, koska Next.js ajaa selaimen server actionit
 * jonossa yksi kerrallaan, jolloin CHUNK_PARALLEL ei toteutunut.
 */

const uuid = z.string().uuid();
export const chunkRequestSchema = z.object({
  clientId: uuid,
  year: z.number().int().min(2000).max(2100),
  jobId: uuid,
  index: z.number().int().min(0).max(400),
});
export type ChunkRequest = z.infer<typeof chunkRequestSchema>;

export const NOT_RECOGNIZED = "Tositetta ei voitu tunnistaa. Voit kirjata sen käsin taulukkoon.";

/** Asiakkaan toiminnot tunnistusta varten. Oletus on näkymä, jos asiakkaalla on se toiminto. */
export async function recognitionContext(tx: Sql, clientId: string, requested: Activity | null | undefined): Promise<RecognitionContext> {
  const [c] = await tx.query<{ has_forestry: boolean; has_agriculture: boolean }>("select has_forestry, has_agriculture from sk_clients where id = $1", [clientId]);
  const client = { hasForestry: c?.has_forestry ?? true, hasAgriculture: c?.has_agriculture ?? false };
  const activities = activitiesOf(client);
  const view = ledgerView(client, requested === "agriculture" ? "maatalous" : null);
  return { activities, defaultActivity: requested && activities.includes(requested) ? requested : (view ?? "forestry") };
}

export function recognitionError(err: unknown, fallback = NOT_RECOGNIZED): string {
  if (err instanceof SuggestionError) return err.message;
  if (err instanceof Error && /row-level security/.test(err.message)) return "Sinulla ei ole oikeutta tähän asiakkaaseen.";
  if (err instanceof Error && /suljettu/.test(err.message)) return "Verovuosi on suljettu, joten tositteita ei tunnisteta.";
  console.error("Tositteen tunnistus epäonnistui", { error: err instanceof Error ? err.name : "tuntematon" });
  return fallback;
}

/**
 * Tiedosto haetaan, palan sivut erotetaan ja tulos tallennetaan kesken olevaan
 * tunnistukseen. Tietokantatransaktio ei ole auki tunnistuksen aikana. Selain
 * yrittää epäonnistunutta palaa kerran uudelleen.
 */
export async function runRecognitionChunk(ctx: StaffContext, input: ChunkRequest): Promise<{ ok: true; value: JobChunk } | { ok: false; error: string }> {
  try {
    const { clientId, year, jobId, index } = chunkRequestSchema.parse(input);
    const { chunk, status, attempts, doc, context } = await ctx.run(async (tx) => {
      const c = await jobChunk(tx, { clientId, jobId, index });
      // Oletustoiminto on tallennettu tunnistukseen, joten jatko toisesta näkymästä käyttää samaa.
      return { ...c, doc: await recognizableDocument(tx, { clientId, year, documentId: c.documentId }), context: await recognitionContext(tx, clientId, c.activity) };
    });
    if (status === "done") return { ok: true, value: { first: chunk.first, last: chunk.last, status, attempts } };
    let result: RecognizeOutcome;
    try {
      const bytes = await getStorage().get(doc.storage_path);
      result = await recognizeChunk(receiptRecognizer(), { bytes, contentType: doc.content_type, fileName: doc.file_name }, chunk, context);
    } catch {
      console.error("Tositteen tiedostoa ei saatu tunnistukseen", { documentId: doc.id });
      result = { ok: false };
    }
    const saved = await ctx.run((tx) => storeChunkResult(tx, { clientId, jobId, index, result: result.ok ? { ok: true, lines: result.lines } : { ok: false } }));
    return { ok: true, value: saved };
  } catch (err) {
    return { ok: false, error: recognitionError(err) };
  }
}
