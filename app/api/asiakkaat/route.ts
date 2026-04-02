// =============================================================
// app/api/asiakkaat/route.ts  —  GET listaus, POST uusi asiakas
// =============================================================
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { supabase } from '@/lib/supabase';

// GET /api/asiakkaat — hae organisaation asiakkaat
export async function GET(request: NextRequest) {
  const session = await auth0.getSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 });
  }

  // Hae käyttäjän organisaatio_id ja rooli
  const { data: kayttaja, error: kErr } = await supabase
    .from('kayttajat')
    .select('id, organisaatio_id, rooli')
    .eq('auth_sub', session.user.sub)
    .single();

  if (kErr || !kayttaja) {
    return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 });
  }

  let query = supabase
    .from('asiakkaat')
    .select('id, etunimi, sukunimi, sahkoposti, alv_rekisterissa, luotu_at, avoin_vuosi')
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .is('poistettu_at', null)
  if (kayttaja.rooli !== 'paakayttaja') {
    query = query.eq('vastuukirjanpitaja_id', kayttaja.id)
  }
  query = query.order('sukunimi', { ascending: true })
  const { data, error } = await query;

  if (error) {
    console.error('Supabase error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

// POST /api/asiakkaat — luo uusi asiakas
export async function POST(request: NextRequest) {
  const session = await auth0.getSession(request);
  if (!session) {
    return NextResponse.json({ error: 'Ei istuntoa' }, { status: 401 });
  }

  if (!supabase) {
    return NextResponse.json({ error: 'Supabase ei konfiguroitu' }, { status: 500 });
  }

  const body = await request.json();

  // Hae organisaatio_id
  const { data: kayttaja, error: kErr } = await supabase
    .from('kayttajat')
    .select('organisaatio_id')
    .eq('auth_sub', session.user.sub)
    .single();

  if (kErr || !kayttaja) {
    return NextResponse.json({ error: 'Käyttäjää ei löydy' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('asiakkaat')
    .insert({
      organisaatio_id: kayttaja.organisaatio_id,
      etunimi: body.etunimi,
      sukunimi: body.sukunimi,
      sahkoposti: body.sahkoposti ?? null,
      alv_rekisterissa: body.alv_rekisterissa ?? false,
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
