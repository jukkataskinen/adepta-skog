import { CATEGORIES, category, categoryByNo, defaultVatRate, SMALL_ASSET_LIMIT, TIMBER_SALE_CODES, type TransactionKind } from "@/lib/tax/rules";
import { netFromGross } from "@/lib/tax/amounts";
import type { PendingSuggestion } from "@/lib/documents/receipt-suggestions";
import {
  ASSET_CLASS_MESSAGE,
  effectiveKind,
  normalizeDate,
  parseAmount,
  resolveCategory,
  SALE_ASSET_MESSAGE,
  SMALL_ASSET_MESSAGE,
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
  withholding: string;
  forestPropertyId: string;
  /** Tyhjä = luokan tyyppi. */
  kind: TransactionKind | "";
  /** Viite säilyy muokatessa, vaikka taulukossa ei ole sille saraketta. */
  reference: string;
  /** Uusi hankinta: hyödykelaji (menojäännöspoiston prosentti). */
  assetRatePct: string;
  /** Myynti: myytävä investointi. */
  saleAssetId: string;
  /** Näyttötiedot tallennetusta rivistä. Eivät vaikuta tallennukseen. */
  assetId?: string | null;
  assetDescription?: string | null;
  documentCount?: number;
  /** Tositteen tunnistuksen ehdotus, josta rivi on tehty. Tallennuksessa rivi hyväksyy ehdotuksen. */
  suggestionId?: string | null;
  /** Ehdotuksen näyttötiedot. Eivät vaikuta tallennukseen. */
  suggestion?: SuggestionInfo;
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
}

export type GridField = "bookedOn" | "description" | "category" | "amountGross" | "vatRate" | "forestPropertyId" | "kind";
export type RowErrorField = GridField | "withholding" | "asset";
export type RowErrors = Partial<Record<RowErrorField, string>>;

/** Näppäimillä kuljettavat sarakkeet vanhan sovelluksen järjestyksessä. Metsätila vain, jos asiakkaalla on tiloja. */
export function gridColumns(hasProperties: boolean): GridField[] {
  return hasProperties
    ? ["bookedOn", "description", "category", "amountGross", "vatRate", "forestPropertyId", "kind"]
    : ["bookedOn", "description", "category", "amountGross", "vatRate", "kind"];
}

export const MAX_GRID_ROWS = 2000;

export function emptyGridRow(key: string, bookedOn = ""): GridRow {
  return {
    key, id: null, bookedOn, description: "", category: "", amountGross: "", vatRate: "", withholding: "", forestPropertyId: "", kind: "",
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
  reference: string | null;
  asset_id: string | null;
  asset_description?: string | null;
  forest_property_id: string | null;
  document_count?: number;
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
    withholding: withholding ? formatAmountInput(withholding) : "",
    forestPropertyId: t.forest_property_id ?? "",
    kind: t.kind,
    reference: t.reference ?? "",
    assetRatePct: "",
    saleAssetId: t.category === "asset_sale" ? (t.asset_id ?? "") : "",
    assetId: t.asset_id,
    assetDescription: t.asset_description ?? null,
    documentCount: t.document_count ?? 0,
  };
}

/**
 * Tunnistuksen ehdotus taulukon riveiksi. Rivit ovat uusia (id null), joten ne
 * tallentuvat vasta taulukon tallennuksessa. Avain on ehdotuksen ja rivin
 * mukaan pysyvä, jotta sivun päivitys ei tuo samoja rivejä kahdesti.
 * Jos asiakas ei ole arvonlisäverorekisterissä, alv on 0 % kuten muillakin
 * uusilla riveillä: kulu on koko kuitin summa. Puuttuva päivä täytetään
 * oletuspäivällä, ja rivi näyttää siitä varoituksen.
 */
