import { PDFDocument } from "pdf-lib";

/**
 * PDF:n sivumäärä ja palan erotus pdf-libillä. Skannatut sivut ovat kuvia, ja
 * copyPages kopioi vain palan sivujen kuvat, joten pala on selvästi koko
 * tiedostoa pienempi.
 */

async function load(bytes: Uint8Array): Promise<PDFDocument | null> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return null;
  }
}

/** Sivumäärä tai null, jos tiedostoa ei voitu jäsentää (silloin se luetaan kokonaan yhtenä palana). */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  const doc = await load(bytes);
  const n = doc?.getPageCount() ?? 0;
  return n > 0 ? n : null;
}

/** Sivut first–last (1-pohjaiset, molemmat mukaan) omaksi PDF:ksi. */
export async function extractPdfPages(bytes: Uint8Array, first: number, last: number): Promise<Buffer> {
  const src = await load(bytes);
  if (!src) throw new Error("PDF:ää ei voitu jäsentää");
  const count = src.getPageCount();
  if (first < 1 || last > count || first > last) throw new Error("Sivualue ei ole tiedostossa");
  const out = await PDFDocument.create();
  const indices = Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i);
  for (const page of await out.copyPages(src, indices)) out.addPage(page);
  return Buffer.from(await out.save());
}

/** Testejä ja selainkokeilua varten: PDF, jossa on n tyhjää sivua. */
export async function blankPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}
