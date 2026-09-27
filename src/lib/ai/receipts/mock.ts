import "server-only";
import type { ReceiptFile, ReceiptRecognizer } from "./index";
import { validateRecognition, type RecognitionResult } from "./schema";

/**
 * Testitila: tositetta ei lähetetä minnekään eikä sitä lueta. Ehdotus johdetaan
 * tiedostonimestä, jotta käyttöliittymää voi kokeilla ilman avainta:
 *   "puukauppa 15.3.2025 12400.pdf" → pystykauppa, ennakonpidätys ja mittauskulu
 *   "polttoaine 2025-04-02 86,50.jpg" → muu vuosimeno 86,50 €
 *   "kokooma 2025.pdf" tai "vuosi-ilmoitus 2025.pdf" → kokoomatiedosto: puukaupan
 *     vuosi-ilmoitus (sivut 1–2) ja taimilasku (sivut 3–4) tilisiirtolomakkeineen
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
      if (/kokooma|vuosi-ilmoitus|vuosi_ilmoitus/.test(name)) return validateRecognition(compilationExample(name, reasoning));
      const timber = /puukauppa|tilitys|pystykauppa/.test(name);
      const doc = (type: string, source: string) => ({ document_index: 1, source_document: source, document_type: type, pages: [1], contract_number: null, invoice_number: null, document_total: null });
      const raw = timber
        ? {
            lines: [
              {
                ...doc("timber_settlement", "Puukaupan tilitys, Puunostaja"), date, description: "Puunostaja, pystykauppa", amount_gross: amount || 12400, vat_rate: 25.5, category: "standing_sale",
                withholding: Math.round((amount || 12400) / 1.255 * 0.3 * 100) / 100, confidence: 0.5, reasoning,
              },
              { ...doc("timber_settlement", "Puukaupan tilitys, Puunostaja"), date, description: "Puunostaja, mittauskulut", amount_gross: 124, vat_rate: 25.5, category: "other_expense", withholding: 0, confidence: 0.4, reasoning },
            ],
          }
        : {
            lines: [
              { ...doc("receipt", "Kuitti"), date, description: rest.replace(/[\d_,.-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Tosite", amount_gross: amount, vat_rate: 25.5, category: "other_expense", withholding: 0, confidence: 0.5, reasoning },
            ],
          };
      return validateRecognition(raw);
    },
  };
}

/**
 * Kokoomatiedoston esimerkki: kuvitteellinen vuosi-ilmoitus kahdesta kaupasta
 * ja taimilasku. Laskun tilisiirtolomakkeesta tulee tahallaan oma rivi, jonka
 * tarkistus poistaa, kuten oikean mallin virheestä.
 */
function compilationExample(name: string, reasoning: string) {
  const year = /(20\d{2})/.exec(name)?.[1] ?? "2025";
  const summary = { document_index: 1, source_document: "Puukaupan vuosi-ilmoitus, Esimerkkipuu Oy", document_type: "timber_annual_summary", pages: [1, 2], invoice_number: null, document_total: null };
  const invoice = { document_index: 2, source_document: "Lasku 1182, Esimerkin Metsäpalvelu", document_type: "invoice", pages: [3], contract_number: null, invoice_number: "1182", document_total: 1882.5 };
  const yearEnd = `${year}-12-31`;
  return {
    lines: [
      { ...summary, contract_number: "10432", date: yearEnd, description: "Esimerkkipuu Oy, pystykauppa 10432", amount_gross: 23092, vat_rate: 25.5, category: "standing_sale", withholding: 5520, confidence: 0.6, reasoning },
      { ...summary, contract_number: "10432", date: yearEnd, description: "Esimerkkipuu Oy, menekinedistämismaksu", amount_gross: 36.8, vat_rate: 0, category: "other_expense", withholding: 0, confidence: 0.6, reasoning },
      { ...summary, contract_number: "11875", date: yearEnd, description: "Esimerkkipuu Oy, hankintakauppa 11875", amount_gross: 7781, vat_rate: 25.5, category: "delivery_sale", withholding: 1860, confidence: 0.6, reasoning },
      { ...invoice, date: `${year}-05-14`, description: "Esimerkin Metsäpalvelu, taimet", amount_gross: 1882.5, vat_rate: 25.5, category: "other_expense", withholding: 0, confidence: 0.7, reasoning },
      { ...invoice, pages: [4], date: `${year}-05-14`, description: "Tilisiirto, maksettava yhteensä", amount_gross: 1882.5, vat_rate: 25.5, category: "other_expense", withholding: 0, confidence: 0.3, reasoning },
    ],
  };
}
