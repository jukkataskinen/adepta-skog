import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const session = await auth0.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'Ei kirjautunut' }, { status: 401 })
  }

  const body = await request.json()
  const { nimi, y_tunnus, kotikunta, sahkoposti, puhelin, organisaatio_id } = body

  if (!nimi || !organisaatio_id) {
    return NextResponse.json({ error: 'Nimi ja organisaatio_id ovat pakollisia' }, { status: 400 })
  }

  const { error } = await supabase!.from('asiakkaat').insert({
    nimi,
    y_tunnus: y_tunnus || null,
    kotikunta: kotikunta || null,
    sahkoposti: sahkoposti || null,
    puhelin: puhelin || null,
    organisaatio_id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
