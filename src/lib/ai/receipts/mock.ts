import "server-only";
import type { ReceiptFile, ReceiptRecognizer } from "./index";
import { validateRecognition, type RecognitionResult } from "./schema";

/**
 * Testitila: tositetta ei lähetetä minnekään eikä sitä lueta. Ehdotus johdetaan
 * tiedostonimestä, jotta käyttöliittymää voi kokeilla ilman avainta:
 *   "puukauppa 15.3.2025 12400.pdf" → pystykauppa, ennakonpidätys ja mittauskulu
 *   "polttoaine 2025-04-02 86,50.jpg" → muu vuosimeno 86,50 €
 * Nimessä oleva päivä (p.k.vvvv tai vvvv-kk-pp) ja summa otetaan mukaan, muuten
 * päivä jää tyhjäksi ja summa on 100 €.
 */
export function mockRecognizer(): ReceiptRecognizer {
  return {
    mode: "mock",
    model: "mock",
    async recognize(file: ReceiptFile): Promise<RecognitionResult> {
      const name = file.fileName.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      if (name.includes("rikki")) return { ok: false };
      let date: string | null = null;
      const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
      const fi = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(name);
      if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
      else if (fi) date = `${fi[3]}-${fi[2].padStart(2, "0")}-${fi[1].padStart(2, "0")}`;
      const rest = name.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/g, " ");
      const amountMatch = /(\d+(?:[.,]\d{1,2})?)/.exec(rest);
      const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : 100;
      const reasoning = "Testitila: ehdotus on johdettu tiedostonimestä, tositetta ei luettu.";
      const timber = /puukauppa|tilitys|pystykauppa/.test(name);
      const raw = timber
        ? {
            lines: [
              {
                date, description: "Puunostaja, pystykauppa", amount_gross: amount || 12400, vat_rate: 25.5, category: "standing_sale",
                withholding: Math.round((amount || 12400) / 1.255 * 0.3 * 100) / 100, confidence: 0.5, reasoning,
              },
              { date, description: "Puunostaja, mittauskulut", amount_gross: 124, vat_rate: 25.5, category: "other_expense", withholding: 0, confidence: 0.4, reasoning },
            ],
          }
        : {
            lines: [
              { date, description: rest.replace(/[\d_,.-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Tosite", amount_gross: amount, vat_rate: 25.5, category: "other_expense", withholding: 0, confidence: 0.5, reasoning },
            ],
          };
      return validateRecognition(raw);
    },
  };
}
