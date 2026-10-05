import {
  allowsOtherShare,
  category,
  categoryActivity,
  generalVatRate,
  isAssetPurchase,
  isAssetSale,
  lowestVatRate,
  reducedVatRate,
  type Activity,
  type TransactionKind,
} from "@/lib/tax/rules";

/**
 * Tiliöintimuisti (DECISIONS 6.10.2026): asiakkaan aiemmista kirjauksista
 * ehdotus uuden kirjauksen tiliöinniksi. Ei ennusta, mitä kirjauksia pitäisi
 * tulla, vaan kertoo, miten samanlainen selite on ennen tiliöity.
 *
 * Puhtaat funktiot, ei kantaa: syöte on asiakkaan historia yhdellä kyselyllä
 * (posting-memory-load.ts), ja muisti rakennetaan pyynnön ajaksi. Uutta taulua
 * ei ole, koska muisti lasketaan aina kirjauksista: muutettu tai poistettu
 * kirjaus näkyy ehdotuksissa heti.
 *
 * Avain on selitteen avainsanat (numerot, päivät, viitteet, vuodet, kuukaudet ja
 * yhtiömuodot pois) ja mahdollinen Y-tunnus. Arvo on tiliöinti: luokka, tyyppi,
 * alv-%, osuudet ja maatila. Painotus suosii tuoreita ja toistuvia tiliöintejä.
 *
 * Ehdotus on aina ehdotus: mikään tässä ei tallenna eikä täytä kenttiä. Käyttäjä
 * valitsee ehdotuksen, ja tallennus kulkee tavallista polkua.
 */

// ---------------------------------------------------------------------------
// Selitteen normalisointi (siirretty odotetuista kirjauksista, DECISIONS 5.10.2026)
// ---------------------------------------------------------------------------

const MONTH = /^(tammi|helmi|maalis|huhti|touko|kesä|heinä|elo|syys|loka|marras|joulu)(k|kuu\p{L}*)?$/u;
const MONTH_ABBR = /^(tam|hel|maa|huh|tou|kes|hei|elo|syy|lok|mar|jou)$/;
// Yhtiömuodot ja sidesanat eivät erota kirjauksia toisistaan.
const STOP = new Set([
  "oy", "oyj", "ab", "ky", "tmi", "ry", "osk", "ay", "ltd", "gmbh", "inc", "ja", "sekä", "tai", "kk", "vko", "nro", "no", "ref", "viite", "lasku", "pvm",
  "jakso", "ajalta", "ajalle", "vuosi", "vuodelta", "vuodelle", "alv", "sis", "eur", "euroa",
]);

/**
 * Selite sanoiksi: pienet kirjaimet, numeroita sisältävät sanat (päivät, viitteet,
 * vuodet, laskunumerot, Y-tunnus) ja kuukausien nimet pois, välimerkit pois.
 * Järjestetty ja yksilöity, jotta sama selite antaa saman allekirjoituksen.
 */
