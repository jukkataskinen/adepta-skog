import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'

// Tiedot haetaan sivulta /api/kayttajat-reitin kautta, joten selain ei saa kanta-avainta
export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  const { data: kayttaja } = await supabase!
    .from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  const orgId = kayttaja?.organisaatio_id ?? ''

  const { data: org } = await supabase!
    .from('organisaatiot').select('nimi').eq('id', orgId).single()
  const orgNimi = org?.nimi ?? ''

  const htmlPath = path.join(process.cwd(), 'app', 'kayttajat', 'kayttajat.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')

  const configScript = `<script>
window._SKOG = ${JSON.stringify({
    orgNimi,
    email: session.user.email ?? '',
  })};
</script>`

  html = html.replace('</head>', configScript + '</head>')
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
