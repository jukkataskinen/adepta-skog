import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const asiakas_id = searchParams.get('asiakas_id')
  const vuosi = searchParams.get('vuosi')

  if (!asiakas_id) return NextResponse.json({ error: 'asiakas_id puuttuu' }, { status: 400 })

  const { data: kayttaja } = await supabase
    .from('kayttajat').select('organisaatio_id').eq('auth_sub', session.user.sub).single()
  if (!kayttaja) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })

  let query = supabase
    .from('tapahtumat')
    .select('id, tyyppi, kuvaus, paivamaara, summa_alv0, alv_prosentti, bruttosumma, kategoria, ennakko, viite')
    .eq('asiakas_id', asiakas_id)
    .order('paivamaara', { ascending: true })

  if (vuosi) query = query.eq('verovuosi', parseInt(vuosi))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { data: kayttaja } = await supabase
    .from('kayttajat').select('id, organisaatio_id').eq('auth_sub', session.user.sub).single()
  if (!kayttaja) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })

  const body = await request.json()
  const { asiakas_id, vuosi, rivit } = body

  if (!asiakas_id || !vuosi) return NextResponse.json({ error: 'asiakas_id ja vuosi vaaditaan' }, { status: 400 })

  const { error: delErr } = await supabase
    .from('tapahtumat').delete().eq('asiakas_id', asiakas_id).eq('verovuosi', vuosi)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  if (rivit && rivit.length > 0) {
    const insert = rivit.map((r: {
      paivamaara: string; kuvaus: string; tyyppi: string;
      summa_alv0: number; alv_prosentti: number;
      kategoria?: string; ennakko?: number; viite?: string
    }) => ({
      asiakas_id,
      tyyppi: r.tyyppi,
      kuvaus: r.kuvaus,
      paivamaara: r.paivamaara,
      summa_alv0: r.summa_alv0,
      alv_prosentti: r.alv_prosentti,
      kategoria: r.kategoria ?? null,
      ennakko: r.ennakko ?? 0,
      viite: r.viite ?? null,
      luonut_kayttaja_id: kayttaja.id,
    }))
    const { error: insErr } = await supabase.from('tapahtumat').insert(insert)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, tallennettu: rivit?.length ?? 0 })
}
