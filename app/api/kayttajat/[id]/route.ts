import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja } from '@/lib/access'

const ROOLIT = ['paakayttaja', 'kirjanpitaja', 'lukija']

// Roolin vaihto ja käytöstä poisto. Vain pääkäyttäjä, kuten kutsussakin (/api/kutsu).
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  const { supabase, kayttaja } = ok

  if (kayttaja.rooli !== 'paakayttaja') return NextResponse.json({ error: 'Ei oikeuksia' }, { status: 403 })
  // Oman roolin tai tilan muutos voisi jättää organisaation ilman pääkäyttäjää
  if (params.id === kayttaja.id) return NextResponse.json({ error: 'Et voi muuttaa omaa rooliasi tai tilaasi' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const muutokset: { rooli?: string; aktiivinen?: boolean } = {}
  if (body && 'rooli' in body) {
    if (!ROOLIT.includes(body.rooli)) return NextResponse.json({ error: 'Tuntematon rooli' }, { status: 400 })
    muutokset.rooli = body.rooli
  }
  if (body && 'aktiivinen' in body) muutokset.aktiivinen = Boolean(body.aktiivinen)
  if (Object.keys(muutokset).length === 0) return NextResponse.json({ error: 'Ei muutoksia' }, { status: 400 })

  // Organisaatioehto estää muuttamasta toisen organisaation käyttäjää
  const { data, error } = await supabase
    .from('kayttajat')
    .update(muutokset)
    .eq('id', params.id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