export function normalizeDescription(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[\s/,;:()[\]{}"'+*=|\\_–—.-]+/u)
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

/** Sanajoukkojen samankaltaisuus 0–1 (Jaccard, sanan alku riittää). Tyhjä ei vastaa mitään. */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let matched = 0;
  for (const w of a) if (b.some((x) => wordsMatch(w, x))) matched++;
  return matched / (a.length + b.length - matched);
}

/** Y-tunnus tekstistä (1234567-8). Tarkistemerkkiä ei laskettu: tunnus on vain avain. */
export function businessIdOf(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t ? /(?:^|\D)(\d{7}-\d)(?!\d)/.exec(t) : null;
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arvonlisäverokanta nykyiseen
// ---------------------------------------------------------------------------

/**
 * Vanha kanta tämän päivän kannaksi: jos kirjauksen kanta oli silloin yleinen,
 * alennettu tai alin kanta, ehdotus käyttää saman kannan nykyistä arvoa
 * (24 → 25,5 %, 14 → 13,5 %). Muu kanta (esim. 0 %) säilyy.
 */
export function currentVatRate(rate: number, fromDate: string, toDate: string): number {
  if (!rate) return 0;
  for (const fn of [generalVatRate, reducedVatRate, lowestVatRate]) if (fn(fromDate) === rate) return fn(toDate);
  return rate;
}

// ---------------------------------------------------------------------------
// Muisti
// ---------------------------------------------------------------------------

export interface PostingEntry {
  /** vvvv-kk-pp */
  bookedOn: string;
  category: string;
  kind: TransactionKind;
  description: string;
  reference?: string | null;
  amountGross: number;
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
  /** Toimiston muisti: asiakas, jotta perusteessa voi kertoa asiakkaiden määrän. */
  clientId?: string;
}

export interface Posting {
  category: string;
  kind: TransactionKind;
  activity: Activity;
  /** Nykyinen kanta (päivitetty, jos vanha kanta on muuttunut). */
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
}

export type PostingSource = "client" | "office";

export interface PostingSuggestion extends Posting {
  /** Tiliöinnin tunniste vaihtoehtojen erottamiseen. */
  key: string;
  source: PostingSource;
  /** Vahva ehdotus: tositteen tunnistuksessa ohittaa tekoälyn luokan. Ei koskaan tallennu ilman käyttäjää. */
  strong: boolean;
  /** 0–1: vastaavien kirjausten painosta tämän tiliöinnin osuus kerrottuna selitteen samankaltaisuudella. */
  confidence: number;
  /** Vastaavien kirjausten painosta tämän tiliöinnin osuus (0–1). */
  agreement: number;
  /** Paras selitteen samankaltaisuus (1 = sama selite tai Y-tunnus). */
  similarity: number;
  /** Montako vastaavaa kirjausta tiliöitiin näin. */
  count: number;
  firstYear: number;
  lastYear: number;
  /** Tuorein vastaava kirjaus (vvvv-kk-pp). */
  lastDate: string;
  /** Tuoreimman kirjauksen selite vuosiluku päivitettynä. Vain asiakkaan omasta historiasta. */
  description: string | null;
  /** Alv-% muuttui nykyiseen kantaan. */
  vatChange: { from: number; to: number } | null;
  /** Montako eri asiakasta (toimiston muisti). */
  clients: number;
  /** Peruste suomeksi, esim. "Tiliöity kuten 4/2024: ...". */
  basis: string;
}

export interface PostingLookup {
  best: PostingSuggestion | null;
  /** Enintään kaksi muuta tiliöintiä samalle selitteelle. */
  alternatives: PostingSuggestion[];
}

export const EMPTY_LOOKUP: PostingLookup = { best: null, alternatives: [] };

interface Signature {
  words: string[];
  entries: (PostingEntry & { year: number; businessId: string | null })[];
}

export interface PostingMemory {
  source: PostingSource;
  signatures: Signature[];
  /** Sanan alku (4 merkkiä) → allekirjoitukset: haku ei käy koko historiaa läpi. */
  index: Map<string, Set<number>>;
  byBusinessId: Map<string, Set<number>>;
  size: number;
}

/**
 * Säädettävät rajat. Oletukset on valittu takautuvalla kokeella
 * (`npm run tiliointi:koe`, DECISIONS 6.10.2026): vahva ehdotus osui oikeaan
 * vähintään 90 %:ssa.
 */
export interface PostingOptions {
  /** Selitteiden samankaltaisuuden alaraja, jotta kirjaus on vastaava. */
  minSimilarity: number;
  /** Puoliintumisaika vuosina: vanha kirjaus painaa vähemmän. */
  halfLifeYears: number;
  /** Summan läheisyys (0,2 = ±20 %) nostaa saman summan tiliöinnin painoa. */
  amountTolerance: number;
  amountBoost: number;
  /** Vahva: tiliöinnin osuus painosta vähintään tämä, */
  strongAgreement: number;
  /** paras samankaltaisuus vähintään tämä, */
  strongSimilarity: number;
  /** ja kirjauksia vähintään tämän verran. */
  strongCount: number;
  /** Vahva vain, jos tuorein vastaava kirjaus on enintään näin monta vuotta vanha. */
  strongMaxAgeYears: number;
}

export const POSTING_DEFAULTS: PostingOptions = {
  minSimilarity: 0.5,
  halfLifeYears: 3,
  amountTolerance: 0.2,
  amountBoost: 1.5,
  strongAgreement: 0.7,
  strongSimilarity: 0.5,
  strongCount: 1,
  strongMaxAgeYears: 4,
};

const prefix = (w: string) => w.slice(0, 4);

/** Muisti kirjauksista. Investoinnin hankinta ja myynti eivät ole toistuvia tiliöintejä (kohde ja laji vaihtuvat). */
export function buildPostingMemory(entries: PostingEntry[], source: PostingSource = "client"): PostingMemory {
  const byKey = new Map<string, Signature>();
  for (const e of entries) {
    if (isAssetPurchase(e.category) || isAssetSale(e.category) || !category(e.category)) continue;
    const words = normalizeDescription(e.description ?? "");
    const businessId = businessIdOf(e.description, e.reference);
    if (!words.length && !businessId) continue;
    const k = `${words.join(" ")}|${businessId ?? ""}`;
    let s = byKey.get(k);
    if (!s) byKey.set(k, (s = { words, entries: [] }));
    s.entries.push({ ...e, year: Number(e.bookedOn.slice(0, 4)), businessId });
  }
  const signatures = [...byKey.values()];
  const index = new Map<string, Set<number>>();
  const byBusinessId = new Map<string, Set<number>>();
  signatures.forEach((s, i) => {
    for (const w of s.words) {
      const p = prefix(w);
      if (!index.has(p)) index.set(p, new Set());
      index.get(p)!.add(i);
    }
    for (const e of s.entries) {
      if (!e.businessId) continue;
      if (!byBusinessId.has(e.businessId)) byBusinessId.set(e.businessId, new Set());
      byBusinessId.get(e.businessId)!.add(i);
    }
  });
  return { source, signatures, index, byBusinessId, size: entries.length };
}

export interface PostingQuery {
  description: string;
  /** Summa arvonlisäveron kanssa; valinnainen. */
  amountGross?: number | null;
  /** Y-tunnus, jos tositteessa tai selitteessä on. */
  businessId?: string | null;
  /** Kirjauksen päivä: alv-kanta päivitetään tähän ja tuoreus lasketaan tästä. */
  date: string;
  /** Vain näiden toimintojen luokat (kirjanpidon näkymä). */
  activities?: Activity[];
}

const MAX_ALTERNATIVES = 2;

function amountClose(a: number, b: number, tol: number): boolean {
  if (!a || !b || Math.sign(a) !== Math.sign(b)) return false;
  const [lo, hi] = [Math.min(Math.abs(a), Math.abs(b)), Math.max(Math.abs(a), Math.abs(b))];
  return lo >= hi * (1 - tol);
}

interface Group {
  posting: Posting;
  key: string;
  weight: number;
  maxSim: number;
  count: number;
  years: Set<number>;
  clients: Set<string>;
  last: Signature["entries"][number];
  vatFrom: number | null;
}

/**
 * Paras tiliöinti ja enintään kaksi vaihtoehtoa annetulle selitteelle.
 * Vastaavat kirjaukset: samankaltaisuus vähintään minSimilarity tai sama Y-tunnus.
 * Kirjauksen paino = samankaltaisuus² × tuoreus (puoliintuu halfLifeYears-välein)
 * × summan läheisyys. Tiliöinnit ryhmitellään, ja suurin paino voittaa.
 */
export function suggestPosting(memory: PostingMemory, query: PostingQuery, opts: Partial<PostingOptions> = {}): PostingLookup {
  const o = { ...POSTING_DEFAULTS, ...opts };
  const words = normalizeDescription(query.description ?? "");
  const businessId = query.businessId ?? businessIdOf(query.description);
  if (!words.length && !businessId) return EMPTY_LOOKUP;
  const candidates = new Set<number>();
  for (const w of words) for (const i of memory.index.get(prefix(w)) ?? []) candidates.add(i);
  if (businessId) for (const i of memory.byBusinessId.get(businessId) ?? []) candidates.add(i);
  if (!candidates.size) return EMPTY_LOOKUP;

  const year = Number(query.date.slice(0, 4));
  const groups = new Map<string, Group>();
  for (const i of candidates) {
    const s = memory.signatures[i];
    const wordSim = similarity(words, s.words);
    for (const e of s.entries) {
      const sim = businessId && e.businessId === businessId ? 1 : wordSim;
      if (sim < o.minSimilarity) continue;
      const activity = categoryActivity(e.category);
      if (query.activities && !query.activities.includes(activity)) continue;
      const vat = currentVatRate(e.vatRate, e.bookedOn, query.date);
      const other = allowsOtherShare(e.category) ? e.otherSharePct : 0;
      // Toimiston muilta asiakkailta vain luokka, tyyppi ja alv: osuudet ja maatila ovat asiakkaan omia.
      const office = memory.source === "office";
      const posting: Posting = {
        category: e.category, kind: e.kind, activity, vatRate: vat,
        businessSharePct: office ? 100 : e.businessSharePct, otherSharePct: office ? 0 : other, farmId: office ? null : e.farmId,
      };
      const key = [posting.category, posting.kind, posting.vatRate, posting.businessSharePct, posting.otherSharePct, posting.farmId ?? ""].join("|");
      const age = Math.max(0, year - e.year);
      const amount = query.amountGross && amountClose(query.amountGross, e.amountGross, o.amountTolerance) ? o.amountBoost : 1;
      const w = sim * sim * Math.pow(0.5, age / o.halfLifeYears) * amount;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { posting, key, weight: 0, maxSim: 0, count: 0, years: new Set(), clients: new Set(), last: e, vatFrom: null }));
      g.weight += w;
      g.maxSim = Math.max(g.maxSim, sim);
      g.count++;
      g.years.add(e.year);
      if (e.clientId) g.clients.add(e.clientId);
      if (e.bookedOn > g.last.bookedOn) g.last = e;
    }
  }
  if (!groups.size) return EMPTY_LOOKUP;
  const total = [...groups.values()].reduce((a, g) => a + g.weight, 0);
  const sorted = [...groups.values()].sort((a, b) => b.weight - a.weight || b.last.bookedOn.localeCompare(a.last.bookedOn));
  const out = sorted.slice(0, 1 + MAX_ALTERNATIVES).map((g, i) => {
    const agreement = g.weight / total;
    const vatChange = g.last.vatRate !== g.posting.vatRate ? { from: g.last.vatRate, to: g.posting.vatRate } : null;
    const strong =
      i === 0 &&
      memory.source === "client" &&
      agreement >= o.strongAgreement &&
      g.maxSim >= o.strongSimilarity &&
      g.count >= o.strongCount &&
      year - g.last.year <= o.strongMaxAgeYears;
    const s: PostingSuggestion = {
      ...g.posting,
      key: g.key,
      source: memory.source,
      strong,
      confidence: Math.round(agreement * g.maxSim * 100) / 100,
      agreement,
      similarity: g.maxSim,
      count: g.count,
      firstYear: Math.min(...g.years),
      lastYear: Math.max(...g.years),
      lastDate: g.last.bookedOn,
      description: memory.source === "client" ? g.last.description.replace(new RegExp(`\\b${g.last.year}\\b`, "g"), String(year)) : null,
      vatChange,
      clients: g.clients.size,
      basis: "",
    };
    s.basis = postingBasis(s);
    return s;
  });
  return { best: out[0] ?? null, alternatives: out.slice(1) };
}

