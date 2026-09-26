import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/current-user";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Tositteen lataus. Rivi haetaan käyttäjän RLS-transaktiossa, joten tiedoston
 * saa vain asiakkaan näkevä käyttäjä. Tiedosto luetaan palvelimella; selain ei
 * saa Storagen osoitetta eikä avainta.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!UUID.test(id) || !UUID.test(docId)) return new NextResponse("Ei löytynyt", { status: 404 });
  const ctx = await requireStaff();
  const [doc] = await ctx.run((tx) =>
    tx.query<{ file_name: string; content_type: string; storage_path: string }>(
      "select file_name, content_type, storage_path from sk_documents where id = $1 and client_id = $2",
      [docId, id],
    ),
  );
  if (!doc) return new NextResponse("Ei löytynyt", { status: 404 });
  const body = await getStorage().get(doc.storage_path);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.content_type,
      // Nimi RFC 5987 -muodossa, koska siinä voi olla ääkkösiä.
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.file_name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
