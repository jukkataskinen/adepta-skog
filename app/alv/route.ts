import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }
  const { data: kayttaja } = await supabase!
    .from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  const orgId = kayttaja?.organisaatio_id ?? ''

  const url = new URL(request.url)
  const vuosiParam = url.searchParams.get('vuosi')
  const avoinVuosi = vuosiParam ? parseInt(vuosiParam) : 2025

  const htmlPath = path.join(process.cwd(), 'app', 'alv', 'alv-raportti.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')
  const configScript = `<script>
window._SKOG = ${JSON.stringify({
  orgId,
  avoinVuosi,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
})};
</script>`
  html = html.replace('</head>', configScript + '</head>')
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