/**
 * Asiakkaan oma muisti ensin. Jos sieltä ei löydy mitään, toimiston (saman
 * organisaation) muiden asiakkaiden tiliöinnit varalla. Toisen organisaation
 * dataa muistiin ei koskaan tule: lataus rajaa organisaatioon ja RLS valvoo.
 */
export function suggestWithFallback(client: PostingMemory, office: PostingMemory | null, query: PostingQuery, opts: Partial<PostingOptions> = {}): PostingLookup {
  const own = suggestPosting(client, query, opts);
  if (own.best || !office) return own;
  return suggestPosting(office, query, opts);
}

// ---------------------------------------------------------------------------
// Näyttö
// ---------------------------------------------------------------------------

const pct = (n: number) => `${n.toLocaleString("fi-FI", { maximumFractionDigits: 2 })} %`;

/** Tiliöinti lyhyesti: "9 Muut vuosimenot, alv 25,5 %, osuus 50 %". */
export function postingLabel(p: Pick<Posting, "category" | "vatRate" | "businessSharePct" | "otherSharePct">): string {
  const c = category(p.category);
  const parts = [c ? `${c.no} ${c.label}` : p.category, `alv ${pct(p.vatRate)}`];
  if (p.businessSharePct !== 100) parts.push(`osuus ${pct(p.businessSharePct)}`);
  if (p.otherSharePct) parts.push(`toisen toiminnon osuus ${pct(p.otherSharePct)}`);
  return parts.join(", ");
}

