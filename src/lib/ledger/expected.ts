import { defaultVatRate, isAssetPurchase, isAssetSale, type Activity, type TransactionKind } from "@/lib/tax/rules";

/**
 * Odotetut kirjaukset: asiakkaan aiempien vuosien toistuvat kirjaukset ennusteeksi
 * tälle vuodelle (DECISIONS 5.10.2026). Puhtaat funktiot, ei kantaa: syöte on
 * asiakkaan historia yhdellä kyselyllä (expected-load.ts), tulos on lista.
 *
 * Säännöt lyhyesti:
 * - Kirjaukset ryhmitellään toiminnon, luokan ja normalisoidun selitteen mukaan.
 *   Selitteestä poistetaan numerot, päivät, viitteet, vuodet ja kuukausien nimet,
 *   ja samankaltaisuus lasketaan sanoista (Jaccard, sanan alku riittää).
 * - Toistuva = esiintyy vähintään kahtena kolmesta edellisestä vuodesta. Jos
 *   asiakkaalla on vain yksi aiempi vuosi, sen kirjaukset ovat ennuste
 *   heikolla luotettavuudella, jotta ennuste alkaa jo toisesta vuodesta.
 * - Kertoja vuodessa = mediaani vuosista, joina ryhmä esiintyi. Kuukaudet ja
 *   päivät tulevat tuoreimmasta vuodesta, jona kertoja oli juuri niin monta.
 * - Summan arvio on tuoreimman vuoden mediaani (viimeisin taso), vaihteluväli
 *   kolmen edellisen vuoden pienin ja suurin.
 * - Investoinnin hankinta ja myynti eivät ole toistuvia (kohde ja laji vaihtuvat).
 */

export interface HistoryEntry {
  id?: string;
  year: number;
  bookedOn: string;
  category: string;
  kind: TransactionKind;
  activity: Activity;
  description: string;
  amountGross: number;
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
  forestPropertyId: string | null;
}

export interface ExpectedOptions {
  /** Ennustettava vuosi. */
  year: number;
  /** Arvonlisäveron oletus riippuu rekisteröinnistä (rules.ts defaultVatRate). */
  vatRegistered: boolean;
  /** Tarkasteltavat edelliset vuodet toistuvuuden säännössä. */
  lookbackYears?: number;
  /** Montako niistä vähintään. */
  minYears?: number;
  /** Luotettavuuden laskennassa katsotaan näin monta vuotta taaksepäin. */
  historyYears?: number;
  /** Selitteiden samankaltaisuuden raja (0–1). */
  threshold?: number;
  /** Summan varasäännön toleranssi (0,2 = ±20 %). 0 = ei varasääntöä. */
  amountTolerance?: number;
}

export const EXPECTED_DEFAULTS = { lookbackYears: 3, minYears: 2, historyYears: 5, threshold: 0.5, amountTolerance: 0.2 } as const;

export type Confidence = "high" | "medium" | "low";

export interface ExpectedInstance {
  /** Kerran järjestysnumero vuoden sisällä (0 = ensimmäinen). */
  index: number;
  month: number;
  /** Ennustettu päivä tänä vuonna (kuukauden viimeinen, jos päivää ei ole). */
  date: string;
}

export interface ExpectedEntry {
  /** Pysyvä tunniste ohitusta ja esitäyttöä varten: tiiviste toiminnosta, luokasta ja selitteestä. */
  key: string;
  activity: Activity;
  category: string;
  kind: TransactionKind;
  /** Tuoreimman kirjauksen selite, vuosiluku vaihdettu tähän vuoteen. */
  description: string;
  /** Vuodet (historiaikkunassa), joina ryhmä esiintyi, uusin ensin. */
  yearsSeen: number[];
  /** Montako edellisistä vuosista (lookback) ryhmä esiintyi, ja montako vuotta tarkasteltiin. */
  recentYears: number;
  lookbackYears: number;
  confidence: Confidence;
  perYear: number;
  instances: ExpectedInstance[];
  /** Arvio yhdelle kerralle (summa arvonlisäveron kanssa). */
  estimate: number;
  min: number;
  max: number;
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
  forestPropertyId: string | null;
  /** Ryhmän selitteiden sanat matching-vaihetta varten. */
  signatures: string[][];
}

