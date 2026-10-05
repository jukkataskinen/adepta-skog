/**
 * Pyyntö samasta osoitteesta (Origin vs. host). Selaimen fetch-reitit käyttävät
 * istuntoevästettä, joten toisen sivuston pyyntö hylätään ennen kirjautumisen
 * tarkistusta; server actionit tekevät saman tarkistuksen itse.
 * Origin "null" tai muuten jäsentymätön osoite hylätään eikä kaada reittiä.
 */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
