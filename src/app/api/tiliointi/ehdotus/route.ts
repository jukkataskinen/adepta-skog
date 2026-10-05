import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { sameOrigin } from "@/lib/security/same-origin";
import { suggestForEntry } from "@/lib/ledger/posting-memory-load";

export const dynamic = "force-dynamic";

/**
 * Tiliöintiehdotukset kirjoitettavalle selitteelle (DECISIONS 6.10.2026).
 * Taulukko ja lomake kutsuvat tätä viiveellä (debounce), kun selite muuttuu.
 * POST, jotta selite ei kulje osoitteessa eikä palvelimen lokeissa.
 *
 * Oikeudet kuten muissakin reiteissä: sama osoite (Origin), kirjautuminen
 * (requireStaff) ja käyttäjän RLS-transaktio. Kirjanpitäjä saa ehdotuksia vain
 * asiakkaalle, jonka kirjaukset hän näkee. Reitti ei tallenna mitään.
 */
const bodySchema = z.object({
  clientId: z.string().uuid(),
  description: z.string().max(200),
  amountGross: z.number().finite().nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  activity: z.enum(["forestry", "agriculture"]).nullable().optional(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request.headers.get("origin"), request.headers.get("x-forwarded-host") ?? request.headers.get("host"))) {
    return NextResponse.json({ ok: false, error: "Pyyntö hylättiin." }, { status: 403 });
  }
  const ctx = await requireStaff();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Pyyntöä ei voitu lukea." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Pyyntöä ei voitu lukea." }, { status: 400 });
  const input = parsed.data;
  const suggestions = await ctx.run((tx) => suggestForEntry(tx, ctx.org.organizationId, { ...input, activity: input.activity ?? null }));
  if (!suggestions) return NextResponse.json({ ok: false, error: "Asiakasta ei löytynyt." }, { status: 404 });
  return NextResponse.json({ ok: true, suggestions });
}
