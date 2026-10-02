import { grossFromNet } from "@/lib/tax/amounts";
import { FORESTRY_CATEGORIES as CATEGORIES, type TransactionKind } from "@/lib/tax/rules";

/**
 * Vanhan Skog-kannan rivit uuden tietomallin riveiksi. Puhdas muunnos ilman
 * kantakutsuja, jotta säännöt voidaan testata (tests/unit/legacy-import.test.ts).
 * Skripti scripts/import-legacy.mts lukee vanhan kannan ja kirjoittaa tulokset.
 *
 * Kenttien nimet on luettu vanhan sovelluksen koodista (legacy/app), koska
 * vanhan kannan rakennetta ei ole versionhallinnassa (PLAN vaihe 2).
 */

export interface LegacyUser {
  id: string;
  auth_sub: string | null;
  sahkoposti: string | null;
  etunimi: string | null;
  sukunimi: string | null;
  rooli: string | null;
  aktiivinen: boolean | null;
  organisaatio_id: string | null;
}

export interface LegacyClient {
  id: string;
  organisaatio_id: string;
  etunimi: string | null;
  sukunimi: string | null;
  y_tunnus: string | null;
  kotikunta: string | null;
  sahkoposti: string | null;
  puhelin: string | null;
  osoite: string | null;
  postinumero: string | null;
  postitoimipaikka: string | null;
  verotiliviite: string | null;
  alv_rekisterissa: boolean | null;
  alv_numero?: string | null;
  avoin_vuosi: number | null;
  vastuukirjanpitaja_id: string | null;
  poistettu_at: string | null;
}

export interface LegacyProperty {
  id: string;
  asiakas_id: string;
  nimi: string | null;
  kiinteistotunnus: string | null;
  pinta_ala_ha: string | number | null;
  hankintahinta: string | number | null;
  hankintapvm: string | null;
  metsämaan_osuus_prosentti: string | number | null;
  metsämaa_ha?: string | number | null;
  vahennyspohjaa_kaytetty: string | number | null;
}

export interface LegacyDeduction {
  metsatila_id: string;
  verovuosi: number;
  kaytettava_vahennys: string | number;
}

export interface LegacyAsset {
  id: string;
  asiakas_id: string;
  kuvaus: string | null;
  hankintapvm: string | null;
  hankintahinta: string | number | null;
  jaannosarvo: string | number | null;
  poistoaika_vuotta: number | null;
  poistotapa: string | null;
  aktiivinen: boolean | null;
  metsatila_id?: string | null;
}

export interface LegacyDepreciation {
  investointi_id: string;
  verovuosi: number;
  poistomaara: string | number;
  jaannosarvo_vuoden_lopussa: string | number | null;
}

export interface LegacyTransaction {
  id: string;
  asiakas_id: string;
  tyyppi: string | null;
  kuvaus: string | null;
  paivamaara: string | null;
  summa_alv0: string | number | null;
  alv_prosentti: string | number | null;
  kategoria: string | null;
  ennakko: string | number | null;
  viite: string | null;
  verovuosi: number | null;
  metsatila_id?: string | null;
}

