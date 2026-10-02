import { CHUNK_OVERLAP, CHUNK_PAGES, CHUNK_PARALLEL, CHUNK_SECONDS } from "./config";
import type { Activity } from "@/lib/tax/rules";
import { cleanPages, validateLines, type ChunkLine } from "./schema";

/**
 * Tiedoston jako paloihin ja palan sivujen muunnos (DECISIONS 28.9.2026).
 * Puhdas moduuli: ei kantaa eikä palvelua, joten sama logiikka toimii
 * palvelimella, selaimessa (arvio) ja testeissä.
 */

/** Pala koko tiedoston sivuina, 1-pohjaisina ja molemmat päät mukaan lukien. */
export interface ChunkRange {
  first: number;
  last: number;
  /** Koko tiedoston sivumäärä. 0 = ei tiedossa (tiedostoa ei voitu jäsentää). */
  total: number;
}

/**
 * Palasuunnitelma. Pieni tiedosto (enintään palan kokoinen), kuva ja tiedosto,
 * jonka sivumäärää ei saatu selville, luetaan yhtenä palana kuten ennen.
 * Pala alkaa edellisen palan viimeiseltä sivulta (limitys), joten askel on
 * palan koko miinus limitys.
 */
export function planChunks(pageCount: number, size = CHUNK_PAGES, overlap = CHUNK_OVERLAP): ChunkRange[] {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return [{ first: 1, last: 1, total: 0 }];
  if (pageCount <= size) return [{ first: 1, last: pageCount, total: pageCount }];
  const step = Math.max(1, size - overlap);
  const out: ChunkRange[] = [];
  for (let first = 1; ; first += step) {
    const last = Math.min(pageCount, first + size - 1);
    out.push({ first, last, total: pageCount });
    if (last >= pageCount) break;
  }
  return out;
}

/** Onko pala koko tiedosto (ei jakoa, tiedosto lähetetään sellaisenaan). */
export function isWholeFile(chunk: ChunkRange): boolean {
  return chunk.total === 0 || (chunk.first === 1 && chunk.last === chunk.total);
}

/**
 * Mallin palauttamat sivut koko tiedoston sivuiksi. Mallille kerrotaan palan
 * sivut koko tiedostossa, ja sitä pyydetään käyttämään niitä. Jos kaikki palan
 * sivut ovat kuitenkin liitteen omassa numeroinnissa (1…palan pituus) eivätkä
 * mahdu palan alueelle, ne siirretään palan alkuun. Epäselvässä tapauksessa
 * (molemmat tulkinnat mahdollisia) koko tiedoston numerointi voittaa, koska
 * sitä pyydettiin. Palan ulkopuolelle jäävä sivu jätetään pois; rivi säilyy.
 */
export function mapChunkPages<T extends { pages: number[] }>(lines: T[], chunk: ChunkRange): T[] {
  if (chunk.total === 0) return lines.map((l) => ({ ...l, pages: cleanPages(l.pages) }));
  const length = chunk.last - chunk.first + 1;
  const all = lines.flatMap((l) => l.pages);
  const inChunk = (p: number) => p >= chunk.first && p <= chunk.last;
  const local = chunk.first > 1 && all.length > 0 && !all.every(inChunk) && all.every((p) => p >= 1 && p <= length);
  return lines.map((l) => ({
    ...l,
    pages: cleanPages((local ? l.pages.map((p) => p + chunk.first - 1) : l.pages).filter(inChunk)),
  }));
}

/**
 * Palan vastaus tarkistetuiksi riveiksi koko tiedoston sivuin. Maksurivejä ei
 * poisteta tässä, vaan yhdistämisessä, kun kaikki palat ovat mukana.
 */
export function validateChunkRecognition(raw: unknown, chunk: ChunkRange, activities: Activity[] = ["forestry"]): { ok: true; lines: ChunkLine[] } | { ok: false } {
  const lines = validateLines(raw, activities);
  if (!lines?.length) return { ok: false };
  return { ok: true, lines: mapChunkPages(lines, chunk) };
}

/** Sivualueen teksti: "9–16" tai "9". */
export function pageRangeText(first: number, last: number): string {
  return first === last ? `${first}` : `${first}–${last}`;
}

/**
 * Epäonnistuneet palat sivualueina. Peräkkäiset (limittäiset tai vierekkäiset)
 * palat yhdistetään: "Sivuja 17–29 ei voitu lukea".
 */
export function failedPagesText(chunks: { first: number; last: number; status: string }[]): string | null {
  const failed = chunks.filter((c) => c.status === "failed").sort((a, b) => a.first - b.first);
  if (!failed.length) return null;
  const ranges: [number, number][] = [];
  for (const c of failed) {
    const prev = ranges[ranges.length - 1];
    if (prev && c.first <= prev[1] + 1) prev[1] = Math.max(prev[1], c.last);
    else ranges.push([c.first, c.last]);
  }
  const text = ranges.map(([a, b]) => pageRangeText(a, b)).join(", ");
  const single = ranges.length === 1 && ranges[0][0] === ranges[0][1];
  return `${single ? "Sivua" : "Sivuja"} ${text} ei voitu lukea.`;
}

/**
 * Aika-arvio käyttäjälle: "40 sivua, 6 osaa, noin 2–3 min". Palat luetaan
 * CHUNK_PARALLEL kerrallaan, joten kierroksia on palojen määrä jaettuna sillä.
 */
export function estimateText(pageCount: number, chunkCount: number, parallel = CHUNK_PARALLEL): string {
  const rounds = Math.ceil(chunkCount / Math.max(1, parallel));
  const [lo, hi] = [rounds * CHUNK_SECONDS[0], rounds * CHUNK_SECONDS[1]];
  const min = Math.max(1, Math.round(lo / 60));
  const max = Math.max(min, Math.ceil(hi / 60));
  const time = hi <= 90 ? `noin ${lo}–${hi} s` : min === max ? `noin ${min} min` : `noin ${min}–${max} min`;
  const pages = pageCount > 0 ? `${pageCount} ${pageCount === 1 ? "sivu" : "sivua"}, ` : "";
  return `${pages}${chunkCount} ${chunkCount === 1 ? "osa" : "osaa"}, ${time}`;
}
