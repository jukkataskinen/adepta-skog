import { NextRequest, NextResponse } from 'next/server'

// Ilman tätä Next 14 rakentaisi GET-reitin staattiseksi, eikä ping koskaan osuisi kantaan
export const dynamic = 'force-dynamic'

// Jokainen projekti pingataan omalla anon-avaimellaan: service role -avain ei saa lähteä toiseen projektiin
const targets = [
  { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  { url: process.env.SUPABASE_KASAMASTER_URL, key: process.env.SUPABASE_KASAMASTER_ANON_KEY },
]

export async function GET(request: NextRequest) {
  // Vercel lähettää cron-kutsussa CRON_SECRETin, joten ulkopuoliset eivät voi käynnistää pingiä
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const active = targets.filter((t): t is { url: string; key: string } => Boolean(t.url && t.key))

  const results = await Promise.allSettled(active.map(t =>
    fetch(t.url + '/rest/v1/', {
      headers: { apikey: t.key, Authorization: `Bearer ${t.key}` },
      cache: 'no-store',
    })
  ))

  const pinged = results.filter(r => r.status === 'fulfilled' && r.value.ok).length

  return NextResponse.json({ ok: true, pinged, total: active.length, ts: new Date().toISOString() })
}
