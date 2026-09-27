import { NextResponse, type NextRequest } from "next/server";
import { verifySignedValue } from "@/lib/security/crypto";
import { getStorage } from "@/lib/storage";
import { YEAR_RECEIPT_MAX_BYTES } from "@/lib/documents/year-receipts";

export const dynamic = "force-dynamic";

/**
 * Kehitysympäristön latausosoite (STORAGE_MODE=local). Tuotannossa selain
 * lataa tiedoston suoraan Supabase Storageen, eikä tätä reittiä käytetä.
 * Osoite on allekirjoitettu ja vanhenee, joten sillä voi tallentaa vain sen
 * yhden tiedoston, jolle palvelin sen antoi.
 */
export async function PUT(request: NextRequest) {
  if (process.env.STORAGE_MODE === "supabase") return new NextResponse(null, { status: 404 });
  const signed = verifySignedValue(request.nextUrl.searchParams.get("t") ?? undefined);
  if (!signed) return new NextResponse("Virheellinen osoite", { status: 403 });
  const sep = signed.lastIndexOf("|");
  const path = signed.slice(0, sep);
  if (Number(signed.slice(sep + 1)) < Date.now()) return new NextResponse("Osoite on vanhentunut", { status: 403 });
  const body = Buffer.from(await request.arrayBuffer());
  if (body.length > YEAR_RECEIPT_MAX_BYTES) return new NextResponse("Tiedosto on liian suuri", { status: 413 });
  await getStorage().put(path, body, request.headers.get("content-type") ?? "application/octet-stream");
  return new NextResponse(null, { status: 204 });
}
