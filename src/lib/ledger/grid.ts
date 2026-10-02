import {
  ACTIVITY_LABEL,
  agriAssetChoices,
  allowsOtherShare,
  ASSET_CLASS_PCTS,
  categoriesFor,
  category,
  categoryActivity,
  categoryByNo,
  defaultVatRate,
  FORESTRY_CATEGORIES,
  isAssetPurchase,
  isAssetSale,
  isLivestockDeferral,
  parseAgriAssetChoice,
  smallAssetLimit,
  TIMBER_SALE_CODES,
  type Activity,
  type Category,
  type ClientActivities,
  type TransactionKind,
  viewCategories,
} from "@/lib/tax/rules";
import { netFromGross, percentOf } from "@/lib/tax/amounts";
import { livestockDeferralFor } from "@/lib/tax/agriculture";
import { formatSharePct, ownShare, type ShareAmounts } from "@/lib/tax/share";
import type { PendingSuggestion } from "@/lib/documents/receipt-suggestions";
import { isCompilation, parsePagesColumn, type DocumentType } from "@/lib/ai/receipts/schema";
import { duplicateWarnings, type ExistingEntry } from "@/lib/ai/receipts/duplicates";
import { documentBalance, type DocumentBalance } from "@/lib/ai/receipts/reconcile";
import {
  AGRI_ASSET_CLASS_MESSAGE,
  ASSET_CLASS_MESSAGE,
  effectiveKind,
  OTHER_SHARE_MESSAGE,
  normalizeDate,
  parseAmount,
  resolveCategory,
  SALE_ASSET_MESSAGE,
  smallAssetMessage,
  toFinnishDate,
  transactionFieldsSchema,
} from "@/lib/ledger/transaction-input";

/**
 * Kirjanpidon taulukko: koko verovuoden kirjaukset muokattavina kuten vanhassa
 * sovelluksessa (legacy/app/asiakas/asiakas.html: render, ck, katSelect).
 * Tässä on taulukon puhdas logiikka: rivit, näppäinsiirrot, luokan numerovalinta,
 * tarkistus ja muutosten erottelu. Sama moduuli toimii selaimessa ja palvelimella,
 * joten palvelin erottelee muutokset samalla säännöllä kuin selain näyttää ne.
 */

// ---------------------------------------------------------------------------
// Rivit
// ---------------------------------------------------------------------------

export interface GridRow {
  key: string;
  /** Tallennetun kirjauksen tunniste; uudella rivillä null. */
  id: string | null;
  bookedOn: string;
  description: string;
  category: string;
  /** Summa arvonlisäveron kanssa, kuten kuitissa. */
  amountGross: string;
  vatRate: string;
  /** Oman toiminnon osuus prosentteina. Tyhjä = 100 %. */
  businessSharePct: string;
  /** Toisen toiminnon osuus prosentteina (metsä ↔ maatalous, vain menot). Tyhjä = 0 %. */
  otherSharePct?: string;
  withholding: string;
  forestPropertyId: string;
  /** Maatalouden kirjauksen maatila (0018). Tyhjä = ei tilaa. Puuttuva = tyhjä. */
  farmId?: string;
  /** Tyhjä = luokan tyyppi. */
  kind: TransactionKind | "";
  /** Viite säilyy muokatessa, vaikka taulukossa ei ole sille saraketta. */
  reference: string;
  /**
   * Uusi hankinta: hyödykelaji. Metsätaloudessa menojäännöspoiston prosentti
   * ("25"), maataloudessa poistoryhmän tunnus ("agri_machinery", rules.ts agriAssetChoices).
   */
  assetRatePct: string;
  /** Myynti: myytävä investointi. */
  saleAssetId: string;
  /** Näyttötiedot tallennetusta rivistä. Eivät vaikuta tallennukseen. */
  assetId?: string | null;
  assetDescription?: string | null;
  documentCount?: number;
  /** Kokoomatiedosto tai saman tiedoston toinen kirjaus: tiedosto ja sivut, joilla kirjauksen tiedot ovat. */
  sourceDocumentId?: string | null;
  sourcePages?: number[];
  /** Tositteen tunnistuksen ehdotus, josta rivi on tehty. Tallennuksessa rivi hyväksyy ehdotuksen. */
  suggestionId?: string | null;
  /** Ehdotuksen rivin numero (0-pohjainen): palvelin hakee sen sivut tallennetusta ehdotuksesta. */
  suggestionLine?: number | null;
  /** Ehdotuksen näyttötiedot. Eivät vaikuta tallennukseen. */
  suggestion?: SuggestionInfo;
  /**
   * Ehdotusrivi jätetään odottamaan: sitä ei tallenneta, ja se palaa
   * tallennuksen jälkeen ehdotukseksi (hyväksyntä riveittäin).
   */
  deferred?: boolean;
}

export interface SuggestionInfo {
  documentId: string;
  documentName: string;
  confidence: number;
  reasoning: string;
  /** Ehdotuksen ensimmäinen rivi: Hylkää-painike ja tositteen liitos. */
  first: boolean;
  /** Tositteen päivä vvvv-kk-pp, tai null, jos sitä ei tunnistettu. */
  sourceDate: string | null;
  /** Lähdeasiakirjan kuvaus, laji ja sivut tiedostossa. */
  sourceDocument: string;
  documentType: DocumentType;
  documentIndex: number;
  pages: number[];
  contractNumber: string | null;
  invoiceNumber: string | null;
  /** Tiedostossa on useita asiakirjoja: se jää vuoden tositteeksi. */
  compilation: boolean;
  /** Mahdollinen päällekkäisyys olemassa olevan kirjauksen tai toisen ehdotuksen kanssa. */
  duplicateWarning?: string | null;
  /** Lähdeasiakirjan loppusumma tai tilityksen maksettu summa (täsmäytys). */
  documentTotal?: number | null;
  /** Huomautus kirjanpitäjälle (maatalous). */
  note?: string | null;
}

export type GridField = "bookedOn" | "description" | "category" | "amountGross" | "vatRate" | "businessSharePct" | "otherSharePct" | "forestPropertyId" | "farmId" | "kind";
export type RowErrorField = GridField | "withholding" | "asset";
export type RowErrors = Partial<Record<RowErrorField, string>>;

/**
 * Näppäimillä kuljettavat sarakkeet vanhan sovelluksen järjestyksessä. Metsätila vain, jos asiakkaalla on tiloja.
 * Osuus on alv %:n jälkeen, mutta Enter ohittaa sen (ENTER_SKIPS), jotta tavallinen syöttö ei hidastu.
 */
