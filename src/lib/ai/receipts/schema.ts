import { z } from "zod";
import { CATEGORIES, TIMBER_SALE_CODES } from "@/lib/tax/rules";

/**
 * Tositteen tunnistuksen tulos: yksi tai useampi kirjausehdotus.
 *
 * Moduuli on puhdas (ei avaimia, ei kantaa), joten samaa tyyppiä voi käyttää
 * palvelimella, taulukossa ja testeissä. Tekoälyn vastaus tarkistetaan tässä
 * aina ennen kuin sitä käytetään: rakenteinen tuloste takaa muodon, mutta ei
 * sitä, että summat ja päivät ovat järkeviä.
 *
 * Yksi tiedosto voi olla kokoomaskannaus, jossa on monta erillistä asiakirjaa
 * (esimerkiksi puukaupan vuosi-ilmoitus ja muutama lasku). Siksi jokaisella
 * rivillä on lähdeasiakirjan järjestysnumero, kuvaus, laji ja sivut.
 */

export const RECEIPT_CATEGORY_CODES = CATEGORIES.map((c) => c.code) as [string, ...string[]];

/** Enintään näin monta riviä yhdestä tositteesta (vuoden tositenippu voi olla pitkä). */
export const MAX_SUGGESTION_LINES = 60;

/** Asiakirjan laji. Vuosi-ilmoitus on ostajan koko vuoden yhteenveto, ei yksittäinen kauppa. */
export const DOCUMENT_TYPES = ["invoice", "receipt", "timber_settlement", "timber_annual_summary", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  invoice: "Lasku",
  receipt: "Kuitti",
  timber_settlement: "Puukaupan tilitys",
  timber_annual_summary: "Puukaupan vuosi-ilmoitus (yhteenveto)",
  other: "Muu asiakirja",
};

/**
 * Palvelulle annettava skeema. Lukurajoja ei ole tässä, koska rakenteinen
 * tuloste ei tue niitä kaikkia; rajat tarkistetaan validateRecognition-funktiossa.
 */
