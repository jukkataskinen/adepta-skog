import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, riviOmassaOrganisaatiossa } from '@/lib/access'

// asiakas_id puuttuu tarkoituksella: investointia ei saa siirtää toiselle asiakkaalle
const MUOKATTAVAT = ['kuvaus', 'hankintapvm', 'hankintahinta', 'jaannosarvo', 'poistoaika_vuotta', 'poistotapa', 'aktiivinen'] as const

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  if (!(await riviOmassaOrganisaatiossa(ok, 'investoinnit', params.id))) {
    return NextResponse.json({ error: 'Investointia ei löydy' }, { status: 404 })
  }

  const body = await request.json()
  const muutokset = Object.fromEntries(MUOKATTAVAT.filter(k => k in body).map(k => [k, body[k]]))

  const { error } = await ok.supabase
    .from('investoinnit')
    .update(muutokset)
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
