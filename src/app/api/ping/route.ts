import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";

// Ilman tätä Next rakentaisi reitin staattiseksi, eikä ping koskaan osuisi kantaan
export const dynamic = "force-dynamic";

/**
 * Päivittäinen cron (vercel.json) pitää Supabasen ilmaisen projektin hereillä.
 * Oma kanta pingataan SQL:llä. Muut projektit (Kasamaster) pingataan
 * niiden omalla anon-avaimella: tämän projektin avaimet eivät lähde muualle.
 */
const OTHERS = [{ url: process.env.SUPABASE_KASAMASTER_URL, key: process.env.SUPABASE_KASAMASTER_ANON_KEY }];

export async function GET(request: NextRequest) {
  // Vercel lähettää cron-kutsussa CRON_SECRETin, joten ulkopuoliset eivät voi käynnistää pingiä
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const own = await getDb()
    .then((db) => db.asService((tx) => tx.query("select 1")))
    .then(() => true)
    .catch(() => false);

  const others = OTHERS.filter((t): t is { url: string; key: string } => Boolean(t.url && t.key));
  const results = await Promise.allSettled(
    others.map((t) => fetch(`${t.url}/rest/v1/`, { headers: { apikey: t.key, Authorization: `Bearer ${t.key}` }, cache: "no-store" })),
  );
  const pinged = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;

  return NextResponse.json({ ok: own, others: `${pinged}/${others.length}`, ts: new Date().toISOString() });
}
