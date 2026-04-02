import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const body = await request.json()
  const { asiakas_id, verovuosi, liite_nimi, liite_data, liite_koko } = body

  // Upsert arkisto row and attach the liite in one operation
  const { error } = await supabase
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
