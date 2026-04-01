export const dynamic = 'force-dynamic'

import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import AsiakasForm from './AsiakasForm'

type Asiakas = {
  id: string
  etunimi: string
  sukunimi: string
  y_tunnus: string | null
  kotikunta: string | null
}

const navLinks = [
  { label: 'Asiakkaat', href: '/asiakkaat' },
  { label: 'Kirjanpito', href: '/kirjanpito' },
  { label: 'ALV-raportti', href: '/kirjanpito/alv' },
  { label: 'Verosuunnitelma', href: '/vero-optimointi' },
  { label: 'Käyttäjät', href: '/kayttajat' },
  { label: 'Asetukset', href: '/asetukset' },
]

export default async function AsiakkaatPage() {
  const session = await auth0.getSession()
  const user = session?.user
  if (!user) redirect('/auth/login')

  const { data: kayttaja } = await supabase!
    .from('kayttajat')
    .select('organisaatio_id')
    .eq('auth_sub', user.sub)
    .single()

  const organisaatioId = kayttaja?.organisaatio_id ?? null

  const { data: asiakkaat } = organisaatioId
    ? await supabase!
        .from('asiakkaat')
        .select('id, etunimi, sukunimi, y_tunnus, kotikunta')
        .eq('organisaatio_id', organisaatioId)
        .order('sukunimi')
    : { data: [] }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#1c2b1e', color: '#f0f4f1' }}>

      {/* Sidebar */}
      <nav style={{
        width: '220px',
        flexShrink: 0,
        backgroundColor: '#162318',
        borderRight: '1px solid #2e4a32',
        display: 'flex',
        flexDirection: 'column',
        padding: '1.5rem 0',
      }}>
        <a href="/" style={{
          fontFamily: "'Fraunces', serif",
          fontSize: '1.2rem',
          fontWeight: 600,
          color: '#1D9E75',
          textDecoration: 'none',
          padding: '0 1.25rem',
          marginBottom: '2rem',
          display: 'block',
        }}>
          Adepta SKOG
        </a>
        {navLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            style={{
              padding: '0.6rem 1.25rem',
              fontSize: '0.9rem',
              color: link.href === '/asiakkaat' ? '#1D9E75' : '#9ab89e',
              textDecoration: 'none',
              fontWeight: link.href === '/asiakkaat' ? 500 : 400,
              borderLeft: link.href === '/asiakkaat' ? '2px solid #1D9E75' : '2px solid transparent',
            }}
          >
            {link.label}
          </a>
        ))}
        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem', borderTop: '1px solid #2e4a32' }}>
          <p style={{ fontSize: '0.8rem', color: '#7a9e7e', margin: '0 0 0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name ?? user.email}
          </p>
          <a href="/auth/logout?returnTo=https://skog.adepta.fi" style={{ fontSize: '0.8rem', color: '#7a9e7e', textDecoration: 'none' }}>
            Kirjaudu ulos
          </a>
        </div>
      </nav>

      {/* Pääsisältö */}
      <main style={{ flex: 1, padding: '2.5rem 2rem', overflowY: 'auto' }}>
        <div style={{ maxWidth: '880px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <div>
              <p style={{
                fontFamily: "'Fraunces', serif", fontSize: '0.8rem', color: '#1D9E75',
                letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 0.4rem',
              }}>
                Hallinta
              </p>
              <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '2rem', fontWeight: 300, color: '#e8f0e9', margin: 0 }}>
                Asiakkaat
              </h1>
            </div>
            {organisaatioId && <AsiakasForm organisaatioId={organisaatioId} />}
          </div>

          {!asiakkaat || asiakkaat.length === 0 ? (
            <p style={{ color: '#7a9e7e', fontSize: '0.95rem' }}>
              Ei asiakkaita. Lisää ensimmäinen asiakas yllä olevalla napilla.
            </p>
          ) : (
            <div style={{ border: '1px solid #2e4a32', borderRadius: '0.75rem', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#162318', borderBottom: '1px solid #2e4a32' }}>
                    {['Nimi', 'Y-tunnus', 'Kotikunta'].map((h) => (
                      <th key={h} style={{
                        padding: '0.75rem 1rem', textAlign: 'left',
                        fontSize: '0.75rem', color: '#7a9e7e',
                        fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(asiakkaat as Asiakas[]).map((a, i) => (
                    <tr
                      key={a.id}
                      style={{
                        borderBottom: i < (asiakkaat?.length ?? 0) - 1 ? '1px solid #2e4a32' : 'none',
                        backgroundColor: 'transparent',
                      }}
                    >
                      <td style={{ padding: '0.85rem 1rem', fontSize: '0.95rem', color: '#e8f0e9', fontWeight: 500 }}>
                        {a.etunimi} {a.sukunimi}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', fontSize: '0.9rem', color: '#9ab89e' }}>{a.y_tunnus ?? '—'}</td>
                      <td style={{ padding: '0.85rem 1rem', fontSize: '0.9rem', color: '#9ab89e' }}>{a.kotikunta ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