export function gridColumns(hasProperties: boolean, hasOtherShare = false, hasFarms = false): GridField[] {
  // Toisen toiminnon osuus vain asiakkaalle, jolla on sekä metsä- että maataloutta.
  const shares: GridField[] = hasOtherShare ? ["businessSharePct", "otherSharePct"] : ["businessSharePct"];
  // Maatila vain maatalouden näkymässä, kun asiakkaalla on useampi tila (0018).
  const place: GridField[] = [...(hasProperties ? (["forestPropertyId"] as GridField[]) : []), ...(hasFarms ? (["farmId"] as GridField[]) : [])];
  return ["bookedOn", "description", "category", "amountGross", "vatRate", ...shares, ...place, "kind"];
}

/** Sarakkeet, jotka Enter ohittaa. Tab ja klikkaus vievät niihin. Osuudet ovat harvoin muita kuin 100 % ja 0 %. */
export const ENTER_SKIPS: GridField[] = ["businessSharePct", "otherSharePct"];

export const MAX_GRID_ROWS = 2000;

export function emptyGridRow(key: string, bookedOn = ""): GridRow {
  return {
    key, id: null, bookedOn, description: "", category: "", amountGross: "", vatRate: "", businessSharePct: "", otherSharePct: "", withholding: "", forestPropertyId: "", farmId: "", kind: "",
    reference: "", assetRatePct: "", saleAssetId: "",
  };
}

/** Summa kenttään suomalaisittain: 1 234,50. */
export function formatAmountInput(n: number): string {
  return n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const numberInput = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : Number(v).toLocaleString("fi-FI"));

export interface StoredTransaction {
  id: string;
  booked_on: string;
  kind: TransactionKind;
  category: string;
  description: string;
  amount_gross: string;
  vat_rate: string;
  withholding: string;
  /** Puuttuu vanhoista testiriveistä: silloin 100 %. */
  business_share_pct?: string | null;
  /** Toisen toiminnon osuus (0015). Puuttuva = 0. */
  other_share_pct?: string | null;
  reference: string | null;
  asset_id: string | null;
  asset_description?: string | null;
  forest_property_id: string | null;
  /** Maatila (0018). Puuttuu vanhoista testiriveistä. */
  farm_id?: string | null;
  document_count?: number;
  source_document_id?: string | null;
  /** smallint[]: ajurista riippuen taulukko tai teksti "{3,4}". */
  source_pages?: unknown;
}

/** Tallennettu kirjaus taulukon riviksi. Rivin avain on kirjauksen tunniste. */
export function rowFromStored(t: StoredTransaction): GridRow {
  const withholding = Number(t.withholding);
  return {
    key: t.id,
    id: t.id,
    bookedOn: toFinnishDate(t.booked_on),
    description: t.description,
    category: t.category,
    amountGross: formatAmountInput(Number(t.amount_gross)),
    vatRate: numberInput(t.vat_rate),
    // 100 % näkyy tyhjänä, jotta poikkeava osuus erottuu.
    businessSharePct: t.business_share_pct === null || t.business_share_pct === undefined || Number(t.business_share_pct) === 100 ? "" : formatSharePct(Number(t.business_share_pct)),
    otherSharePct: t.other_share_pct && Number(t.other_share_pct) ? formatSharePct(Number(t.other_share_pct)) : "",
    withholding: withholding ? formatAmountInput(withholding) : "",
    forestPropertyId: t.forest_property_id ?? "",
    farmId: t.farm_id ?? "",
    kind: t.kind,
    reference: t.reference ?? "",
    assetRatePct: "",
    saleAssetId: isAssetSale(t.category) ? (t.asset_id ?? "") : "",
    assetId: t.asset_id,
    assetDescription: t.asset_description ?? null,
    documentCount: t.document_count ?? 0,
    sourceDocumentId: t.source_document_id ?? null,
    sourcePages: parsePagesColumn(t.source_pages),
  };
}

/**
 * Tunnistuksen ehdotus taulukon riveiksi. Rivit ovat uusia (id null), joten ne
 * tallentuvat vasta taulukon tallennuksessa. Avain on ehdotuksen ja rivin
 * mukaan pysyvä, jotta sivun päivitys ei tuo samoja rivejä kahdesti.
 * Jos asiakas ei ole arvonlisäverorekisterissä, alv on 0 % kuten muillakin
 * uusilla riveillä: kulu on koko kuitin summa. Puuttuva päivä täytetään
 * oletuspäivällä, ja rivi näyttää siitä varoituksen; vuosi-ilmoituksen rivi saa
 * vuoden viimeisen päivän, koska ilmoitus on koko vuoden yhteenveto.
 * Sopimus- tai laskunumero tallentuu kirjauksen viitteeksi, jotta
 * päällekkäisyyden tarkistus löytää kirjauksen myöhemmin.
 * Metsätalouden osuus on aina 100 % (tyhjä): tositteesta ei voi päätellä,
 * kuuluuko osa muulle toiminnalle, joten kirjanpitäjä muuttaa sen tarvittaessa.
 */
export function rowsFromSuggestion(s: Pick<PendingSuggestion, "id" | "document_id" | "file_name" | "lines">, opts: { vatRegistered: boolean; defaultDate: string; year?: number }): GridRow[] {
  const compilation = isCompilation(s.lines);
  return s.lines.map((l, i) => {
    const cat = category(l.category);
    const missingDate = l.documentType === "timber_annual_summary" && opts.year ? `31.12.${opts.year}` : opts.defaultDate;
    const reference = l.contractNumber ? `Sopimus ${l.contractNumber}` : l.invoiceNumber ? `Lasku ${l.invoiceNumber}` : "";
    return {
      ...emptyGridRow(`s-${s.id}-${i}`, l.date ? toFinnishDate(l.date) : missingDate),
      description: l.description,
      category: cat ? cat.code : "",
      kind: cat ? cat.kind : "",
      amountGross: formatAmountInput(l.amountGross),
      vatRate: numberInput(opts.vatRegistered ? l.vatRate : 0),
      withholding: l.withholding > 0 && TIMBER_SALE_CODES.includes(l.category) ? formatAmountInput(l.withholding) : "",
      reference: reference.slice(0, 100),
      // Maatalouden investointi saa tunnistetun poistoryhmän valmiiksi; kirjanpitäjä voi vaihtaa sen.
      assetRatePct: l.category === "agri_asset_purchase" && l.assetClass ? l.assetClass : "",
      suggestionId: s.id,
      suggestionLine: i,
      suggestion: {
        documentId: s.document_id, documentName: s.file_name, confidence: l.confidence, reasoning: l.reasoning, first: i === 0, sourceDate: l.date,
        sourceDocument: l.sourceDocument, documentType: l.documentType, documentIndex: l.documentIndex, pages: l.pages, contractNumber: l.contractNumber,
        invoiceNumber: l.invoiceNumber, compilation, documentTotal: l.documentTotal ?? null, note: l.note ?? null,
      },
    };
  });
}

