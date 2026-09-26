import { NextResponse } from 'next/server'

export async function GET() {
  const auth0Domain = process.env.AUTH0_DOMAIN
  const clientId = process.env.AUTH0_CLIENT_ID
  const returnTo = encodeURIComponent('https://skog.adepta.fi')

  const response = NextResponse.redirect(
    `https://${auth0Domain}/v2/logout?client_id=${clientId}&returnTo=${returnTo}`
  )

  // Tyhjennä session cookie manuaalisesti
  response.cookies.delete('appSession')

  return response
}
