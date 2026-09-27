import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { appendAttachments } from "@/lib/reports/attachments";

// 1 × 1 pikselin PNG.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

async function pdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 200]);
  return d.save();
}

describe("veroraportin liitteet", () => {
  it("liiteluettelo, PDF-sivut ja kuva raportin perään", async () => {
    const out = await appendAttachments(
      await pdf(3),
      [
        { title: "Kirjaus 15.6.2025: Pystykauppa", fileName: "tilitys.pdf", contentType: "application/pdf", bytes: await pdf(2) },
        { title: "Vuoden tositeaineisto", fileName: "kuitti.png", contentType: "image/png", bytes: PNG },
      ],
      { year: 2025 },
    );
    // 3 raporttisivua + luettelo + 2 + 1.
    expect((await PDFDocument.load(out)).getPageCount()).toBe(7);
  });

  it("rikkinäinen tai puuttuva tiedosto ei kaada raporttia", async () => {
    const out = await appendAttachments(
      await pdf(1),
      [
        { title: "Rikki", fileName: "rikki.pdf", contentType: "application/pdf", bytes: new Uint8Array([1, 2, 3]) },
        { title: "Puuttuu", fileName: "poissa.pdf", contentType: "application/pdf", bytes: null },
      ],
      { year: 2025 },
    );
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it("ilman liitteitä raportti pysyy samana", async () => {
    const report = await pdf(2);
    expect(await appendAttachments(report, [], { year: 2025 })).toBe(report);
  });
});
