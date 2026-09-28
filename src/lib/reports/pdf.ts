import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { forestSaleLines } from "@/lib/tax/forest-sale";
import { ADDITIONAL_PREPAYMENT_MIN, additionalPrepaymentDueDate, annualVatDueDate } from "@/lib/tax/rules";
import { formatSharePct } from "@/lib/tax/share";
import { priorOpeningText } from "@/lib/tax/load";
import type { ReportData } from "./data";

/**
 * Veroraportti PDF:nä (A4): kansilehti, sisällysluettelo, tulot ja menot
 * sekä verolaskelma, arvonlisävero, poistot, metsävähennys ja kirjausluettelo.
 * Avoimen vuoden raportissa on LUONNOS-vesileima jokaisella sivulla, kuten
 * vanhassa sovelluksessa. Puhdas funktio: tiedot sisään, tavut ulos.
 *
 * Ulkoasu mukailee vanhan sovelluksen raporttia (tumma kansi, numeroitu
 * sisällysluettelo, pienin kapitein kirjoitetut sivuotsikot, tummat
 * taulukko-otsikot, tulo- ja menorivien kevyt sävytys), mutta väreinä ovat
 * Skogin tumma sininen ja neutraalit sävyt. Vihreää on vain pieninä korosteina.
 */

const MM = 72 / 25.4;
const W = 210 * MM;
const H = 297 * MM;
const LEFT = 20 * MM;
const RIGHT = W - 20 * MM;
const TOP = H - 24 * MM;
const BOTTOM = 22 * MM;

// Värit: src/app/globals.css (ink, cloud, line, moss, coral).
const INK = rgb(0x1b / 255, 0x2a / 255, 0x41 / 255);
const INK_STRONG = rgb(0x12 / 255, 0x1d / 255, 0x2e / 255);
const INK_SOFT = rgb(0x26 / 255, 0x37 / 255, 0x52 / 255);
const MUTED = rgb(0.43, 0.47, 0.53);
const LINE = rgb(0xdf / 255, 0xe6 / 255, 0xf0 / 255);
const PAPER = rgb(0.965, 0.96, 0.945);
const INCOME_TINT = rgb(0.945, 0.965, 0.955);
const EXPENSE_TINT = rgb(0.985, 0.95, 0.945);
const ACCENT = rgb(0x2e / 255, 0x9e / 255, 0x6b / 255);
const ACCENT_DARK = rgb(0x1f / 255, 0x6f / 255, 0x4b / 255);
const WHITE = rgb(1, 1, 1);
const ON_DARK = rgb(0.78, 0.82, 0.88);
const ON_DARK_MUTED = rgb(0.55, 0.6, 0.68);
const NEGATIVE = rgb(0.55, 0.13, 0.13);

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