/**
 * Päällekkäisyysvaroitukset ehdotusriveille: vertailu asiakkaan saman vuoden
 * kirjauksiin ja muiden asiakirjojen ehdotusriveihin (src/lib/ai/receipts/duplicates.ts).
 */
export function withDuplicateWarnings(
  rows: GridRow[],
  stored: Pick<StoredTransaction, "booked_on" | "category" | "amount_gross" | "description" | "reference">[],
): GridRow[] {
  const existing: ExistingEntry[] = stored.map((t) => ({
    bookedOn: t.booked_on, category: t.category, amountGross: Number(t.amount_gross), description: t.description, reference: t.reference,
  }));
  const candidates = rows.flatMap((r) => {
    const sg = r.suggestion;
    const gross = parseAmount(r.amountGross);
    if (!sg || gross === null || Number.isNaN(gross)) return [];
    const label = `${sg.sourceDocument || sg.documentName}: ${r.description}`.slice(0, 120);
    return [{ key: r.key, group: `${r.suggestionId}:${sg.documentIndex}`, category: r.category, amountGross: gross, contractNumber: sg.contractNumber, invoiceNumber: sg.invoiceNumber, label }];
  });
  const warnings = duplicateWarnings(candidates, existing);
  return rows.map((r) => (r.suggestion && warnings.has(r.key) ? { ...r, suggestion: { ...r.suggestion, duplicateWarning: warnings.get(r.key) } } : r));
}

/**
 * Ehdotuksen asiakirja taulukossa: tilitys tai lasku riveineen (DECISIONS
 * 2.10.2026, maatalouden tositteiden tunnistus). Ryhmä lasketaan taulukon
 * nykyisistä riveistä, joten muokkaus, poisto ja odottamaan jättäminen näkyvät
 * heti täsmäytyksessä. Avain on ensimmäisen rivin avain, jonka yläpuolelle
 * näkymä piirtää ryhmän otsikon.
 */
export interface SuggestionGroup {
  firstKey: string;
  suggestionId: string;
  documentIndex: number;
  sourceDocument: string;
  documentType: DocumentType;
  documentName: string;
  documentId: string;
  pages: number[];
  rowKeys: string[];
  /** Odottamaan jätetyt rivit (eivät tallennu tällä kertaa). */
  deferredKeys: string[];
  balance: DocumentBalance;
}

export function suggestionGroups(rows: GridRow[]): Map<string, SuggestionGroup> {
  const byDoc = new Map<string, SuggestionGroup>();
  for (const r of rows) {
    const sg = r.suggestion;
    if (!sg || !r.suggestionId || r.id) continue;
    const key = `${r.suggestionId}:${sg.documentIndex}`;
    let g = byDoc.get(key);
    if (!g) {
      g = {
        firstKey: r.key, suggestionId: r.suggestionId, documentIndex: sg.documentIndex, sourceDocument: sg.sourceDocument, documentType: sg.documentType,
        documentName: sg.documentName, documentId: sg.documentId, pages: [], rowKeys: [], deferredKeys: [],
        balance: documentBalance([], null),
      };
      byDoc.set(key, g);
    }
    g.rowKeys.push(r.key);
    if (r.deferred) g.deferredKeys.push(r.key);
    g.pages = [...new Set([...g.pages, ...sg.pages])].sort((a, b) => a - b);
  }
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const out = new Map<string, SuggestionGroup>();
  for (const g of byDoc.values()) {
    const members = g.rowKeys.map((k) => rowByKey.get(k)!);
    const total = members.map((r) => r.suggestion?.documentTotal).find((t): t is number => typeof t === "number" && t > 0) ?? null;
    const lines = members.map((r) => {
      const gross = parseAmount(r.amountGross);
      const wh = parseAmount(r.withholding);
      return { kind: (rowKind(r) ?? "") as TransactionKind | "", amountGross: gross !== null && !Number.isNaN(gross) ? gross : 0, withholding: wh !== null && !Number.isNaN(wh) ? wh : 0 };
    });
    out.set(g.firstKey, { ...g, balance: documentBalance(lines, total) });
  }
  return out;
}

/** Odottamaan jätetyt ehdotusrivit tallennusta varten: ehdotus ja rivien numerot. */
export function deferredSuggestionLines(rows: GridRow[]): { suggestionId: string; lines: number[] }[] {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    if (r.id || !r.deferred || !r.suggestionId || r.suggestionLine === null || r.suggestionLine === undefined) continue;
    out.set(r.suggestionId, [...(out.get(r.suggestionId) ?? []), r.suggestionLine]);
  }
  return [...out.entries()].map(([suggestionId, lines]) => ({ suggestionId, lines: [...new Set(lines)].sort((a, b) => a - b) }));
}

/**
 * Ehdotusrivin varoitus päivästä: päivä on muulta vuodelta, tai sitä ei
 * tunnistettu tositteesta eikä kirjanpitäjä ole vielä muuttanut oletuspäivää.
 */
export function suggestionDateWarning(r: GridRow, year: number, initialBookedOn?: string): string | null {
  if (!r.suggestion) return null;
  const iso = normalizeDate(r.bookedOn, year);
  if (iso && Number(iso.slice(0, 4)) !== year) return `Päivä ${toFinnishDate(iso)} on muulta vuodelta kuin ${year}. Tarkista päivä ja vuosi.`;
  if (!r.suggestion.sourceDate && r.bookedOn === initialBookedOn) return "Tositteesta ei tunnistettu päivää. Tarkista päivä.";
  return null;
}

/** Uusi rivi on tyhjä, jos siihen ei ole kirjoitettu mitään (päivä tulee valmiina edelliseltä riviltä). */
export function isBlankGridRow(r: GridRow): boolean {
  return (
    r.id === null &&
    [r.description, r.category, r.amountGross, r.vatRate, r.businessSharePct, r.otherSharePct, r.withholding, r.forestPropertyId, r.farmId, r.reference, r.assetRatePct, r.saleAssetId].every(
      (v) => !String(v ?? "").trim(),
    )
  );
}

// ---------------------------------------------------------------------------
// Laskenta riville
// ---------------------------------------------------------------------------

