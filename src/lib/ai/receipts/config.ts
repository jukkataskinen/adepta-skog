/**
 * Tunnistuksen osiin jaon vakiot (DECISIONS 28.9.2026, tunnistus osissa).
 *
 * Koko vuoden tositeaineisto skannataan usein yhdeksi 30–100 sivun PDF:ksi.
 * Yksi kutsu koko tiedostolle ei mahdu palvelun vastausrajaan eikä Vercelin
 * funktioaikaan, joten tiedosto luetaan paloina. Jokainen pala on oma
 * palvelinkutsunsa, ja selain ohjaa etenemistä.
 */

/** Sivuja palassa. Kahdeksan skannattua sivua ehtii lukea selvästi alle kutsun aikarajan. */
export const CHUNK_PAGES = 8;

/**
 * Limitys: palan viimeinen sivu on myös seuraavan palan ensimmäinen sivu, jotta
 * palojen rajalle osuva asiakirja näkyy kokonaan ainakin toisessa palassa.
 * Molempien palojen tunnistama sama rivi yhdistetään (merge.ts).
 */
export const CHUNK_OVERLAP = 1;

/**
 * Yhden palan tunnistuksen aikaraja. Palvelinfunktion enimmäisaika on sivulla
 * 120 s (kirjanpito/page.tsx); tiedoston haku, jako ja tallennus mahtuvat loppuun.
 */
export const CHUNK_TIMEOUT_MS = 100_000;

/**
 * Palan vastauksen enimmäispituus. Kahdeksan sivua tuottaa tavallisesti 5–30
 * riviä (noin 120 tokenia riviltä) ja ajattelun; 12 000 jättää runsaasti varaa,
 * mutta aikaraja katkaisee ennen kuin tätä pidempi vastaus ehtisi valmistua.
 */
export const CHUNK_MAX_TOKENS = 12_000;

/**
 * Selain lukee enintään näin monta palaa yhtä aikaa (DECISIONS 2.10.2026).
 * Lyhyt tiedosto luetaan kahtena rinnakkaisena, pitkä (yli 6 osaa, noin 45
 * sivua) kolmena, jotta 300 sivun vuosiaineisto valmistuu noin 10–25
 * minuutissa. Enempää ei ajeta, koska Anthropicin minuuttikohtainen
 * tokeniraja (8 skannattua sivua on noin 20 000 syötetokenia) ja
 * palan uusinta riittävät silloin vielä pienelläkin käyttötasolla.
 */
export const CHUNK_PARALLEL = 2;
export const CHUNK_PARALLEL_LONG = 3;

export function chunkParallel(chunkCount: number): number {
  return chunkCount > 6 ? CHUNK_PARALLEL_LONG : CHUNK_PARALLEL;
}

/** Aika-arvio yhdelle palalle sekunteina (alaraja, yläraja). */
export const CHUNK_SECONDS: [number, number] = [30, 70];
