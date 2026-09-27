import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'
import { kelvollinenVuosi } from '@/lib/vuosi'

export async function PATCH(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { data: kayttaja } = await supabase
    .from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  if (!kayttaja) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })

  const body = await request.json()
  // Sama tarkistus kuin muualla, ettei kiinteä yläraja 2030 estä tulevia vuosia
  const vuosi = kelvollinenVuosi(body.vuosi)
  if (!vuosi) {
    return NextResponse.json({ error: 'Virheellinen vuosi' }, { status: 400 })
  }

  const { error } = await supabase
    .from('organisaatiot')
    .update({ avoin_vuosi: vuosi })
    .eq('id', kayttaja.organisaatio_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, avoin_vuosi: vuosi })
}
