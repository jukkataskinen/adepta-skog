import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, eiLoydy } from '@/lib/access'
import { valitseVuosi } from '@/lib/vuosi'

// Veroraportin tiedot yhdellä kutsulla. Sivu haki nämä ennen selaimesta anon-avaimella,
// ja RLS esti kaiken, joten raportti oli tyhjä myös arkiston "Avaa raportti" -linkistä.
export async function GET(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  const { supabase, kayttaja } = ok

  const { searchParams } = new URL(request.url)
  const asiakas_id = searchParams.get('asiakas_id')
  if (!asiakas_id) return NextResponse.json({ error: 'asiakas_id puuttuu' }, { status: 400 })

  // Organisaatiorajaus tässä, koska service role -avain ohittaa RLS:n
  const { data: asiakas } = await supabase
    .from('asiakkaat')
    .select('etunimi, sukunimi, osoite, postinumero, postitoimipaikka, y_tunnus, verotiliviite, avoin_vuosi')
    .eq('id', asiakas_id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .maybeSingle()
  if (!asiakas) return eiLoydy()

  const vuosi = valitseVuosi(searchParams.get('vuosi'), asiakas.avoin_vuosi)

  const [tapahtumat, tilat, investoinnit] = await Promise.all([
    supabase.from('tapahtumat')
      .select('tyyppi, kuvaus, paivamaara, summa_alv0, alv_prosentti, ennakko, kategoria')
      .eq('asiakas_id', asiakas_id).eq('verovuosi', vuosi).order('paivamaara'),
    supabase.from('metsatilat')
      .select('id, nimi, hankintahinta, hankintapvm, metsämaan_osuus_prosentti')
      .eq('asiakas_id', asiakas_id),
    supabase.from('investoinnit')
      .select('id, kuvaus, hankintahinta, poistoaika_vuotta, poistotapa, jaannosarvo, aktiivinen')
      .eq('asiakas_id', asiakas_id).eq('aktiivinen', true),
  ])
  const virhe = tapahtumat.error ?? tilat.error ?? investoinnit.error
  if (virhe) return NextResponse.json({ error: virhe.message }, { status: 500 })

  // Sarakkeen nimen ä sekoittaa supabase-js:n tyyppijäsentimen, joten tyyppi annetaan käsin
  const tilaIdt = ((tilat.data ?? []) as unknown as { id: string }[]).map(t => t.id)
  const invIdt = (investoinnit.data ?? []).map(i => i.id)

  // Metsävähennykset ja poistot rajautuvat asiakkaan omien tilojen ja investointien kautta
  const [vahennykset, poistot] = await Promise.all([
    tilaIdt.length > 0
      ? supabase.from('metsavahennykset')
          .select('metsatila_id, verovuosi, kaytettava_vahennys')
          .in('metsatila_id', tilaIdt)
          .order('verovuosi', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    invIdt.length > 0
      ? supabase.from('poistot')
          .select('investointi_id, verovuosi, poistomaara, jaannosarvo_vuoden_lopussa')
          .in('investointi_id', invIdt)
          .order('verovuosi', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])
  const virhe2 = vahennykset.error ?? poistot.error
  if (virhe2) return NextResponse.json({ error: virhe2.message }, { status: 500 })

  return NextResponse.json({
    vuosi,
    asiakas,
    tapahtumat: tapahtumat.data ?? [],
    tilat: tilat.data ?? [],
    investoinnit: investoinnit.data ?? [],
    vahennykset: vahennykset.data ?? [],
    poistot: poistot.data ?? [],
  })
}
