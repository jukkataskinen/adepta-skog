// =============================================================
// app/layout.tsx  —  juuriasettelu + navigaatio + auth guard
// =============================================================
import { auth0 } from '@/lib/auth0';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Metsävero',
  description: 'Metsätalouden kirjanpito ja verolaskenta',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Middleware hoitaa autentikoinnin, mutta haetaan session käyttäjätietoja varten
  const session = await auth0.getSession();

  // Kirjautumaton → kirjautumissivulle (middleware tekee saman, tämä on varmuuden vuoksi)
  if (!session) redirect('/auth/login');

  const rooli = (session.user as { rooli?: string })?.rooli ?? 'lukija';

  return (
    <html lang="fi">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh' }}>

          {/* Sivupalkki */}
          <nav style={{
            width: 220,
            borderRight: '0.5px solid #e5e5e5',
            background: '#fff',
            padding: '1.5rem 0',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{ padding: '0 1.25rem 1.5rem', borderBottom: '0.5px solid #e5e5e5' }}>
              <span style={{ fontSize: 18, fontWeight: 500 }}>🌲 Metsävero</span>
            </div>

            <div style={{ padding: '1rem 0', flex: 1 }}>
              {[
                { href: '/asiakkaat',    label: 'Asiakkaat' },
                { href: '/kirjanpito',   label: 'Kirjanpito' },
                { href: '/investoinnit', label: 'Investoinnit' },
                { href: '/alv',          label: 'ALV-laskelma' },
                { href: '/raportit',     label: 'Raportit' },
              ].map(({ href, label }) => (
                <Link key={href} href={href} style={{
                  display: 'block',
                  padding: '8px 1.25rem',
                  fontSize: 14,
                  color: '#333',
                  textDecoration: 'none',
                }}>
                  {label}
                </Link>
              ))}

              {/* Hallinta vain pääkäyttäjälle */}
              {rooli === 'paakayttaja' && (
                <Link href="/hallinta" style={{
                  display: 'block',
                  padding: '8px 1.25rem',
                  fontSize: 14,
                  color: '#333',
                  textDecoration: 'none',
                }}>
                  Hallinta
                </Link>
              )}
            </div>

            {/* Käyttäjäinfo alaosassa */}
            <div style={{
              padding: '1rem 1.25rem',
              borderTop: '0.5px solid #e5e5e5',
              fontSize: 12,
              color: '#888',
            }}>
              <div style={{ fontWeight: 500, color: '#333', marginBottom: 2 }}>
                {session.user?.name}
              </div>
              <div style={{ marginBottom: 8 }}>{rooliLabel(rooli)}</div>
              <Link href="/auth/logout" style={{ color: '#888', fontSize: 12 }}>
                Kirjaudu ulos
              </Link>
            </div>
          </nav>

          {/* Sisältöalue */}
          <main style={{ flex: 1, padding: '2rem', background: '#f8f7f4', overflowY: 'auto' }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

function rooliLabel(rooli: string) {
  return { paakayttaja: 'Pääkäyttäjä', kirjanpitaja: 'Kirjanpitäjä', lukija: 'Lukija' }[rooli] ?? rooli;
}