const yearsText = (a: number, b: number) => (a === b ? `vuonna ${a}` : `vuosina ${a}–${b}`);
const timesText = (n: number) => (n === 1 ? "kerran" : `${n} kertaa`);

/** Peruste: mistä ehdotus tulee. Toimiston muilta asiakkailta ei kerrota selitteitä eikä summia. */
export function postingBasis(s: PostingSuggestion): string {
  const label = postingLabel(s);
  const vat = s.vatChange ? ` Alv päivitetty nykyiseen kantaan: ${pct(s.vatChange.from)} → ${pct(s.vatChange.to)}.` : "";
  if (s.source === "office") {
    const clients = s.clients > 1 ? `, ${s.clients} asiakasta` : "";
    return `Toimiston muilta asiakkailta: ${label}; ${timesText(s.count)} ${yearsText(s.firstYear, s.lastYear)}${clients}. Tarkista osuus.${vat}`;
  }
  const [y, m] = s.lastDate.split("-").map(Number);
  return `Tiliöity kuten ${m}/${y}: ${label}; ${timesText(s.count)} ${yearsText(s.firstYear, s.lastYear)}.${vat}`;
}

// ---------------------------------------------------------------------------
// Tekoälyn vihje
// ---------------------------------------------------------------------------

/**
 * Asiakkaan tavallisimmat tiliöinnit tekoälyn vihjeeksi (DECISIONS 6.10.2026):
 * enintään n selitettä avainsanoina (ei numeroita, viitteitä eikä summia),
 * vähintään kaksi kertaa käytetty, tuoreus painottaen. Muoto on tiivis:
 * "tiemaksu → other_expense, alv 0, osuus 50".
 */
