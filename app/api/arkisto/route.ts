import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin as supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const body = await request.json()
  const { asiakas_id, verovuosi } = body

  const { error } = await supabase.from('arkisto').upsert({
    asiakas_id,
    verovuosi,
    tiedostonimi: 'veroraportti_' + verovuosi + '.pdf',
    pdf_data: 'archived_' + verovuosi,
  }, { onConflict: 'asiakas_id,verovuosi' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request)
  if (!session) return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 })
  if (!supabase) return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const asiakas_id = searchParams.get('asiakas_id')
  if (!asiakas_id) return NextResponse.json({ error: 'asiakas_id puuttuu' }, { status: 400 })

  const { data, error } = await supabase
    .from('arkisto')
    .select('id, verovuosi, tiedostonimi, liite_nimi, liite_koko, luotu_at')
    .eq('asiakas_id', asiakas_id)
    .order('verovuosi', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
