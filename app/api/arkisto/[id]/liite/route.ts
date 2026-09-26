import { NextRequest, NextResponse } from 'next/server'
import { vaadiKayttaja, riviOmassaOrganisaatiossa } from '@/lib/access'

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const ok = await vaadiKayttaja(request)
  if ('virhe' in ok) return ok.virhe
  if (!(await riviOmassaOrganisaatiossa(ok, 'arkisto', params.id))) {
    return NextResponse.json({ error: 'Arkistoa ei löydy' }, { status: 404 })
  }

  const { error } = await ok.supabase
    .from('arkisto')
    .update({ liite_nimi: null, liite_data: null, liite_koko: null })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
