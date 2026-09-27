import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { Sql } from "@/lib/db/types";
import { getStorage } from "@/lib/storage";

/**
 * Tositteet veroraportin liitteiksi. Raportin perään tulee liitteiden
 * sisällysluettelo ja sen jälkeen jokainen tosite: PDF-sivut sellaisinaan ja
 * kuvat sovitettuina A4-sivulle. Jokaisen liitteen ensimmäisen sivun alareunaan
 * merkitään liitteen numero, jotta paperilla selaava löytää sen luettelosta.
 * Tiedosto, jota ei voi liittää (suojattu tai rikkinäinen PDF), mainitaan
 * luettelossa, jotta puute näkyy eikä jää huomaamatta.
 */

export interface Attachment {
  title: string;
  fileName: string;
  contentType: string;
  /** null, jos tiedostoa ei löytynyt tallennuksesta. */
  bytes: Uint8Array | null;
}

const MM = 72 / 25.4;
const A4: [number, number] = [210 * MM, 297 * MM];
const INK = rgb(0x1b / 255, 0x2a / 255, 0x41 / 255);
const MUTED = rgb(0.43, 0.47, 0.53);
const LINE = rgb(0xdf / 255, 0xe6 / 255, 0xf0 / 255);

function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

function fit(font: PDFFont, text: string, size: number, width: number): string {
  let t = safe(font, text);
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -2) + "…";
  return t;
}

export async function appendAttachments(report: Uint8Array, attachments: Attachment[], opts: { year: number }): Promise<Uint8Array> {
  if (!attachments.length) return report;
  const doc = await PDFDocument.load(report);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reportPages = doc.getPageCount();
  const index: { title: string; fileName: string; page: number | null; pages: number; note?: string }[] = [];

  for (const [i, a] of attachments.entries()) {
    const firstIndex = doc.getPageCount();
    if (!a.bytes) {
      index.push({ title: a.title, fileName: a.fileName, page: null, pages: 0, note: "Tiedostoa ei löytynyt tallennuksesta" });
      continue;
    }
    try {
      if (a.contentType === "application/pdf") {
        const src = await PDFDocument.load(a.bytes);
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
      } else if (a.contentType === "image/jpeg" || a.contentType === "image/png") {
        const img = a.contentType === "image/png" ? await doc.embedPng(a.bytes) : await doc.embedJpg(a.bytes);
        const page = doc.addPage(A4);
        const maxW = A4[0] - 30 * MM;
        const maxH = A4[1] - 40 * MM;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2 + 5 * MM, width: w, height: h });
      } else {
        index.push({ title: a.title, fileName: a.fileName, page: null, pages: 0, note: "Tiedostomuotoa ei voi liittää" });
        continue;
      }
    } catch {
      index.push({ title: a.title, fileName: a.fileName, page: null, pages: 0, note: "Tiedostoa ei voitu liittää (suojattu tai vioittunut PDF)" });
      continue;
    }
    const added = doc.getPageCount() - firstIndex;
    // Liitteen numero ensimmäisen sivun alareunaan.
    const first = doc.getPage(firstIndex);
    const label = safe(bold, `Liite ${i + 1}`);
    first.drawRectangle({ x: 8 * MM, y: 4 * MM, width: bold.widthOfTextAtSize(label, 8) + 6, height: 13, color: rgb(1, 1, 1), opacity: 0.85 });
    first.drawText(label, { x: 8 * MM + 3, y: 4 * MM + 3.5, size: 8, font: bold, color: INK });
    index.push({ title: a.title, fileName: a.fileName, page: firstIndex + 2, pages: added });
  }

  // Liiteluettelo heti raportin perään. Sivunumerot lasketaan luettelosivun kanssa.
  const list = doc.insertPage(reportPages, A4);
  const left = 20 * MM;
  const right = A4[0] - 20 * MM;
  let y = A4[1] - 24 * MM;
  list.drawText("LIITTEET: TOSITTEET", { x: left, y: y - 9, size: 9, font: bold, color: MUTED });
  y -= 15;
  list.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.6, color: INK });
  y -= 18;
  list.drawText(safe(font, `Verovuoden ${opts.year} tositteet, ${attachments.length} kpl.`), { x: left, y, size: 9, font, color: MUTED });
  y -= 18;
  for (const [i, e] of index.entries()) {
    if (y < 30 * MM) break;
    list.drawText(`${i + 1}`, { x: left, y, size: 10, font: bold, color: INK });
    list.drawText(fit(font, e.title, 9.5, 110 * MM), { x: left + 10 * MM, y, size: 9.5, font, color: INK });
    const pageText = e.page ? `s. ${e.page}${e.pages > 1 ? `–${e.page + e.pages - 1}` : ""}` : "";
    list.drawText(pageText, { x: right - font.widthOfTextAtSize(pageText, 9.5), y, size: 9.5, font, color: INK });
    y -= 12;
    list.drawText(fit(font, e.note ? `${e.fileName} · ${e.note}` : e.fileName, 8, 140 * MM), { x: left + 10 * MM, y, size: 8, font, color: e.note ? rgb(0.55, 0.13, 0.13) : MUTED });
    y -= 8;
    list.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.4, color: LINE });
    y -= 12;
  }
  if (index.length && y < 30 * MM) {
    list.drawText(safe(font, "Luettelo jatkuu: kaikki tositteet ovat tämän sivun jälkeen numerojärjestyksessä."), { x: left, y: 22 * MM, size: 8, font, color: MUTED });
  }
  return doc.save();
}

/**
 * Vuoden tositteet liitteiksi: ensin kirjausten tositteet kirjauspäivän
 * mukaan, sitten vuoden tositeaineisto lisäysjärjestyksessä.
 */
export async function loadAttachments(tx: Sql, clientId: string, year: number): Promise<Attachment[]> {
  const docs = await tx.query<{ file_name: string; content_type: string; storage_path: string; booked_on: string | null; description: string | null }>(
    `select d.file_name, d.content_type, d.storage_path, t.booked_on::text, t.description
       from sk_documents d left join sk_transactions t on t.id = d.transaction_id
      where d.client_id = $1 and d.tax_year = $2 and d.kind = 'receipt'
      order by (d.transaction_id is null), t.booked_on nulls last, d.created_at`,
    [clientId, year],
  );
  const storage = getStorage();
  const out: Attachment[] = [];
  for (const d of docs) {
    const date = d.booked_on ? d.booked_on.split("-").reverse().map(Number).join(".") : null;
    out.push({
      title: date ? `Kirjaus ${date}${d.description ? `: ${d.description}` : ""}` : "Vuoden tositeaineisto",
      fileName: d.file_name,
      contentType: d.content_type,
      // Puuttuva tiedosto ei saa estää vuoden sulkemista: se mainitaan liiteluettelossa.
      bytes: await storage.get(d.storage_path).then((b) => new Uint8Array(b), () => null),
    });
  }
  return out;
}
