import { HELP_TOPICS, sectionId } from "./topics";

/**
 * Sovelluksen sivut ja niiden ohjeet. Henkilökunnan kehys näyttää jokaisella
 * sivulla linkin sivun ohjeeseen tämän kartan perusteella. Tarkempi sääntö on
 * ensin. Uusi sivu lisätään tähän samassa muutoksessa: testi
 * tests/unit/help-routes.test.ts käy läpi kaikki henkilökunnan sivut ja kaatuu,
 * jos jollekin puuttuu ohje. query rajaa säännön osoitteen parametreihin
 * (maatalouden kirjanpito on sama sivu parametrilla toiminta=maatalous).
 */
const ROUTES: { pattern: RegExp; query?: RegExp; slug: string; section?: string }[] = [
  { pattern: /^\/tyopoyta/, slug: "tyopoyta" },
  { pattern: /^\/asiakkaat\/uusi/, slug: "asiakkaat", section: "Uusi asiakas" },
  { pattern: /^\/asiakkaat\/[^/]+\/metsatilat\/uusi/, slug: "metsatilat", section: "Uusi metsätila" },
  { pattern: /^\/asiakkaat\/[^/]+\/muokkaa/, slug: "asiakkaat", section: "Tietojen muokkaus" },
  { pattern: /^\/asiakkaat\/[^/]+\/metsatilat/, slug: "metsatilat" },
  { pattern: /^\/asiakkaat\/[^/]+\/kirjanpito\/[^/]+/, slug: "kirjanpito", section: "Muokkaus ja poisto" },
  { pattern: /^\/asiakkaat\/[^/]+\/kirjanpito\/?$/, query: /(^|&)toiminta=maatalous(&|$)/, slug: "maatalouden-kirjanpito" },
  { pattern: /^\/asiakkaat\/[^/]+\/kirjanpito/, slug: "kirjanpito" },
  { pattern: /^\/asiakkaat\/[^/]+\/investoinnit\/[^/]+/, slug: "investoinnit", section: "Aiemmin hankittu investointi ja menojäännös" },
  { pattern: /^\/asiakkaat\/[^/]+\/investoinnit/, slug: "investoinnit" },
  { pattern: /^\/asiakkaat\/[^/]+\/maatalous/, slug: "maatalous" },
  { pattern: /^\/asiakkaat\/[^/]+\/alv/, slug: "alv" },
  { pattern: /^\/asiakkaat\/[^/]+\/verosuunnitelma/, slug: "verosuunnitelma" },
  { pattern: /^\/asiakkaat\/[^/]+\/raportti/, slug: "veroraportti" },
  { pattern: /^\/asiakkaat/, slug: "asiakkaat" },
  { pattern: /^\/asetukset/, slug: "asetukset" },
  { pattern: /^\/kehitystoiveet/, slug: "kehitystoiveet" },
];

/** Sivun ohje: otsikko ja osoite (osioon asti, jos sivu vastaa ohjeen osiota). */
export function helpFor(pathname: string, search = ""): { slug: string; title: string; href: string } | null {
  const query = search.replace(/^\?/, "");
  const route = ROUTES.find((r) => r.pattern.test(pathname) && (!r.query || r.query.test(query)));
  const topic = route ? HELP_TOPICS.find((t) => t.slug === route.slug) : null;
  if (!route || !topic) return null;
  const section = route.section && topic.sections.some((s) => s.title === route.section) ? `#${sectionId(route.section)}` : "";
  return { slug: topic.slug, title: topic.title, href: `/ohjeet/${topic.slug}${section}` };
}

export const HELP_ROUTE_SLUGS = ROUTES.map((r) => ({ slug: r.slug, section: r.section ?? null }));
