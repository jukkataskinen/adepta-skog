import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { forestSaleLines } from "@/lib/tax/forest-sale";
import { ACTIVITY_LABEL, ADDITIONAL_PREPAYMENT_MIN, additionalPrepaymentDueDate, annualVatDueDate } from "@/lib/tax/rules";
import { vatFormRows } from "@/lib/tax/vat";
import { formatSharePct } from "@/lib/tax/share";
import { priorOpeningText } from "@/lib/tax/load";
import type { ReportData, ReportTransaction } from "./data";
import { FORM2_ORDER, form2Label } from "@/lib/filing/vsy002-fields";

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

type SectionKey = "summary" | "forestry" | "vat" | "assets" | "deduction" | "agriculture" | "ledger";

const SECTION_DEFS: Record<SectionKey, { title: string; description: string }> = {
  summary: { title: "Yhteenveto ja maksutiedote", description: "Tuleeko veroa maksettavaksi vai palautusta, ja paljonko arvonlisäveroa tilitetään ja milloin." },
  forestry: { title: "Tulot, menot ja verolaskelma", description: "Tulot ja menot luokittain, poistot, metsävähennys ja arvioitu pääomatulon vero." },
  vat: { title: "Arvonlisävero", description: "Myynnin ja ostojen vero neljänneksittäin ja koko vuodelta sekä myynnit verokannoittain." },
  assets: { title: "Investoinnit ja poistot", description: "Investoinnit poistamattomine arvoineen, vuoden poistot ja myynnit." },
  deduction: { title: "Metsävähennys", description: "Metsävähennyksen pohja tiloittain, vuoden vähennys ja metsätilojen myynnit." },
  agriculture: { title: "Maatalous (lomake 2)", description: "Maatalouden tulot ja menot lomakkeen kentittäin, poistot ryhmittäin, varaukset ja varallisuuslaskelma." },
  ledger: { title: "Kirjausluettelo", description: "Kaikki verovuoden kirjaukset päivämäärineen, luokkineen ja summineen." },
};

