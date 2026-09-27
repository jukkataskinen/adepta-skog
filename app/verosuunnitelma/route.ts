import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import fs from 'fs'
import path from 'path'
import { kelvollinenVuosi } from '@/lib/vuosi'

export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  const { data: kayttaja } = await supabase!
    .from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  const orgId = kayttaja?.organisaatio_id ?? ''

  const url = new URL(request.url)
  // Ilman asiakasta sivulla ei ole mitään näytettävää: asiakassivun välilehti korvaa erillisen sivun
  if (!url.searchParams.get('asiakas_id')) {
    return NextResponse.redirect(new URL('/asiakas', request.url))
  }
  // Vuosi vain, jos se on annettu. Muuten API-reitti käyttää asiakkaan avointa vuotta tai kuluvaa vuotta.
  const vuosi = kelvollinenVuosi(url.searchParams.get('vuosi'))

  const { data: asiakkaat } = await supabase!
    .from('asiakkaat')
    .select('id, etunimi, sukunimi')
    .eq('organisaatio_id', orgId)
    .order('sukunimi')

  const htmlPath = path.join(process.cwd(), 'app', 'verosuunnitelma', 'verosuunnitelma.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')

  const configScript = `<script>
window._SKOG = ${JSON.stringify({
    vuosi,
    asiakkaat: (asiakkaat ?? []).map(a => ({ id: a.id, nimi: `${a.sukunimi} ${a.etunimi}` })),
  })};
</script>`

  html = html.replace('</head>', configScript + '</head>')
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
