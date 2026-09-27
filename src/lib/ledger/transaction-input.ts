import { z } from "zod";
import { CATEGORIES, category, defaultVatRate, type TransactionKind } from "@/lib/tax/rules";
import { grossAmount } from "@/lib/ledger/summary";

/**
 * Kirjauksen kenttien tarkistus. Sama skeema palvelee kirjauslomaketta ja
 * taulukkosyöttöä, jotta säännöt ovat yhdessä paikassa. Moduuli on puhdas
 * (ei kantaa, ei Nextiä), joten sitä voi käyttää myös selaimessa esikatseluun.
 */

const blank = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

/**
 * Summa tekstistä. Hyväksyy suomalaisen muodon (1 234,56), euromerkin ja
 * prosenttimerkin, koska Excelistä liitetyissä soluissa ne ovat usein mukana.
 * Tyhjä on null, kelvoton NaN.
 */
export function parseAmount(v: unknown): number | null {
  const e = blank(v);
  if (e === null) return null;
  if (typeof e === "number") return e;
  let s = String(e).replace(/[\s€%]/g, "");
  // Tuhaterottimena piste ja desimaalina pilkku (1.234,56): pisteet pois.
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "");
  s = s.replace(",", ".").replace(/^−/, "-");
  if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return Number.NaN;
  return Number(s);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Päivä muotoon vvvv-kk-pp. Hyväksyy vvvv-kk-pp ja p.k.vvvv. Jos vuosi puuttuu
 * (p.k. tai p.k), käytetään annettua vuotta: taulukossa syötetään yhden
 * verovuoden kirjauksia, joten vuoden kirjoittaminen joka riville on turhaa.
 * Palauttaa null, jos päivää ei ole kalenterissa.
 */
export function normalizeDate(v: string, year?: number): string | null {
  const s = v.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const fi = /^(\d{1,2})\.(\d{1,2})\.?(\d{4})?$/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (fi && (fi[3] || year)) [d, m, y] = [Number(fi[1]), Number(fi[2]), fi[3] ? Number(fi[3]) : year!];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** vvvv-kk-pp → p.k.vvvv taulukon soluun. */
export function toFinnishDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
}

const amount = (min: number, message: string) =>
  z.preprocess((v) => parseAmount(v), z.number({ message }).min(min, message).max(1e10, message).nullable());