/** Raportin osat: metsätalouden osat metsäasiakkaalle, maatalousosa maatalousasiakkaalle. */
function sectionsFor(data: ReportData): SectionKey[] {
  const forest = data.client.hasForestry || !data.client.hasAgriculture;
  return [
    "summary",
    ...(forest ? (["forestry"] as const) : []),
    "vat",
    ...(forest ? (["assets", "deduction"] as const) : []),
    ...(data.agri ? (["agriculture"] as const) : []),
    "ledger",
  ];
}

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
  const sections = sectionsFor(data);
  const forest = sections.includes("forestry");
  const toc: number[] = [];
  const section = (key: SectionKey) => {
    w.newPage();
    // Sivunumero kannen ja sisällysluettelon kanssa: ne ovat sivut 1 ja 2.
    toc[sections.indexOf(key)] = w.pages.length + 2;
    w.section(`${SECTION_DEFS[key].title} · Verovuosi ${data.year}`);
  };
  const two: Col[] = [{ width: 120 }, { width: 50, align: "right" }];

  const r = data.result;
  const dep = data.depreciation.reduce((s, d) => s + d.amount, 0);

  // 1. Yhteenveto ja maksutiedote: kaksi asiakkaan tärkeintä kysymystä.
  section("summary");
  const agri = data.agri;
  // Maatalousasiakkaan arvio kattaa metsätalouden ja maatalouden: pääomatulot yhteen 30/34 %:n rajaan
  // ja maatalouden ansiotulo-osuuden vero arviona (src/lib/tax/agri-plan.ts, combinedTax).
  const totalTax = agri ? agri.tax.total : r.tax.total;
  const taxLeft = Math.round((totalTax - data.plan.withholding) * 100) / 100;
  const agriRows: [string, string][] = agri
    ? [
        ["Maatalouden tulot (lomake 2)", eur(agri.form2.income)],
        ["Maatalouden menot ja poistot", eur(-agri.form2.expense)],
        [agri.form2.result < 0 ? "Maatalouden tappio" : "Maatalouden tulos", eur(agri.form2.result)],
        ...(agri.split.lossesUsed ? ([["Aiempien vuosien tappiot", eur(-agri.split.lossesUsed)]] as [string, string][]) : []),
        ...(agri.split.splitBase ? ([["Maatalouden yrittäjävähennys 5 %", eur(-agri.split.entrepreneurDeduction)]] as [string, string][]) : []),
        [`Maatalouden pääomatulo-osuus (${agri.split.capitalPct} %)`, eur(agri.split.owner.capital)],
        ["Maatalouden ansiotulo-osuus", eur(agri.split.owner.earned)],
        ...(agri.tax.lossToCapital ? ([["Maatalouden tappio pääomatuloista", eur(-agri.tax.lossToCapital)]] as [string, string][]) : []),
        ["Verotettava pääomatulo yhteensä", eur(agri.tax.capital)],
        ["Pääomatulon vero", eur(agri.tax.capitalTax.total)],
        ["Ansiotulon vero, arvio", eur(agri.tax.earnedTax.total)],
        ["Arvioitu vero yhteensä", eur(agri.tax.total)],
        ...(data.plan.withholding ? ([["Ennakonpidätykset", eur(-data.plan.withholding)]] as [string, string][]) : []),
      ]
    : [];
  w.summaryTable([
    ...(forest
      ? ([
          [agri ? "Metsätalouden tulot ilman arvonlisäveroa" : "Tulot ilman arvonlisäveroa", eur(data.plan.income)],
          ["Menot ja poistot", eur(-(data.plan.expense + dep))],
          ["Metsävähennys ja yrittäjävähennys", eur(-(data.plan.recordedDeduction + r.entrepreneurDeduction))],
          ...(r.saleResult ? ([["Luovutusvoitot ja -tappiot", eur(r.saleResult)]] as [string, string][]) : []),
          ...((agri
            ? [["Metsätalouden verotettava tulo", eur(r.forestryTaxable + r.saleResult)]]
            : [
                ["Verotettava pääomatulo", eur(r.taxable)],
                ["Arvioitu pääomatulon vero", eur(r.tax.total)],
                ["Ennakonpidätykset", eur(-data.plan.withholding)],
              ]) as [string, string][]),
        ] as [string, string][])
      : []),
    ...agriRows,
  ]);
  const vatPayable = data.vat.year.payable;
  const vatRef = data.client.taxAccountReference;
  w.paymentBoxes(
    {
      title: agri ? "Tulovero, arvio" : "Pääomatulon vero",
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
  if (agri) {
    w.text(
      "Maatalouden tulo on jaettu pääoma- ja ansiotuloon edellisen vuoden nettovarallisuuden mukaan. Ansiotulon vero on arvio keskimääräisellä kunnallisveroprosentilla ilman vähennyksiä ja muita ansiotuloja. Maksetut ennakkoverot näkyvät OmaVerossa, eikä niitä ole vähennetty.",
      { size: 8, color: MUTED },
    );
    if (agri.split.spouse) w.text("Puolison osuudet maatalouden tulosta verotetaan puolisolla, eikä niitä ole tässä arviossa.", { size: 8, color: MUTED });
  }
  if (agri) {
    w.text("Arvonlisävero on laskettu metsä- ja maataloudesta yhdessä, koska ne ilmoitetaan samalla ilmoituksella.", { size: 8, color: MUTED });
  }

  // 2. Tulot, menot ja verolaskelma (metsätalous)
  if (forest) {
    section("forestry");
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
  }

  // 3. Arvonlisävero
  section("vat");
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
    w.text(
      data.client.hasAgriculture
        ? `Ostojen verosta ${eur(data.vat.year.nonDeductible)} on yksityistä, joten sitä ei vähennetä.`
        : `Ostojen verosta ${eur(data.vat.year.nonDeductible)} kuuluu muulle toiminnalle, joten sitä ei vähennetä tässä.`,
      { size: 8, color: MUTED },
    );
  }
  if (data.client.hasAgriculture) {
    // Metsä ja maatalous ilmoitetaan samalla alv-ilmoituksella; erittely kertoo, mistä vero tulee.
    w.space(4);
    w.subheading("Metsä ja maatalous");
    w.head(["Toiminto", "Myynnin vero", "Ostojen vero", "Maksettava"], vat4);
    for (const [key, label] of [["forestry", "Metsätalous"], ["agriculture", "Maatalous"]] as const) {
      const a = data.vat.year.byActivity[key];
      w.row([label, eur(a.output), eur(a.input), eur(Math.round((a.output - a.input) * 100) / 100)], vat4);
    }
    w.row(["Yhteensä", eur(data.vat.year.output), eur(data.vat.year.input), eur(data.vat.year.payable)], vat4, { tone: "total" });
  }
  // Ilmoituksen kentät vain rekisteröidylle: rekisteröimätön ei anna ilmoitusta, ja kentät näyttäisivät ilmoitettavilta.
  if (data.client.vatRegistered) {
    w.space(4);
    w.subheading("Arvonlisäveroilmoituksen kentät");
    const f3: Col[] = [{ width: 20 }, { width: 100 }, { width: 50, align: "right" }];
    for (const [code, label, value] of vatFormRows(data.year, data.vat.year.form)) w.row([code, label, eur(value)], f3);
  }
  if (data.vat.year.byRate.length) {
    w.space(4);
    w.subheading("Myynnit verokannoittain");
    const rate3: Col[] = [{ width: 70 }, { width: 50, align: "right" }, { width: 50, align: "right" }];
    w.head(["Verokanta", "Myynti ilman alv", "Vero"], rate3);
    for (const b of data.vat.year.byRate) w.row([`${b.rate.toLocaleString("fi-FI")} %`, eur(b.net), eur(b.vat)], rate3, { tone: "income" });
  }

  // 4. Investoinnit ja poistot (metsätalous)
  if (forest) {
    section("assets");
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

    // 5. Metsätilat ja metsävähennys
    section("deduction");
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
  }

  // 6. Maatalous (lomake 2)
  if (agri) renderAgriculture(w, data.year, agri, () => section("agriculture"));

  // 7. Kirjausluettelo
  section("ledger");
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
  // Maatalousasiakkaan luettelo on eritelty toiminnoittain kuten kirjanpito (metsätalous, maatalous).
  // Pelkän metsäasiakkaan luettelo on ennallaan.
  const byActivity = data.client.hasAgriculture;
  const groups: { title: string | null; rows: ReportTransaction[] }[] = byActivity
    ? (["forestry", "agriculture"] as const)
        .map((a) => ({ title: ACTIVITY_LABEL[a], rows: data.transactions.filter((t) => (t.activity ?? "forestry") === a) }))
        .filter((g) => g.rows.length > 0)
    : [{ title: null, rows: data.transactions }];
  for (const g of groups) {
    if (g.title) w.subheading(`${g.title}: ${g.rows.length === 1 ? "1 kirjaus" : `${g.rows.length} kirjausta`}`);
    w.head(["Päivä", "Luokka", "Selite", "Ilman alv", "Alv %", "Yhteensä", ...(shares ? ["Osuus"] : []), ...(refs ? ["Liite"] : [])], t6, 7);
    for (const t of g.rows) {
      const cells = [date(t.bookedOn), t.category, t.description, eur(t.net), t.vatRate.toLocaleString("fi-FI"), eur(t.gross)];
      if (shares) cells.push(t.sharePct < 100 ? `${formatSharePct(t.sharePct)} %` : "");
      w.row(refs ? [...cells, t.attachment ?? "–"] : cells, t6, {
        size: 8, tone: t.kind === "income" ? "income" : t.kind === "expense" ? "expense" : undefined,
      });
    }
    if (g.title) w.space(4);
  }
  if (!data.transactions.length) w.text("Ei kirjauksia.", { size: 9, color: MUTED });
  if (shares) {
    w.space(3);
    w.text(
      byActivity
        ? "Osuus on kirjauksen oman toiminnon osuus. Summat ovat koko tositteen, mutta toiminnon tuloissa, menoissa ja laskelmissa on vain sen osuus."
        : "Osuus on metsätalouden osuus kirjauksesta. Summat ovat koko tositteen, mutta tuloissa, menoissa ja verolaskelmassa on vain metsätalouden osuus.",
      { size: 8, color: MUTED },
    );
  }

  // Kansilehti ja sisällysluettelo viimeisenä, kun sivunumerot tiedetään.
  drawCover(doc.insertPage(0, [W, H]), f, data, draft);
  drawToc(doc.insertPage(1, [W, H]), f, data, sections, toc);

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

/**
 * Maatalousosa: tunnusluvut, tulot ja menot luokittain, lomakkeen 2 kentät,
 * poistot ryhmittäin ja huomautukset. Luvut tulevat samasta laskennasta kuin
 * Maatalous-välilehti ja VSY002-tiedosto (src/lib/tax/agriculture.ts).
 */
function renderAgriculture(w: Writer, year: number, agri: NonNullable<ReportData["agri"]>, start: () => void) {
  start();
  const form = agri.form2;
  w.figures([
    { label: "Tulot (332)", value: eur(form.income) },
    { label: "Menot (357)", value: eur(form.expense) },
    { label: form.result < 0 ? "Tappio (363)" : "Tulos (362)", value: eur(Math.abs(form.result)), accent: form.result >= 0, negative: form.result < 0 },
  ]);
  if (form.errors.length) w.text(`Korjattavaa ennen veroilmoitusta: ${form.errors.join(" ")}`, { size: 8.5, color: NEGATIVE, gap: 6 });
  const cat4: Col[] = [{ width: 80 }, { width: 30, align: "right" }, { width: 30, align: "right" }, { width: 30, align: "right" }];
  for (const [kind, title, tone] of [["income", "Tulot", "income"], ["expense", "Menot", "expense"], ["investment", "Investoinnit", undefined]] as const) {
    const rows = agri.categories.filter((c) => c.kind === kind);
    if (!rows.length) continue;
    w.subheading(`Maatalouden ${title.toLowerCase()} luokittain`);
    w.head(["Luokka", "Ilman alv", "Alv", "Yhteensä"], cat4);
    for (const c of rows) w.row([c.label, eur(c.net), eur(c.vat), eur(c.gross)], cat4, { tone });
    w.space(3);
  }
  w.subheading("Lomakkeen 2 kentät");
  const f3: Col[] = [{ width: 16 }, { width: 114 }, { width: 40, align: "right" }];
  const pct = new Set(["413", "414", "415", "416"]);
  const plain = new Set(["418", "281", "534", "516", "287", "288", "401", "406", "411"]);
  for (const code of FORM2_ORDER.filter((c) => form.fields[c] !== undefined)) {
    const v = form.fields[code];
    const strong = code === "332" || code === "357" || code === "362" || code === "363";
    w.row([code, form2Label(code, year), pct.has(code) ? `${v.toLocaleString("fi-FI")} %` : plain.has(code) ? v.toLocaleString("fi-FI") : eur(v)], f3, {
      size: 8, tone: strong ? "total" : undefined,
    });
  }
  if (agri.depreciation.pools.length) {
    w.space(4);
    w.subheading("Poistot ryhmittäin");
    const p6: Col[] = [{ width: 50 }, { width: 24, align: "right" }, { width: 24, align: "right" }, { width: 24, align: "right" }, { width: 24, align: "right" }, { width: 24, align: "right" }];
    w.head(["Ryhmä", "Alussa", "Lisäys", "Vähennykset", "Poisto", "Lopussa"], p6, 7);
    for (const p of agri.depreciation.pools) {
      w.row([`${p.label} ${p.pct} %`, eur(p.start), eur(p.additions), eur(-(p.sales + p.grants + p.equalization)), eur(p.depreciation), eur(p.end)], p6, { size: 8 });
    }
    w.row(["Poistot yhteensä", "", "", "", eur(agri.depreciation.total), ""], p6, { tone: "total", size: 8 });
  }
  if (form.warnings.length) {
    w.space(3);
    for (const t of form.warnings) w.text(t, { size: 8, color: MUTED });
  }
  w.space(2);
  w.text("Maatalouden tulos on laskettu maksuperusteella. Yritystulon jako on arvio; lopullinen jako tehdään verotuksessa.", { size: 8, color: MUTED });
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
  const kicker = !data.agri ? "METSÄTALOUDEN KIRJANPITO JA VEROLASKELMA" : data.client.hasForestry ? "METSÄ- JA MAATALOUDEN KIRJANPITO JA VEROLASKELMA" : "MAATALOUDEN KIRJANPITO JA VEROLASKELMA";
  page.drawText(safe(f.bold, kicker), { x, y, size: 8.5, font: f.bold, color: ON_DARK_MUTED });
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
function drawToc(page: PDFPage, f: Fonts, data: ReportData, sections: SectionKey[], pages: number[]) {
  let y = TOP;
  page.drawText(safe(f.bold, "SISÄLLYSLUETTELO"), { x: LEFT, y: y - 9, size: 9, font: f.bold, color: MUTED });
  y -= 15;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1.6, color: INK });
  y -= 10;
  sections.map((k) => SECTION_DEFS[k]).forEach((s, i) => {
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
