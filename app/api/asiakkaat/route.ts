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
    .select('id, etunimi, sukunimi, sahkoposti, alv_rekisterissa, luotu_at')
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .order('sukunimi', { ascending: true });

  if (error) {
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

  // Lomake lähettää "nimi" — jaetaan etunimi + sukunimi
  // "Matti Meikäläinen" → etunimi: "Matti", sukunimi: "Meikäläinen"
  // "Matti Olavi Meikäläinen" → etunimi: "Matti Olavi", sukunimi: "Meikäläinen"
  const nimiOsat = (body.nimi ?? '').trim().split(' ');
  const sukunimi = nimiOsat.length > 1 ? nimiOsat[nimiOsat.length - 1] : nimiOsat[0];
  const etunimi  = nimiOsat.length > 1 ? nimiOsat.slice(0, -1).join(' ') : '';

  const { data, error } = await supabase
    .from('asiakkaat')
    .insert({
      organisaatio_id: kayttaja.organisaatio_id,
      etunimi:         etunimi,
      sukunimi:        sukunimi,
      sahkoposti:      body.sahkoposti ?? null,
      puhelin:         body.puhelin ?? null,
      alv_rekisterissa: body.alv_rekisterissa ?? false,
      // y_tunnus ja kotikunta tallentuvat jos sarakkeet on lisätty
      ...(body.y_tunnus  ? { y_tunnus:  body.y_tunnus }  : {}),
      ...(body.kotikunta ? { kotikunta: body.kotikunta } : {}),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