/** Kirjauksen perustiedot. Lomake lisää tähän investoinnin kentät. */
export const transactionFieldsSchema = z.object({
  bookedOn: z.preprocess((v) => (typeof v === "string" ? (normalizeDate(v) ?? v) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista päivä.")),
  category: z.string({ message: "Valitse luokka." }).refine((c) => category(c) !== null, "Valitse luokka."),
  description: z.string().max(500, "Selite on liian pitkä.").default(""),
  amountNet: amount(-1e10, "Tarkista summa.").refine((v) => v !== null, "Anna summa ilman arvonlisäveroa."),
  vatRate: amount(0, "Tarkista verokanta.").refine((v) => v === null || v < 100, "Tarkista verokanta."),
  withholding: amount(0, "Tarkista ennakonpidätys."),
  reference: z.preprocess(blank, z.string().max(100, "Viite on liian pitkä.").nullable()),
  // Vapaaehtoinen: kaikki menot eivät kohdistu yhdelle tilalle.
  forestPropertyId: z.preprocess(blank, z.string().uuid("Valitse metsätila.").nullable()),
});

export type TransactionFields = z.infer<typeof transactionFieldsSchema>;

/** Tyhjä verokanta = luokan oletus kirjauksen päivälle. */
export function effectiveVatRate(input: { category: string; bookedOn: string; vatRate: number | null }): number {
  return input.vatRate ?? defaultVatRate(input.category, input.bookedOn);
}

// ---------------------------------------------------------------------------
// Taulukkosyöttö
// ---------------------------------------------------------------------------

/** Taulukon sarakkeet järjestyksessä. Excelistä liitetyt sarakkeet tulkitaan tässä järjestyksessä. */
export const BATCH_FIELDS = ["bookedOn", "category", "description", "amountNet", "vatRate", "withholding", "reference", "forestPropertyId"] as const;
export type BatchField = (typeof BATCH_FIELDS)[number];
export type BatchRowInput = { key: string } & Record<BatchField, string>;
export type RowErrors = Partial<Record<BatchField, string>>;

/** Investoinnit tarvitsevat hyödykkeen lajin tai myytävän investoinnin, joten ne kirjataan lomakkeella. */
export const TABLE_EXCLUDED_CATEGORIES = ["asset_purchase", "asset_sale"];
export const INVESTMENT_HINT = "Investoinnin hankinta ja myynti kirjataan lomakkeella, koska ne tarvitsevat lisätiedot.";
export const MAX_BATCH_ROWS = 500;

export interface ValidBatchRow {
  key: string;
  bookedOn: string;
  category: string;
  kind: TransactionKind;
  description: string;
  amountNet: number;
  vatRate: number;
  withholding: number;
  reference: string | null;
  forestPropertyId: string | null;
}

export type BatchState =
  | { status: "idle" }
  | { status: "error"; message: string; rowErrors: Record<string, RowErrors> }
  | { status: "saved"; count: number };

export function emptyBatchRow(key: string, bookedOn = ""): BatchRowInput {
  return { key, bookedOn, category: "", description: "", amountNet: "", vatRate: "", withholding: "", reference: "", forestPropertyId: "" };
}

/**
 * Tyhjä rivi ohitetaan tallennuksessa: taulukon lopussa on usein tyhjä rivi.
 * Päivää ei lasketa, koska uusi rivi saa sen valmiiksi edelliseltä riviltä.
 */
export function isBlankRow(r: BatchRowInput): boolean {
  return BATCH_FIELDS.every((f) => f === "bookedOn" || !String(r[f] ?? "").trim());
}

export function validateBatchRow(
  raw: BatchRowInput,
  opts: { year: number; propertyIds: string[] },
): { ok: true; value: ValidBatchRow } | { ok: false; errors: RowErrors } {
  const errors: RowErrors = {};
  const date = normalizeDate(raw.bookedOn ?? "", opts.year);
  const result = transactionFieldsSchema.safeParse({ ...raw, bookedOn: date ?? raw.bookedOn ?? "" });
  if (!result.success) {
    for (const issue of result.error.issues) {
      const f = issue.path[0] as BatchField;
      if (BATCH_FIELDS.includes(f) && !errors[f]) errors[f] = issue.message.startsWith("Invalid") ? "Tarkista arvo." : issue.message;
    }
  }
  if (TABLE_EXCLUDED_CATEGORIES.includes(raw.category)) errors.category = INVESTMENT_HINT;
  if (date && Number(date.slice(0, 4)) !== opts.year && !errors.bookedOn) errors.bookedOn = `Päivän on oltava vuonna ${opts.year}.`;
  if (result.success && result.data.forestPropertyId && !opts.propertyIds.includes(result.data.forestPropertyId)) {
    errors.forestPropertyId = "Valitse asiakkaan metsätila.";
  }
  if (!result.success || Object.keys(errors).length) return { ok: false, errors };
  const v = result.data;
  const cat = category(v.category)!;
  return {
    ok: true,
    value: {
      key: raw.key,
      bookedOn: v.bookedOn,
      category: cat.code,
      kind: cat.kind,
      description: v.description,
      amountNet: v.amountNet!,
      vatRate: effectiveVatRate(v),
      withholding: v.withholding ?? 0,
      reference: v.reference,
      forestPropertyId: v.forestPropertyId,
    },
  };
}

/** Koko taulukko: kelvolliset rivit ja virheet rivin avaimella. Tyhjät rivit ohitetaan. */
export function validateBatch(rows: BatchRowInput[], opts: { year: number; propertyIds: string[] }) {
  const valid: ValidBatchRow[] = [];
  const rowErrors: Record<string, RowErrors> = {};
  for (const r of rows) {
    if (isBlankRow(r)) continue;
    const res = validateBatchRow(r, opts);
    if (res.ok) valid.push(res.value);
    else rowErrors[r.key] = res.errors;
  }
  return { valid, rowErrors, hasErrors: Object.keys(rowErrors).length > 0 };
}

/** Rivin esikatselu selaimessa: tehokas verokanta ja summa verollisena, jos ne voi jo laskea. */
export function previewRow(r: BatchRowInput, year: number): { defaultVat: number | null; gross: number | null } {
  const date = normalizeDate(r.bookedOn, year) ?? `${year}-12-31`;
  const cat = category(r.category);
  const defaultVat = cat ? defaultVatRate(cat.code, date) : null;
  const net = parseAmount(r.amountNet);
  const rate = parseAmount(r.vatRate);
  const vat = rate === null ? defaultVat : rate;
  if (net === null || Number.isNaN(net) || vat === null || Number.isNaN(vat)) return { defaultVat, gross: null };
  return { defaultVat, gross: grossAmount(net, vat) };
}

// ---------------------------------------------------------------------------
// Liittäminen Excelistä
// ---------------------------------------------------------------------------

/** Leikepöydän teksti soluiksi: rivit rivinvaihdoilla, sarakkeet sarkaimilla. Lopun tyhjät rivit pois. */
export function parseClipboard(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((l) => l.split("\t").map((c) => c.trim()));
}

/** Luokka nimestä tai tunnuksesta, isoista ja pienistä kirjaimista välittämättä. */
export function resolveCategory(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  return CATEGORIES.find((c) => c.code === t || c.label.toLowerCase() === t || c.legacyName.toLowerCase() === t)?.code ?? null;
}

function pastedValue(field: BatchField, value: string, opts: { year: number; properties: { id: string; name: string }[] }): string {
  if (field === "bookedOn") {
    const iso = normalizeDate(value, opts.year);
    return iso ? toFinnishDate(iso) : value;
  }
  if (field === "category") return resolveCategory(value) ?? value;
  if (field === "forestPropertyId") {
    const t = value.trim().toLowerCase();
    return opts.properties.find((p) => p.id === value.trim() || p.name.toLowerCase() === t)?.id ?? value;
  }
  return value;
}

/**
 * Liittää solut taulukkoon alkaen annetusta rivistä ja sarakkeesta. Olemassa
 * olevat rivit korvataan liitetyiltä osin ja puuttuvat rivit lisätään loppuun.
 * Jos ensimmäinen liitetty rivi on otsikkorivi (päivä ei ole päivä eikä summa
 * summa), se ohitetaan, koska Excelistä kopioidaan usein otsikot mukaan.
 */
export function applyPaste(
  rows: BatchRowInput[],
  startRow: number,
  startCol: number,
  grid: string[][],
  opts: { year: number; properties: { id: string; name: string }[]; fields?: readonly BatchField[]; newKey: () => string },
): BatchRowInput[] {
  const fields = opts.fields ?? BATCH_FIELDS;
  let cells = grid;
  if (cells.length > 1 && fields[startCol] === "bookedOn") {
    const first = cells[0];
    const amountIdx = fields.indexOf("amountNet") - startCol;
    const amountCell = amountIdx >= 0 ? first[amountIdx] : undefined;
    const amountOk = amountCell !== undefined && !Number.isNaN(parseAmount(amountCell) ?? Number.NaN);
    if (!normalizeDate(first[0] ?? "", opts.year) && !amountOk) cells = cells.slice(1);
  }
  const out = rows.map((r) => ({ ...r }));
  cells.forEach((line, i) => {
    const idx = startRow + i;
    if (!out[idx]) out.push(emptyBatchRow(opts.newKey()));
    line.forEach((value, j) => {
      const field = fields[startCol + j];
      if (field) out[idx][field] = pastedValue(field, value, opts);
    });
  });
  return out;
}
