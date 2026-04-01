export const dynamic = 'force-dynamic'

import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'
import { redirect } from 'next/navigation'
import AsiakasForm from './AsiakasForm'

type Asiakas = {
  id: string
  nimi: string
  y_tunnus: string | null
  kotikunta: string | null
}

export default async function AsiakkaatPage() {
  const session = await auth0.getSession()
  if (!session?.user) redirect('/auth/login')

  const user = session.user

  // 1. Hae käyttäjän organisaatio_id
  const { data: kayttaja } = await supabase!
    .from('kayttajat')
    .select('organisaatio_id')
    .eq('auth_sub', user.sub)
    .single()

  const organisaatioId = kayttaja?.organisaatio_id ?? null

  // 2. Hae asiakkaat
  const { data: asiakkaat } = organisaatioId
    ? await supabase!
        .from('asiakkaat')
        .select('id, nimi, y_tunnus, kotikunta')
        .eq('organisaatio_id', organisaatioId)
        .order('nimi')
    : { data: [] }

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#1c2b1e', color: '#f0f4f1' }}>
      <style>{`
        .asiakas-rivi:hover { background-color: #283f2d; }
        a.takaisin:hover { color: #1D9E75; }
      `}</style>

      {/* Header */}
      <header style={{
        backgroundColor: '#162318',
        borderBottom: '1px solid #2e4a32',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <a href="/" className="takaisin" style={{
          fontFamily: "'Fraunces', serif",
          fontSize: '1.6rem',
          fontWeight: 600,
          color: '#1D9E75',
          textDecoration: 'none',
        }}>
          Adepta SKOG
        </a>
        <span style={{ fontSize: '0.875rem', color: '#9ab89e' }}>
          {user.name ?? user.email}
        </span>
      </header>

      {/* Sisältö */}
      <section style={{ padding: '2.5rem 2rem', maxWidth: '960px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '2rem' }}>
          <div>
            <p style={{ fontFamily: "'Fraunces', serif", fontSize: '0.85rem', color: '#1D9E75', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.4rem' }}>
              Hallinta
            </p>
            <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: '2rem', fontWeight: 300, color: '#e8f0e9', margin: 0 }}>
              Asiakkaat
            </h1>
          </div>
          {organisaatioId && <AsiakasForm organisaatioId={organisaatioId} />}
        </div>

        {/* Taulukko */}
        {!asiakkaat || asiakkaat.length === 0 ? (
          <p style={{ color: '#7a9e7e', fontSize: '0.95rem' }}>Ei asiakkaita. Lisää ensimmäinen asiakas.</p>
        ) : (
          <div style={{ border: '1px solid #2e4a32', borderRadius: '0.75rem', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#162318', borderBottom: '1px solid #2e4a32' }}>
                  {['Nimi', 'Y-tunnus', 'Kotikunta'].map((h) => (
                    <th key={h} style={{
                      padding: '0.75rem 1rem', textAlign: 'left',
                      fontSize: '0.8rem', color: '#7a9e7e',
                      fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(asiakkaat as Asiakas[]).map((a, i) => (
                  <tr
                    key={a.id}
                    className="asiakas-rivi"
                    style={{
                      borderBottom: i < asiakkaat.length - 1 ? '1px solid #2e4a32' : 'none',
                      transition: 'background-color 0.15s',
                    }}
                  >
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.95rem', color: '#e8f0e9', fontWeight: 500 }}>{a.nimi}</td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.9rem', color: '#9ab89e' }}>{a.y_tunnus ?? '—'}</td>
                    <td style={{ padding: '0.85rem 1rem', fontSize: '0.9rem', color: '#9ab89e' }}>{a.kotikunta ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