// ---------------------------------------------------------------------------
// Selitteen normalisointi
// ---------------------------------------------------------------------------

const MONTH = /^(tammi|helmi|maalis|huhti|touko|kesä|heinä|elo|syys|loka|marras|joulu)(k|kuu\p{L}*)?$/u;
const MONTH_ABBR = /^(tam|hel|maa|huh|tou|kes|hei|elo|syy|lok|mar|jou)$/;
// Yhtiömuodot ja sidesanat eivät erota kirjauksia toisistaan.
const STOP = new Set(["oy", "oyj", "ab", "ky", "tmi", "ry", "osk", "ja", "sekä", "tai", "kk", "vko", "nro", "no", "ref", "viite", "lasku", "pvm", "jakso", "ajalta", "ajalle", "vuosi", "vuodelta", "vuodelle"]);

/**
 * Selite sanoiksi: pienet kirjaimet, numeroita sisältävät sanat (päivät, viitteet,
 * vuodet, laskunumerot) ja kuukausien nimet pois, välimerkit pois. Järjestetty ja
 * yksilöity, jotta sama selite antaa saman allekirjoituksen.
 */
export function normalizeDescription(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s/,;:()[\]{}"'+*=|\\_–—-]+/u)
    .filter((w) => w && !/\d/.test(w))
    .map((w) => w.replace(/[^\p{L}]/gu, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w) && !MONTH.test(w) && !MONTH_ABBR.test(w));
  return [...new Set(words)].sort();
}

/** Sanat vastaavat, jos ne ovat samat tai toinen on toisen alku (taivutus: maksu, maksut, maksun). */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
}

/** Sanajoukkojen samankaltaisuus 0–1 (Jaccard). Kaksi tyhjää selitettä ovat samat. */
export function similarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  let matched = 0;
  for (const w of a) if (b.some((x) => wordsMatch(w, x))) matched++;
  return matched / (a.length + b.length - matched);
}

