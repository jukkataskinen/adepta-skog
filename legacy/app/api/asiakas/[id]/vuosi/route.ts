import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { data: kayttaja } = await supabase.from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  if (!kayttaja) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })

  const body = await request.json()
  const { avoin_vuosi } = body

  const { error } = await supabase
    .from('asiakkaat')
    .update({ avoin_vuosi })
    .eq('id', params.id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
