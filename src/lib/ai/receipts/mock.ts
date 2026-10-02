import "server-only";
import { FORESTRY_CONTEXT, type ReceiptFile, type ReceiptRecognizer, type RecognitionContext } from "./index";
import { isWholeFile, mapChunkPages, validateChunkRecognition, type ChunkRange } from "./chunks";
import { validateRecognition, type RecognitionResult } from "./schema";
import { categoryActivity } from "@/lib/tax/rules";

/**
 * Testitila: tositetta ei lähetetä minnekään eikä sitä lueta. Ehdotus johdetaan
 * tiedostonimestä, jotta käyttöliittymää voi kokeilla ilman avainta:
 *   "puukauppa 15.3.2025 12400.pdf" → pystykauppa, ennakonpidätys ja mittauskulu
 *   "polttoaine 2025-04-02 86,50.jpg" → muu vuosimeno 86,50 €
 *   "kokooma 2025.pdf" tai "vuosi-ilmoitus 2025.pdf" → kokoomatiedosto: puukaupan
 *     vuosi-ilmoitus (sivut 1–2) ja taimilasku (sivut 3–4) tilisiirtolomakkeineen
 *   "maatila 2025.pdf" (myös meijeri, maito, maatalous) → maatalouden kokooma:
 *     maitotilitys (14 % tai 2026 alkaen 13,5 %), Ruokaviraston maksuilmoitus,
 *     lannoitelasku, MYEL-lasku ja metsänhoitolasku. Metsänhoitolasku on
 *     metsätaloutta, ja se jää pois, jos asiakkaalla ei ole metsätaloutta.
 * Maatalousasiakkaalla tavallisen kuitin luokka tulee oletustoiminnosta
 * (näkymä, josta tunnistus aloitettiin): maataloudessa polttoaine on
 * Polttoaineet ja muu kuitti Muut ostot, metsätaloudessa Muut vuosimenot.
 * Nimessä oleva päivä (p.k.vvvv tai vvvv-kk-pp) ja summa otetaan mukaan, muuten
 * päivä jää tyhjäksi ja summa on 100 €.
 *
 * Osissa luettava pitkä PDF (yli palan kokoinen): rivit tehdään palan sivuista,
 * ks. chunkExample. Nimi "osavirhe" saa sivun 17 sisältävän palan epäonnistumaan
 * kahdesti peräkkäin, jotta uusinta ja "Sivuja … ei voitu lukea" näkyvät selaimessa.
 */
/** Epäonnistumiset palaa kohden (vain testitila, palvelinprosessin muistissa). */
const failures = new Map<string, number>();

export function mockRecognizer(): ReceiptRecognizer {
  return {
    mode: "mock",
    model: "mock",
    async recognize(file: ReceiptFile, _signal?: AbortSignal, chunk?: ChunkRange, context: RecognitionContext = FORESTRY_CONTEXT): Promise<RecognitionResult> {
      const name = file.fileName.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      if (name.includes("rikki")) return { ok: false };
      if (chunk && !isWholeFile(chunk)) {
        // Pieni viive, jotta eteneminen ja keskeytys näkyvät selaimessa (ei testeissä).
        if (!process.env.VITEST) await new Promise((r) => setTimeout(r, 2_000));
        if (name.includes("osavirhe") && chunk.first <= 17 && chunk.last >= 17) {
          const key = `${name}:${chunk.first}`;
          const n = (failures.get(key) ?? 0) + 1;
          failures.set(key, n);
          if (n <= 2) return { ok: false };
        }
        return validateChunkRecognition(forContext(chunkExample(name, chunk, context), context), chunk, context.activities);
      }
      const whole = byName(name, context);
      return whole.ok && chunk ? { ok: true, lines: mapChunkPages(whole.lines, chunk) } : whole;
    },
  };
}

type RawLine = { category: string; [key: string]: unknown };

/**
 * Testitilan rivit asiakkaan toiminnoille: toiminnon, jota asiakkaalla ei ole,
 * rivit jätetään pois, kuten oikea palvelu ei voi ehdottaa sen luokkia.
 */
function forContext<T extends { lines: RawLine[] }>(raw: T, context: RecognitionContext): T {
  return { ...raw, lines: raw.lines.filter((l) => context.activities.includes(categoryActivity(l.category))) };
}

/** Tavallisen kuitin luokka oletustoiminnosta. */
function receiptCategory(name: string, context: RecognitionContext): string {
  if (context.defaultActivity !== "agriculture" || !context.activities.includes("agriculture")) return "other_expense";
  return /polttoaine|diesel|bensiini/.test(name) ? "agri_fuels" : "agri_other_purchases";
}

/** Koko tiedoston ehdotus nimestä (tiedostoa ei lueta). */
function byName(name: string, context: RecognitionContext = FORESTRY_CONTEXT): RecognitionResult {
  let date: string | null = null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(name);
  const fi = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(name);
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (fi) date = `${fi[3]}-${fi[2].padStart(2, "0")}-${fi[1].padStart(2, "0")}`;
  const rest = name.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4}/g, " ");
  // Pitkä numerosarja on skannerin aikaleima tai tunniste eikä summa, joten summaksi kelpaa enintään kuusinumeroinen luku.
  const amountMatch = /(?<!\d)(\d{1,6}(?:[.,]\d{1,2})?)(?!\d)/.exec(rest);
  const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : 100;
  const reasoning = "Testitila: ehdotus on johdettu tiedostonimestä, tositetta ei luettu.";
  if (/maatila|maatalous|meijeri|maito/.test(name) && context.activities.includes("agriculture")) {
    return validateRecognition(forContext(farmExample(name, reasoning), context), context.activities);
  }
  if (/kokooma|vuosi-ilmoitus|vuosi_ilmoitus/.test(name)) return validateRecognition(forContext(compilationExample(name, reasoning), context), context.activities);
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
          { ...doc("receipt", "Kuitti"), date, description: rest.replace(/[\d_,.-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Tosite", amount_gross: amount, vat_rate: 25.5, category: receiptCategory(name, context), withholding: 0, confidence: 0.5, reasoning },
        ],
      };
  return validateRecognition(forContext(raw, context), context.activities);
}

