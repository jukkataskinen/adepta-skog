import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportData } from "./data";

/**
 * Veroraportti PDF:nä (A4): kansilehti sisällysluetteloineen, tulot ja menot
 * sekä verolaskelma, arvonlisävero, poistot, metsävähennys ja kirjausluettelo.
 * Avoimen vuoden raportissa on LUONNOS-vesileima jokaisella sivulla, kuten
 * vanhassa sovelluksessa. Puhdas funktio: tiedot sisään, tavut ulos.
 */

const MM = 72 / 25.4;
const W = 210 * MM;
const H = 297 * MM;
const LEFT = 20 * MM;
const RIGHT = W - 20 * MM;
const TOP = H - 20 * MM;
const BOTTOM = 22 * MM;
const INK = rgb(0.106, 0.165, 0.255);
const MUTED = rgb(0.45, 0.48, 0.53);
const LINE = rgb(0.85, 0.87, 0.9);

const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const date = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
};

/** Vakiofontti (WinAnsi) ei sisällä kaikkia merkkejä; tuntematon merkki korvataan kysymysmerkillä. */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(/−/g, "-")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

type Align = "left" | "right";
interface Col {
  width: number;
  align?: Align;
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = TOP;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private header: string,
  ) {}

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.page.drawText(safe(this.font, this.header), { x: LEFT, y: H - 12 * MM, size: 8, font: this.font, color: MUTED });
    this.y = TOP;
  }

  ensure(space: number) {
    if (this.y - space < BOTTOM) this.newPage();
  }

  text(t: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size + 4);
    this.page.drawText(safe(opts.bold ? this.bold : this.font, t), { x: opts.x ?? LEFT, y: this.y - size, size, font: opts.bold ? this.bold : this.font, color: opts.color ?? INK });
    this.y -= size + (opts.gap ?? 5);
  }

  heading(t: string) {
    this.ensure(40);
    this.y -= 6;
    this.text(t, { size: 15, bold: true, gap: 10 });
  }

  space(mm: number) {
    this.y -= mm * MM;
  }

  /** Taulukon rivi. Leveydet millimetreinä, summa korkeintaan 170 mm. */
  row(cells: string[], cols: Col[], opts: { bold?: boolean; line?: boolean; size?: number } = {}) {
    const size = opts.size ?? 9;
    this.ensure(size + 6);
    const font = opts.bold ? this.bold : this.font;
    let x = LEFT;
    cells.forEach((cell, i) => {
      const col = cols[i];
      const w = col.width * MM;
      let t = safe(font, cell);
      while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -1);
      const tw = font.widthOfTextAtSize(t, size);
      this.page.drawText(t, { x: col.align === "right" ? x + w - tw - 2 : x, y: this.y - size, size, font, color: INK });
      x += w;
    });
    this.y -= size + 5;
    if (opts.line) {
      this.page.drawLine({ start: { x: LEFT, y: this.y + 2 }, end: { x: RIGHT, y: this.y + 2 }, thickness: 0.5, color: LINE });
      this.y -= 3;
    }
  }
}

