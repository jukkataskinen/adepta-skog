import { NextRequest, NextResponse } from 'next/server'

// Erillinen sivu käytti kantaa selaimesta anon-avaimella, ja RLS esti haut, joten sivu oli tyhjä.
// Asiakassivun Kirjanpito-välilehti ja ALV-yhteenveto korvaavat sen. Vanhat kirjanmerkit ohjataan sinne.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/asiakas', request.url))
}
