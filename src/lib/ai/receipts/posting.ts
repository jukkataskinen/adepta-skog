import { allowsOtherShare, category, categoryActivity, isAssetPurchase, isAssetSale, TIMBER_SALE_CODES, type TransactionKind } from "@/lib/tax/rules";
import { postingLabel, type PostingLookup, type PostingSuggestion } from "@/lib/ledger/posting-memory";
import { waitsByDefault } from "./agri";
import type { SuggestionLine } from "./schema";

/**
 * Tunnistuksen rivi ja tiliöintimuisti yhteen (DECISIONS 6.10.2026).
 *
 * Vahva muistin osuma ohittaa tekoälyn luokan: luokka, tyyppi, osuudet ja
 * maatila tulevat asiakkaan aiemmista kirjauksista, ja tekoälyn arvaus jää
 * vaihtoehdoksi. Heikko osuma ei muuta mitään, vaan näkyy vaihtoehtona.
 * Alv-% tulee aina tositteelta, koska tositteen kanta on ensisijainen lähde;
 * jos aiempi kanta oli toinen, rivi kertoo sen.
 *
 * Kaikki tämä on ehdotusta. Rivi tallentuu kirjaukseksi vasta, kun
 * kirjanpitäjä tallentaa taulukon (hyväksyntä ennallaan).
 */

export type PostingChoiceSource = "memory" | "office" | "ai";

/** Valittavissa oleva tiliöinti ehdotusrivillä. */
export interface PostingChoice {
  source: PostingChoiceSource;
  category: string;
  kind: TransactionKind;
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
  /** "9 Muut vuosimenot, alv 25,5 %" */
  label: string;
  /** Mistä ehdotus tulee. */
  basis: string;
}

export interface LinePosting {
  category: string;
  kind: TransactionKind;
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
  /** Kumpi tiliöinti on rivillä: muistin vai tekoälyn. */
  applied: "memory" | "ai";
  /** Muistin peruste, kun muisti ohitti tekoälyn. */
  basis: string | null;
  /** Huomautus, esimerkiksi alv-kanta poikkeaa aiemmasta. */
  note: string | null;
  /** Muut tiliöinnit, enintään kolme: tekoälyn arvaus tai muistin vaihtoehdot. */
  options: PostingChoice[];
}

const pct = (n: number) => `${n.toLocaleString("fi-FI", { maximumFractionDigits: 2 })} %`;

export function choiceFromSuggestion(s: PostingSuggestion): PostingChoice {
  return {
    source: s.source === "office" ? "office" : "memory",
    category: s.category,
    kind: s.kind,
    vatRate: s.vatRate,
    businessSharePct: s.businessSharePct,
    otherSharePct: s.otherSharePct,
    farmId: s.farmId,
    label: postingLabel(s),
    basis: s.basis,
  };
}

/**
 * Rivit, joita muisti ei ohita: investoinnit (laji ja kohde), puukauppa
 * ennakonpidätyksineen, tukirivit (luokka tulee tukilajista) ja oletuksena
 * odottamaan jäävät rivit (investointituki, lainan lyhennys).
 */
function keepsAiPosting(l: SuggestionLine): boolean {
  return (
    isAssetPurchase(l.category) ||
    isAssetSale(l.category) ||
    (TIMBER_SALE_CODES.includes(l.category) && l.withholding > 0) ||
    Boolean(l.subsidyType) ||
    waitsByDefault({ documentType: l.documentType, description: l.description, subsidyType: l.subsidyType ?? null })
  );
}

const sameChoice = (a: Pick<PostingChoice, "category" | "kind" | "businessSharePct" | "otherSharePct" | "farmId">, b: typeof a) =>
  a.category === b.category && a.kind === b.kind && a.businessSharePct === b.businessSharePct && a.otherSharePct === b.otherSharePct && (a.farmId ?? null) === (b.farmId ?? null);

export function mergeLinePosting(l: SuggestionLine, lookup: PostingLookup | null, opts: { vatRegistered: boolean }): LinePosting {
  const cat = category(l.category);
  const docVat = opts.vatRegistered ? l.vatRate : 0;
  const ai: PostingChoice = {
    source: "ai",
    category: l.category,
    kind: cat?.kind ?? "expense",
    vatRate: docVat,
    businessSharePct: 100,
    otherSharePct: 0,
    farmId: null,
    label: postingLabel({ category: l.category, vatRate: docVat, businessSharePct: 100, otherSharePct: 0 }),
    basis: "Tekoälyn arvio tositteesta.",
  };
  const found = [lookup?.best, ...(lookup?.alternatives ?? [])].filter((s): s is PostingSuggestion => Boolean(s));
  const best = lookup?.best ?? null;
  const overrides = Boolean(best && best.strong && !keepsAiPosting(l) && best.activity === categoryActivity(l.category));
  if (best && overrides) {
    const other = allowsOtherShare(best.category) ? best.otherSharePct : 0;
    const applied = { category: best.category, kind: best.kind, businessSharePct: best.businessSharePct, otherSharePct: other, farmId: best.farmId };
    const note = opts.vatRegistered && best.vatRate !== docVat ? `Aiemmin alv ${pct(best.vatRate)}, tositteella ${pct(docVat)}. Rivillä on tositteen kanta: tarkista.` : null;
    const options = [ai, ...found.slice(1).map(choiceFromSuggestion)].filter((c) => !sameChoice(c, applied)).slice(0, 3);
    return { ...applied, vatRate: docVat, applied: "memory", basis: best.basis, note, options };
  }
  const choices = found.map(choiceFromSuggestion);
  // Muisti vahvistaa tekoälyn arvauksen: peruste näkyy, vaikka tiliöinti ei muutu.
  const confirming = choices.find((c) => sameChoice(c, ai));
  const options = choices.filter((c) => !sameChoice(c, ai)).slice(0, 3);
  return {
    category: ai.category, kind: ai.kind, vatRate: docVat, businessSharePct: 100, otherSharePct: 0, farmId: null, applied: "ai",
    basis: confirming ? `Sama kuin aiemmin. ${confirming.basis}` : null, note: null, options,
  };
}
