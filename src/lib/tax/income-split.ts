import { round2 } from "./amounts";
import {
  AGRI_ENTREPRENEUR_DEDUCTION_PCT,
  capitalSharePct,
  EQUALIZATION_RESERVE,
  municipalTaxAvgPct,
  stateIncomeTaxScale,
  WAGES_NET_WEALTH_PCT,
  type IncomeSplitClaim,
} from "./rules";

/**
 * Maatalouden yritystulon jako pääoma- ja ansiotuloon, tasausvarauksen
 * enimmäismäärä ja ansiotulon veron arvio. Puhtaita funktioita: syöte sisään,
 * tulos ulos (CLAUDE.md). Lähteet (tarkistettu 2.10.2026):
 * Verohallinto, Tuloverotus – maataloudenharjoittaja; Maatalouden
 * nettovarallisuus; Maataloudenharjoittajan tappiot; Yrittäjävähennys
 * maataloudessa; Maatalouden tasausvaraus ja jälleenhankintavaraus. TVL 30 a §,
 * 38 § ja 41 §.
 *
 * Järjestys Verohallinnon ohjeen mukaan:
 *   1. tuloksesta vähennetään aiempien vuosien vahvistetut tappiot → jaettava yritystulo
 *   2. jaettavasta yritystulosta 5 % yrittäjävähennys
 *   3. loppu jaetaan: pääomatuloa enintään 20 % (10 %, 0 %) edellisen vuoden
 *      nettovarallisuudesta, johon on lisätty 30 % palkoista; loppu ansiotuloa
 *   4. puolisoille: pääomatulo nettovarallisuusosuuksien ja ansiotulo
 *      työpanososuuksien suhteessa
 */

export interface IncomeSplitInput {
  /** Maatalouden tulos (+) tai tappio (−) lomakkeelta 2 (362/363). */
  result: number;
  /** Aiempien vuosien vahvistetut maatalouden tappiot, joita ei ole vielä vähennetty. */
  confirmedLosses: number;
  /** Edellisen vuoden lopun nettovarallisuus (735 tai −736). null = ei tiedossa. */
  priorNetWealth: number | null;
  /** Edellisen vuoden ennakonpidätyksen alaiset palkat (437), joista 30 % lisätään varallisuuteen. */
  priorWages: number;
  claim: IncomeSplitClaim;
  /** Puolison osuudet (414 ja 416). null = ei yrittäjäpuolisoa. */
  spouseWealthSharePct: number | null;
  spouseWorkSharePct: number | null;
  /** Vaatimus vähentää vuoden tappio pääomatuloista (420). */
  lossToCapitalIncome: boolean;
}

export interface PersonShare {
  capital: number;
  earned: number;
}

export interface IncomeSplitResult {
  /** Tuloksesta vähennetyt aiempien vuosien tappiot. */
  lossesUsed: number;
  /** Jäljelle jäävät vahvistetut tappiot seuraaville vuosille (ilman tämän vuoden tappiota). */
  lossesLeft: number;
  /** Jaettava yritystulo: tulos − vahvistetut tappiot, vähintään 0. */
  distributable: number;
  entrepreneurDeduction: number;
  /** Jaettava määrä yrittäjävähennyksen jälkeen. */
  splitBase: number;
  /** Pääomatulo-osuuden pohja: nettovarallisuus + 30 % palkoista, negatiivinen → 0. */
  wealthBase: number;
  capitalPct: number;
  /** Pääomatulo-osuuden laskennallinen enimmäismäärä (prosentti × pohja). */
  capitalMax: number;
  capital: number;
  earned: number;
  /** Asiakkaan (yrittäjän) ja puolison osuudet. Puoliso null, jos puolisoa ei ole. */
  owner: PersonShare;
  spouse: PersonShare | null;
  /** Vuoden tappio (positiivisena), jos tulos on tappiollinen. */
  loss: number;
  /** Tappio, joka vähennetään tämän vuoden pääomatuloista (vaatimus 420). Puolisoilla yrittäjän osuus. */
  lossToCapital: number;
  /** Tappio, joka vahvistetaan maatalouden tappioksi seuraaville vuosille. */
  lossConfirmed: number;
  /** Nettovarallisuus puuttuu: kaikki on ansiotuloa, kunnes se annetaan. */
  wealthMissing: boolean;
}

