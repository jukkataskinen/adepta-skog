import { auth0 } from '@/lib/auth0'
import { supabase } from '@/lib/supabase'

export default async function Home() {
  const session = await auth0.getSession()
  const user = session?.user

  if (user) {
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

  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Adepta SKOG</h1>
        <p style={{ color: '#666' }}>Metsätalouden kirjanpito- ja veropalvelu</p>

        {user ? (
          <div style={{ marginTop: '1.5rem' }}>
            <p style={{ color: '#1D9E75', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              ✓ Kirjautunut: {user.name ?? user.email}
            </p>
            <a
              href="/auth/logout"
              style={{ display: 'inline-block', padding: '0.5rem 1.5rem', backgroundColor: '#dc2626', color: '#fff', borderRadius: '0.5rem', textDecoration: 'none' }}
            >
              Kirjaudu ulos
            </a>
          </div>
        ) : (
          <div style={{ marginTop: '1.5rem' }}>
            <a
              href="/auth/login"
              style={{ display: 'inline-block', padding: '0.5rem 1.5rem', backgroundColor: '#2563eb', color: '#fff', borderRadius: '0.5rem', textDecoration: 'none' }}
            >
              Kirjaudu sisään
            </a>
          </div>
        )}
      </div>
    </main>
  )
}
