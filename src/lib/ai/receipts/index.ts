import "server-only";
import { anthropicRecognizer, RECOGNITION_TIMEOUT_MS } from "./anthropic";
import { mockRecognizer } from "./mock";
import type { RecognitionResult } from "./schema";

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

export interface ReceiptRecognizer {
  mode: "mock" | "anthropic";
  /** Tallennetaan ehdotukseen, jotta tiedetään, mikä malli ehdotuksen teki. */
  model: string;
  recognize(file: ReceiptFile, signal?: AbortSignal): Promise<RecognitionResult>;
}

/** Palvelun rajat: kuva enintään 5 Mt, PDF-pyyntö enintään 32 Mt (base64 kasvattaa kolmanneksella). */
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
export async function recognizeReceipt(recognizer: ReceiptRecognizer, file: ReceiptFile, timeoutMs = RECOGNITION_TIMEOUT_MS + 5_000): Promise<RecognizeOutcome> {
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
    return await Promise.race([recognizer.recognize(file, controller.signal).catch(() => ({ ok: false }) as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type { RecognitionResult, SuggestionLine } from "./schema";