/** Katkaisee tekstin riveiksi annettuun leveyteen. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of safe(font, text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

type Align = "left" | "right";
interface Col {
  width: number;
  align?: Align;
}
type Tone = "income" | "expense" | "total" | "result";

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
}

class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = TOP;
  private label = "";
  constructor(
    private doc: PDFDocument,
    private f: Fonts,
    private header: string,
  ) {}

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    const h = safe(this.f.regular, this.header);
    this.page.drawText(h, { x: LEFT, y: H - 13 * MM, size: 7.5, font: this.f.regular, color: MUTED });
    this.page.drawLine({ start: { x: LEFT, y: H - 15 * MM }, end: { x: RIGHT, y: H - 15 * MM }, thickness: 0.4, color: LINE });
    this.y = TOP;
  }

  ensure(space: number) {
    if (this.y - space < BOTTOM) {
      this.newPage();
      // Jatkosivulla toistetaan sivun otsikko, jotta lukija tietää, missä osassa ollaan.
      if (this.label) this.pageLabel(`${this.label} (jatkuu)`);
    }
  }

  /** Sivun otsikko pienin kapitein ja paksun viivan kanssa, kuten vanhassa raportissa. */
  pageLabel(t: string) {
    const text = safe(this.f.bold, t.toUpperCase());
    this.page.drawText(text, { x: LEFT, y: this.y - 9, size: 9, font: this.f.bold, color: MUTED });
    this.y -= 15;
    this.page.drawLine({ start: { x: LEFT, y: this.y }, end: { x: RIGHT, y: this.y }, thickness: 1.6, color: INK });
    this.y -= 16;
  }

  section(label: string) {
    this.label = label;
    this.pageLabel(label);
  }

  text(t: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number; serif?: boolean } = {}) {
    const size = opts.size ?? 10;
    const font = opts.serif ? this.f.serif : opts.bold ? this.f.bold : this.f.regular;
    const x = opts.x ?? LEFT;
    for (const line of wrap(font, t, size, RIGHT - x)) {
      this.ensure(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= opts.gap ?? 3;
  }

  /** Väliotsikko serif-kirjaimin. */
  subheading(t: string) {
    this.ensure(40);
    this.y -= 4;
    this.text(t, { size: 13, serif: true, gap: 6 });
  }

  space(mm: number) {
    this.y -= mm * MM;
  }

  /** Taulukon otsikkorivi: tumma pohja, vaalea teksti. */
  head(cells: string[], cols: Col[], size = 7.5) {
    this.ensure(size + 30);
    const h = size + 9;
    this.page.drawRectangle({ x: LEFT, y: this.y - h, width: RIGHT - LEFT, height: h, color: INK });
    this.cells(cells.map((c) => c.toUpperCase()), cols, { size, font: this.f.bold, color: WHITE, top: this.y - 5 });
    this.y -= h;
  }

  /** Taulukon rivi. Leveydet millimetreinä, summa korkeintaan 170 mm. */
  row(cells: string[], cols: Col[], opts: { bold?: boolean; size?: number; tone?: Tone; color?: ReturnType<typeof rgb> } = {}) {
    const size = opts.size ?? 9;
    const h = size + 8;
    this.ensure(h);
    const fill = opts.tone === "income" ? INCOME_TINT : opts.tone === "expense" ? EXPENSE_TINT : opts.tone === "total" || opts.tone === "result" ? PAPER : null;
    if (fill) this.page.drawRectangle({ x: LEFT, y: this.y - h, width: RIGHT - LEFT, height: h, color: fill });
    if (opts.tone === "total" || opts.tone === "result") {
      this.page.drawLine({ start: { x: LEFT, y: this.y }, end: { x: RIGHT, y: this.y }, thickness: opts.tone === "result" ? 1.2 : 0.8, color: opts.tone === "result" ? INK : MUTED });
    }
    const bold = opts.bold || opts.tone === "total" || opts.tone === "result";
    this.cells(cells, cols, { size: opts.tone === "result" ? size + 1 : size, font: bold ? this.f.bold : this.f.regular, color: opts.color ?? INK, top: this.y - 4 });
    this.y -= h;
    this.page.drawLine({ start: { x: LEFT, y: this.y }, end: { x: RIGHT, y: this.y }, thickness: 0.4, color: LINE });
  }

  private cells(cells: string[], cols: Col[], o: { size: number; font: PDFFont; color: ReturnType<typeof rgb>; top: number }) {
    let x = LEFT;
    cells.forEach((cell, i) => {
      const col = cols[i];
      const w = col.width * MM;
      let t = safe(o.font, cell);
      while (t.length > 1 && o.font.widthOfTextAtSize(t, o.size) > w - 6) t = t.slice(0, -1);
      const tw = o.font.widthOfTextAtSize(t, o.size);
      this.page.drawText(t, { x: col.align === "right" ? x + w - tw - 3 : x + 3, y: o.top - o.size, size: o.size, font: o.font, color: o.color });
      x += w;
    });
  }

  /** Tiivis yhteenveto: nimike vasemmalla, summa oikealla, viimeiset rivit korostettuina. */
  summaryTable(rows: [string, string][]) {
    const cols: Col[] = [{ width: 120 }, { width: 50, align: "right" }];
    rows.forEach(([label, value]) => {
      const strong = label.startsWith("Verotettava") || label.startsWith("Arvioitu");
      this.row([label, value], cols, strong ? { tone: "total" } : {});
    });
    this.y -= 8 * MM;
  }

  /** Kaksi maksulaatikkoa rinnakkain, kuten vanhan raportin maksutiedote. */
  paymentBoxes(...boxes: { title: string; amount: string; tone: "pay" | "refund" | "none"; lead: string; lines: string[] }[]) {
    const gap = 5 * MM;
    const width = (RIGHT - LEFT - gap) / 2;
    const pad = 5 * MM;
    const heightOf = (b: (typeof boxes)[number]) =>
      18 + 30 + 14 + wrap(this.f.regular, b.lead, 8.5, width - 2 * pad).length * 11 + 8 + b.lines.reduce((h, l) => h + wrap(this.f.regular, l, 8.5, width - 2 * pad).length * 11 + 2, 0) + pad;
    const h = Math.max(...boxes.map(heightOf));
    this.ensure(h + 10);
    boxes.forEach((b, i) => {
      const x = LEFT + i * (width + gap);
      const top = this.y;
      this.page.drawRectangle({ x, y: top - h, width, height: h, borderColor: LINE, borderWidth: 0.8, color: WHITE });
      const color = b.tone === "pay" ? NEGATIVE : b.tone === "refund" ? ACCENT_DARK : INK;
      this.page.drawRectangle({ x, y: top - h, width: 2.4, height: h, color: b.tone === "pay" ? NEGATIVE : b.tone === "refund" ? ACCENT : LINE });
      let y = top - pad - 7;
      this.page.drawText(safe(this.f.bold, b.title.toUpperCase()), { x: x + pad, y, size: 7.5, font: this.f.bold, color: MUTED });
      y -= 30;
      this.page.drawText(safe(this.f.bold, b.amount), { x: x + pad, y, size: 22, font: this.f.bold, color });
      y -= 16;
      for (const l of wrap(this.f.bold, b.lead, 8.5, width - 2 * pad)) {
        this.page.drawText(l, { x: x + pad, y, size: 8.5, font: this.f.bold, color: INK });
        y -= 11;
      }
      y -= 6;
      for (const line of b.lines) {
        for (const l of wrap(this.f.regular, line, 8.5, width - 2 * pad)) {
          this.page.drawText(l, { x: x + pad, y, size: 8.5, font: this.f.regular, color: INK });
          y -= 11;
        }
        y -= 2;
      }
    });
    this.y -= h + 6 * MM;
  }

  /** Tunnuslukulaatikot rivissä (vanhan raportin mt-box). */
  figures(items: { label: string; value: string; accent?: boolean; negative?: boolean }[]) {
    const h = 20 * MM;
    this.ensure(h + 8);
    const gap = 4 * MM;
    const width = (RIGHT - LEFT - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const x = LEFT + i * (width + gap);
      this.page.drawRectangle({ x, y: this.y - h, width, height: h, borderColor: LINE, borderWidth: 0.8, color: WHITE });
      if (it.accent) this.page.drawRectangle({ x, y: this.y - h, width: 2.2, height: h, color: ACCENT });
      this.page.drawText(safe(this.f.bold, it.label.toUpperCase()), { x: x + 4 * MM, y: this.y - 6 * MM, size: 7, font: this.f.bold, color: MUTED });
      this.page.drawText(safe(this.f.bold, it.value), {
        x: x + 4 * MM, y: this.y - 15 * MM, size: 15, font: this.f.bold, color: it.negative ? NEGATIVE : it.accent ? ACCENT_DARK : INK,
      });
    });
    this.y -= h + 8 * MM;
  }
}

