'use client'

import { useRouter } from 'next/navigation'

export default function LogoutButton() {
  const router = useRouter()

  const handleLogout = () => {
    router.push('/auth/logout?returnTo=https://skog.adepta.fi')
  }

  return (
    <button
      onClick={handleLogout}
      style={{
        fontSize: '0.8rem',
        padding: '0.4rem 1rem',
        backgroundColor: 'transparent',
        color: '#9ab89e',
        border: '1px solid #2e4a32',
        borderRadius: '0.4rem',
        cursor: 'pointer',
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      Kirjaudu ulos
    </button>
  )
}
