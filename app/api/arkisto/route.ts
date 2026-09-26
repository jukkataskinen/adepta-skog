import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, asiakasOmassaOrganisaatiossa, eiLoydy } from '@/lib/access'

export async function POST(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe

  const body = await request.json()
  const { asiakas_id, verovuosi } = body
  if (!(await asiakasOmassaOrganisaatiossa(ok, asiakas_id))) return eiLoydy()

  const { error } = await ok.supabase.from('arkisto').upsert({
    asiakas_id,
    verovuosi,
    tiedostonimi: 'veroraportti_' + verovuosi + '.pdf',
    pdf_data: 'archived_' + verovuosi,
  }, { onConflict: 'asiakas_id,verovuosi' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe

  const { searchParams } = new URL(request.url)
  const asiakas_id = searchParams.get('asiakas_id')
  if (!asiakas_id) return NextResponse.json({ error: 'asiakas_id puuttuu' }, { status: 400 })
  if (!(await asiakasOmassaOrganisaatiossa(ok, asiakas_id))) return eiLoydy()

  const { data, error } = await ok.supabase
    .from('arkisto')
    .select('id, verovuosi, tiedostonimi, liite_nimi, liite_koko, luotu_at')
    .eq('asiakas_id', asiakas_id)
    .order('verovuosi', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