/** FNV-1a 32 bit heksana. Lyhyt ja vakaa tunniste; ei henkilötietoja osoitteeseen eikä kantaan. */
export function expectedKey(activity: Activity, categoryCode: string, signature: string[]): string {
  const s = `${activity}|${categoryCode}|${signature.join(" ")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Ryhmittely
// ---------------------------------------------------------------------------

interface Cluster {
  activity: Activity;
  category: string;
  rows: (HistoryEntry & { words: string[] })[];
  signatures: string[][];
}

const sigKey = (w: string[]) => w.join(" ");

function bestCluster(clusters: Cluster[], words: string[], threshold: number): Cluster | null {
  let best: Cluster | null = null;
  let bestSim = -1;
  for (const c of clusters) {
    const sim = Math.max(...c.signatures.map((s) => similarity(words, s)));
    if (sim >= threshold && sim > bestSim) {
      best = c;
      bestSim = sim;
    }
  }
  return best;
}

/**
 * Ryhmittely uusimmasta vanhimpaan. Ensin selitteen mukaan; jos mikään ryhmä ei
 * sovi, varasääntö kuten tämän vuoden tunnistuksessa: saman luokan ryhmä, jolla
 * ei vielä ole kirjausta tältä vuodelta ja jonka tuorein summa on lähellä.
 */
function cluster(rows: HistoryEntry[], threshold: number, amountTolerance: number): Cluster[] {
  // Uusimmasta vanhimpaan, jotta ryhmän ensimmäinen allekirjoitus on tuorein selite.
  const sorted = [...rows].sort((a, b) => b.bookedOn.localeCompare(a.bookedOn));
  const byCategory = new Map<string, Cluster[]>();
  for (const r of sorted) {
    const words = normalizeDescription(r.description);
    const k = `${r.activity}|${r.category}`;
    const list = byCategory.get(k) ?? [];
    byCategory.set(k, list);
    const found =
      bestCluster(list, words, threshold) ??
      (amountTolerance > 0
        ? (list.find((c) => !c.rows.some((x) => x.year === r.year) && amountClose(r.amountGross, c.rows[0].amountGross, amountTolerance)) ?? null)
        : null);
    if (found) {
      found.rows.push({ ...r, words });
      if (!found.signatures.some((s) => sigKey(s) === sigKey(words))) found.signatures.push(words);
    } else {
      list.push({ activity: r.activity, category: r.category, rows: [{ ...r, words }], signatures: [words] });
    }
  }
  return [...byCategory.values()].flat();
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

/** Päivä tänä vuonna. 29.2. ja 31. päivät siirtyvät kuukauden viimeiseen. */
export function dayInYear(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

/** Yleisin allekirjoitus (tasatilanteessa tuorein) on ryhmän tunniste. */
function mainSignature(c: Cluster): string[] {
  const counts = new Map<string, number>();
  for (const r of c.rows) counts.set(sigKey(r.words), (counts.get(sigKey(r.words)) ?? 0) + 1);
  let best = c.rows[0].words;
  let bestN = 0;
  for (const r of c.rows) {
    const n = counts.get(sigKey(r.words))!;
    if (n > bestN) {
      best = r.words;
      bestN = n;
    }
  }
  return best;
}

/** Toistuvien kirjausten ennuste vuodelle opts.year historian perusteella. */
export function findExpected(history: HistoryEntry[], opts: ExpectedOptions): ExpectedEntry[] {
  const lookback = opts.lookbackYears ?? EXPECTED_DEFAULTS.lookbackYears;
  const historyYears = Math.max(opts.historyYears ?? EXPECTED_DEFAULTS.historyYears, lookback);
  const threshold = opts.threshold ?? EXPECTED_DEFAULTS.threshold;
  const amountTolerance = opts.amountTolerance ?? EXPECTED_DEFAULTS.amountTolerance;
  const Y = opts.year;
  const rows = history.filter((r) => r.year < Y && r.year >= Y - historyYears && !isAssetPurchase(r.category) && !isAssetSale(r.category));
  // Uusi asiakas: jos aiempia vuosia on vähemmän kuin sääntö vaatii, vaatimus on kaikki olemassa olevat vuodet.
  const yearsWithRows = new Set(rows.filter((r) => r.year >= Y - lookback).map((r) => r.year));
  if (!yearsWithRows.size) return [];
  const minYears = Math.min(opts.minYears ?? EXPECTED_DEFAULTS.minYears, yearsWithRows.size);
  // Tarkasteltu jakso: edelliset vuodet asiakkaan ensimmäisestä kirjausvuodesta alkaen, enintään lookback.
  const span = Math.min(lookback, Y - Math.min(...yearsWithRows));

  const out: ExpectedEntry[] = [];
  for (const c of cluster(rows, threshold, amountTolerance)) {
    const years = [...new Set(c.rows.map((r) => r.year))].sort((a, b) => b - a);
    const recent = years.filter((y) => y >= Y - lookback);
    if (recent.length < minYears) continue;
    const perYearCounts = recent.map((y) => c.rows.filter((r) => r.year === y).length);
    const perYear = Math.max(1, Math.round(median(perYearCounts)));
    // Kuukaudet ja päivät tuoreimmasta vuodesta, jona kertoja oli tyypillinen määrä.
    const refYear = recent.find((y, i) => perYearCounts[i] === perYear) ?? recent[0];
    const refRows = c.rows.filter((r) => r.year === refYear).sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
    const picked = pickEven(refRows, perYear);
    const instances = picked.map((r, index) => {
      const month = Number(r.bookedOn.slice(5, 7));
      return { index, month, date: dayInYear(Y, month, Number(r.bookedOn.slice(8, 10))) };
    });
    const latestYear = recent[0];
    const latestRows = c.rows.filter((r) => r.year === latestYear);
    const latest = latestRows[0]; // rivit ovat uusimmasta vanhimpaan
    const amounts = c.rows.filter((r) => r.year >= Y - lookback).map((r) => r.amountGross);
    // Jos edellinen kirjaus käytti silloista oletuskantaa, käytetään tämän päivän oletusta (esim. 24 → 25,5 %).
    const followsDefault = latest.vatRate === defaultVatRate(c.category, latest.bookedOn, { vatRegistered: opts.vatRegistered });
    const vatRate = followsDefault ? defaultVatRate(c.category, instances[0]?.date ?? `${Y}-01-01`, { vatRegistered: opts.vatRegistered }) : latest.vatRate;
    out.push({
      key: expectedKey(c.activity, c.category, mainSignature(c)),
      activity: c.activity,
      category: c.category,
      kind: latest.kind,
      description: latest.description.replace(new RegExp(`\\b${latest.year}\\b`, "g"), String(Y)),
      yearsSeen: years,
      recentYears: recent.length,
      lookbackYears: span,
      confidence: yearsWithRows.size < 2 ? "low" : recent.length >= lookback ? "high" : "medium",
      perYear,
      instances,
      estimate: round2(median(latestRows.map((r) => r.amountGross))),
      min: Math.min(...amounts),
      max: Math.max(...amounts),
      vatRate,
      businessSharePct: latest.businessSharePct,
      otherSharePct: latest.otherSharePct,
      farmId: latest.farmId,
      forestPropertyId: latest.forestPropertyId,
      signatures: c.signatures,
    });
  }
  // Vuoden järjestyksessä: ensimmäinen kerta ensin.
  return out.sort((a, b) => (a.instances[0]?.date ?? "").localeCompare(b.instances[0]?.date ?? "") || a.category.localeCompare(b.category));
}

/** n riviä tasaisesti järjestetyistä riveistä (jos vuonna oli enemmän kertoja kuin tyypillisesti). */
function pickEven<T>(rows: T[], n: number): T[] {
  if (rows.length <= n) return rows;
  return Array.from({ length: n }, (_, i) => rows[Math.floor((i * rows.length) / n)]);
}

// ---------------------------------------------------------------------------
// Tämän vuoden tila
// ---------------------------------------------------------------------------

export type InstanceStatus = "booked" | "late" | "upcoming" | "skipped";

export interface CurrentEntry {
  id: string;
  bookedOn: string;
  category: string;
  activity: Activity;
  description: string;
  amountGross: number;
}

export interface InstanceState extends ExpectedInstance {
  status: InstanceStatus;
  /** Kirjattu: vastaava kirjaus ja sen summa. */
  transactionId: string | null;
  amount: number | null;
}

export interface ExpectedState extends ExpectedEntry {
  skipped: boolean;
  states: InstanceState[];
  booked: number;
  late: number;
  upcoming: number;
  /** Ensimmäinen kirjaamaton kerta esitäyttöä varten. */
  next: InstanceState | null;
}

/** Summat ovat lähellä toisiaan: sama etumerkki ja ero enintään tol (0,2 = 20 %) suuremmasta. */
export function amountClose(a: number, b: number, tol: number): boolean {
  if (!a || !b || Math.sign(a) !== Math.sign(b)) return false;
  const [lo, hi] = [Math.min(Math.abs(a), Math.abs(b)), Math.max(Math.abs(a), Math.abs(b))];
  return lo >= hi * (1 - tol);
}

/**
 * Tämän vuoden kirjaukset ryhmiin: ryhmän tunniste → kirjaukset päivän mukaan.
 * Ensin selitteen mukaan. Sitten varasääntö: selitteet vaihtuvat vuosittain
 * (vastapuolen nimi, laskun teksti), joten saman luokan kirjaamaton kirjaus käy
 * ryhmälle, jolta puuttuu vielä kertoja ja jonka arvio on lähellä summaa (±20 %).
 * Sopimaton kirjaus jää pois.
 */
export function matchToEntries<T extends Omit<CurrentEntry, "id">>(
  entries: ExpectedEntry[],
  current: T[],
  threshold: number = EXPECTED_DEFAULTS.threshold,
  amountTolerance: number = EXPECTED_DEFAULTS.amountTolerance,
): Map<string, T[]> {
  const assigned = new Map<string, T[]>();
  const add = (key: string, t: T) => assigned.set(key, [...(assigned.get(key) ?? []), t]);
  const rest: T[] = [];
  for (const t of [...current].sort((a, b) => a.bookedOn.localeCompare(b.bookedOn))) {
    const words = normalizeDescription(t.description);
    let best: ExpectedEntry | null = null;
    let bestSim = -1;
    for (const e of entries) {
      if (e.activity !== t.activity || e.category !== t.category) continue;
      const sim = Math.max(...e.signatures.map((s) => similarity(words, s)));
      if (sim >= threshold && sim > bestSim) {
        best = e;
        bestSim = sim;
      }
    }
    if (best) add(best.key, t);
    else rest.push(t);
  }
  if (amountTolerance > 0) {
    for (const t of rest) {
      let best: ExpectedEntry | null = null;
      let bestDiff = Infinity;
      for (const e of entries) {
        if (e.activity !== t.activity || e.category !== t.category) continue;
        if ((assigned.get(e.key)?.length ?? 0) >= e.perYear || !amountClose(t.amountGross, e.estimate, amountTolerance)) continue;
        const diff = Math.abs(Math.abs(t.amountGross) - Math.abs(e.estimate));
        if (diff < bestDiff) {
          best = e;
          bestDiff = diff;
        }
      }
      if (best) add(best.key, t);
    }
    for (const list of assigned.values()) list.sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
  }
  return assigned;
}

/**
 * Tämän vuoden kirjaukset odotettuihin. Kirjaus kuuluu ryhmään samalla säännöllä
 * kuin historiassa (toiminto, luokka, selitteen samankaltaisuus), ja jos se sopii
 * useaan, parhaiten sopivaan. Ryhmän sisällä kirjaus merkitsee lähimmän kuukauden
 * kerran kirjatuksi. Kirjaamaton kerta on myöhässä, kun sen kuukausi on ohi.
 */
export function expectedStatus(
  entries: ExpectedEntry[],
  current: CurrentEntry[],
  opts: { year: number; today: string; skipped?: Iterable<string>; threshold?: number; amountTolerance?: number },
): ExpectedState[] {
  const skipped = new Set(opts.skipped ?? []);
  const assigned = matchToEntries(entries, current, opts.threshold, opts.amountTolerance);
  const todayYear = Number(opts.today.slice(0, 4));
  const todayMonth = Number(opts.today.slice(5, 7));
  const past = (month: number) => opts.year < todayYear || (opts.year === todayYear && month < todayMonth);

  return entries.map((e) => {
    const isSkipped = skipped.has(e.key);
    const rows = assigned.get(e.key) ?? [];
    const match = new Map<number, CurrentEntry>();
    // Kirjaus lähimpään vapaaseen kertaan kuukauden mukaan; ylimääräiset kirjaukset eivät muuta tilaa.
    for (const t of rows) {
      const m = Number(t.bookedOn.slice(5, 7));
      let bestI = -1;
      for (const inst of e.instances) {
        if (match.has(inst.index)) continue;
        if (bestI < 0 || Math.abs(inst.month - m) < Math.abs(e.instances[bestI].month - m)) bestI = inst.index;
      }
      if (bestI >= 0) match.set(bestI, t);
    }
    const states: InstanceState[] = e.instances.map((inst) => {
      const t = match.get(inst.index);
      const status: InstanceStatus = t ? "booked" : isSkipped ? "skipped" : past(inst.month) ? "late" : "upcoming";
      return { ...inst, status, transactionId: t?.id ?? null, amount: t ? t.amountGross : null };
    });
    const count = (s: InstanceStatus) => states.filter((x) => x.status === s).length;
    return {
      ...e,
      skipped: isSkipped,
      states,
      booked: count("booked"),
      late: count("late"),
      upcoming: count("upcoming"),
      next: states.find((s) => s.status === "late" || s.status === "upcoming") ?? null,
    };
  });
}

export interface ExpectedSummary {
  expected: number;
  booked: number;
  late: number;
  upcoming: number;
  skipped: number;
}

/** Yhteenveto kerroista: "12 odotettua, 7 kirjattu, 2 puuttuu". */
export function summarizeExpected(states: ExpectedState[]): ExpectedSummary {
  const all = states.flatMap((s) => s.states);
  const n = (st: InstanceStatus) => all.filter((x) => x.status === st).length;
  return { expected: all.length, booked: n("booked"), late: n("late"), upcoming: n("upcoming"), skipped: n("skipped") };
}
