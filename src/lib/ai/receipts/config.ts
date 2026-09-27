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

/** Selain lukee enintään näin monta palaa yhtä aikaa. */
export const CHUNK_PARALLEL = 2;

/** Aika-arvio yhdelle palalle sekunteina (alaraja, yläraja). */
export const CHUNK_SECONDS: [number, number] = [30, 70];