/** Syy, miksi rivi jätettiin pois. Vain tunniste ja syy, ei henkilötietoja. */
export interface Skipped {
  table: string;
  legacyId: string;
  reason: string;
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const text = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

// pg palauttaa date-sarakkeen oletuksena Date-oliona paikallisena keskiyönä, joten luetaan paikalliset osat.
const date = (v: string | Date | null | undefined): string | null => {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = typeof v === "string" ? v.match(/^(\d{4}-\d{2}-\d{2})/) : null;
  return m ? m[1] : null;
};

/** Vanha rooli uudeksi. Lukija-roolia ei ole uudessa sovelluksessa (DECISIONS 26.9.2026). */
export function mapRole(rooli: string | null): "owner" | "staff" | null {
  if (rooli === "paakayttaja") return "owner";
  if (rooli === "kirjanpitaja") return "staff";
  return null;
}

export function mapUser(u: LegacyUser): { email: string; fullName: string | null; role: "owner" | "staff" } | Skipped {
  const email = text(u.sahkoposti)?.toLowerCase();
  if (!email) return { table: "kayttajat", legacyId: u.id, reason: "sähköposti puuttuu" };
  if (u.aktiivinen === false) return { table: "kayttajat", legacyId: u.id, reason: "ei aktiivinen" };
  const role = mapRole(u.rooli);
  if (!role) return { table: "kayttajat", legacyId: u.id, reason: `rooli ${u.rooli ?? "puuttuu"} ei siirry` };
  const fullName = [text(u.etunimi), text(u.sukunimi)].filter(Boolean).join(" ") || null;
  return { email, fullName, role };
}

export interface ClientRow {
  legacyId: string;
  firstName: string;
  lastName: string;
  businessId: string | null;
  municipality: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  taxAccountReference: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  legacyResponsibleId: string | null;
  archivedAt: string | null;
  openYear: number | null;
}

export function mapClient(c: LegacyClient): ClientRow | Skipped {
  const lastName = text(c.sukunimi);
  const firstName = text(c.etunimi) ?? "";
  if (!lastName && !firstName) return { table: "asiakkaat", legacyId: c.id, reason: "nimi puuttuu" };
  const postal = text(c.postinumero);
  return {
    legacyId: c.id,
    firstName,
    lastName: lastName ?? "",
    businessId: text(c.y_tunnus),
    municipality: text(c.kotikunta),
    email: text(c.sahkoposti),
    phone: text(c.puhelin),
    street: text(c.osoite),
    // Uusi kanta hyväksyy vain viisinumeroisen postinumeron.
    postalCode: postal && /^\d{5}$/.test(postal) ? postal : null,
    city: text(c.postitoimipaikka),
    taxAccountReference: text(c.verotiliviite),
    vatRegistered: c.alv_rekisterissa === true,
    vatNumber: text(c.alv_numero),
    legacyResponsibleId: c.vastuukirjanpitaja_id,
    archivedAt: c.poistettu_at,
    openYear: c.avoin_vuosi,
  };
}

export interface PropertyRow {
  legacyId: string;
  legacyClientId: string;
  name: string;
  propertyCode: string | null;
  areaHa: number | null;
  acquisitionPrice: number | null;
  acquiredOn: string | null;
  forestLandSharePct: number | null;
  forestLandHa: number | null;
  deductionUsedBefore: number;
}

/**
 * Vanha kenttä vahennyspohjaa_kaytetty sisältää myös ohjelmassa kirjatut
 * metsävähennykset, koska verosuunnitelma kasvatti sitä. Ne siirtyvät omina
 * riveinään, joten "käytetty ennen ohjelmaa" on erotus.
 */
export function mapProperty(p: LegacyProperty, deductions: LegacyDeduction[]): PropertyRow {
  const recorded = deductions.filter((d) => d.metsatila_id === p.id).reduce((s, d) => s + (num(d.kaytettava_vahennys) ?? 0), 0);
  const used = num(p.vahennyspohjaa_kaytetty) ?? 0;
  return {
    legacyId: p.id,
    legacyClientId: p.asiakas_id,
    name: text(p.nimi) ?? "Nimetön tila",
    propertyCode: text(p.kiinteistotunnus),
    areaHa: num(p.pinta_ala_ha),
    acquisitionPrice: num(p.hankintahinta),
    acquiredOn: date(p.hankintapvm),
    forestLandSharePct: num(p.metsämaan_osuus_prosentti),
    forestLandHa: num(p.metsämaa_ha),
    deductionUsedBefore: Math.max(0, Math.round((used - recorded) * 100) / 100),
  };
}

export interface AssetRow {
  legacyId: string;
  legacyClientId: string;
  description: string;
  acquiredOn: string;
  acquisitionCost: number;
  method: "straight_line" | "declining_balance";
  usefulLifeYears: number | null;
  decliningRatePct: number | null;
  openingBookValue: number | null;
  /** Vanha sovellus merkitsi myydyn kohteen epäaktiiviseksi ilman päivää. */
  disposed: boolean;
  legacyPropertyId: string | null;
}

export function mapAsset(a: LegacyAsset): AssetRow | Skipped {
  const acquiredOn = date(a.hankintapvm);
  const cost = num(a.hankintahinta);
  if (!acquiredOn || cost === null) return { table: "investoinnit", legacyId: a.id, reason: "hankintapäivä tai -hinta puuttuu" };
  const declining = a.poistotapa === "menojannos";
  if (!declining && !(a.poistoaika_vuotta && a.poistoaika_vuotta > 0)) {
    return { table: "investoinnit", legacyId: a.id, reason: "tasapoiston poistoaika puuttuu" };
  }
  return {
    legacyId: a.id,
    legacyClientId: a.asiakas_id,
    description: text(a.kuvaus) ?? "Investointi",
    acquiredOn,
    acquisitionCost: cost,
    method: declining ? "declining_balance" : "straight_line",
    usefulLifeYears: declining ? null : a.poistoaika_vuotta,
    decliningRatePct: declining ? 25 : null,
    openingBookValue: num(a.jaannosarvo),
    disposed: a.aktiivinen === false,
    legacyPropertyId: a.metsatila_id ?? null,
  };
}

const LEGACY_KIND: Record<string, TransactionKind> = { tulo: "income", meno: "expense", investointi: "investment" };

export interface TransactionRow {
  legacyId: string;
  legacyClientId: string;
  bookedOn: string;
  kind: TransactionKind;
  category: string;
  description: string;
  amountNet: number;
  /** Vanhassa kannassa oli vain veroton summa; brutto lasketaan siitä kuten vanha sovellus sen näytti. */
  amountGross: number;
  vatRate: number;
  withholding: number;
  reference: string | null;
  legacyPropertyId: string | null;
}

/**
 * Luokka haetaan vanhalla nimellä. Tuntematon tai puuttuva luokka päätellään
 * tyypistä (muu tulo tai muu meno), jotta kirjaus ei katoa; sellaiset listataan
 * tarkistettaviksi.
 */
export function mapTransaction(t: LegacyTransaction): { row: TransactionRow; categoryGuessed: boolean } | Skipped {
  const bookedOn = date(t.paivamaara);
  const amount = num(t.summa_alv0);
  if (!bookedOn || amount === null) return { table: "tapahtumat", legacyId: t.id, reason: "päivä tai summa puuttuu" };
  // Vanhassa sovelluksessa vuosi oli erillinen kenttä. Uudessa se tulee päivästä, joten ristiriita tarkistetaan.
  if (t.verovuosi && Number(bookedOn.slice(0, 4)) !== t.verovuosi) {
    return { table: "tapahtumat", legacyId: t.id, reason: "päivä ei ole verovuodella" };
  }
  const found = CATEGORIES.find((c) => c.legacyName === t.kategoria?.trim());
  const kind = found?.kind ?? LEGACY_KIND[t.tyyppi ?? ""] ?? null;
  if (!kind) return { table: "tapahtumat", legacyId: t.id, reason: "tyyppi tuntematon" };
  const fallback = kind === "expense" ? "other_expense" : kind === "investment" ? "asset_purchase" : "forestry_subsidy";
  return {
    row: {
      legacyId: t.id,
      legacyClientId: t.asiakas_id,
      bookedOn,
      kind,
      category: found?.code ?? fallback,
      description: text(t.kuvaus) ?? "",
      amountNet: amount,
      amountGross: grossFromNet(amount, num(t.alv_prosentti) ?? 0),
      vatRate: num(t.alv_prosentti) ?? 0,
      withholding: num(t.ennakko) ?? 0,
      reference: text(t.viite),
      legacyPropertyId: t.metsatila_id ?? null,
    },
    categoryGuessed: !found,
  };
}

/**
 * Asiakkaan verovuodet: jokainen vuosi, jolla on kirjauksia, poistoja tai
 * metsävähennyksiä, sekä avoin vuosi. Vanhassa sovelluksessa vain avointa
 * vuotta pystyi muokkaamaan, joten sitä aiemmat vuodet tuodaan suljettuina.
 */
export function taxYears(openYear: number | null, years: number[]): { year: number; closed: boolean }[] {
  const all = new Set(years);
  if (openYear) all.add(openYear);
  return [...all].sort((a, b) => a - b).map((year) => ({ year, closed: openYear !== null && year < openYear }));
}

export function isSkipped(v: unknown): v is Skipped {
  return typeof v === "object" && v !== null && "reason" in v && "legacyId" in v;
}
