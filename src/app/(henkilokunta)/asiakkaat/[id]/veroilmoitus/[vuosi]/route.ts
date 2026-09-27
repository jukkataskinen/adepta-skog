import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { buildFilingDownload } from "@/lib/filing/download";

export const dynamic = "force-dynamic";

/**
 * Metsätalouden veroilmoitus 2C tiedostona (VSY02C). POST, koska lomakkeella
 * voi olla henkilötunnuksia, eikä niitä saa URL-osoitteeseen. Tiedosto
 * palautetaan suoraan ladattavaksi eikä sitä arkistoida; välimuisti on kielletty.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; vuosi: string }> }) {
  const { id, vuosi } = await params;
  const year = Number(vuosi);
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(year)) return json(404, "Ei löytynyt.");
  // Lomake lähetetään vain omalta sivulta. Selain lähettää Origin-otsakkeen POST-pyynnöissä.
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).host !== request.headers.get("host")) return json(403, "Pyyntö ei tullut Skogista.");
  const ctx = await requireStaff();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, "Lomakkeen tiedot puuttuvat.");
  }
  const result = await ctx.run((tx) =>
    buildFilingDownload(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, userName: ctx.user.fullName }, id, year, form),
  );
  if (!result.ok) return json(result.status, result.error);
  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": "text/plain; charset=ISO-8859-1",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function json(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
