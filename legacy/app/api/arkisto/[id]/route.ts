import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, riviOmassaOrganisaatiossa } from '@/lib/access'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  if (!(await riviOmassaOrganisaatiossa(ok, 'arkisto', params.id))) {
    return NextResponse.json({ error: 'Arkistoa ei löydy' }, { status: 404 })
  }

  const { data, error } = await ok.supabase
    .from('arkisto')
    .select('id, verovuosi, tiedostonimi, liite_nimi, liite_koko, liite_data, luotu_at')
    .eq('id', params.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
