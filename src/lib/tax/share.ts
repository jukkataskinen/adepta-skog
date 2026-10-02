import { percentOf, round2, vatOf } from "./amounts";
import { categoryActivity, crossCategory, type Activity, type TransactionKind } from "./rules";

/**
 * Kirjauksen osuudet toiminnoille (0013, 0015; DECISIONS 28.9. ja 2.10.2026).
 *
 * Osa tositteesta voi kuulua muulle toiminnalle: esimerkiksi tiemaksusta vain
 * 50 % on metsätalouden kulua, tai sähkölaskusta 70 % maataloudelle, 20 %
 * metsätaloudelle ja 10 % yksityiseen. Kirjauksen summat ovat aina koko
 * tositteen summat, ja kaikki verolaskenta ottaa niistä osuudet tällä säännöllä:
 *
 *   oma veroton       = pyöristys(veroton × oma/100, 2)
 *   toisen veroton    = pyöristys(veroton × toinen/100, 2)          vain menot
 *   ostojen alv       = pyöristys((brutto − veroton) × osuus/100, 2) kummallekin osuudelle
 *   myynnin alv       = brutto − veroton                            tulot: koko myynnin vero
 *   yksityinen        = loppu, jotta osat täsmäävät kuittiin
 *
 * Myynnin vero on koko myynnistä, koska myyjä on verovelvollinen koko
 * laskuttamastaan myynnistä. Ostojen verosta vähennetään oman ja toisen
 * toiminnon osuus, koska sama verovelvollinen antaa yhden alv-ilmoituksen
 * molemmista. Yksityisen osuuden veroa ei vähennetä.
 */

export const FULL_SHARE = 100;

export interface ShareInput {
  kind: TransactionKind;
  /** Koko tositteen veroton summa. */
  amountNet: number;
  /** Koko tositteen summa arvonlisäveron kanssa. */
  amountGross: number;
  /** Oman toiminnon osuus prosentteina, 0 < x ≤ 100. Puuttuva = 100. */
  businessSharePct?: number | null;
  /** Toisen toiminnon osuus prosentteina (vain menot). Puuttuva = 0. */
  otherSharePct?: number | null;
}

export interface ShareAmounts {
  sharePct: number;
  /** Oman toiminnon veroton osuus: tuloa, menoa tai investoinnin hankintamenoa. */
  net: number;
  /** Oman toiminnon arvonlisäveroon kuuluva vero: myynnissä koko vero, ostoissa osuus. */
  vat: number;
  /** Oman toiminnon summa arvonlisäveron kanssa (net + vat). */
  gross: number;
  /** Ostojen vero, jota ei vähennetä (yksityinen osuus). Myynnissä 0. */
  nonDeductibleVat: number;
  /** Muulle kuin omalle toiminnolle kuuluva veroton summa (toinen toiminto ja yksityinen). */
  otherNet: number;
  /** Muulle kuin omalle toiminnolle kuuluva summa arvonlisäveron kanssa (brutto − gross). */
  otherGross: number;
  /** Toisen toiminnon osuus prosentteina ja summat. Nollia, jos osuutta ei ole. */
  crossPct: number;
  crossNet: number;
  crossVat: number;
  crossGross: number;
  /** Yksityinen osuus arvonlisäveron kanssa. */
  privateGross: number;
}

/** Osuus luvuksi: puuttuva tai kelvoton on 100 %, jotta vanhat rivit toimivat ennallaan. */
export function sharePct(v: number | string | null | undefined): number {
  const n = v === null || v === undefined || v === "" ? FULL_SHARE : Number(v);
  return Number.isFinite(n) && n > 0 && n <= FULL_SHARE ? n : FULL_SHARE;
}

/** Toisen toiminnon osuus luvuksi: puuttuva tai kelvoton on 0. */
export function otherSharePct(v: number | string | null | undefined): number {
  const n = v === null || v === undefined || v === "" ? 0 : Number(v);
  return Number.isFinite(n) && n > 0 && n < FULL_SHARE ? n : 0;
}

export function isPartialShare(v: number | string | null | undefined): boolean {
  return sharePct(v) < FULL_SHARE;
}

/** Kirjauksen osuudet: oma toiminto, toinen toiminto ja yksityinen. */
export function ownShare(t: ShareInput): ShareAmounts {
  const pct = sharePct(t.businessSharePct);
  const cross = t.kind === "expense" ? Math.min(otherSharePct(t.otherSharePct), FULL_SHARE - pct) : 0;
  const fullVat = vatOf(t.amountNet, t.amountGross);
  const net = pct === FULL_SHARE ? round2(t.amountNet) : percentOf(t.amountNet, pct);
  const vatShare = pct === FULL_SHARE ? fullVat : percentOf(fullVat, pct);
  const vat = t.kind === "income" ? fullVat : vatShare;
  const gross = round2(net + vat);
  const crossNet = cross ? percentOf(t.amountNet, cross) : 0;
  const crossVat = cross ? percentOf(fullVat, cross) : 0;
  const crossGross = round2(crossNet + crossVat);
  const otherGross = round2(t.amountGross - gross);
  return {
    sharePct: pct,
    net,
    vat,
    gross,
    nonDeductibleVat: t.kind === "income" ? 0 : round2(fullVat - vatShare - crossVat),
    otherNet: round2(t.amountNet - net),
    otherGross,
    crossPct: cross,
    crossNet,
    crossVat,
    crossGross,
    privateGross: round2(otherGross - crossGross),
  };
}

/**
 * Metsätalouden osuus kirjauksesta. Nimi on säilytetty, koska metsätalouden
 * laskelmat käyttävät sitä metsätalouden kirjauksille; maatalouden kirjauksen
 * osuudet saa samalla funktiolla (ownShare).
 */
export const forestryShare = ownShare;

/** Osuus prosentteina tekstiksi: 50 → "50", 33.33 → "33,33". */
export function formatSharePct(pct: number): string {
  return pct.toLocaleString("fi-FI", { maximumFractionDigits: 2 });
}

export interface ActivityInput extends ShareInput {
  category: string;
  /** Puuttuva = luokasta. */
  activity?: Activity | null;
}

export type ActivityPart<T> = T & { category: string; amountNet: number; amountGross: number; businessSharePct: number; otherSharePct: number; cross: boolean };

/**
 * Kirjauksen osa, joka kuuluu annetulle toiminnolle, valmiiksi osuutena:
 * oma osuus omalla luokalla tai toisen toiminnon osuus vastaavalla luokalla
 * (crossCategory). Summat ovat osuuden summat, joten tulokseen voi käyttää
 * ownShare-funktiota osuudella 100. null, jos kirjauksesta ei kuulu mitään
 * toiminnolle.
 */
export function activityPart<T extends ActivityInput>(t: T, activity: Activity): ActivityPart<T> | null {
  const own = t.activity ?? categoryActivity(t.category);
  const s = ownShare(t);
  if (own === activity) return { ...t, amountNet: s.net, amountGross: s.gross, businessSharePct: FULL_SHARE, otherSharePct: 0, cross: false };
  if (!s.crossPct) return null;
  return { ...t, category: crossCategory(t.category), amountNet: s.crossNet, amountGross: s.crossGross, businessSharePct: FULL_SHARE, otherSharePct: 0, cross: true };
}

/** Kirjausten osat toiminnolle (activityPart), tyhjät pois. */
export function activityRows<T extends ActivityInput>(rows: T[], activity: Activity): ActivityPart<T>[] {
  return rows.map((r) => activityPart(r, activity)).filter((r): r is ActivityPart<T> => r !== null);
}
