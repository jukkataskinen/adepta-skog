import { HELP_TOPICS, sectionId } from "./topics";

/**
 * Sovelluksen sivut ja niiden ohjeet. Henkilökunnan kehys näyttää jokaisella
 * sivulla linkin sivun ohjeeseen tämän kartan perusteella. Tarkempi sääntö on
 * ensin. Uusi sivu lisätään tähän samassa muutoksessa: testi
 * tests/unit/help-routes.test.ts käy läpi kaikki henkilökunnan sivut ja kaatuu,
 * jos jollekin puuttuu ohje.
 */
const ROUTES: { pattern: RegExp; slug: string; section?: string }[] = [
  { pattern: /^\/tyopoyta/, slug: "tyopoyta" },
  { pattern: /^\/asiakkaat\/[^/]+\/metsatilat/, slug: "metsatilat" },
  { pattern: /^\/asiakkaat/, slug: "asiakkaat" },
  { pattern: /^\/asetukset/, slug: "asetukset" },
]

/** Sivun ohje: otsikko ja osoite (osioon asti, jos sivu vastaa ohjeen osiota). */
export function helpFor(pathname: string): { slug: string; title: string; href: string } | null {
  const route = ROUTES.find((r) => r.pattern.test(pathname));
  const topic = route ? HELP_TOPICS.find((t) => t.slug === route.slug) : null;
  if (!route || !topic) return null;
  const section = route.section && topic.sections.some((s) => s.title === route.section) ? `#${sectionId(route.section)}` : "";
  return { slug: topic.slug, title: topic.title, href: `/ohjeet/${topic.slug}${section}` };
}

export const HELP_ROUTE_SLUGS = ROUTES.map((r) => ({ slug: r.slug, section: r.section ?? null }));
