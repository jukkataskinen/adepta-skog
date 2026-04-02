import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { data: kayttaja } = await supabase.from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  if (!kayttaja) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })

  const { data: asiakas } = await supabase
    .from('asiakkaat')
    .select('etunimi, sukunimi, y_tunnus, kotikunta, sahkoposti, puhelin, osoite, postinumero, postitoimipaikka, verotiliviite, alv_rekisterissa, avoin_vuosi, luotu_at, vastuukirjanpitaja_id, kayttajat!vastuukirjanpitaja_id(etunimi, sukunimi)')
    .eq('id', params.id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .single()

  const { data: metsatilat } = await supabase
    .from('metsatilat')
    .select('id, nimi, kiinteistotunnus, pinta_ala_ha, hankintahinta')
    .eq('asiakas_id', params.id)
    .order('nimi')

  const { data: investoinnit } = await supabase
    .from('investoinnit')
    .select('id, kuvaus, hankintahinta, poistotapa, poistoaika_vuotta')
    .eq('asiakas_id', params.id)
    .eq('aktiivinen', true)

  return NextResponse.json({ asiakas, metsatilat: metsatilat ?? [], investoinnit: investoinnit ?? [] })
}
