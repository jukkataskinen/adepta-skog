export const dynamic = 'force-dynamic'

import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'
import { redirect, notFound } from 'next/navigation'
import MuokkausForm from './MuokkausForm'

type Params = { params: { id: string } }

export default async function AsiakasPage({ params }: Params) {
  const session = await auth0.getSession()
  if (!session?.user) redirect('/auth/login')

  if (!supabase) return <p>Supabase ei konfiguroitu</p>

  const { data: kayttaja } = await supabase
    .from('kayttajat')
    .select('organisaatio_id')
    .eq('auth_sub', session.user.sub)
    .single()

  if (!kayttaja) redirect('/auth/login')

  const { data: asiakas } = await supabase
    .from('asiakkaat')
    .select('id, etunimi, sukunimi, y_tunnus, kotikunta, sahkoposti, puhelin, alv_rekisterissa, luotu_at, osoite, postinumero, postitoimipaikka, verotiliviite, avoin_vuosi')
    .eq('id', params.id)
    .eq('organisaatio_id', kayttaja.organisaatio_id)
    .single()

  if (!asiakas) notFound()

  const { data: metsatilat } = await supabase
    .from('metsatilat')
    .select('id, nimi, kiinteistotunnus, pinta_ala_ha, hankintahinta, hankintapvm')
    .eq('asiakas_id', params.id)
    .order('nimi')

  const nimi = `${asiakas.etunimi} ${asiakas.sukunimi}`

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#1c2b1e', color: '#f0f4f1' }}>
      <nav style={{ width: '220px', flexShrink: 0, backgroundColor: '#162318', borderRight: '1px solid #2e4a32', display: 'flex', flexDirection: 'column', padding: '1.5rem 0' }}>
        <a href="/" style={{ fontFamily: "'Fraunces', serif", fontSize: '1.2rem', fontWeight: 600, color: '#1D9E75', textDecoration: 'none', padding: '0 1.25rem', marginBottom: '2rem', display: 'block' }}>Adepta SKOG</a>
        {[
          { label: 'Asiakkaat', href: '/asiakkaat' },
          { label: 'Kirjanpito', href: '/kirjanpito' },
          { label: 'ALV-raportti', href: '/kirjanpito/alv' },
          { label: 'Verosuunnitelma', href: '/vero-optimointi' },
          { label: 'Käyttäjät', href: '/kayttajat' },
          { label: 'Asetukset', href: '/asetukset' },
        ].map((link) => (
          <a key={link.href} href={link.href} style={{ padding: '0.6rem 1.25rem', fontSize: '0.9rem', color: link.href === '/asiakkaat' ? '#1D9E75' : '#9ab89e', textDecoration: 'none', fontWeight: link.href === '/asiakkaat' ? 500 : 400, borderLeft: link.href === '/asiakkaat' ? '2px solid #1D9E75' : '2px solid transparent' }}>{link.label}</a>
        ))}
        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem', borderTop: '1px solid #2e4a32' }}>
          <p style={{ fontSize: '0.8rem', color: '#7a9e7e', margin: '0 0 0.5rem' }}>{session.user.name ?? session.user.email}</p>
          <a href="/auth/logout?returnTo=https://skog.adepta.fi" style={{ fontSize: '0.8rem', color: '#7a9e7e', textDecoration: 'none' }}>Kirjaudu ulos</a>
        </div>
      </nav>
      <main style={{ flex: 1, padding: '2.5rem 2rem', overflowY: 'auto' }}>
        <div style={{ maxWidth: '880px' }}>
          <p style={{ fontSize: '0.85rem', color: '#7a9e7e', margin: '0 0 1.5rem' }}>
            <a href="/asiakkaat" style={{ color: '#1D9E75', textDecoration: 'none' }}>Asiakkaat</a> / {nimi}
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <div>
              <p style={{ fontFamily: "'Fraunces', serif", fontSize: '0.8rem', color: '#1D9E75', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 0.4rem' }}>Asiakas</p>
              <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '2rem', fontWeight: 300, color: '#e8f0e9', margin: 0 }}>{nimi}</h1>
            </div>
            <MuokkausForm asiakas={asiakas} />
          </div>
          <div style={{ border: '1px solid #2e4a32', borderRadius: '0.75rem', padding: '1.5rem', marginBottom: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <Kentta label="Y-tunnus" arvo={asiakas.y_tunnus} />
            <Kentta label="Kotikunta" arvo={asiakas.kotikunta} />
            <Kentta label="Osoite" arvo={asiakas.osoite} />
            <Kentta label="Postinumero ja -toimipaikka" arvo={[asiakas.postinumero, asiakas.postitoimipaikka].filter(Boolean).join(' ') || null} />
            <Kentta label="Sähköposti" arvo={asiakas.sahkoposti} />
            <Kentta label="Puhelin" arvo={asiakas.puhelin} />
            <Kentta label="Verotiliviite" arvo={asiakas.verotiliviite} />
            <Kentta label="Avoin verovuosi" arvo={asiakas.avoin_vuosi ? String(asiakas.avoin_vuosi) : null} />
            <Kentta label="ALV-rekisteri" arvo={asiakas.alv_rekisterissa ? 'Kyllä' : 'Ei'} />
            <Kentta label="Lisätty" arvo={new Date(asiakas.luotu_at).toLocaleDateString('fi-FI')} />
          </div>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '1.2rem', fontWeight: 300, color: '#e8f0e9', margin: '0 0 1rem' }}>Metsätilat</h2>
          {!metsatilat || metsatilat.length === 0 ? (
            <p style={{ color: '#7a9e7e', fontSize: '0.9rem', marginBottom: '2rem' }}>Ei metsätiloja.</p>
          ) : (
            <div style={{ border: '1px solid #2e4a32', borderRadius: '0.75rem', overflow: 'hidden', marginBottom: '2rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ backgroundColor: '#162318', borderBottom: '1px solid #2e4a32' }}>
                  {['Tilan nimi', 'Kiinteistötunnus', 'Pinta-ala (ha)', 'Hankintahinta'].map(h => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', fontSize: '0.75rem', color: '#7a9e7e', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>{metsatilat.map((t, i) => (
                  <tr key={t.id} style={{ borderBottom: i < metsatilat.length - 1 ? '1px solid #2e4a32' : 'none' }}>
                    <td style={{ padding: '0.85rem 1rem', color: '#e8f0e9', fontWeight: 500 }}>{t.nimi}</td>
                    <td style={{ padding: '0.85rem 1rem', color: '#9ab89e' }}>{t.kiinteistotunnus ?? '—'}</td>
                    <td style={{ padding: '0.85rem 1rem', color: '#9ab89e' }}>{t.pinta_ala_ha ?? '—'}</td>
                    <td style={{ padding: '0.85rem 1rem', color: '#9ab89e' }}>{t.hankintahinta ? `${Number(t.hankintahinta).toLocaleString('fi-FI')} €` : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function Kentta({ label, arvo }: { label: string; arvo: string | null | undefined }) {
  return (
    <div>
      <p style={{ fontSize: '0.75rem', color: '#7a9e7e', margin: '0 0 0.25rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
      <p style={{ fontSize: '0.95rem', color: '#e8f0e9', margin: 0 }}>{arvo ?? '—'}</p>
    </div>
  )
}
