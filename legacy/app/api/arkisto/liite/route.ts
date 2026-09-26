import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, asiakasOmassaOrganisaatiossa, eiLoydy } from '@/lib/access'

export async function POST(request: NextRequest) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe

  const body = await request.json()
  const { asiakas_id, verovuosi, liite_nimi, liite_data, liite_koko } = body
  if (!(await asiakasOmassaOrganisaatiossa(ok, asiakas_id))) return eiLoydy()

  // Upsert arkisto row and attach the liite in one operation
  const { error } = await ok.supabase
    .from('arkisto')
    .upsert({
      asiakas_id,
      verovuosi,
      tiedostonimi: 'veroraportti_' + verovuosi + '.pdf',
      pdf_data: 'archived_' + verovuosi,
      liite_nimi,
      liite_data,
      liite_koko,
    }, { onConflict: 'asiakas_id,verovuosi' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