/** Rivin verokanta: kirjoitettu tai oletus (luokka, päivä, asiakkaan alv-rekisteröinti). */
export function rowVatRate(r: GridRow, year: number, client: { vatRegistered: boolean }): number | null {
  const rate = parseAmount(r.vatRate);
  if (rate !== null) return Number.isNaN(rate) ? null : rate;
  const cat = category(r.category);
  if (!cat) return null;
  return defaultVatRate(cat.code, normalizeDate(r.bookedOn, year) ?? `${year}-12-31`, client);
}

/** Veroton summa näytettäväksi. null, jos summaa tai kantaa ei voi vielä laskea. */
export function rowNet(r: GridRow, year: number, client: { vatRegistered: boolean }): number | null {
  const gross = parseAmount(r.amountGross);
  const rate = rowVatRate(r, year, client);
  if (gross === null || Number.isNaN(gross) || rate === null) return null;
  return netFromGross(gross, rate);
}

/** Rivin osuus: tyhjä = 100, kelvoton = null. */
export function rowSharePct(r: GridRow): number | null {
  const v = parseAmount(r.businessSharePct);
  if (v === null) return 100;
  return Number.isFinite(v) && v > 0 && v <= 100 ? v : null;
}

/** Rivin toisen toiminnon osuus: tyhjä = 0, kelvoton = null. */
export function rowOtherSharePct(r: GridRow): number | null {
  const v = parseAmount(r.otherSharePct ?? "");
  if (v === null) return 0;
  return Number.isFinite(v) && v >= 0 && v < 100 ? v : null;
}

/** Rivin osuudet summista näytettäväksi. null, jos summaa, kantaa tai osuutta ei voi vielä laskea. */
export function rowShare(r: GridRow, year: number, client: { vatRegistered: boolean }): ShareAmounts | null {
  const gross = parseAmount(r.amountGross);
  const net = rowNet(r, year, client);
  const pct = rowSharePct(r);
  const other = rowOtherSharePct(r);
  if (gross === null || Number.isNaN(gross) || net === null || pct === null || other === null) return null;
  return ownShare({ kind: rowKind(r) ?? "expense", amountNet: net, amountGross: gross, businessSharePct: pct, otherSharePct: allowsOtherShare(r.category) ? other : 0 });
}

/**
 * Rivin osuuksien selitys rivin alle, esimerkiksi "Maataloudelle 878,50 €,
 * metsätaloudelle 251,00 €, yksityiseen 125,50 €." Pelkällä metsäasiakkaalla
 * teksti on kuten ennen: "Metsätaloudelle X, muulle Y".
 */
export function shareNote(r: GridRow, share: ShareAmounts, fmt: (n: number) => string): string {
  const own = category(r.category)?.activity ?? "forestry";
  const other: Activity = own === "forestry" ? "agriculture" : "forestry";
  const to = (a: Activity) => (a === "forestry" ? "metsätaloudelle" : "maataloudelle");
  const first = to(own);
  const parts = [`${first[0].toUpperCase()}${first.slice(1)} ${fmt(share.gross)}`];
  if (share.crossPct) parts.push(`${to(other)} ${fmt(share.crossGross)}`);
  if (share.privateGross) parts.push(share.crossPct || own === "agriculture" ? `yksityiseen ${fmt(share.privateGross)}` : `muulle ${fmt(share.privateGross)}`);
  return `${parts.join(", ")}.${share.nonDeductibleVat ? ` Alv:sta ${fmt(share.nonDeductibleVat)} ei vähennetä.` : ""}`;
}

export function rowKind(r: GridRow): TransactionKind | null {
  if (!category(r.category)) return r.kind || null;
  return effectiveKind(r.category, r.kind || null);
}

/** Tyyppi voidaan kääntää tulosta menoksi ja takaisin, paitsi investoinneissa. */
export function toggleKind(r: GridRow): GridRow {
  const current = rowKind(r);
  if (!current || current === "investment" || isAssetSale(r.category) || isAssetPurchase(r.category)) return r;
  return { ...r, kind: current === "income" ? "expense" : "income" };
}

/**
 * Luokan valinta kuten vanhan katSelect: tyyppi ja verokanta luokasta.
 * Verokanta asetetaan näkyviin, jotta kirjanpitäjä näkee ja voi vaihtaa sen.
 */
export function selectCategory(r: GridRow, code: string, year: number, client: { vatRegistered: boolean }): GridRow {
  const cat = category(code);
  if (!cat) return r;
  const date = normalizeDate(r.bookedOn, year) ?? `${year}-12-31`;
  return {
    ...r,
    category: cat.code,
    kind: cat.kind,
    vatRate: numberInput(defaultVatRate(cat.code, date, client)),
    // Laji ja myytävä kohde säilyvät vain saman luokan sisällä: metsän ja maatalouden lajit ovat eri.
    assetRatePct: isAssetPurchase(cat.code) && cat.code === r.category ? r.assetRatePct : "",
    saleAssetId: isAssetSale(cat.code) && cat.code === r.category ? r.saleAssetId : "",
    // Toisen toiminnon osuus vain menoille, joille se sallitaan.
    otherSharePct: allowsOtherShare(cat.code) ? (r.otherSharePct ?? "") : "",
    // Maatila vain maatalouden kirjauksella.
    farmId: cat.activity === "agriculture" ? (r.farmId ?? "") : "",
  };
}

/**
 * Jaksotettavan kotieläinrivin vuosierät näytettäväksi rivin alla (0018), samalla
 * säännöllä kuin tallennus (livestockDeferralFor). null, jos rivi ei ole
 * jaksotettava tai summaa ei voi vielä laskea.
 */
export function rowLivestockDeferral(r: GridRow, year: number, client: { vatRegistered: boolean }): { year: number; amount: number }[] | null {
  if (!isLivestockDeferral(r.category)) return null;
  const gross = parseAmount(r.amountGross);
  const net = rowNet(r, year, client);
  const pct = rowSharePct(r);
  if (gross === null || Number.isNaN(gross) || net === null || pct === null) return null;
  const d = livestockDeferralFor({ category: r.category, kind: rowKind(r) ?? "income", amountNet: net, amountGross: gross, businessSharePct: pct }, client.vatRegistered);
  if (!d) return null;
  const first = Number((normalizeDate(r.bookedOn, year) ?? `${year}`).slice(0, 4));
  return d.split.map((amount, i) => ({ year: first + i, amount }));
}

/** Puukaupasta kysytään ennakonpidätys, kun summa on syötetty (vanha avaaEP). */
export function asksWithholding(r: GridRow): boolean {
  return TIMBER_SALE_CODES.includes(r.category);
}

/** Hankintakaupan alle tarjotaan hankintatyön laskuria, jos alla ei vielä ole hankintatyötä (vanha htTarkistaRivi). */
export function offersDeliveryWork(rows: GridRow[], index: number): boolean {
  const r = rows[index];
  if (!r || r.category !== "delivery_sale") return false;
  const gross = parseAmount(r.amountGross);
  if (gross === null || Number.isNaN(gross) || gross <= 0) return false;
  return rows[index + 1]?.category !== "delivery_work";
}

