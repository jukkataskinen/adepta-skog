import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { data: kayttaja } = await supabase
    .from('kayttajat')
    .select('organisaatio_id')
    .eq('auth_sub', session.user.sub)
    .single()

  if (!kayttaja) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })

  const body = await request.json()

  if (!body.asiakas_id || !body.kuvaus?.trim() || !body.hankintahinta || !body.hankintapvm || !body.poistoaika_vuotta) {
    return NextResponse.json({ error: 'Pakolliset kentät puuttuvat' }, { status: 400 })
  }

  const { data: asiakas } = await supabase
    .from('asiakkaat')
    .select('id')
    .eq('id', body.asiakas_id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .single()

  if (!asiakas) return NextResponse.json({ error: 'Asiakasta ei löydy' }, { status: 404 })

  const { data, error } = await supabase
    .from('investoinnit')
    .insert({
      asiakas_id: body.asiakas_id,
      kuvaus: body.kuvaus.trim(),
      hankintapvm: body.hankintapvm,
      hankintahinta: body.hankintahinta,
      jaannosarvo: body.jaannosarvo ?? 0,
      poistoaika_vuotta: body.poistoaika_vuotta,
      poistotapa: body.poistotapa ?? 'tasa',
      aktiivinen: body.aktiivinen ?? true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
