import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'

type Params = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: Params) {
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

  const { data, error } = await supabase
    .from('asiakkaat')
    .update({
      etunimi: body.etunimi,
      sukunimi: body.sukunimi,
      y_tunnus: body.y_tunnus ?? null,
      kotikunta: body.kotikunta ?? null,
      sahkoposti: body.sahkoposti ?? null,
      puhelin: body.puhelin ?? null,
      alv_rekisterissa: body.alv_rekisterissa ?? false,
      osoite: body.osoite ?? null,
      postinumero: body.postinumero ?? null,
      postitoimipaikka: body.postitoimipaikka ?? null,
      verotiliviite: body.verotiliviite ?? null,
      avoin_vuosi: body.avoin_vuosi ?? null,
    })
    .eq('id', params.id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