const SECTIONS: { title: string; description: string }[] = [
  { title: "Yhteenveto ja maksutiedote", description: "Tuleeko veroa maksettavaksi vai palautusta, ja paljonko arvonlisäveroa tilitetään ja milloin." },
  { title: "Tulot, menot ja verolaskelma", description: "Tulot ja menot luokittain, poistot, metsävähennys ja arvioitu pääomatulon vero." },
  { title: "Arvonlisävero", description: "Myynnin ja ostojen vero neljänneksittäin ja koko vuodelta sekä myynnit verokannoittain." },
  { title: "Investoinnit ja poistot", description: "Investoinnit poistamattomine arvoineen, vuoden poistot ja myynnit." },
  { title: "Metsävähennys", description: "Metsävähennyksen pohja tiloittain, vuoden vähennys ja metsätilojen myynnit." },
  { title: "Kirjausluettelo", description: "Kaikki verovuoden kirjaukset päivämäärineen, luokkineen ja summineen." },
];

export async function renderTaxReport(data: ReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Veroraportti ${data.year}`);
  doc.setCreator("Skog");
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    serif: await doc.embedFont(StandardFonts.TimesRoman),
  };
  const draft = data.status === "open";
  const w = new Writer(doc, f, `${data.client.name} · Veroraportti ${data.year}${draft ? " · LUONNOS" : ""}`);
  const toc: number[] = [];
  const section = (index: number) => {
    w.newPage();
    // Sivunumero kannen ja sisällysluettelon kanssa: ne ovat sivut 1 ja 2.
    toc[index] = w.pages.length + 2;
    w.section(`${SECTIONS[index].title} · Verovuosi ${data.year}`);
  };
  const two: Col[] = [{ width: 120 }, { width: 50, align: "right" }];

  const r = data.result;
  const dep = data.depreciation.reduce((s, d) => s + d.amount, 0);

  // 1. Yhteenveto ja maksutiedote: kaksi asiakkaan tärkeintä kysymystä.
  section(0);
  const taxLeft = Math.round((r.tax.total - data.plan.withholding) * 100) / 100;
  w.summaryTable([
    ["Tulot ilman arvonlisäveroa", eur(data.plan.income)],
    ["Menot ja poistot", eur(-(data.plan.expense + dep))],
    ["Metsävähennys ja yrittäjävähennys", eur(-(data.plan.recordedDeduction + r.entrepreneurDeduction))],
    ...(r.saleResult ? ([["Luovutusvoitot ja -tappiot", eur(r.saleResult)]] as [string, string][]) : []),
    ["Verotettava pääomatulo", eur(r.taxable)],
    ["Arvioitu pääomatulon vero", eur(r.tax.total)],
    ["Ennakonpidätykset", eur(-data.plan.withholding)],
  ]);
  const vatPayable = data.vat.year.payable;
  const vatRef = data.client.taxAccountReference;
  w.paymentBoxes(
    {
      title: "Pääomatulon vero",
      amount: eur(Math.abs(taxLeft)),
      tone: taxLeft > 0 ? "pay" : "refund",
      lead: taxLeft > 0 ? "Arviolta maksettavaa (jäännösvero eli mätky)" : taxLeft < 0 ? "Arviolta palautusta" : "Ei maksettavaa eikä palautusta",
      lines:
        taxLeft > 0
          ? [
              "Mätkyjä ja korkoa voi välttää lisäennakolla.",
              `Pyydä lisäennakko OmaVerossa ja maksa se viimeistään ${date(additionalPrepaymentDueDate(data.year))}. Silloin korkoa ei tule.`,
              `Lisäennakon vähimmäismäärä on ${ADDITIONAL_PREPAYMENT_MIN} €. Tilinumero ja viite näkyvät OmaVerossa.`,
            ]
          : taxLeft < 0
            ? ["Ennakonpidätykset ovat arvioitua veroa suuremmat.", "Verohallinto palauttaa erotuksen, kun verotus valmistuu."]
            : ["Ennakonpidätykset kattavat arvioidun veron."],
    },
    !data.client.vatRegistered
      ? { title: "Arvonlisävero", amount: "–", tone: "none", lead: "Asiakas ei ole arvonlisäverorekisterissä", lines: ["Arvonlisäveroa ei tilitetä."] }
      : {
          title: "Arvonlisävero",
          amount: eur(Math.abs(vatPayable)),
          tone: vatPayable > 0 ? "pay" : vatPayable < 0 ? "refund" : "none",
          lead: vatPayable > 0 ? "Tilitettävä (myynnin vero miinus ostojen vero)" : vatPayable < 0 ? "Palautettava" : "Ei tilitettävää",
          lines: [
            `Verokausi kalenterivuosi ${data.year}.`,
            vatPayable < 0
              ? `Anna arvonlisäveroilmoitus OmaVerossa viimeistään ${date(annualVatDueDate(data.year))}. Verohallinto palauttaa veron.`
              : `Ilmoita ja maksa viimeistään ${date(annualVatDueDate(data.year))}.`,
            ...(vatPayable > 0
              ? ["Maksunsaaja: Verohallinto.", vatRef ? `Viite: ${vatRef} (oma-aloitteiset verot).` : "Viite: oma-aloitteisten verojen viite OmaVerosta.", "Tilinumero näkyy OmaVerossa."]
              : []),
          ],
        },
  );
  w.text(
    "Maksutiedote on laskettu kirjanpidon tiedoista. Lopulliset verot vahvistetaan verotuksessa. Arvio ei ota huomioon asiakkaan muita pääomatuloja. Tarkista summat aina OmaVerosta ennen maksua.",
    { size: 8, color: MUTED },
  );

  // 2. Tulot, menot ja verolaskelma
  section(1);
  w.figures([
    { label: "Verotettava pääomatulo", value: eur(r.taxable) },
    { label: "Arvioitu vero", value: eur(r.tax.total), accent: true },
    { label: "Ennakonpidätykset", value: eur(data.plan.withholding) },
  ]);
  if (!data.confirmed) {
    w.text("Verosuunnitelmaa ei ole vahvistettu, joten poistot ja metsävähennys ovat nollia.", { size: 9, color: MUTED, gap: 8 });
  }
  const cat4: Col[] = [{ width: 80 }, { width: 30, align: "right" }, { width: 30, align: "right" }, { width: 30, align: "right" }];
  for (const [kind, title, tone] of [["income", "Tulot", "income"], ["expense", "Menot", "expense"], ["investment", "Investoinnit", undefined]] as const) {
    const rows = data.categories.filter((c) => c.kind === kind);
    if (!rows.length) continue;
    w.subheading(title);
    w.head(["Luokka", "Ilman alv", "Alv", "Yhteensä"], cat4);
    for (const c of rows) w.row([c.label, eur(c.net), eur(c.vat), eur(c.gross)], cat4, { tone });
    if (rows.length > 1) {
      const sum = (k: "net" | "vat" | "gross") => rows.reduce((s, c) => s + c[k], 0);
      w.row(["Yhteensä", eur(sum("net")), eur(sum("vat")), eur(sum("gross"))], cat4, { tone: "total" });
    }
    w.space(4);
  }
  w.subheading("Verolaskelma");
  w.row(["Tulot ilman arvonlisäveroa ja koneiden myyntejä", eur(data.plan.income)], two);
  w.row(["Menot", eur(-data.plan.expense)], two);
  w.row(["Poistot", eur(-dep)], two);
  w.row(["Metsätalouden puhdas pääomatulo", eur(r.netBeforeDeduction)], two, { tone: "total" });
  w.row(["Metsävähennys", eur(-data.plan.recordedDeduction)], two);
  w.row(["Yrittäjävähennys 5 %", eur(-r.entrepreneurDeduction)], two);
  w.row(["Metsätalouden verotettava pääomatulo", eur(r.forestryTaxable)], two, { tone: "total" });
  if (data.depreciation.some((d) => d.sold) || data.plan.forestSales.length) {
    w.row([r.saleExempt ? "Myynnit, verovapaa (enintään 1 000 €)" : "Luovutusvoitot ja -tappiot (lomake 9)", eur(r.saleResult)], two);
  }
  w.row(["Verotettava pääomatulo", eur(r.taxable)], two, { tone: "result" });
  w.row(["Arvioitu vero 30 %", eur(r.tax.low)], two);
  if (r.tax.high) w.row(["Arvioitu vero 34 %", eur(r.tax.high)], two);
  w.row(["Arvioitu vero yhteensä", eur(r.tax.total)], two, { tone: "total" });
  if (data.plan.withholding) {
    w.row(["Ennakonpidätykset", eur(data.plan.withholding)], two);
    const left = Math.round((r.tax.total - data.plan.withholding) * 100) / 100;
    w.row([left >= 0 ? "Arviolta maksettavaa" : "Arviolta palautusta", eur(Math.abs(left))], two, { tone: "result" });
  }
  w.space(3);
  w.text("Vero on arvio. Se ei ota huomioon asiakkaan muita pääomatuloja eikä aiempien vuosien tappioita.", { size: 8, color: MUTED });

  // 2. Arvonlisävero
  section(2);
  if (!data.client.vatRegistered) w.text("Asiakas ei ole arvonlisäverorekisterissä.", { size: 9, color: MUTED, gap: 8 });
  w.figures([
    { label: "Myynnin vero", value: eur(data.vat.year.output) },
    { label: "Ostojen vero", value: eur(data.vat.year.input) },
    { label: data.vat.year.payable >= 0 ? "Maksettava" : "Palautettava", value: eur(Math.abs(data.vat.year.payable)), accent: true },
  ]);
  const vat4: Col[] = [{ width: 70 }, { width: 33, align: "right" }, { width: 33, align: "right" }, { width: 34, align: "right" }];
  w.head(["Jakso", "Myynnin vero", "Ostojen vero", "Maksettava"], vat4);
  for (const q of data.vat.quarters) w.row([q.label, eur(q.output), eur(q.input), eur(q.payable)], vat4);
  w.row([data.vat.year.label, eur(data.vat.year.output), eur(data.vat.year.input), eur(data.vat.year.payable)], vat4, { tone: "total" });
  if (data.vat.year.nonDeductible) {
    w.space(3);
    w.text(`Ostojen verosta ${eur(data.vat.year.nonDeductible)} kuuluu muulle toiminnalle, joten sitä ei vähennetä tässä.`, { size: 8, color: MUTED });
  }
  if (data.vat.year.byRate.length) {
    w.space(4);
    w.subheading("Myynnit verokannoittain");
    const rate3: Col[] = [{ width: 70 }, { width: 50, align: "right" }, { width: 50, align: "right" }];
    w.head(["Verokanta", "Myynti ilman alv", "Vero"], rate3);
    for (const b of data.vat.year.byRate) w.row([`${b.rate.toLocaleString("fi-FI")} %`, eur(b.net), eur(b.vat)], rate3, { tone: "income" });
  }

  // 3. Investoinnit ja poistot
  section(3);
  if (!data.depreciation.length) w.text("Ei investointeja tälle vuodelle.", { size: 9, color: MUTED });
  else {
    const dep5: Col[] = [{ width: 50 }, { width: 35 }, { width: 28, align: "right" }, { width: 28, align: "right" }, { width: 29, align: "right" }];
    w.head(["Investointi", "Poistotapa", "Arvo alussa", "Poisto", "Arvo lopussa"], dep5);
    for (const d of data.depreciation) {
      w.row([d.description, d.sold ? "Myyty" : d.method, eur(d.bookValueStart), d.sold ? "–" : eur(d.amount), eur(d.bookValueEnd)], dep5);
      if (d.sold) w.text(d.saleGain ? `Luovutusvoitto ${eur(d.saleGain)}` : `Luovutustappio ${eur(d.saleLoss)}`, { size: 8, color: MUTED, x: LEFT + 4 });
      if (d.transferred) w.text(`Metsätilan myynnissä hankintamenoon siirtyi ${eur(d.transferred)}`, { size: 8, color: MUTED, x: LEFT + 4 });
      const prior = priorOpeningText(d.acquisitionCost, d.opening);
      if (prior) w.text(prior, { size: 8, color: MUTED, x: LEFT + 4 });
    }
    w.row(["Poistot yhteensä", "", "", eur(dep), ""], dep5, { tone: "total" });
  }

  // 4. Metsätilat ja metsävähennys
  section(4);
  if (!data.properties.length) w.text("Ei metsätiloja.", { size: 9, color: MUTED });
  else {
    const p4: Col[] = [{ width: 80 }, { width: 45, align: "right" }, { width: 45, align: "right" }];
    w.head(["Metsätila", "Pohjaa ennen vuotta", "Vähennys tänä vuonna"], p4);
    for (const p of data.properties) w.row([p.name, p.remainingBefore === null ? "Tiedot puuttuvat" : eur(p.remainingBefore), eur(p.deduction)], p4);
    w.row(["Yhteensä", "", eur(data.plan.recordedDeduction)], p4, { tone: "total" });
  }
  for (const s of data.plan.forestSales) {
    const { lines, result, note } = forestSaleLines(s);
    w.space(4);
    w.subheading(`Metsätilan ${s.sharePct < 100 ? "osan myynti" : "myynti"}: ${s.name}, ${date(s.disposedOn)}`);
    lines.forEach(([label, amount]) => w.row([label, eur(amount)], two));
    w.row([result[0], eur(result[1])], two, { tone: "result" });
    if (note) w.text(note, { size: 8, color: MUTED, x: LEFT + 4 });
  }

  // 5. Kirjausluettelo
  section(5);
  // Liite-sarake vain, kun raportin loppuun tulee tositteet: viittaus on liitteen numero ja sivu tiedostossa.
  const refs = data.transactions.some((t) => t.attachment);
  // Osuus-sarake vain, kun jokin kirjaus kuuluu metsätaloudelle vain osittain. Summat ovat koko tositteen,
  // ja osuus kertoo, paljonko niistä on luokkasummissa ja verolaskelmassa.
  const shares = data.transactions.some((t) => t.sharePct < 100);
  const descWidth = (refs ? 40 : 50) - (shares ? 14 : 0);
  const t6: Col[] = [
    { width: 22 }, { width: refs ? 34 : 38 }, { width: descWidth }, { width: 25, align: "right" }, { width: 12, align: "right" }, { width: 23, align: "right" },
    ...(shares ? [{ width: 14, align: "right" } as Col] : []),
    ...(refs ? [{ width: 14, align: "right" } as Col] : []),
  ];
  w.head(["Päivä", "Luokka", "Selite", "Ilman alv", "Alv %", "Yhteensä", ...(shares ? ["Osuus"] : []), ...(refs ? ["Liite"] : [])], t6, 7);
  for (const t of data.transactions) {
    const cells = [date(t.bookedOn), t.category, t.description, eur(t.net), t.vatRate.toLocaleString("fi-FI"), eur(t.gross)];
    if (shares) cells.push(t.sharePct < 100 ? `${formatSharePct(t.sharePct)} %` : "");
    w.row(refs ? [...cells, t.attachment ?? "–"] : cells, t6, {
      size: 8, tone: t.kind === "income" ? "income" : t.kind === "expense" ? "expense" : undefined,
    });
  }
  if (!data.transactions.length) w.text("Ei kirjauksia.", { size: 9, color: MUTED });
  if (shares) {
    w.space(3);
    w.text("Osuus on metsätalouden osuus kirjauksesta. Summat ovat koko tositteen, mutta tuloissa, menoissa ja verolaskelmassa on vain metsätalouden osuus.", {
      size: 8, color: MUTED,
    });
  }

  // Kansilehti ja sisällysluettelo viimeisenä, kun sivunumerot tiedetään.
  drawCover(doc.insertPage(0, [W, H]), f, data, draft);
  drawToc(doc.insertPage(1, [W, H]), f, data, toc);

  // Sivunumerot, luottamuksellisuusmerkintä ja vesileima.
  const all = doc.getPages();
  all.forEach((p, i) => {
    if (i === 0) return;
    const n = `${i + 1} / ${all.length}`;
    p.drawText(n, { x: RIGHT - f.regular.widthOfTextAtSize(n, 8), y: 12 * MM, size: 8, font: f.regular, color: MUTED });
    p.drawText("Luottamuksellinen", { x: LEFT, y: 12 * MM, size: 8, font: f.regular, color: MUTED });
    if (draft) p.drawText("LUONNOS", { x: 45 * MM, y: 90 * MM, size: 96, font: f.bold, color: rgb(0.8, 0.35, 0.25), opacity: 0.08, rotate: degrees(40) });
  });
  return doc.save();
}

/** Tumma kansilehti kuten vanhassa raportissa, Skogin sinisellä. */
function drawCover(page: PDFPage, f: Fonts, data: ReportData, draft: boolean) {
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: INK_STRONG });
  const x = 24 * MM;
  let y = H - 34 * MM;

  // Tunnus: kolme palkkia ja nimi. Vihreä vain pienenä korosteena.
  page.drawRectangle({ x, y: y - 11, width: 5, height: 14, color: ACCENT });
  page.drawRectangle({ x: x + 7, y: y - 3, width: 5, height: 6, color: ON_DARK_MUTED });
  page.drawRectangle({ x: x + 7, y: y - 11, width: 5, height: 6, color: INK_SOFT });
  page.drawText("Adepta", { x: x + 18, y: y - 9, size: 13, font: f.serif, color: WHITE });
  page.drawText("Skog", { x: x + 18 + f.serif.widthOfTextAtSize("Adepta ", 13), y: y - 9, size: 13, font: f.bold, color: ON_DARK });

  y = H - 110 * MM;
  page.drawText(safe(f.bold, "METSÄTALOUDEN KIRJANPITO JA VEROLASKELMA"), { x, y, size: 8.5, font: f.bold, color: ON_DARK_MUTED });
  y -= 42;
  page.drawText(`Veroraportti ${data.year}`, { x, y, size: 38, font: f.serif, color: WHITE });
  y -= 34;
  for (const line of wrap(f.regular, data.client.name, 18, W - 2 * x)) {
    page.drawText(line, { x, y, size: 18, font: f.regular, color: ON_DARK });
    y -= 24;
  }

  // Tietokortti: asiakas ja laatija.
  const cardH = 44 * MM;
  const cardY = 58 * MM;
  page.drawRectangle({ x, y: cardY, width: W - 2 * x, height: cardH, color: INK_SOFT, borderColor: rgb(0.2, 0.28, 0.4), borderWidth: 0.6 });
  const colW = (W - 2 * x) / 2;
  const block = (cx: number, title: string, lines: string[]) => {
    let ly = cardY + cardH - 9 * MM;
    page.drawText(safe(f.bold, title.toUpperCase()), { x: cx, y: ly, size: 7.5, font: f.bold, color: ON_DARK_MUTED });
    ly -= 16;
    for (const l of lines) {
      for (const part of wrap(f.regular, l, 9.5, colW - 12 * MM)) {
        page.drawText(part, { x: cx, y: ly, size: 9.5, font: f.regular, color: ON_DARK });
        ly -= 13;
      }
    }
  };
  block(x + 7 * MM, "Asiakas", [
    data.client.name,
    ...(data.client.address ? [data.client.address] : []),
    ...(data.client.businessId ? [`Y-tunnus ${data.client.businessId}`] : []),
    ...(data.client.municipality ? [`Kotikunta ${data.client.municipality}`] : []),
  ]);
  block(x + colW + 3 * MM, "Laatija", [
    data.office.name,
    ...(data.office.businessId ? [`Y-tunnus ${data.office.businessId}`] : []),
    `Laadittu ${date(data.generatedAt)}`,
    draft ? "Luonnos: verovuosi on avoin" : `Verovuosi suljettu ${data.closedAt ? date(data.closedAt) : ""}`.trim(),
  ]);

  page.drawText(safe(f.bold, "LUOTTAMUKSELLINEN · SISÄLTÄÄ HENKILÖ- JA TALOUSTIETOJA"), { x, y: 22 * MM, size: 7.5, font: f.bold, color: ON_DARK_MUTED });
  if (draft) page.drawText("LUONNOS", { x: W - x - f.bold.widthOfTextAtSize("LUONNOS", 10), y: 22 * MM, size: 10, font: f.bold, color: rgb(0.95, 0.55, 0.45) });
}

/** Sisällysluettelo omalla sivullaan: iso numero, otsikko, kuvaus ja sivunumero. */
function drawToc(page: PDFPage, f: Fonts, data: ReportData, pages: number[]) {
  let y = TOP;
  page.drawText(safe(f.bold, "SISÄLLYSLUETTELO"), { x: LEFT, y: y - 9, size: 9, font: f.bold, color: MUTED });
  y -= 15;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1.6, color: INK });
  y -= 10;
  SECTIONS.forEach((s, i) => {
    y -= 14;
    page.drawText(String(i + 1), { x: LEFT, y: y - 18, size: 24, font: f.serif, color: ACCENT_DARK });
    page.drawText(safe(f.bold, s.title), { x: LEFT + 14 * MM, y: y - 8, size: 11.5, font: f.bold, color: INK });
    const pn = String(pages[i] ?? "");
    page.drawText(pn, { x: RIGHT - f.regular.widthOfTextAtSize(pn, 11), y: y - 8, size: 11, font: f.regular, color: INK });
    let dy = y - 22;
    for (const line of wrap(f.regular, s.description, 9, RIGHT - LEFT - 30 * MM)) {
      page.drawText(line, { x: LEFT + 14 * MM, y: dy, size: 9, font: f.regular, color: MUTED });
      dy -= 12;
    }
    y = dy - 8;
    page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 0.4, color: LINE });
  });

  // Alareunaan asiakas ja toimisto kuten vanhan raportin sisällysluettelossa.
  let ly = BOTTOM + 34;
  let ry = BOTTOM + 34;
  const leftLines = [data.client.name, data.client.address, data.client.businessId ? `Y-tunnus ${data.client.businessId}` : null].filter(Boolean) as string[];
  const rightLines = [data.office.name, [data.office.email, data.office.phone].filter(Boolean).join(" · ") || null, `Laadittu ${date(data.generatedAt)} · Verovuosi ${data.year}`].filter(Boolean) as string[];
  page.drawLine({ start: { x: LEFT, y: ly + 16 }, end: { x: RIGHT, y: ly + 16 }, thickness: 0.4, color: LINE });
  for (const l of leftLines) {
    page.drawText(safe(f.regular, l), { x: LEFT, y: ly, size: 8.5, font: f.regular, color: MUTED });
    ly -= 12;
  }
  for (const l of rightLines) {
    const t = safe(f.regular, l);
    page.drawText(t, { x: RIGHT - f.regular.widthOfTextAtSize(t, 8.5), y: ry, size: 8.5, font: f.regular, color: MUTED });
    ry -= 12;
  }
}
