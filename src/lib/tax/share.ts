import { percentOf, round2, vatOf } from "./amounts";
import type { TransactionKind } from "./rules";

/**
 * Metsätalouden osuus kirjauksesta (migraatio 0013, DECISIONS 28.9.2026).
 *
 * Osa tositteesta voi kuulua muulle toiminnalle: esimerkiksi tiemaksusta vain
 * 50 % on metsätalouden kulua. Kirjauksen summat ovat aina koko tositteen summat,
 * ja kaikki verolaskenta ottaa niistä metsätalouden osuuden tällä säännöllä:
 *
 *   veroton osuus   = pyöristys(veroton × osuus/100, 2)
 *   ostojen alv     = pyöristys((brutto − veroton) × osuus/100, 2)   menot ja investoinnit
 *   myynnin alv     = brutto − veroton                                tulot: koko myynnin vero
 *
 * Myynnin vero on koko myynnistä, koska myyjä on verovelvollinen koko
 * laskuttamastaan myynnistä riippumatta siitä, mille toiminnalle tulo kuuluu.
 * Ostojen verosta vähennetään vain metsätalouden osuus; loppu ei ole
 * metsätalouden vähennettävää veroa (se näytetään erikseen).
 */

export const FULL_SHARE = 100;

export interface ShareInput {
  kind: TransactionKind;
  /** Koko tositteen veroton summa. */
  amountNet: number;
  /** Koko tositteen summa arvonlisäveron kanssa. */
  amountGross: number;
  /** Metsätalouden osuus prosentteina, 0 < x ≤ 100. Puuttuva = 100. */
  businessSharePct?: number | null;
}

export interface ShareAmounts {
  sharePct: number;
  /** Metsätalouden veroton osuus: tuloa, menoa tai investoinnin hankintamenoa. */
  net: number;
  /** Metsätalouden arvonlisäveroon kuuluva vero: myynnissä koko vero, ostoissa osuus. */
  vat: number;
  /** Metsätalouden kirjanpitoon kuuluva summa arvonlisäveron kanssa (net + vat). */
  gross: number;
  /** Ostojen vero, jota ei vähennetä metsätaloudessa (muun toiminnan osuus). Myynnissä 0. */
  nonDeductibleVat: number;
  /** Muulle toiminnalle kuuluva veroton summa. */
  otherNet: number;
  /** Muulle toiminnalle kuuluva summa arvonlisäveron kanssa (brutto − gross). */
  otherGross: number;
}

/** Osuus luvuksi: puuttuva tai kelvoton on 100 %, jotta vanhat rivit toimivat ennallaan. */
export function sharePct(v: number | string | null | undefined): number {
  const n = v === null || v === undefined || v === "" ? FULL_SHARE : Number(v);
  return Number.isFinite(n) && n > 0 && n <= FULL_SHARE ? n : FULL_SHARE;
}

export function isPartialShare(v: number | string | null | undefined): boolean {
  return sharePct(v) < FULL_SHARE;
}

/** Metsätalouden osuus kirjauksen summista. */
export function forestryShare(t: ShareInput): ShareAmounts {
  const pct = sharePct(t.businessSharePct);
  const fullVat = vatOf(t.amountNet, t.amountGross);
  const net = pct === FULL_SHARE ? round2(t.amountNet) : percentOf(t.amountNet, pct);
  const vatShare = pct === FULL_SHARE ? fullVat : percentOf(fullVat, pct);
  const vat = t.kind === "income" ? fullVat : vatShare;
  const gross = round2(net + vat);
  return {
    sharePct: pct,
    net,
    vat,
    gross,
    nonDeductibleVat: t.kind === "income" ? 0 : round2(fullVat - vatShare),
    otherNet: round2(t.amountNet - net),
    otherGross: round2(t.amountGross - gross),
  };
}

/** Osuus prosentteina tekstiksi: 50 → "50", 33.33 → "33,33". */
export function formatSharePct(pct: number): string {
  return pct.toLocaleString("fi-FI", { maximumFractionDigits: 2 });
}
