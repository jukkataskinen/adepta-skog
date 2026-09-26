import { NextRequest, NextResponse } from 'next/server'
import { auth0 } from '@/lib/auth0'
import { supabaseAdmin } from '@/lib/supabase'

// Service role -avain ohittaa RLS:n, joten organisaatiorajaus on tarkistettava tässä jokaisessa reitissä

export type Kayttaja = { id: string; organisaatio_id: string; rooli: string }

type Ok = { kayttaja: Kayttaja; supabase: NonNullable<typeof supabaseAdmin> }

// Palauttaa kirjautuneen käyttäjän tai valmiin virhevastauksen
export async function vaadiKayttaja(request: NextRequest): Promise<Ok | { virhe: NextResponse }> {
  const session = await auth0.getSession(request)
  if (!session) return { virhe: NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 }) }
  if (!supabaseAdmin) return { virhe: NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 }) }

  const { data: kayttaja } = await supabaseAdmin
    .from('kayttajat')
    .select('id, organisaatio_id, rooli')
    .eq('auth_sub', session.user.sub)
    .single()
  if (!kayttaja?.organisaatio_id) return { virhe: NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 }) }

  return { kayttaja, supabase: supabaseAdmin }
}

// Sama vastaus sekä puuttuvalle että toisen organisaation asiakkaalle, jotta tunnisteita ei voi kokeilla
export const eiLoydy = () => NextResponse.json({ error: 'Asiakasta ei löydy' }, { status: 404 })

export async function asiakasOmassaOrganisaatiossa(ok: Ok, asiakasId: unknown): Promise<boolean> {
  if (typeof asiakasId !== 'string' || !asiakasId) return false
  const { data } = await ok.supabase
    .from('asiakkaat')
    .select('id')
    .eq('id', asiakasId)
    .eq('organisaatio_id', ok.kayttaja.organisaatio_id)
    .maybeSingle()
  return Boolean(data)
}

// Rivit, joilla ei ole omaa organisaatiota, rajataan asiakkaan kautta
export async function riviOmassaOrganisaatiossa(ok: Ok, taulu: 'arkisto' | 'investoinnit', id: string): Promise<boolean> {
  const { data } = await ok.supabase.from(taulu).select('asiakas_id').eq('id', id).maybeSingle()
  return asiakasOmassaOrganisaatiossa(ok, data?.asiakas_id)
}