export const recognitionOutputSchema = z.object({
  lines: z
    .array(
      z.object({
        document_index: z
          .number()
          .int()
          .describe("Lähdeasiakirjan järjestysnumero tiedostossa: 1 ensimmäiselle erilliselle asiakirjalle, 2 seuraavalle jne. Saman asiakirjan riveillä sama numero."),
        source_document: z.string().describe("Lähdeasiakirjan lyhyt kuvaus suomeksi, esimerkiksi 'Puukaupan vuosi-ilmoitus, Metsäliitto' tai 'Lasku 1234, Metsäpalvelu Oy'."),
        document_type: z.enum(DOCUMENT_TYPES).describe("Lähdeasiakirjan laji."),
        pages: z.array(z.number().int()).describe("Sivut, joilla rivin tiedot ovat, 1-pohjaisina tiedoston alusta laskien."),
        contract_number: z.string().nullable().describe("Puukaupan sopimus- tai kauppanumero, jos asiakirjassa on. Muuten null."),
        invoice_number: z.string().nullable().describe("Laskun tai tilityksen numero, jos asiakirjassa on. Ei viitenumeroa eikä tilinumeroa. Muuten null."),
        document_total: z.number().nullable().describe("Lähdeasiakirjan loppusumma arvonlisäveron kanssa euroina, jos se on tulostettu. Muuten null."),
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
    .describe("Kirjausehdotukset asiakirjoittain. Kunkin asiakirjan pääasiallinen rivi (esimerkiksi puukaupan tulo tai laskun kokonaissumma) ensin."),
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
  /** Lähdeasiakirjan järjestysnumero tiedostossa (1-pohjainen). */
  documentIndex: number;
  /** Lähdeasiakirjan lyhyt kuvaus. */
  sourceDocument: string;
  documentType: DocumentType;
  /** Sivut 1-pohjaisina, nousevassa järjestyksessä. Tyhjä, jos sivua ei tiedetä. */
  pages: number[];
  contractNumber: string | null;
  invoiceNumber: string | null;
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

/** Sivut: kokonaisluvut 1–2000, ei toistoja, nousevassa järjestyksessä, enintään 50. */
export function cleanPages(pages: unknown): number[] {
  if (!Array.isArray(pages)) return [];
  const ok = pages.filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p >= 1 && p <= 2000);
  return [...new Set(ok)].sort((a, b) => a - b).slice(0, 50);
}

/**
 * Sopimus- tai laskunumero. Tilinumeron näköinen (IBAN) hylätään, koska
 * tilinumeroita ei tallenneta, ja pituus rajataan.
 */
function cleanNumber(s: string | null | undefined): string | null {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return null;
  if (/^[A-Z]{2}\d{2}[\dA-Z ]{10,}$/i.test(t)) return null;
  return t;
}

/** Tallennetun rivin muoto: sama tarkistus, kun rivit luetaan kannasta. Vanhoilta riveiltä puuttuvat kentät saavat oletuksen. */
export const suggestionLineSchema = z.object({
  date: z.string().nullable(),
  description: z.string().max(200),
  category: z.enum(RECEIPT_CATEGORY_CODES),
  amountGross: z.number().positive().max(100_000_000),
  vatRate: z.number().min(0).max(100),
  withholding: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(300),
  documentIndex: z.number().int().min(1).max(1000).default(1),
  sourceDocument: z.string().max(120).default(""),
  documentType: z.enum(DOCUMENT_TYPES).default("other"),
  pages: z.array(z.number()).default([]),
  contractNumber: z.string().max(40).nullable().default(null),
  invoiceNumber: z.string().max(40).nullable().default(null),
});

export type RecognitionResult = { ok: true; lines: SuggestionLine[] } | { ok: false };

/**
 * Maksuun viittaava selite: tilisiirtolomake, viitenumero, tilinumero tai eräpäivä.
 * Ne ovat laskun maksuosa eivätkä erillinen kulu. Sana "maksu" yksin ei riitä,
 * koska esimerkiksi menekinedistämismaksu ja metsänhoitomaksu ovat oikeita kuluja.
 */
const PAYMENT_WORDS = /tilisiirto|viitenumero|\bviite\b|eräpäivä|\biban\b|pankkisiirto|maksettava|maksuosa|maksulomake|maksutiedot|maksu yhteensä|laskun maksu|saajan tilinumero/i;

export function isPaymentLike(description: string): boolean {
  return PAYMENT_WORDS.test(description);
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

type LineWithTotal = SuggestionLine & { documentTotal?: number | null };

/**
 * Poistaa rivit, jotka toistavat saman asiakirjan loppusumman maksuna, sekä
 * saman laskun toiston (sama laskunumero, luokka ja summa toisena asiakirjana).
 * Asiakirjan viimeistä riviä ei poisteta: maksurivi poistetaan vain, jos samasta
 * asiakirjasta jää muita rivejä ja maksurivin summa on asiakirjan loppusumma,
 * muiden rivien summa tai jonkin toisen rivin summa.
 */
export function removeDuplicatePaymentLines(lines: LineWithTotal[]): SuggestionLine[] {
  const removed = new Set<number>();
  lines.forEach((l, i) => {
    if (!isPaymentLike(l.description)) return;
    const others = lines.filter((o, j) => j !== i && !removed.has(j) && o.documentIndex === l.documentIndex);
    if (!others.length) return;
    const total = [l, ...others].map((o) => o.documentTotal).find((t): t is number => typeof t === "number" && t > 0);
    const sumOthers = round2(others.reduce((s, o) => s + o.amountGross, 0));
    if ((total !== undefined && near(l.amountGross, total)) || near(l.amountGross, sumOthers) || others.some((o) => near(o.amountGross, l.amountGross))) {
      removed.add(i);
    }
  });
  // Sama lasku kahdesti (esimerkiksi lasku ja sen kopio eri sivuilla): jälkimmäinen pois.
  lines.forEach((l, i) => {
    if (removed.has(i) || !l.invoiceNumber) return;
    const earlier = lines.findIndex(
      (o, j) =>
        j < i && !removed.has(j) && o.documentIndex !== l.documentIndex && o.invoiceNumber === l.invoiceNumber && o.category === l.category && near(o.amountGross, l.amountGross),
    );
    if (earlier >= 0) removed.add(i);
  });
  return lines
    .filter((_, i) => !removed.has(i))
    .map((l) => {
      const { documentTotal, ...rest } = l;
      void documentTotal;
      return rest;
    });
}

/**
 * Tekoälyn vastaus ehdotusriveiksi. Kelvoton rivi (summa puuttuu, tuntematon
 * luokka) jätetään pois; jos yhtään kelvollista riviä ei jää, tunnistus on
 * epäonnistunut. Päivä, joka ei ole kalenterissa, muuttuu tyhjäksi, jolloin
 * kirjanpitäjä täyttää sen. Ennakonpidätys hyväksytään vain puukaupan riville.
 * Maksuosan toistava rivi poistetaan (removeDuplicatePaymentLines).
 */
export function validateRecognition(raw: unknown): RecognitionResult {
  const parsed = recognitionOutputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  const lines: LineWithTotal[] = [];
  for (const l of parsed.data.lines.slice(0, MAX_SUGGESTION_LINES)) {
    const amount = round2(Math.abs(l.amount_gross));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) continue;
    const vat = round2(l.vat_rate);
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) continue;
    const timber = TIMBER_SALE_CODES.includes(l.category);
    const wh = round2(Math.abs(l.withholding));
    const confidence = Number.isFinite(l.confidence) ? Math.min(1, Math.max(0, l.confidence)) : 0;
    const total = l.document_total === null ? null : round2(Math.abs(l.document_total));
    lines.push({
      date: validDate(l.date),
      description: l.description.replace(/\s+/g, " ").trim().slice(0, 200),
      category: l.category,
      amountGross: amount,
      vatRate: vat,
      withholding: timber && Number.isFinite(wh) && wh < amount ? wh : 0,
      confidence: Math.round(confidence * 100) / 100,
      reasoning: l.reasoning.replace(/\s+/g, " ").trim().slice(0, 300),
      documentIndex: l.document_index >= 1 && l.document_index <= 1000 ? l.document_index : 1,
      sourceDocument: l.source_document.replace(/\s+/g, " ").trim().slice(0, 120),
      documentType: l.document_type,
      pages: cleanPages(l.pages),
      contractNumber: cleanNumber(l.contract_number),
      invoiceNumber: cleanNumber(l.invoice_number),
      documentTotal: total !== null && Number.isFinite(total) ? total : null,
    });
  }
  const out = removeDuplicatePaymentLines(lines);
  return out.length ? { ok: true, lines: out } : { ok: false };
}

/** Kannasta luetut rivit: rikkinäinen rivi jätetään pois eikä se kaada sivua. */
export function parseStoredLines(raw: unknown): SuggestionLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l) => {
    const p = suggestionLineSchema.safeParse(l);
    return p.success ? [{ ...p.data, date: validDate(p.data.date), pages: cleanPages(p.data.pages) }] : [];
  });
}