// ---------------------------------------------------------------------------
// Näppäimet (vanha ck)
// ---------------------------------------------------------------------------

export type KeyAction =
  | { type: "focus"; row: number; col: number }
  /** Rivin loppu eteenpäin: seuraava rivi tai uusi rivi (ensin mahdollinen hankintatyö). */
  | { type: "rowEnd"; row: number }
  | { type: "addButton" }
  | { type: "toggleKind"; row: number }
  | { type: "deleteRow"; row: number }
  | { type: "menuMove"; delta: 1 | -1 }
  | { type: "menuOpen" }
  | { type: "menuSelect" }
  | { type: "menuClose"; then: KeyAction | null }
  /** Näppäin käsitelty, ei muuta. */
  | { type: "none" };

export interface KeyInput {
  key: string;
  shift: boolean;
  ctrl: boolean;
  row: number;
  col: number;
  rowCount: number;
  columns: GridField[];
  menuOpen: boolean;
}

/** Kentät, joissa T kääntää tyypin: niissä kirjain ei muuten merkitse mitään. */
const KIND_TOGGLE_FIELDS: GridField[] = ["bookedOn", "amountGross", "vatRate", "businessSharePct", "kind"];

/**
 * Mitä näppäin tekee taulukossa. null = selaimen oletus (esimerkiksi kirjoitus kenttään).
 * - Enter ja Tab: seuraava kenttä, rivin lopussa seuraava tai uusi rivi. Shift: takaisin.
 *   Enter ohittaa osuuden (ENTER_SKIPS), Tab ei.
 * - Nuolet ylös ja alas: sama sarake edellisellä tai seuraavalla rivillä,
 *   paitsi selitteessä (tekstin muokkaus) ja avoimessa luokkavalikossa.
 * - T kääntää tulon ja menon, Delete viimeisessä sarakkeessa poistaa rivin.
 */
export function gridKeyAction(k: KeyInput): KeyAction | null {
  if (k.ctrl) return null;
  const field = k.columns[k.col];
  const last = k.columns.length - 1;
  // Enter hyppää ohitettavien sarakkeiden yli; Tab käy jokaisessa.
  const skip = (c: number, enter: boolean) => enter && ENTER_SKIPS.includes(k.columns[c]);
  const forward = (enter = false): KeyAction => {
    let c = k.col + 1;
    while (c <= last && skip(c, enter)) c++;
    return c <= last ? { type: "focus", row: k.row, col: c } : { type: "rowEnd", row: k.row };
  };
  const back = (enter = false): KeyAction | null => {
    let c = k.col - 1;
    while (c >= 0 && skip(c, enter)) c--;
    if (c >= 0) return { type: "focus", row: k.row, col: c };
    let prev = last;
    while (prev > 0 && skip(prev, enter)) prev--;
    return k.row > 0 ? { type: "focus", row: k.row - 1, col: prev } : null;
  };
  const vertical = (down: boolean): KeyAction =>
    down
      ? k.row < k.rowCount - 1
        ? { type: "focus", row: k.row + 1, col: k.col }
        : { type: "addButton" }
      : k.row > 0
        ? { type: "focus", row: k.row - 1, col: k.col }
        : { type: "none" };

  if (field === "category" && k.menuOpen) {
    if (k.key === "ArrowDown") return { type: "menuMove", delta: 1 };
    if (k.key === "ArrowUp") return { type: "menuMove", delta: -1 };
    if (k.key === "Enter") return { type: "menuSelect" };
    if (k.key === "Escape") return { type: "menuClose", then: null };
    if (k.key === "Tab") return { type: "menuClose", then: k.shift ? back() : forward() };
    return null;
  }
  if (field === "category" && (k.key === " " || (k.key === "ArrowDown" && k.shift))) return { type: "menuOpen" };

  switch (k.key) {
    case "Enter":
      return k.shift ? (back(true) ?? { type: "none" }) : forward(true);
    case "Tab":
      return k.shift ? back() : forward();
    case "ArrowDown":
    case "ArrowUp":
      return field === "description" ? null : vertical(k.key === "ArrowDown");
    case "t":
    case "T":
      return KIND_TOGGLE_FIELDS.includes(field) ? { type: "toggleKind", row: k.row } : null;
    case " ":
      return field === "kind" ? { type: "toggleKind", row: k.row } : null;
    case "Delete":
      return field === "kind" ? { type: "deleteRow", row: k.row } : null;
    default:
      return null;
  }
}

/** Lisää rivi -painike taulukon lopussa (vanha arbK). */
export function addButtonKeyAction(key: string, shift: boolean, rowCount: number, lastCol: number): KeyAction | { type: "add" } | null {
  if (key === "Enter" || key === " ") return { type: "add" };
  if (key === "ArrowUp" && rowCount > 0) return { type: "focus", row: rowCount - 1, col: 0 };
  if (key === "Tab" && shift && rowCount > 0) return { type: "focus", row: rowCount - 1, col: lastCol };
  return null;
}

// ---------------------------------------------------------------------------
// Luokan valinta numerolla
// ---------------------------------------------------------------------------

/** Aikaikkuna toiselle numerolle (1 → 10, 11 tai 12). */
export const CATEGORY_DIGIT_WINDOW_MS = 700;

export interface DigitResult {
  /** Odottava syöte seuraavaa numeroa varten. */
  buffer: string;
  /** Valitaan heti. */
  select: number | null;
  /** Korostetaan valikossa; valitaan, jos aikaikkuna umpeutuu. */
  highlight: number | null;
}

/**
 * Numeronäppäin luokkavalikossa. Yksiselitteinen numero valitaan heti. Jos
 * numero voi jatkua (1 → 10, 11, 12), odotetaan hetki toista numeroa.
 * Numero, joka ei jatka syötettä, aloittaa uuden.
 */
export function categoryDigit(buffer: string, digit: string, numbers: number[] = FORESTRY_CATEGORIES.map((c) => c.no)): DigitResult {
  const cand = buffer + digit;
  const exact = numbers.includes(Number(cand)) && !cand.startsWith("0");
  const longer = numbers.some((n) => String(n).startsWith(cand) && String(n) !== cand);
  if (exact && !longer) return { buffer: "", select: Number(cand), highlight: Number(cand) };
  if (exact) return { buffer: cand, select: null, highlight: Number(cand) };
  if (longer) return { buffer: cand, select: null, highlight: null };
  if (buffer) return categoryDigit("", digit, numbers);
  return { buffer: "", select: null, highlight: null };
}

