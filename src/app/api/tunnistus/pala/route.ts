import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { chunkRequestSchema, runRecognitionChunk } from "@/lib/documents/recognize-chunk";
import { sameOrigin } from "@/lib/security/same-origin";

export const dynamic = "force-dynamic";
/** Sama enimmäisaika kuin kirjanpitosivulla: pala mahtuu CHUNK_TIMEOUT_MS:n ja tallennuksen aikaan. */
export const maxDuration = 120;

/**
 * Tositteen yhden palan tunnistus (DECISIONS 2.10.2026). Selain kutsuu tätä
 * CHUNK_PARALLEL palaa kerrallaan. Server actionina palat kulkivat jonossa yksi
 * kerrallaan, joten pitkä vuosiaineisto kesti kaksi kertaa arvioitua kauemmin.
 *
 * Oikeudet kuten server actionissa: kirjautuminen (requireStaff) ja käyttäjän
 * RLS-transaktio. Pyynnön on tultava samasta osoitteesta (Origin), koska
 * reitti käyttää istuntoevästettä; server actionit tekevät saman tarkistuksen itse.
 */
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
  const parsed = chunkRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Pyyntöä ei voitu lukea." }, { status: 400 });
  return NextResponse.json(await runRecognitionChunk(ctx, parsed.data));
}
