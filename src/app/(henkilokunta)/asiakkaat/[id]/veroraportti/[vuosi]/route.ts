import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { loadReportData } from "@/lib/reports/data";
import { renderTaxReport } from "@/lib/reports/pdf";
import { appendAttachments, loadAttachments } from "@/lib/reports/attachments";

export const dynamic = "force-dynamic";

/**
 * Veroraportti ajantasaisilla luvuilla. Avoimen vuoden raportti on luonnos.
 * Suljetun vuoden virallinen versio on arkistossa (tallennettu sulkemishetkellä).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; vuosi: string }> }) {
  const { id, vuosi } = await params;
  const year = Number(vuosi);
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(year)) return new NextResponse("Ei löytynyt", { status: 404 });
  const ctx = await requireStaff();
  // ?liitteet=1 liittää vuoden tositteet raportin loppuun kuten lopullisessa raportissa.
  const withAttachments = request.nextUrl.searchParams.get("liitteet") === "1";
  const result = await ctx.run(async (tx) => {
    const data = await loadReportData(tx, ctx.org.organizationId, id, year);
    return data ? { data, attachments: withAttachments ? await loadAttachments(tx, id, year) : [] } : null;
  });
  if (!result) return new NextResponse("Ei löytynyt", { status: 404 });
  const { data } = result;
  const bytes = await appendAttachments(await renderTaxReport(data), result.attachments, { year });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="veroraportti_${year}${data.status === "open" ? "_luonnos" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