/** Pelkän metsäasiakkaan valikon rivit järjestyksessä. Asiakkaan valikko: menuCategories. */
export const MENU_CATEGORIES = FORESTRY_CATEGORIES;

/**
 * Asiakkaan valikon luokat: pelkkä metsäasiakas näkee metsätalouden luokat
 * kuten ennen, maatalousasiakas myös maatalouden luokat. Järjestys on
 * CATEGORIES-listan järjestys (ensin metsä, sitten maatalous ryhmittäin).
 */
export function menuCategories(c: ClientActivities, view: Activity | null = null): Category[] {
  return view ? viewCategories(c, view) : categoriesFor(c);
}

/** Valikon ryhmän otsikko: kun molemmat toiminnot ovat käytössä, metsän ryhmissä näkyy toiminto. */
export function menuGroupLabel(c: Category, both: boolean): string {
  return both && c.activity === "forestry" ? `${ACTIVITY_LABEL.forestry}: ${c.group}` : c.group;
}

export function menuIndexOfNo(no: number, menu: Category[] = MENU_CATEGORIES): number {
  return menu.findIndex((c) => c.no === no);
}

/** Maatalouden investoinnin lajivalinnat (metsätalouden lajit ovat ASSET_CLASSES). */
export function assetChoices(code: string, year: number): { id: string; label: string }[] {
  return code === "agri_asset_purchase" ? agriAssetChoices(year) : [];
}

export { categoryByNo };

// ---------------------------------------------------------------------------
// Tarkistus
// ---------------------------------------------------------------------------

export interface GridValidateOptions {
  year: number;
  propertyIds: string[];
  /** Asiakkaan maatilat (0018). Puuttuva = ei tiloja. */
  farmIds?: string[];
  vatRegistered: boolean;
  /** Investoinnit, jotka rivi voi merkitä myydyiksi (myymättömät ja rivin oma). */
  saleableAssetIds: (row: GridRow) => string[];
  /** Asiakkaan toiminnot. Puuttuva = vain metsätalous kuten ennen. */
  activities?: Activity[];
  /** Investoinnin toiminto: myynnin luokan on oltava saman toiminnon. Puuttuva = metsätalous. */
  assetActivity?: (assetId: string) => Activity | null;
  /** Kirjanpidon näkymä: rivin luokan on oltava tämän toiminnon. Puuttuva = ei rajausta. */
  view?: Activity | null;
}

export const ACTIVITY_MESSAGE = "Asiakas ei harjoita maataloutta. Valitse metsätalouden luokka tai lisää maatalous asiakkaan tietoihin.";
export const FORESTRY_OFF_MESSAGE = "Asiakas ei harjoita metsätaloutta. Valitse maatalouden luokka tai lisää metsätalous asiakkaan tietoihin.";

/** Rivi on väärän toiminnon kirjanpidossa (näkymä rajattu toiminnolle). */
export function viewMessage(view: Activity): string {
  return view === "agriculture"
    ? "Tämä on maatalouden kirjanpito. Valitse maatalouden luokka (21–59), tai kirjaa rivi metsätalouden kirjanpitoon."
    : "Tämä on metsätalouden kirjanpito. Valitse metsätalouden luokka (1–12), tai kirjaa rivi maatalouden kirjanpitoon.";
}

/** Kirjaus kuuluu näkymään: rajaamaton näkymä näyttää kaikki. */
export function inView(categoryCode: string, view: Activity | null): boolean {
  return !view || categoryActivity(categoryCode) === view;
}

export interface ValidGridRow {
  key: string;
  id: string | null;
  bookedOn: string;
  category: string;
  kind: TransactionKind;
  description: string;
  amountGross: number;
  vatRate: number;
  withholding: number;
  businessSharePct: number;
  otherSharePct: number;
  reference: string | null;
  forestPropertyId: string | null;
  farmId: string | null;
  assetRatePct: number | null;
  /** Maatalouden investoinnin lajivalinta (rules.ts parseAgriAssetChoice). */
  agriAssetChoice: string | null;
  saleAssetId: string | null;
}

const errorField = (path: string): RowErrorField => (path === "reference" ? "description" : (path as RowErrorField));

