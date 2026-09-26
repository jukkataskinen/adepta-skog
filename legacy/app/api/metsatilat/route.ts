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

  if (!body.asiakas_id || !body.nimi?.trim()) {
    return NextResponse.json({ error: 'asiakas_id ja nimi ovat pakollisia' }, { status: 400 })
  }

  // Varmista että asiakas kuuluu samaan organisaatioon
  const { data: asiakas } = await supabase
    .from('asiakkaat')
    .select('id')
    .eq('id', body.asiakas_id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .single()

  if (!asiakas) return NextResponse.json({ error: 'Asiakasta ei löydy' }, { status: 404 })

  const { data, error } = await supabase
    .from('metsatilat')
    .insert({
      asiakas_id: body.asiakas_id,
      nimi: body.nimi.trim(),
      kiinteistotunnus: body.kiinteistotunnus ?? null,
      pinta_ala_ha: body.pinta_ala_ha ?? null,
      hankintahinta: body.hankintahinta ?? null,
      hankintapvm: body.hankintapvm ?? null,
      metsämaan_osuus_prosentti: body.metsämaan_osuus_prosentti ?? 60,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
