import { z } from "zod";
import { CATEGORIES, TIMBER_SALE_CODES } from "@/lib/tax/rules";

/**
 * Tositteen tunnistuksen tulos: yksi tai useampi kirjausehdotus.
 *
 * Moduuli on puhdas (ei avaimia, ei kantaa), joten samaa tyyppiä voi käyttää
 * palvelimella, taulukossa ja testeissä. Tekoälyn vastaus tarkistetaan tässä
 * aina ennen kuin sitä käytetään: rakenteinen tuloste takaa muodon, mutta ei
 * sitä, että summat ja päivät ovat järkeviä.
 */

export const RECEIPT_CATEGORY_CODES = CATEGORIES.map((c) => c.code) as [string, ...string[]];

/** Enintään näin monta riviä yhdestä tositteesta (vuoden tositenippu voi olla pitkä). */
export const MAX_SUGGESTION_LINES = 60;

/**
 * Palvelulle annettava skeema. Lukurajoja ei ole tässä, koska rakenteinen
 * tuloste ei tue niitä kaikkia; rajat tarkistetaan validateRecognition-funktiossa.
 */
export const recognitionOutputSchema = z.object({
  lines: z
    .array(
      z.object({
        date: z.string().nullable().describe("Päivä muodossa YYYY-MM-DD: laskun, kuitin tai tilityksen päivä. null, jos päivää ei näy."),
        description: z.string().describe("Vastapuoli ja lyhyt selite suomeksi, enintään 60 merkkiä, esimerkiksi 'Metsä Group, pystykauppa'."),
        amount_gross: z.number().describe("Summa arvonlisäveron kanssa euroina, positiivinen luku."),
        vat_rate: z.number().describe("Arvonlisäveroprosentti tositteen mukaan, esimerkiksi 25.5, 24, 14, 10 tai 0."),
        category: z.enum(RECEIPT_CATEGORY_CODES).describe("Luokan tunnus luokkalistasta."),
        withholding: z.number().describe("Ennakonpidätys euroina puukaupan tulorivillä, muuten 0."),
        confidence: z.number().describe("Varmuus 0–1: kuinka varma olet rivin tiedoista."),
        reasoning: z.string().describe("Lyhyt perustelu suomeksi, enintään 200 merkkiä: mistä summa, päivä ja luokka päätelty."),
      }),
    )
    .describe("Kirjausehdotukset. Pääasiallinen rivi (esimerkiksi puukaupan tulo tai laskun kokonaissumma) ensin."),
});

export type RecognitionOutput = z.infer<typeof recognitionOutputSchema>;

/** Tarkistettu ehdotusrivi. Tallennetaan sk_receipt_suggestions.lines-sarakkeeseen. */
export interface SuggestionLine {
  /** vvvv-kk-pp tai null */
  date: string | null;
  description: string;
  category: string;
  amountGross: number;
  vatRate: number;
  withholding: number;
  confidence: number;
  reasoning: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function validDate(s: string | null): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return s.trim();
}

/** Tallennetun rivin muoto: sama tarkistus, kun rivit luetaan kannasta. */
export const suggestionLineSchema = z.object({
  date: z.string().nullable(),
  description: z.string().max(200),
  category: z.enum(RECEIPT_CATEGORY_CODES),
  amountGross: z.number().positive().max(100_000_000),
  vatRate: z.number().min(0).max(100),
  withholding: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(300),
});

export type RecognitionResult = { ok: true; lines: SuggestionLine[] } | { ok: false };

/**
 * Tekoälyn vastaus ehdotusriveiksi. Kelvoton rivi (summa puuttuu, tuntematon
 * luokka) jätetään pois; jos yhtään kelvollista riviä ei jää, tunnistus on
 * epäonnistunut. Päivä, joka ei ole kalenterissa, muuttuu tyhjäksi, jolloin
 * kirjanpitäjä täyttää sen. Ennakonpidätys hyväksytään vain puukaupan riville.
 */
export function validateRecognition(raw: unknown): RecognitionResult {
  const parsed = recognitionOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  const lines: SuggestionLine[] = [];
  for (const l of parsed.data.lines.slice(0, MAX_SUGGESTION_LINES)) {
    const amount = round2(Math.abs(l.amount_gross));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) continue;
    const vat = round2(l.vat_rate);
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) continue;
    const timber = TIMBER_SALE_CODES.includes(l.category);
    const wh = round2(Math.abs(l.withholding));
    const confidence = Number.isFinite(l.confidence) ? Math.min(1, Math.max(0, l.confidence)) : 0;
    lines.push({
      date: validDate(l.date),
      description: l.description.replace(/\s+/g, " ").trim().slice(0, 200),
      category: l.category,
      amountGross: amount,
      vatRate: vat,
      withholding: timber && Number.isFinite(wh) && wh < amount ? wh : 0,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: l.reasoning.replace(/\s+/g, " ").trim().slice(0, 300),
    });
  }
  return lines.length ? { ok: true, lines } : { ok: false };
}

/** Kannasta luetut rivit: rikkinäinen rivi jätetään pois eikä se kaada sivua. */
export function parseStoredLines(raw: unknown): SuggestionLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => {
    const p = suggestionLineSchema.safeParse(l);
    return p.success ? [{ ...p.data, date: validDate(p.data.date) }] : [];
  });
}
