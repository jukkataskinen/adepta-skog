export const dynamic = 'force-dynamic'

import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'
import LogoutButton from './components/LogoutButton'

export default async function Home() {
  const session = await auth0.getSession()
  const user = session?.user

  if (user && supabase) {
    // 1. Tarkista onko käyttäjällä jo organisaatio
    const { data: olemassaOleva } = await supabase
      .from('kayttajat')
      .select('organisaatio_id')
      .eq('auth_sub', user.sub)
      .single()

    let organisaatioId = olemassaOleva?.organisaatio_id ?? null

    // 2. Jos ei ole, luo uusi organisaatio
    if (!organisaatioId) {
      const { data: uusiOrg, error: orgError } = await supabase
        .from('organisaatiot')
        .insert({ nimi: user.email })
        .select('id')
        .single()

      if (orgError) {
        console.error('[Supabase organisaatio insert error]', orgError)
      } else {
        organisaatioId = uusiOrg.id
        console.log('[Supabase organisaatio luotu]', uusiOrg)
      }
    }

    // 3. Upsert käyttäjä organisaatio_id:llä
    const { data, error } = await supabase.from('kayttajat').upsert(
      {
        auth_sub: user.sub,
        sahkoposti: user.email,
        viimeksi_kirjautunut: new Date().toISOString(),
        organisaatio_id: organisaatioId,
      },
      { onConflict: 'auth_sub' }
    )
    if (error) {
      console.error('[Supabase upsert error]', error)
    } else {
      console.log('[Supabase upsert ok]', data)
    }
  }

  const navItems = [
    {
      label: 'Asiakkaat',
      href: '/asiakkaat',
      icon: '👥',
      desc: 'Hallinnoi asiakkaita ja tiloja',
    },
    {
      label: 'Kirjanpito',
      href: '/kirjanpito',
      icon: '📒',
      desc: 'Tulot, menot ja tiliotteet',
    },
    {
      label: 'Vero-optimointi',
      href: '/vero-optimointi',
      icon: '📊',
      desc: 'Metsäverotuksen suunnittelu',
    },
    {
      label: 'Kuittiskanneri',
      href: '/demo/adepta_skog_kuittiskanneri.html',
      icon: '📷',
      desc: 'Skannaa ja tallenna kuitit',
    },
  ]

  return (
    <main style={{ minHeight: '100vh', backgroundColor: '#1c2b1e', color: '#f0f4f1' }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#162318',
        borderBottom: '1px solid #2e4a32',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h1 style={{
          fontFamily: "'Fraunces', serif",
          fontSize: '1.6rem',
          fontWeight: 600,
          color: '#1D9E75',
          margin: 0,
          letterSpacing: '-0.01em',
        }}>
          Adepta SKOG
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.875rem', color: '#9ab89e' }}>
            {user?.name ?? user?.email}
          </span>
          <LogoutButton />
        </div>
      </header>

      {/* Hero */}
      <section style={{ padding: '3rem 2rem 2rem', maxWidth: '960px', margin: '0 auto' }}>
        <p style={{ fontFamily: "'Fraunces', serif", fontSize: '0.85rem', color: '#1D9E75', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
          Dashboard
        </p>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '2.2rem', fontWeight: 300, color: '#e8f0e9', margin: '0 0 0.5rem' }}>
          Tervetuloa, {user?.name?.split(' ')[0] ?? 'käyttäjä'}
        </h2>
        <p style={{ color: '#7a9e7e', fontSize: '0.95rem', margin: 0 }}>
          Metsätalouden kirjanpito- ja veropalvelu
        </p>
      </section>

      {/* Cards */}
      <style>{`
        .skog-card {
          display: block;
          background-color: #223528;
          border: 1px solid #2e4a32;
          border-radius: 0.75rem;
          padding: 1.5rem;
          text-decoration: none;
          color: inherit;
          transition: border-color 0.2s, background-color 0.2s;
        }
        .skog-card:hover {
          border-color: #1D9E75;
          background-color: #283f2d;
        }
      `}</style>
      <section style={{
        padding: '1rem 2rem 4rem',
        maxWidth: '960px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '1.25rem',
      }}>
        {navItems.map((item) => (
          <a key={item.href} href={item.href} className="skog-card">
            <span style={{ fontSize: '1.75rem', display: 'block', marginBottom: '0.75rem' }}>{item.icon}</span>
            <strong style={{
              fontFamily: "'Fraunces', serif",
              fontSize: '1.05rem',
              fontWeight: 600,
              color: '#e8f0e9',
              display: 'block',
              marginBottom: '0.35rem',
            }}>
              {item.label}
            </strong>
            <span style={{ fontSize: '0.8rem', color: '#7a9e7e', lineHeight: 1.4 }}>
              {item.desc}
            </span>
          </a>
        ))}
      </section>
    </main>
  )
}
