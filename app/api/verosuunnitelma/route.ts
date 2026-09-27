import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, eiLoydy } from '@/lib/access'
import { kelvollinenVuosi, valitseVuosi } from '@/lib/vuosi'

// Verosuunnitelman lukeminen ja tallennus. Sivu teki nämä ennen selaimesta anon-avaimella,
// ja RLS esti ne, joten asiakassivun Verosuunnitelma-välilehti oli tyhjä eikä tallennus toiminut.

type Ok = Exclude<Awaited<ReturnType<typeof vaadiKayttaja>>, { virhe: NextResponse }>

async function omaAsiakas(ok: Ok, asiakasId: unknown) {
  if (typeof asiakasId !== 'string' || !asiakasId) return null
  const { data } = await ok.supabase
    .from('asiakkaat')
    .select('id, avoin_vuosi')
    .eq('id', asiakasId)
    .eq('organisaatio_id', ok.kayttaja.organisaatio_id)
    .maybeSingle()
  return data
}

export async function GET(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  const { supabase } = ok

  const { searchParams } = new URL(request.url)
  const asiakas = await omaAsiakas(ok, searchParams.get('asiakas_id'))
  if (!asiakas) return eiLoydy()
  const vuosi = valitseVuosi(searchParams.get('vuosi'), asiakas.avoin_vuosi)

  const [tapahtumat, tilat, investoinnit] = await Promise.all([
    supabase.from('tapahtumat')
      .select('tyyppi, summa_alv0')
      .eq('asiakas_id', asiakas.id).eq('verovuosi', vuosi),
    supabase.from('metsatilat')
      .select('nimi, hankintahinta, metsämaan_osuus_prosentti, vahennyspohjaa_kaytetty')
      .eq('asiakas_id', asiakas.id),
    supabase.from('investoinnit')
      .select('id, kuvaus, hankintahinta, poistoaika_vuotta, poistotapa, jaannosarvo')
      .eq('asiakas_id', asiakas.id).eq('aktiivinen', true),
  ])
  const virhe = tapahtumat.error ?? tilat.error ?? investoinnit.error
  if (virhe) return NextResponse.json({ error: virhe.message }, { status: 500 })

  return NextResponse.json({
    vuosi,
    avoin_vuosi: asiakas.avoin_vuosi,
    tapahtumat: tapahtumat.data ?? [],
    tilat: tilat.data ?? [],
    investoinnit: investoinnit.data ?? [],
  })
}

export async function POST(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  const { supabase } = ok

  const body = await request.json().catch(() => null)
  const asiakas = await omaAsiakas(ok, body?.asiakas_id)
  if (!asiakas) return eiLoydy()

  const vuosi = kelvollinenVuosi(body?.vuosi)
  if (!vuosi) return NextResponse.json({ error: 'Verovuosi puuttuu' }, { status: 400 })
  // Suljetun vuoden poistot ja metsävähennys on voitu jo ilmoittaa verottajalle
  if (asiakas.avoin_vuosi && vuosi !== asiakas.avoin_vuosi) {
    return NextResponse.json({ error: 'Vuosi ' + vuosi + ' on suljettu. Avaa se ensin asiakkaan tiedoista.' }, { status: 409 })
  }

  const mv = Math.max(0, Math.round(Number(body?.metsavahennys) || 0))

  // Toimii kuten vanha selainkoodi: vähennys kirjataan asiakkaan ensimmäiselle metsätilalle
  if (mv > 0) {
    const { data: tilat } = await supabase.from('metsatilat')
      .select('id, vahennyspohjaa_kaytetty').eq('asiakas_id', asiakas.id)
    if (tilat && tilat.length > 0) {
      const { error: e1 } = await supabase.from('metsavahennykset').upsert({
        asiakas_id: asiakas.id,
        metsatila_id: tilat[0].id,
        verovuosi: vuosi,
        kaytettava_vahennys: mv,
      }, { onConflict: 'metsatila_id,verovuosi' })
      if (e1) return NextResponse.json({ error: e1.message }, { status: 500 })

      const { error: e2 } = await supabase.from('metsatilat').update({
        vahennyspohjaa_kaytetty: Number(tilat[0].vahennyspohjaa_kaytetty || 0) + mv,
      }).eq('id', tilat[0].id)
      if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
    }
  }

  // Poistot vain asiakkaan omille aktiivisille investoinneille, vaikka selain lähettäisi muita tunnisteita
  const pyydetyt: { investointi_id: string; poistomaara: number }[] = Array.isArray(body?.poistot) ? body.poistot : []
  if (pyydetyt.length > 0) {
    const { data: inv } = await supabase.from('investoinnit')
      .select('id, hankintahinta, poistotapa')
      .eq('asiakas_id', asiakas.id).eq('aktiivinen', true)
    const omat = new Map((inv ?? []).map(i => [i.id, i]))

    for (const p of pyydetyt) {
      const i = omat.get(p?.investointi_id)
      const poistomaara = Number(p?.poistomaara) || 0
      if (!i || poistomaara <= 0) continue

      const jaannosNyt = i.poistotapa === 'menojannos'
        ? Number(i.hankintahinta) * 0.75
        : Number(i.hankintahinta) - poistomaara

      const { error } = await supabase.from('poistot').upsert({
        investointi_id: i.id,
        verovuosi: vuosi,
        poistomaara,
        jaannosarvo_vuoden_lopussa: Math.max(0, jaannosNyt),
      }, { onConflict: 'investointi_id,verovuosi' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