export function validateGridRow(r: GridRow, opts: GridValidateOptions): { ok: true; value: ValidGridRow } | { ok: false; errors: RowErrors } {
  const errors: RowErrors = {};
  const date = normalizeDate(r.bookedOn ?? "", opts.year);
  const parsed = transactionFieldsSchema.safeParse({
    bookedOn: date ?? r.bookedOn ?? "",
    category: r.category,
    description: r.description,
    amountGross: r.amountGross,
    vatRate: r.vatRate,
    withholding: r.withholding,
    businessSharePct: r.businessSharePct ?? "",
    otherSharePct: r.otherSharePct ?? "",
    reference: r.reference,
    forestPropertyId: r.forestPropertyId,
    kind: r.kind,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const f = errorField(String(issue.path[0]));
      if (!errors[f]) errors[f] = issue.message.startsWith("Invalid") ? "Tarkista arvo." : issue.message;
    }
  }
  if (date && Number(date.slice(0, 4)) !== opts.year && !errors.bookedOn) errors.bookedOn = `Päivän on oltava vuonna ${opts.year}.`;
  if (!parsed.success || Object.keys(errors).length) return { ok: false, errors };

  const v = parsed.data;
  const cat = category(v.category)!;
  const activities = opts.activities ?? ["forestry"];
  if (!activities.includes(cat.activity)) errors.category = cat.activity === "agriculture" ? ACTIVITY_MESSAGE : FORESTRY_OFF_MESSAGE;
  else if (opts.view && cat.activity !== opts.view) errors.category = viewMessage(opts.view);
  const vatRate = v.vatRate ?? defaultVatRate(cat.code, v.bookedOn, { vatRegistered: opts.vatRegistered });
  if (v.forestPropertyId && !opts.propertyIds.includes(v.forestPropertyId)) errors.forestPropertyId = "Valitse asiakkaan metsätila.";
  // Maatila vain maatalouden kirjaukselle; metsätalouden rivillä se jätetään pois.
  const farmId = cat.activity === "agriculture" && r.farmId ? r.farmId : null;
  if (farmId && !(opts.farmIds ?? []).includes(farmId)) errors.farmId = "Valitse asiakkaan maatila.";
  if (v.otherSharePct && !allowsOtherShare(cat.code)) errors.otherSharePct = OTHER_SHARE_MESSAGE;
  else if (v.otherSharePct && v.otherSharePct + v.businessSharePct > 100) errors.otherSharePct = "Osuudet ovat yhteensä yli 100 %.";
  const rate = cat.code === "asset_purchase" && r.assetRatePct ? Number(r.assetRatePct) : null;
  const agriChoice = cat.code === "agri_asset_purchase" && r.assetRatePct ? r.assetRatePct : null;
  if (isAssetPurchase(cat.code) && !r.assetId) {
    // Raja koskee toiminnon osuutta, koska vain se on toiminnon hankintamenoa (write.ts).
    if (percentOf(netFromGross(v.amountGross!, vatRate), v.businessSharePct) <= smallAssetLimit(cat.activity)) errors.category = smallAssetMessage(cat.activity);
    else if (cat.code === "asset_purchase" && (!rate || !ASSET_CLASS_PCTS.includes(rate))) errors.asset = ASSET_CLASS_MESSAGE;
    else if (cat.code === "agri_asset_purchase" && (!agriChoice || !parseAgriAssetChoice(agriChoice, Number(v.bookedOn.slice(0, 4))))) errors.asset = AGRI_ASSET_CLASS_MESSAGE;
  }
  if (isAssetSale(cat.code)) {
    if (r.saleAssetId && !opts.saleableAssetIds(r).includes(r.saleAssetId)) errors.asset = SALE_ASSET_MESSAGE;
    else if (r.saleAssetId && (opts.assetActivity?.(r.saleAssetId) ?? "forestry") !== cat.activity) errors.asset = SALE_ASSET_MESSAGE;
    if (!r.saleAssetId && !r.id) errors.asset = SALE_ASSET_MESSAGE;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      key: r.key,
      id: r.id,
      bookedOn: v.bookedOn,
      category: cat.code,
      kind: effectiveKind(cat.code, v.kind),
      description: v.description,
      amountGross: v.amountGross!,
      vatRate,
      withholding: v.withholding ?? 0,
      businessSharePct: v.businessSharePct,
      otherSharePct: allowsOtherShare(cat.code) ? v.otherSharePct : 0,
      reference: v.reference,
      forestPropertyId: v.forestPropertyId,
      farmId,
      assetRatePct: cat.code === "asset_purchase" && !r.assetId ? rate : null,
      agriAssetChoice: cat.code === "agri_asset_purchase" && !r.assetId ? agriChoice : null,
      saleAssetId: isAssetSale(cat.code) ? r.saleAssetId || null : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Suodatin ja haku
// ---------------------------------------------------------------------------

/**
 * Kirjanpidon suodatin: luokka, kuukausi ja hakuteksti. Sama sääntö
 * taulukossa (selaimessa) ja lomakenäkymän luettelossa (palvelimella).
 * Tyhjä kenttä ei rajaa.
 */
export interface LedgerFilter {
  category: string;
  /** 1–12 tai null. */
  month: number | null;
  text: string;
}

export const EMPTY_FILTER: LedgerFilter = { category: "", month: null, text: "" };

export const MONTH_NAMES = ["Tammikuu", "Helmikuu", "Maaliskuu", "Huhtikuu", "Toukokuu", "Kesäkuu", "Heinäkuu", "Elokuu", "Syyskuu", "Lokakuu", "Marraskuu", "Joulukuu"];

export function isFilterActive(f: LedgerFilter): boolean {
  return Boolean(f.category || f.month || f.text.trim());
}

/** Suodatin osoitteen parametreista (?luokka=&kk=&haku=). Kelvoton arvo ei rajaa. */
export function parseLedgerFilter(p: { luokka?: string; kk?: string; haku?: string }): LedgerFilter {
  const month = Number(p.kk);
  return {
    category: p.luokka && category(p.luokka) ? p.luokka : "",
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    text: (p.haku ?? "").slice(0, 100),
  };
}

const fold = (t: string) => t.toLocaleLowerCase("fi-FI").replace(/\s+/g, " ").trim();

/**
 * Vastaako kirjaus suodatinta. Haku osuu selitteeseen, viitteeseen, luokan
 * nimeen ja numeroon. Jos haku on summa (esimerkiksi 1 250,50), se osuu myös
 * kirjaukseen, jonka summa on sama.
 */
export function matchesLedgerFilter(
  t: { bookedOn: string | null; category: string; description: string; reference: string | null; amountGross: number | null },
  f: LedgerFilter,
): boolean {
  if (f.category && t.category !== f.category) return false;
  if (f.month && (!t.bookedOn || Number(t.bookedOn.slice(5, 7)) !== f.month)) return false;
  const q = fold(f.text);
  if (!q) return true;
  const cat = category(t.category);
  const hay = fold([t.description, t.reference ?? "", cat?.label ?? t.category, cat ? String(cat.no) : ""].join(" "));
  if (hay.includes(q)) return true;
  const amount = parseAmount(f.text);
  return amount !== null && !Number.isNaN(amount) && t.amountGross !== null && Math.abs(t.amountGross - amount) < 0.005;
}

/**
 * Taulukon rivin näkyvyys suodattimella. Tallentamattomat rivit näkyvät aina,
 * jotta uusi rivi ja tunnistuksen ehdotus eivät katoa kesken kirjoituksen.
 */
export function gridRowVisible(r: GridRow, f: LedgerFilter, year: number): boolean {
  if (!r.id || !isFilterActive(f)) return true;
  const gross = parseAmount(r.amountGross);
  return matchesLedgerFilter(
    { bookedOn: normalizeDate(r.bookedOn, year), category: r.category, description: r.description, reference: r.reference, amountGross: gross === null || Number.isNaN(gross) ? null : gross },
    f,
  );
}

/**
 * Seuraava näkyvä rivi suunnassa (Enter, nuolet ja rivin loppu ohittavat
 * piilotetut rivit). null, jos suunnassa ei ole näkyvää riviä.
 */
export function nextVisibleRow(visible: boolean[], from: number, target: number): number | null {
  if (target < 0 || target >= visible.length) return null;
  if (visible[target]) return target;
  const dir = target >= from ? 1 : -1;
  for (let i = target + dir; i >= 0 && i < visible.length; i += dir) if (visible[i]) return i;
  return null;
}

// ---------------------------------------------------------------------------
// Muutokset
// ---------------------------------------------------------------------------

/**
 * Rivin vertailumuoto: päivä ja luvut tulkittuina, jotta 25,5 ja 25.5 tai
 * 1 000 ja 1000,00 ovat sama arvo. Tulkitsematon arvo jää tekstiksi, jolloin
 * rivi on muuttunut.
 */
function canonical(r: GridRow, year: number): string {
  const num = (v: string) => {
    const n = parseAmount(v);
    return n === null ? null : Number.isNaN(n) ? `?${v}` : n;
  };
  return JSON.stringify([
    normalizeDate(r.bookedOn, year) ?? r.bookedOn,
    r.description.trim(),
    r.category,
    num(r.amountGross),
    num(r.vatRate),
    num(r.withholding) ?? 0,
    num(r.businessSharePct ?? "") ?? 100,
    num(r.otherSharePct ?? "") ?? 0,
    r.forestPropertyId || null,
    categoryActivity(r.category) === "agriculture" ? r.farmId || null : null,
    rowKind(r),
    r.reference.trim() || null,
    r.assetRatePct || null,
    isAssetSale(r.category) ? r.saleAssetId || null : null,
  ]);
}

export function sameRow(a: GridRow, b: GridRow, year: number): boolean {
  return canonical(a, year) === canonical(b, year);
}

export interface GridChanges {
  created: GridRow[];
  updated: GridRow[];
  deleted: string[];
  /** Rivit, joiden tunnistetta ei ole alkuperäisissä: joku muu on muuttanut vuotta. */
  unknown: GridRow[];
}

/** Erottelee uudet, muuttuneet ja poistetut rivit. Tyhjät uudet rivit ohitetaan. */
export function planGridChanges(original: GridRow[], current: GridRow[], deletedIds: string[], year: number): GridChanges {
  const byId = new Map(original.filter((r) => r.id).map((r) => [r.id!, r]));
  const out: GridChanges = { created: [], updated: [], deleted: [], unknown: [] };
  for (const r of current) {
    if (!r.id) {
      if (!isBlankGridRow(r)) out.created.push(r);
      continue;
    }
    const o = byId.get(r.id);
    if (!o) out.unknown.push(r);
    else if (!sameRow(o, r, year)) out.updated.push(r);
  }
  const present = new Set(current.map((r) => r.id).filter(Boolean));
  for (const id of new Set(deletedIds)) {
    if (!present.has(id)) out.deleted.push(id);
  }
  return out;
}

export function changeCount(c: GridChanges): number {
  return c.created.length + c.updated.length + c.deleted.length;
}

// ---------------------------------------------------------------------------
// Liittäminen Excelistä
// ---------------------------------------------------------------------------

export type PasteField =
  | "bookedOn" | "description" | "category" | "amountGross" | "vatRate" | "withholding" | "forestPropertyId" | "reference" | "businessSharePct" | "otherSharePct";

/**
 * Liitettävät sarakkeet järjestyksessä: taulukon järjestys, sitten ennakonpidätys, metsätila ja viite.
 * Osuus on valinnainen sarake viitteen jälkeen, jotta vanhat Excel-pohjat toimivat ennallaan, ja
 * toisen toiminnon osuus on sen jälkeen viimeisenä.
 */
export function pasteFields(hasProperties: boolean): PasteField[] {
  return hasProperties
    ? ["bookedOn", "description", "category", "amountGross", "vatRate", "withholding", "forestPropertyId", "reference", "businessSharePct", "otherSharePct"]
    : ["bookedOn", "description", "category", "amountGross", "vatRate", "withholding", "reference", "businessSharePct", "otherSharePct"];
}

/** Luokka nimestä, tunnuksesta tai vanhan sovelluksen numerosta. */
export function pastedCategory(text: string): string | null {
  const t = text.trim();
  if (/^\d{1,2}$/.test(t)) return categoryByNo(Number(t))?.code ?? null;
  return resolveCategory(t);
}

/**
 * Liittää solut taulukkoon alkaen annetusta rivistä ja kentästä. Uudet
 * (tallentamattomat) rivit täytetään liitetyiltä osin, tallennettujen kohdalle
 * lisätään uusi rivi, ja puuttuvat rivit lisätään loppuun.
 * Jos ensimmäinen liitetty rivi on otsikkorivi (päivä ei ole päivä eikä summa
 * summa), se ohitetaan, koska Excelistä kopioidaan usein otsikot mukaan.
 * Summat ovat arvonlisäveron kanssa.
 */
export function applyGridPaste(
  rows: GridRow[],
  startRow: number,
  startField: PasteField,
  grid: string[][],
  opts: { year: number; properties: { id: string; name: string }[]; newKey: () => string },
): GridRow[] {
  const fields = pasteFields(opts.properties.length > 0);
  const startCol = fields.indexOf(startField);
  if (startCol < 0) return rows;
  let cells = grid;
  if (cells.length > 1 && startField === "bookedOn") {
    const first = cells[0];
    const amountIdx = fields.indexOf("amountGross") - startCol;
    const amountCell = first[amountIdx];
    const amountOk = amountCell !== undefined && !Number.isNaN(parseAmount(amountCell) ?? Number.NaN);
    if (!normalizeDate(first[0] ?? "", opts.year) && !amountOk) cells = cells.slice(1);
  }
  const out = rows.map((r) => ({ ...r }));
  cells.forEach((line, i) => {
    const idx = startRow + i;
    // Tallennettua kirjausta ei korvata liittämällä: uusi rivi lisätään sen kohdalle,
    // jotta vahingossa liitetty ei muuta vanhoja kirjauksia (ne voi muuttaa kentittäin).
    if (!out[idx]) out.push(emptyGridRow(opts.newKey(), out[idx - 1]?.bookedOn ?? ""));
    else if (out[idx].id) out.splice(idx, 0, emptyGridRow(opts.newKey(), out[idx - 1]?.bookedOn ?? out[idx].bookedOn));
    let r = out[idx];
    line.forEach((value, j) => {
      const field = fields[startCol + j];
      if (!field) return;
      if (field === "bookedOn") {
        const iso = normalizeDate(value, opts.year);
        r = { ...r, bookedOn: iso ? toFinnishDate(iso) : value };
      } else if (field === "category") {
        const code = pastedCategory(value);
        // Tunnettu luokka asettaa tyypin; verokanta jää tyhjäksi (oletus), ellei sitä liitetä.
        r = code ? { ...r, category: code, kind: category(code)!.kind } : { ...r, category: value };
      } else if (field === "forestPropertyId") {
        const t = value.trim().toLowerCase();
        r = { ...r, forestPropertyId: opts.properties.find((p) => p.id === value.trim() || p.name.toLowerCase() === t)?.id ?? value };
      } else {
        r = { ...r, [field]: value };
      }
    });
    out[idx] = r;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Tallennuksen tila
// ---------------------------------------------------------------------------

export type GridSaveState =
  | { status: "idle" }
  | { status: "error"; message: string; rowErrors: Record<string, RowErrors> }
  | { status: "saved"; created: number; updated: number; deleted: number; rows: GridRow[]; suggestionRows?: GridRow[] };