/**
 * Maatalouden kokoomatiedoston esimerkki (kuvitteellinen): maitotilitys,
 * Ruokaviraston maksuilmoitus, lannoitelasku, MYEL-lasku ja metsänhoitolasku.
 * Elintarvikkeiden alv on 14 % vuonna 2025 ja 13,5 % vuodesta 2026.
 */
function farmExample(name: string, reasoning: string) {
  const year = /(20\d{2})/.exec(name)?.[1] ?? "2025";
  const food = Number(year) >= 2026 ? 13.5 : 14;
  const base = { contract_number: null, withholding: 0, reasoning };
  return {
    lines: [
      {
        ...base, document_index: 1, source_document: "Maitotilitys 3/2025, Esimerkin Meijeri", document_type: "dairy_settlement", pages: [1], invoice_number: "M-0325",
        document_total: null, date: `${year}-04-15`, description: "Esimerkin Meijeri, maitotilitys maaliskuu", amount_gross: 5244, vat_rate: food,
        category: "agri_livestock_products", confidence: 0.7,
      },
      {
        ...base, document_index: 1, source_document: "Maitotilitys 3/2025, Esimerkin Meijeri", document_type: "dairy_settlement", pages: [1], invoice_number: "M-0325",
        document_total: null, date: `${year}-04-15`, description: "Esimerkin Meijeri, maidon kuljetusmaksu", amount_gross: 186, vat_rate: 25.5,
        category: "agri_contracting", confidence: 0.6,
      },
      {
        ...base, document_index: 2, source_document: "Maksuilmoitus, Ruokavirasto", document_type: "subsidy_payment", pages: [2], invoice_number: null,
        document_total: null, date: `${year}-12-18`, description: "Ruokavirasto, perustulotuki", amount_gross: 8200, vat_rate: 0, category: "agri_state_subsidy", confidence: 0.7,
      },
      {
        ...base, document_index: 3, source_document: "Lasku 55120, Esimerkin Maatalouskauppa", document_type: "invoice", pages: [3], invoice_number: "55120",
        document_total: 3120.5, date: `${year}-05-06`, description: "Esimerkin Maatalouskauppa, lannoitteet", amount_gross: 3120.5, vat_rate: 25.5,
        category: "agri_fertilizers", confidence: 0.7,
      },
      {
        ...base, document_index: 4, source_document: "MYEL-lasku, Mela", document_type: "invoice", pages: [4], invoice_number: null,
        document_total: 2890, date: `${year}-03-31`, description: "Mela, MYEL-maksu", amount_gross: 2890, vat_rate: 0, category: "agri_myel", confidence: 0.7,
      },
      {
        ...base, document_index: 5, source_document: "Lasku 2210, Esimerkin Metsäpalvelu", document_type: "invoice", pages: [5], invoice_number: "2210",
        document_total: 980, date: `${year}-06-10`, description: "Esimerkin Metsäpalvelu, taimikonhoito", amount_gross: 980, vat_rate: 25.5,
        category: "other_expense", confidence: 0.6,
      },
    ],
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

/**
 * Palan esimerkkirivit: lasku joka neljänneltä sivulta ja palojen rajasivulta.
 * Rajasivu (palan viimeinen, joka on myös seuraavan palan ensimmäinen) tuottaa
 * tahallaan saman rivin molempiin paloihin, jotta yhdistämisen poisto näkyy:
 * lopullisessa ehdotuksessa rivi on vain kerran.
 */
function chunkExample(name: string, chunk: ChunkRange, context: RecognitionContext = FORESTRY_CONTEXT) {
  const expense = receiptCategory("", context);
  const year = /(20\d{2})/.exec(name)?.[1] ?? "2025";
  const reasoning = "Testitila: rivi on tehty palan sivunumeroista, tositetta ei luettu.";
  const lines = [];
  let doc = 0;
  for (let p = chunk.first; p <= chunk.last; p++) {
    const boundary = (p === chunk.first && p > 1) || (p === chunk.last && p < chunk.total);
    if (p % 4 !== 0 && !boundary) continue;
    doc++;
    const invoice = String(1000 + p);
    const month = String(((p - 1) % 12) + 1).padStart(2, "0");
    const amount = 100 + p * 10;
    lines.push({
      document_index: doc,
      source_document: `Lasku ${invoice}, Esimerkin Metsäpalvelu`,
      document_type: "invoice",
      pages: [p],
      contract_number: null,
      invoice_number: invoice,
      document_total: amount,
      date: `${year}-${month}-15`,
      description: `Esimerkin Metsäpalvelu, sivun ${p} lasku`,
      amount_gross: amount,
      vat_rate: 25.5,
      category: expense,
      withholding: 0,
      confidence: boundary ? 0.4 : 0.6,
      reasoning,
    });
  }
  // Pala ilman laskusivua (esimerkiksi pelkkä raja) saa silti yhden rivin ensimmäiseltä sivulta.
  if (!lines.length) {
    lines.push({
      document_index: 1, source_document: "Kuitti", document_type: "receipt", pages: [chunk.first], contract_number: null, invoice_number: null,
      document_total: null, date: null, description: "Kuitti", amount_gross: 50, vat_rate: 25.5, category: expense, withholding: 0, confidence: 0.3, reasoning,
    });
  }
  return { lines };
}