export function businessIncomeSplit(i: IncomeSplitInput): IncomeSplitResult {
  const spouseW = i.spouseWealthSharePct ?? null;
  const spouseL = i.spouseWorkSharePct ?? null;
  const hasSpouse = spouseW !== null && spouseL !== null;
  const wealthMissing = i.priorNetWealth === null;
  // Negatiivinen nettovarallisuus: tulo on kokonaan ansiotuloa (Maatalouden nettovarallisuus, vero.fi).
  const wealthBase = Math.max(0, round2((i.priorNetWealth ?? 0) + (i.priorWages * WAGES_NET_WEALTH_PCT) / 100));
  const capitalPct = capitalSharePct(i.claim);
  const capitalMax = round2((wealthBase * capitalPct) / 100);

  if (i.result <= 0) {
    const loss = round2(-i.result);
    // Tappion voi vaatia vähennettäväksi saman vuoden pääomatuloista; muuten se vahvistetaan.
    const lossToCapitalTotal = i.lossToCapitalIncome ? loss : 0;
    const ownerPart = hasSpouse ? round2((lossToCapitalTotal * (100 - spouseW!)) / 100) : lossToCapitalTotal;
    return {
      lossesUsed: 0, lossesLeft: round2(i.confirmedLosses), distributable: 0, entrepreneurDeduction: 0, splitBase: 0, wealthBase, capitalPct, capitalMax,
      capital: 0, earned: 0, owner: { capital: 0, earned: 0 }, spouse: hasSpouse ? { capital: 0, earned: 0 } : null,
      loss, lossToCapital: ownerPart, lossConfirmed: round2(loss - lossToCapitalTotal), wealthMissing,
    };
  }

  const lossesUsed = round2(Math.min(i.result, Math.max(0, i.confirmedLosses)));
  const distributable = round2(i.result - lossesUsed);
  const entrepreneurDeduction = round2((distributable * AGRI_ENTREPRENEUR_DEDUCTION_PCT) / 100);
  const splitBase = round2(distributable - entrepreneurDeduction);
  const capital = round2(Math.min(splitBase, capitalMax));
  const earned = round2(splitBase - capital);

  let owner: PersonShare = { capital, earned };
  let spouse: PersonShare | null = null;
  if (hasSpouse) {
    const sCap = round2((capital * spouseW!) / 100);
    const sEarn = round2((earned * spouseL!) / 100);
    spouse = { capital: sCap, earned: sEarn };
    owner = { capital: round2(capital - sCap), earned: round2(earned - sEarn) };
  }
  return {
    lossesUsed, lossesLeft: round2(Math.max(0, i.confirmedLosses) - lossesUsed), distributable, entrepreneurDeduction, splitBase, wealthBase, capitalPct, capitalMax,
    capital, earned, owner, spouse, loss: 0, lossToCapital: 0, lossConfirmed: 0, wealthMissing,
  };
}

/**
 * Tasausvarauksen enimmäismäärä: 40 % maatalouden puhtaasta tulosta ennen
 * korkoja ja ennen tämän vuoden tasausvarausta, enintään 25 000 €, alas
 * täysiin satasiin. Alle 800 euron varausta ei voi tehdä (MVL 17 a §,
 * Verohallinto: Maatalouden tasausvaraus ja jälleenhankintavaraus).
 */
export function equalizationReserveMax(netIncomeBeforeInterest: number): number {
  const raw = Math.min(EQUALIZATION_RESERVE.max, (Math.max(0, netIncomeBeforeInterest) * EQUALIZATION_RESERVE.pct) / 100);
  const rounded = Math.floor(raw / EQUALIZATION_RESERVE.round) * EQUALIZATION_RESERVE.round;
  return rounded >= EQUALIZATION_RESERVE.min ? rounded : 0;
}

/** Tarkistaa tasausvarauksen. Palauttaa virheen tai null. */
export function validateEqualizationReserve(amount: number, max: number): string | null {
  if (amount === 0) return null;
  if (amount < 0) return "Tasausvaraus ei voi olla negatiivinen.";
  if (amount % EQUALIZATION_RESERVE.round !== 0) return "Tasausvaraus tehdään täysinä satoina euroina.";
  if (max === 0) return "Tänä vuonna tasausvarausta ei voi tehdä, koska enimmäismäärä jää alle 800 euron.";
  if (amount < EQUALIZATION_RESERVE.min) return `Tasausvaraus on vähintään ${EQUALIZATION_RESERVE.min} € tai ei lainkaan.`;
  if (amount > max) return `Tasausvaraus voi olla enintään ${max.toLocaleString("fi-FI")} €.`;
  return null;
}

/** Valtion tulovero verotettavasta ansiotulosta vuoden asteikolla. */
export function stateIncomeTax(taxable: number, year: number): number {
  if (taxable <= 0) return 0;
  const { brackets } = stateIncomeTaxScale(year);
  let row = brackets[0];
  for (const b of brackets) if (taxable >= b[0]) row = b;
  return round2(row[1] + ((taxable - row[0]) * row[2]) / 100);
}

export interface EarnedTaxEstimate {
  state: number;
  municipal: number;
  total: number;
  /** Ansiotulon lisäyksen keskimääräinen veroprosentti. */
  ratePct: number;
}

/**
 * Arvio maatalouden ansiotulo-osuuden verosta: valtion veron lisäys muiden
 * ansiotulojen päälle ja kunnallisvero oletusprosentilla. Arvio ei ota
 * huomioon vähennyksiä (perusvähennys, työtulovähennys), kirkollisveroa,
 * Yle-veroa eikä sairausvakuutusmaksuja, joten se on suuntaa antava.
 */
export function earnedIncomeTaxEstimate(earned: number, year: number, otherEarned = 0, municipalPct = municipalTaxAvgPct(year)): EarnedTaxEstimate {
  if (earned <= 0) return { state: 0, municipal: 0, total: 0, ratePct: 0 };
  const other = Math.max(0, otherEarned);
  const state = round2(stateIncomeTax(other + earned, year) - stateIncomeTax(other, year));
  const municipal = round2((earned * municipalPct) / 100);
  const total = round2(state + municipal);
  return { state, municipal, total, ratePct: round2((total / earned) * 100) };
}
