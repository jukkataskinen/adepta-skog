import { z } from "zod";
import { CATEGORIES, category, defaultVatRate, SMALL_ASSET_LIMIT, type TransactionKind } from "@/lib/tax/rules";

/**
 * Kirjauksen kenttien tarkistus. Sama skeema palvelee kirjauslomaketta ja
 * taulukkosyöttöä, jotta säännöt ovat yhdessä paikassa. Moduuli on puhdas
 * (ei kantaa, ei Nextiä), joten sitä voi käyttää myös selaimessa esikatseluun.
 */

/** Investointien viestit: samat lomakkeella, taulukossa ja palvelimella. */
export const SMALL_ASSET_MESSAGE = `Enintään ${SMALL_ASSET_LIMIT} euron hankinta kirjataan vuosimenona. Valitse luokka Muut vuosimenot.`;
export const ASSET_CLASS_MESSAGE = "Valitse hyödykkeen laji: kone, tie tai oja, tai rakennus.";
export const SALE_ASSET_MESSAGE = "Valitse myytävä investointi.";
export const DEPRECIATED_MESSAGE = "Investoinnista on jo tehty poistoja, joten hankintaa ei voi poistaa.";

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

export const SHARE_MESSAGE = "Anna metsätalouden osuus prosentteina: yli 0 ja enintään 100, enintään kaksi desimaalia.";

/**
 * Metsätalouden osuus prosentteina (0013). Tyhjä = 100 %. Hyväksyy pilkun ja
 * prosenttimerkin (50 %, 33,33). Enintään kaksi desimaalia, koska kanta on numeric(5,2).
 */
export const businessShareSchema = z.preprocess(
  (v) => parseAmount(v) ?? 100,
  z
    .number({ message: SHARE_MESSAGE })
    .refine((n) => Number.isFinite(n) && n > 0 && n <= 100, SHARE_MESSAGE)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, SHARE_MESSAGE),
);

const amount = (min: number, message: string) =>
  z.preprocess((v) => parseAmount(v), z.number({ message }).min(min, message).max(1e10, message).nullable());

/** Kirjauksen perustiedot. Lomake lisää tähän investoinnin kentät. */
export const transactionFieldsSchema = z.object({
  bookedOn: z.preprocess((v) => (typeof v === "string" ? (normalizeDate(v) ?? v) : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista päivä.")),
  category: z.string({ message: "Valitse luokka." }).refine((c) => category(c) !== null, "Valitse luokka."),
  description: z.string().max(500, "Selite on liian pitkä.").default(""),
  // Kuitin summa arvonlisäveron kanssa. Veroton osa lasketaan siitä (src/lib/tax/amounts.ts).
  amountGross: amount(-1e10, "Tarkista summa.").refine((v) => v !== null, "Anna summa (sis. alv)."),
  vatRate: amount(0, "Tarkista verokanta.").refine((v) => v === null || v < 100, "Tarkista verokanta."),
  withholding: amount(0, "Tarkista ennakonpidätys."),
  // Osittain vähennettävä kulu: vain osuus kuuluu metsätaloudelle (src/lib/tax/share.ts).
  businessSharePct: businessShareSchema.default(100),
  reference: z.preprocess(blank, z.string().max(100, "Viite on liian pitkä.").nullable()),
  // Vapaaehtoinen: kaikki menot eivät kohdistu yhdelle tilalle.
  forestPropertyId: z.preprocess(blank, z.string().uuid("Valitse metsätila.").nullable()),
  // Tyyppi tulee luokasta. Taulukossa T-näppäin voi kääntää tulon menoksi tai
  // päinvastoin (kuten vanhassa sovelluksessa), joten se voidaan antaa erikseen.
  kind: z.preprocess(blank, z.enum(["income", "expense", "investment"], { message: "Tarkista tyyppi." }).nullable()).default(null),
});

export type TransactionFields = z.infer<typeof transactionFieldsSchema>;

/** Tyhjä verokanta = oletus luokalle, päivälle ja asiakkaalle (rules.ts, defaultVatRate). */
export function effectiveVatRate(
  input: { category: string; bookedOn: string; vatRate: number | null },
  client: { vatRegistered: boolean },
): number {
  return input.vatRate ?? defaultVatRate(input.category, input.bookedOn, client);
}

/**
 * Kirjauksen tyyppi. Investoinnin hankinta ja myynti ovat aina luokkansa
 * tyyppiä, koska investointi syntyy tai myydään niistä. Muissa annettu tulo tai
 * meno säilyy; jos sitä ei annettu, tyyppi tulee luokasta.
 */
export function effectiveKind(categoryCode: string, kind: TransactionKind | null): TransactionKind {
  const cat = category(categoryCode);
  if (!cat) return kind ?? "expense";
  if (cat.kind === "investment" || cat.code === "asset_sale") return cat.kind;
  return kind === "income" || kind === "expense" ? kind : cat.kind;
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