export async function renderTaxReport(data: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Veroraportti ${data.year}`);
  doc.setCreator("Skog");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draft = data.status === "open";
  const w = new Writer(doc, font, bold, `${data.client.name} · Veroraportti ${data.year}${draft ? " · LUONNOS" : ""}`);
  const toc: { title: string; page: number }[] = [];
  const section = (title: string) => {
    w.newPage();
    // Sivunumero kansilehden kanssa: kansi on sivu 1.
    toc.push({ title, page: w.pages.length + 1 });
    w.heading(title);
  };
  const two: Col[] = [{ width: 120 }, { width: 50, align: "right" }];

  // 1. Tulot, menot ja verolaskelma
  section("Tulot, menot ja verolaskelma");
  if (!data.confirmed) {
    w.text("Verosuunnitelmaa ei ole vahvistettu, joten poistot ja metsävähennys ovat nollia.", { size: 9, color: MUTED, gap: 8 });
  }
  const cat4: Col[] = [{ width: 80 }, { width: 30, align: "right" }, { width: 30, align: "right" }, { width: 30, align: "right" }];
  for (const [kind, title] of [["income", "Tulot"], ["expense", "Menot"], ["investment", "Investoinnit"]] as const) {
    const rows = data.categories.filter((c) => c.kind === kind);
    if (!rows.length) continue;
    w.text(title, { bold: true, size: 11, gap: 6 });
    w.row(["Luokka", "Ilman alv", "Alv", "Yhteensä"], cat4, { bold: true, line: true });
    for (const r of rows) w.row([r.label, eur(r.net), eur(r.vat), eur(r.gross)], cat4);
    w.space(4);
  }
  w.text("Verolaskelma", { bold: true, size: 11, gap: 6 });
  const r = data.result;
  const dep = data.depreciation.reduce((s, d) => s + d.amount, 0);
  const gain = data.depreciation.reduce((s, d) => s + d.saleGain, 0);
  const loss = data.depreciation.reduce((s, d) => s + d.saleLoss, 0);
  w.row(["Tulot ilman arvonlisäveroa", eur(data.plan.income)], two);
  if (gain) w.row(["Myyntivoitot", eur(gain)], two);
  w.row(["Menot", eur(-data.plan.expense)], two);
  if (loss) w.row(["Myyntitappiot", eur(-loss)], two);
  w.row(["Poistot", eur(-dep)], two, { line: true });
  w.row(["Metsätalouden puhdas pääomatulo", eur(r.netBeforeDeduction)], two, { bold: true });
  w.row(["Metsävähennys", eur(-data.plan.recordedDeduction)], two, { line: true });
  w.row(["Verotettava pääomatulo", eur(r.taxable)], two, { bold: true });
  w.row(["Arvioitu vero 30 %", eur(r.tax.low)], two);
  if (r.tax.high) w.row(["Arvioitu vero 34 %", eur(r.tax.high)], two);
  w.row(["Arvioitu vero yhteensä", eur(r.tax.total)], two, { bold: true });
  if (data.plan.withholding) w.row(["Ennakonpidätykset", eur(data.plan.withholding)], two);

  // 2. Arvonlisävero
  section("Arvonlisävero");
  if (!data.client.vatRegistered) w.text("Asiakas ei ole arvonlisäverorekisterissä.", { size: 9, color: MUTED, gap: 8 });
  const vat4: Col[] = [{ width: 70 }, { width: 33, align: "right" }, { width: 33, align: "right" }, { width: 34, align: "right" }];
  w.row(["Jakso", "Myynnin vero", "Ostojen vero", "Maksettava"], vat4, { bold: true, line: true });
  for (const q of data.vat.quarters) w.row([q.label, eur(q.output), eur(q.input), eur(q.payable)], vat4);
  w.row([data.vat.year.label, eur(data.vat.year.output), eur(data.vat.year.input), eur(data.vat.year.payable)], vat4, { bold: true });
  w.space(6);
  if (data.vat.year.byRate.length) {
    w.text("Myynnit verokannoittain", { bold: true, size: 11, gap: 6 });
    const rate3: Col[] = [{ width: 70 }, { width: 50, align: "right" }, { width: 50, align: "right" }];
    w.row(["Verokanta", "Myynti ilman alv", "Vero"], rate3, { bold: true, line: true });
    for (const b of data.vat.year.byRate) w.row([`${b.rate.toLocaleString("fi-FI")} %`, eur(b.net), eur(b.vat)], rate3);
  }

  // 3. Investoinnit ja poistot
  section("Investoinnit ja poistot");
  if (!data.depreciation.length) w.text("Ei investointeja tälle vuodelle.", { size: 9, color: MUTED });
  else {
    const dep5: Col[] = [{ width: 50 }, { width: 35 }, { width: 28, align: "right" }, { width: 28, align: "right" }, { width: 29, align: "right" }];
    w.row(["Investointi", "Poistotapa", "Arvo alussa", "Poisto", "Arvo lopussa"], dep5, { bold: true, line: true });
    for (const d of data.depreciation) {
      w.row([d.description, d.sold ? "Myyty" : d.method, eur(d.bookValueStart), d.sold ? "–" : eur(d.amount), eur(d.bookValueEnd)], dep5);
      if (d.sold) w.text(d.saleGain ? `Myyntivoitto ${eur(d.saleGain)}` : `Myyntitappio ${eur(d.saleLoss)}`, { size: 8, color: MUTED, x: LEFT + 4 });
    }
  }

  // 4. Metsätilat ja metsävähennys
  section("Metsävähennys");
  if (!data.properties.length) w.text("Ei metsätiloja.", { size: 9, color: MUTED });
  else {
    const p4: Col[] = [{ width: 80 }, { width: 45, align: "right" }, { width: 45, align: "right" }];
    w.row(["Metsätila", "Pohjaa ennen vuotta", "Vähennys tänä vuonna"], p4, { bold: true, line: true });
    for (const p of data.properties) w.row([p.name, p.remainingBefore === null ? "Tiedot puuttuvat" : eur(p.remainingBefore), eur(p.deduction)], p4);
    w.row(["Yhteensä", "", eur(data.plan.recordedDeduction)], p4, { bold: true });
  }

  // 5. Kirjausluettelo
  section("Kirjausluettelo");
  const t6: Col[] = [{ width: 22 }, { width: 38 }, { width: 50 }, { width: 25, align: "right" }, { width: 12, align: "right" }, { width: 23, align: "right" }];
  w.row(["Päivä", "Luokka", "Selite", "Ilman alv", "Alv %", "Yhteensä"], t6, { bold: true, line: true, size: 8 });
  for (const t of data.transactions) {
    w.row([date(t.bookedOn), t.category, t.description, eur(t.net), t.vatRate.toLocaleString("fi-FI"), eur(t.gross)], t6, { size: 8 });
  }
  if (!data.transactions.length) w.text("Ei kirjauksia.", { size: 9, color: MUTED });

  // Kansilehti viimeisenä, kun sivunumerot tiedetään.
  const cover = doc.insertPage(0, [W, H]);
  let y = H - 60 * MM;
  const put = (t: string, size: number, isBold = false, color = INK) => {
    cover.drawText(safe(isBold ? bold : font, t), { x: LEFT, y, size, font: isBold ? bold : font, color });
    y -= size + 6;
  };
  put(`Veroraportti ${data.year}`, 28, true);
  put("Metsätalouden kirjanpito ja verolaskelma", 12, false, MUTED);
  y -= 10 * MM;
  put(data.client.name, 16, true);
  if (data.client.businessId) put(`Y-tunnus ${data.client.businessId}`, 10);
  if (data.client.address) put(data.client.address, 10);
  if (data.client.municipality) put(`Kotikunta ${data.client.municipality}`, 10);
  y -= 8 * MM;
  put(draft ? "LUONNOS: verovuosi on avoin, luvut voivat muuttua." : `Vahvistettu. Verovuosi suljettu ${data.closedAt ? date(data.closedAt) : ""}.`, 10, true, draft ? rgb(0.75, 0.35, 0.2) : INK);
  put(`Laadittu ${date(data.generatedAt)}`, 9, false, MUTED);
  y -= 12 * MM;
  put("Sisällys", 13, true);
  for (const e of toc) {
    const label = safe(font, e.title);
    cover.drawText(label, { x: LEFT, y, size: 11, font, color: INK });
    const num = String(e.page);
    cover.drawText(num, { x: RIGHT - font.widthOfTextAtSize(num, 11), y, size: 11, font, color: INK });
    y -= 17;
  }
  let fy = BOTTOM + 20;
  for (const line of [data.office.name, data.office.businessId ? `Y-tunnus ${data.office.businessId}` : null, data.office.address, [data.office.email, data.office.phone].filter(Boolean).join(" · ") || null].filter(Boolean) as string[]) {
    cover.drawText(safe(font, line), { x: LEFT, y: fy, size: 9, font, color: MUTED });
    fy -= 12;
  }

  // Sivunumerot ja vesileima kaikille sivuille.
  const all = doc.getPages();
  all.forEach((p, i) => {
    const n = `${i + 1} / ${all.length}`;
    p.drawText(n, { x: RIGHT - font.widthOfTextAtSize(n, 8), y: 12 * MM, size: 8, font, color: MUTED });
    if (draft) {
      p.drawText("LUONNOS", { x: 45 * MM, y: 90 * MM, size: 96, font: bold, color: rgb(0.85, 0.3, 0.2), opacity: 0.1, rotate: degrees(40) });
    }
  });
  return doc.save();
}