export function postingHints(memory: PostingMemory, date: string, n = 30, activities?: Activity[]): string[] {
  const year = Number(date.slice(0, 4));
  const rows: { line: string; weight: number }[] = [];
  for (const s of memory.signatures) {
    if (!s.words.length || s.entries.length < 2) continue;
    const res = suggestPosting(memory, { description: s.words.join(" "), date, activities }, { minSimilarity: 1 });
    const b = res.best;
    if (!b || b.count < 2) continue;
    const weight = s.entries.reduce((a, e) => a + Math.pow(0.5, Math.max(0, year - e.year) / POSTING_DEFAULTS.halfLifeYears), 0);
    const parts = [`${b.category}`, `alv ${b.vatRate}`];
    if (b.businessSharePct !== 100) parts.push(`osuus ${b.businessSharePct}`);
    if (b.otherSharePct) parts.push(`toinen ${b.otherSharePct}`);
    rows.push({ line: `${s.words.join(" ").slice(0, 60)} → ${parts.join(", ")}`, weight });
  }
  const seen = new Set<string>();
  return rows
    .sort((a, b) => b.weight - a.weight)
    .filter((r) => (seen.has(r.line) ? false : (seen.add(r.line), true)))
    .slice(0, n)
    .map((r) => r.line);
}
