import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja } from '@/lib/access'

// Oletuksena aktiiviset käyttäjät kirjanpitäjän valintaan.
// ?kaikki=1 antaa käyttäjäsivulle myös poistetut käyttäjät ja vastuuasiakkaiden määrän,
// koska sivu haki nämä ennen selaimesta anon-avaimella ja RLS esti haun.
export async function GET(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  const { supabase, kayttaja } = ok

  const kaikki = new URL(request.url).searchParams.get('kaikki') === '1'

  if (!kaikki) {
    const { data, error } = await supabase
      .from('kayttajat')
      .select('id, etunimi, sukunimi, rooli, sahkoposti')
      .eq('organisaatio_id', kayttaja.organisaatio_id)
      .eq('aktiivinen', true)
      .order('sukunimi')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
  }

  const [kayttajat, asiakkaat] = await Promise.all([
    supabase.from('kayttajat')
      .select('id, etunimi, sukunimi, sahkoposti, rooli, viimeksi_kirjautunut, aktiivinen')
      .eq('organisaatio_id', kayttaja.organisaatio_id)
      .order('sukunimi'),
    supabase.from('asiakkaat')
      .select('vastuukirjanpitaja_id')
      .eq('organisaatio_id', kayttaja.organisaatio_id)
      .is('poistettu_at', null),
  ])
  const virhe = kayttajat.error ?? asiakkaat.error
  if (virhe) return NextResponse.json({ error: virhe.message }, { status: 500 })

  const maarat: Record<string, number> = {}
  for (const a of asiakkaat.data ?? []) {
    if (a.vastuukirjanpitaja_id) maarat[a.vastuukirjanpitaja_id] = (maarat[a.vastuukirjanpitaja_id] ?? 0) + 1
  }

  return NextResponse.json({
    oma_id: kayttaja.id,
    oma_rooli: kayttaja.rooli,
    kayttajat: (kayttajat.data ?? []).map(k => ({ ...k, asiakkaita: maarat[k.id] ?? 0 })),
  })
}