export function rowsFromSuggestion(s: PendingSuggestion, opts: { vatRegistered: boolean; defaultDate: string }): GridRow[] {
  return s.lines.map((l, i) => {
    const cat = category(l.category);
    return {
      ...emptyGridRow(`s-${s.id}-${i}`, l.date ? toFinnishDate(l.date) : opts.defaultDate),
      description: l.description,
      category: cat ? cat.code : "",
      kind: cat ? cat.kind : "",
      amountGross: formatAmountInput(l.amountGross),
      vatRate: numberInput(opts.vatRegistered ? l.vatRate : 0),
      withholding: l.withholding > 0 && TIMBER_SALE_CODES.includes(l.category) ? formatAmountInput(l.withholding) : "",
      suggestionId: s.id,
      suggestion: {
        documentId: s.document_id, documentName: s.file_name, confidence: l.confidence, reasoning: l.reasoning, first: i === 0, sourceDate: l.date,
      },
    };
  });
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
    [r.description, r.category, r.amountGross, r.vatRate, r.withholding, r.forestPropertyId, r.reference, r.assetRatePct, r.saleAssetId].every(
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

export function rowKind(r: GridRow): TransactionKind | null {
  if (!category(r.category)) return r.kind || null;
  return effectiveKind(r.category, r.kind || null);
}

/** Tyyppi voidaan kääntää tulosta menoksi ja takaisin, paitsi investoinneissa. */
export function toggleKind(r: GridRow): GridRow {
  const current = rowKind(r);
  if (!current || current === "investment" || r.category === "asset_sale" || r.category === "asset_purchase") return r;
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
    assetRatePct: cat.code === "asset_purchase" ? r.assetRatePct : "",
    saleAssetId: cat.code === "asset_sale" ? r.saleAssetId : "",
  };
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
const KIND_TOGGLE_FIELDS: GridField[] = ["bookedOn", "amountGross", "vatRate", "kind"];

/**
 * Mitä näppäin tekee taulukossa. null = selaimen oletus (esimerkiksi kirjoitus kenttään).
 * - Enter ja Tab: seuraava kenttä, rivin lopussa seuraava tai uusi rivi. Shift: takaisin.
 * - Nuolet ylös ja alas: sama sarake edellisellä tai seuraavalla rivillä,
 *   paitsi selitteessä (tekstin muokkaus) ja avoimessa luokkavalikossa.
 * - T kääntää tulon ja menon, Delete viimeisessä sarakkeessa poistaa rivin.
 */
export function gridKeyAction(k: KeyInput): KeyAction | null {
  if (k.ctrl) return null;
  const field = k.columns[k.col];
  const last = k.columns.length - 1;
  const forward = (): KeyAction => (k.col < last ? { type: "focus", row: k.row, col: k.col + 1 } : { type: "rowEnd", row: k.row });
  const back = (): KeyAction | null =>
    k.col > 0 ? { type: "focus", row: k.row, col: k.col - 1 } : k.row > 0 ? { type: "focus", row: k.row - 1, col: last } : null;
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
      return k.shift ? (back() ?? { type: "none" }) : forward();
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
export function categoryDigit(buffer: string, digit: string, numbers: number[] = CATEGORIES.map((c) => c.no)): DigitResult {
  const cand = buffer + digit;
  const exact = numbers.includes(Number(cand)) && !cand.startsWith("0");
  const longer = numbers.some((n) => String(n).startsWith(cand) && String(n) !== cand);
  if (exact && !longer) return { buffer: "", select: Number(cand), highlight: Number(cand) };
  if (exact) return { buffer: cand, select: null, highlight: Number(cand) };
  if (longer) return { buffer: cand, select: null, highlight: null };
  if (buffer) return categoryDigit("", digit, numbers);
  return { buffer: "", select: null, highlight: null };
}

/** Valikon rivit järjestyksessä: sama järjestys kuin CATEGORIES (ryhmittäin). */
export const MENU_CATEGORIES = CATEGORIES;

export function menuIndexOfNo(no: number): number {
  return MENU_CATEGORIES.findIndex((c) => c.no === no);
}

export { categoryByNo };

// ---------------------------------------------------------------------------
// Tarkistus
// ---------------------------------------------------------------------------

export interface GridValidateOptions {
  year: number;
  propertyIds: string[];
  vatRegistered: boolean;
  /** Investoinnit, jotka rivi voi merkitä myydyiksi (myymättömät ja rivin oma). */
  saleableAssetIds: (row: GridRow) => string[];
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
  reference: string | null;
  forestPropertyId: string | null;
  assetRatePct: number | null;
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
  const vatRate = v.vatRate ?? defaultVatRate(cat.code, v.bookedOn, { vatRegistered: opts.vatRegistered });
  if (v.forestPropertyId && !opts.propertyIds.includes(v.forestPropertyId)) errors.forestPropertyId = "Valitse asiakkaan metsätila.";
  const rate = r.assetRatePct ? Number(r.assetRatePct) : null;
  if (cat.code === "asset_purchase" && !r.assetId) {
    if (netFromGross(v.amountGross!, vatRate) <= SMALL_ASSET_LIMIT) errors.category = SMALL_ASSET_MESSAGE;
    else if (!rate) errors.asset = ASSET_CLASS_MESSAGE;
  }
  if (cat.code === "asset_sale") {
    if (r.saleAssetId && !opts.saleableAssetIds(r).includes(r.saleAssetId)) errors.asset = SALE_ASSET_MESSAGE;
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
      reference: v.reference,
      forestPropertyId: v.forestPropertyId,
      assetRatePct: cat.code === "asset_purchase" && !r.assetId ? rate : null,
      saleAssetId: cat.code === "asset_sale" ? r.saleAssetId || null : null,
    },
  };
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
    r.forestPropertyId || null,
    rowKind(r),
    r.reference.trim() || null,
    r.assetRatePct || null,
    r.category === "asset_sale" ? r.saleAssetId || null : null,
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

export type PasteField = "bookedOn" | "description" | "category" | "amountGross" | "vatRate" | "withholding" | "forestPropertyId" | "reference";

/** Liitettävät sarakkeet järjestyksessä: taulukon järjestys, sitten ennakonpidätys, metsätila ja viite. */
export function pasteFields(hasProperties: boolean): PasteField[] {
  return hasProperties
    ? ["bookedOn", "description", "category", "amountGross", "vatRate", "withholding", "forestPropertyId", "reference"]
    : ["bookedOn", "description", "category", "amountGross", "vatRate", "withholding", "reference"];
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
  | { status: "saved"; created: number; updated: number; deleted: number; rows: GridRow[] };
