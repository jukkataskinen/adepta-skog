import { ACTIVITY_PARAM, type Activity } from "@/lib/tax/rules";

/**
 * Kirjanpidon oletusnäkymä (DECISIONS 6.10.2026, odottavat tositteet).
 * Kun sivu avataan ilman vuotta ja toimintoa (esimerkiksi välilehdeltä tai
 * asiakaslistasta), ja asiakkaalla on odottavia tunnistuksen ehdotuksia,
 * avataan se vuosi ja toiminto, jossa uusin odottava ehdotus on. Näin
 * kesken jäänyt työ on heti näkyvissä. Muuten sivun omat oletukset pätevät.
 * Puhdas funktio: palauttaa vuoden ja toimintoparametrin sellaisina kuin ne
 * olisivat osoitteessa.
 */
export function ledgerTarget(input: {
  requestedYear?: string;
  requestedActivity?: string;
  years: { year: number }[];
  pending: { year: number; activity: Activity; createdAt: string }[];
}): { vuosi?: string; toiminta?: string } {
  const { requestedYear, requestedActivity } = input;
  if (requestedYear || requestedActivity) return { vuosi: requestedYear, toiminta: requestedActivity };
  const known = new Set(input.years.map((y) => y.year));
  const newest = input.pending
    .filter((p) => known.has(p.year))
    .reduce<(typeof input.pending)[number] | null>((best, p) => (!best || Date.parse(p.createdAt) > Date.parse(best.createdAt) ? p : best), null);
  if (!newest) return {};
  return { vuosi: String(newest.year), toiminta: ACTIVITY_PARAM[newest.activity] };
}
