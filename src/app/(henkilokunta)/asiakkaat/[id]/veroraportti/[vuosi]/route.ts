import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { loadReportData } from "@/lib/reports/data";
import { renderTaxReport } from "@/lib/reports/pdf";

export const dynamic = "force-dynamic";

/**
 * Veroraportti ajantasaisilla luvuilla. Avoimen vuoden raportti on luonnos.
 * Suljetun vuoden virallinen versio on arkistossa (tallennettu sulkemishetkellä).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; vuosi: string }> }) {
  const { id, vuosi } = await params;
  const year = Number(vuosi);
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(year)) return new NextResponse("Ei löytynyt", { status: 404 });
  const ctx = await requireStaff();
  const data = await ctx.run((tx) => loadReportData(tx, ctx.org.organizationId, id, year));
  if (!data) return new NextResponse("Ei löytynyt", { status: 404 });
  const bytes = await renderTaxReport(data);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="veroraportti_${year}${data.status === "open" ? "_luonnos" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
