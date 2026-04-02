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

  const { data: org } = await supabase!
    .from('organisaatiot').select('avoin_vuosi, nimi').eq('id', orgId).single()
  const avoinVuosi = org?.avoin_vuosi ?? 2025
  const orgNimi = org?.nimi ?? ''

  const htmlPath = path.join(process.cwd(), 'app', 'kayttajat', 'kayttajat.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')

  const configScript = `<script>
window._SKOG = ${JSON.stringify({
    orgId,
    orgNimi,
    avoinVuosi,
    email: session.user.email ?? '',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  })};
</script>`

  html = html.replace('</head>', configScript + '</head>')
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
