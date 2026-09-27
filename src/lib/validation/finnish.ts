/**
 * Suomalaiset tunnisteet: Y-tunnus, IBAN, viitenumero, kiinteistötunnus ja
 * postinumero (eRapusta) sekä henkilötunnuksen muodon tarkistus.
 * Henkilötunnusta ei tallenneta mihinkään: se tarkistetaan vain
 * veroilmoitustiedostoa muodostettaessa (DECISIONS 28.9.2026).
 */

export function normalizeBusinessId(value: string): string {
  const digits = value.replace(/[\s-]/g, "");
  return digits.length === 8 ? `${digits.slice(0, 7)}-${digits[7]}` : value.trim();
}

export function isValidBusinessId(value: string): boolean {
  const m = /^(\d{7})-(\d)$/.exec(normalizeBusinessId(value));
  if (!m) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const sum = weights.reduce((t, w, i) => t + w * Number(m[1][i]), 0);
  const r = sum % 11;
  if (r === 1) return false;
  return Number(m[2]) === (r === 0 ? 0 : 11 - r);
}

export function isValidPostalCode(value: string): boolean {
  return /^\d{5}$/.test(value.trim());
}

/**
 * Kiinteistötunnus lyhyessä tai pitkässä muodossa: 172-402-4-543 tai
 * 17240200040543. Palauttaa lyhyen muodon tai null.
 */
export function normalizePropertyCode(value: string): string | null {
  const v = value.trim();
  const short = /^(\d{1,3})-(\d{1,3})-(\d{1,4})-(\d{1,4})(?:-[A-Z]\d{0,4})?$/.exec(v);
  if (short) return short.slice(1, 5).map((p) => String(Number(p))).join("-") + (v.match(/-[A-Z]\d{0,4}$/)?.[0] ?? "");
  const long = /^(\d{3})(\d{3})(\d{4})(\d{4})$/.exec(v.replace(/\s/g, ""));
  if (long) return long.slice(1, 5).map((p) => String(Number(p))).join("-");
  return null;
}

/** Kotimainen viitenumero: perusosa + tarkiste (painot 7-3-1 oikealta). */
export function referenceNumber(base: string): string {
  const digits = base.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 19) throw new Error("Viitenumeron perusosa on 3–19 numeroa");
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * weights[i % 3];
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits}${check}`;
}

export function isValidReferenceNumber(value: string): boolean {
  const digits = value.replace(/\s/g, "");
  if (!/^\d{4,20}$/.test(digits)) return false;
  return referenceNumber(digits.slice(0, -1)) === digits;
}

/** RF-viite (ISO 11649) kotimaisesta viitteestä. */
export function rfReference(domestic: string): string {
  const digits = domestic.replace(/\D/g, "");
  const numeric = `${digits}271500`; // "RF00" → R=27 F=15 00
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  const check = String(98 - remainder).padStart(2, "0");
  return `RF${check}${digits}`;
}

/** Viite ryhmiteltynä viiden numeron ryhmiin näyttöä varten. */
export function formatReference(value: string): string {
  const d = value.replace(/\s/g, "");
  return d.replace(/\B(?=(\d{5})+(?!\d))/g, " ");
}

export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("FI") && iban.length !== 18) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/**
 * Henkilötunnuksen välimerkit vuosisadoittain (laki 128/2022, käytössä
 * 1.1.2023 alkaen): 1800 +, 1900 - Y X W V U, 2000 A B C D E F.
 */
const PERSONAL_ID_CENTURY: Record<string, number> = {
  "+": 1800, "-": 1900, Y: 1900, X: 1900, W: 1900, V: 1900, U: 1900, A: 2000, B: 2000, C: 2000, D: 2000, E: 2000, F: 2000,
};
const PERSONAL_ID_CHECK = "0123456789ABCDEFHJKLMNPRSTUVWXY";

/** Poistaa välilyönnit ja muuttaa kirjaimet isoiksi. */
export function normalizePersonalId(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}

/**
 * Henkilötunnuksen muodollinen oikeellisuus: päivä on kalenterissa,
 * välimerkki on sallittu, yksilönumero 002–999 ja tarkistusmerkki täsmää
 * (yhdeksännumeroinen luku jaettuna 31:llä). Voimassaoloa ei voi tarkistaa,
 * kuten ei Verohallinnon tarkistusmoduulikaan (muoto HETU2). Keinotunnuksia
 * (esim. 010101-UUUU) ei hyväksytä.
 */
export function isValidPersonalId(value: string): boolean {
  const m = /^(\d{2})(\d{2})(\d{2})([-+A-FU-Y])(\d{3})([0-9A-Y])$/.exec(normalizePersonalId(value));
  if (!m) return false;
  const [, dd, mm, yy, sep, ind, check] = m;
  const century = PERSONAL_ID_CENTURY[sep];
  if (century === undefined) return false;
  const year = century + Number(yy);
  const date = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) return false;
  if (Number(ind) < 2) return false;
  return PERSONAL_ID_CHECK[Number(`${dd}${mm}${yy}${ind}`) % 31] === check;
}
