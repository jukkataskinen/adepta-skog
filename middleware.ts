import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth0 } from './lib/auth0'

export async function middleware(request: NextRequest) {
  const authRes = await auth0.middleware(request)

  // Auth0 handles /auth/* routes (login, callback, logout, profile, access-token)
  if (request.nextUrl.pathname.startsWith('/auth')) {
    return authRes
  }

  // Redirect unauthenticated users to login
  const session = await auth0.getSession(request)
  if (!session) {
    const loginUrl = new URL('/auth/login', request.nextUrl.origin)
    loginUrl.searchParams.set('returnTo', request.nextUrl.pathname)
    return NextResponse.redirect(loginUrl)
  }

  return authRes
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|demo|icons|manifest.json|sw.js|tietosuojaseloste.html|kayttoehdot.html|index.html|$).*)'],
}
