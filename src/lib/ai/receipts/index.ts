import "server-only";
import { anthropicRecognizer } from "./anthropic";
import { mockRecognizer } from "./mock";
import { isWholeFile, type ChunkRange } from "./chunks";
import { CHUNK_TIMEOUT_MS } from "./config";
import { extractPdfPages } from "./pdf";
import type { RecognitionResult } from "./schema";
import type { Activity } from "@/lib/tax/rules";

/**
 * Tositteiden tunnistus (tekoäly). Tilat ympäristömuuttujasta AI_MODE:
 *   mock       oletus: tositetta ei lähetetä minnekään, ehdotus tiedostonimestä
 *   anthropic  Claude (ANTHROPIC_API_KEY, malli AI_RECEIPTS_MODEL tai oletus)
 * Jos tila on anthropic mutta avain puuttuu, käytetään testitilaa, jotta
 * puuttuva avain ei kaada sivua (CLAUDE.md: mock on oletus, kun avain puuttuu).
 *
 * Tunnistus ei koskaan heitä virhettä kutsujalle: epäonnistunut tunnistus on
 * { ok: false }, ja käyttöliittymä kertoo, ettei tositetta voitu tunnistaa.
 */

export interface ReceiptFile {
  bytes: Buffer;
  contentType: string;
  /** Vain testitila käyttää nimeä. Oikealle palvelulle nimeä ei lähetetä. */
  fileName: string;
}

/**
 * Asiakkaan toiminnot ja oletustoiminto (näkymä, josta tunnistus aloitettiin).
 * Palveluun lähtee vain tämä tieto, ei asiakkaan nimeä eikä muita tietoja.
 * Puuttuva = pelkkä metsätalous kuten ennen.
 */
export interface RecognitionContext {
  activities: Activity[];
  defaultActivity: Activity;
}

export const FORESTRY_CONTEXT: RecognitionContext = { activities: ["forestry"], defaultActivity: "forestry" };

export interface ReceiptRecognizer {
  mode: "mock" | "anthropic";
  /** Tallennetaan ehdotukseen, jotta tiedetään, mikä malli ehdotuksen teki. */
  model: string;
  /**
   * Ilman palaa: koko tiedosto, maksurivit poistettu (validateRecognition).
   * Palan kanssa: tiedosto on palan sivut, sivut palautetaan koko tiedoston
   * numeroinnissa ja asiakirjan loppusumma säilyy yhdistämistä varten.
   */
  recognize(file: ReceiptFile, signal?: AbortSignal, chunk?: ChunkRange, context?: RecognitionContext): Promise<RecognitionResult>;
}

/**
 * Palvelun rajat lähetettävälle tiedostolle tai palalle: kuva enintään 5 Mt,
 * PDF-pyyntö enintään 32 Mt (base64 kasvattaa kolmanneksella).
 */
export const RECOGNIZE_MAX_BYTES: Record<string, number> = {
  "application/pdf": 20 * 1024 * 1024,
  "image/jpeg": 5 * 1024 * 1024,
  "image/png": 5 * 1024 * 1024,
};

export type RecognizeOutcome = RecognitionResult | { ok: false; reason: "too_large" | "unsupported" };

export function receiptRecognizer(env: Record<string, string | undefined> = process.env): ReceiptRecognizer {
  if (env.AI_MODE === "anthropic" && env.ANTHROPIC_API_KEY) {
    return anthropicRecognizer({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_RECEIPTS_MODEL });
  }
  return mockRecognizer();
}

/** Tunnistus aikarajalla. Aikarajan ylitys ja virheet palautetaan epäonnistumisena. */
export async function recognizeReceipt(
  recognizer: ReceiptRecognizer,
  file: ReceiptFile,
  timeoutMs = CHUNK_TIMEOUT_MS + 3_000,
  chunk?: ChunkRange,
  context?: RecognitionContext,
): Promise<RecognizeOutcome> {
  const max = RECOGNIZE_MAX_BYTES[file.contentType];
  if (!max) return { ok: false, reason: "unsupported" };
  if (file.bytes.length > max) return { ok: false, reason: "too_large" };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RecognitionResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      console.warn("Tositteen tunnistus ylitti aikarajan");
      resolve({ ok: false });
    }, timeoutMs);
  });
  try {
    return await Promise.race([recognizer.recognize(file, controller.signal, chunk, context).catch(() => ({ ok: false }) as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Yhden palan tunnistus: PDF:stä erotetaan palan sivut, ja pala lähetetään
 * tunnistukseen palan tiedoin. Koko tiedoston pala lähetetään sellaisenaan.
 */
export async function recognizeChunk(recognizer: ReceiptRecognizer, file: ReceiptFile, chunk: ChunkRange, context?: RecognitionContext): Promise<RecognizeOutcome> {
  let bytes = file.bytes;
  if (file.contentType === "application/pdf" && !isWholeFile(chunk)) {
    try {
      bytes = await extractPdfPages(file.bytes, chunk.first, chunk.last);
    } catch {
      console.warn("Tositteen palaa ei voitu erottaa");
      return { ok: false };
    }
  }
  return recognizeReceipt(recognizer, { ...file, bytes }, CHUNK_TIMEOUT_MS + 3_000, chunk, context);
}

export type { RecognitionResult, SuggestionLine } from "./schema";