/** Kokoomatiedosto: ehdotuksen rivit tulevat useasta eri asiakirjasta. */
export function isCompilation(lines: Pick<SuggestionLine, "documentIndex">[]): boolean {
  return new Set(lines.map((l) => l.documentIndex)).size > 1;
}

/** Sivumerkintä näytettäväksi: "s. 3", "s. 3–4", "s. 1, 3". Tyhjä, jos sivuja ei ole. */
export function pageLabel(pages: number[] | null | undefined): string {
  if (!pages?.length) return "";
  const parts: string[] = [];
  let start = pages[0];
  let prev = pages[0];
  for (const p of [...pages.slice(1), Number.NaN]) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = p;
    prev = p;
  }
  return `s. ${parts.join(", ")}`;
}

/** Linkin teksti kirjauksen lähdetositteelle: "Tosite (s. 3)". */
export function sourceDocumentLabel(pages: number[] | null | undefined): string {
  return pages?.length ? `Tosite (${pageLabel(pages)})` : "Tosite";
}

/** Tositteen osoite, joka avautuu oikealta sivulta (PDF-katselimen #page). */
export function documentHref(clientId: string, documentId: string, pages?: number[] | null): string {
  const base = `/asiakkaat/${clientId}/tositteet/${documentId}`;
  return pages?.length ? `${base}#page=${pages[0]}` : base;
}

/** Sivut kannan smallint[]-sarakkeesta: ajuri voi antaa taulukon tai tekstin "{3,4}". */
export function parsePagesColumn(v: unknown): number[] {
  if (Array.isArray(v)) return cleanPages(v.map(Number));
  if (typeof v === "string") return cleanPages((v.match(/\d+/g) ?? []).map(Number));
  return [];
}
