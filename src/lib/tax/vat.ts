import { round2 } from "./amounts";
import { ownShare } from "./share";
import { categoryActivity, generalVatRate, reducedVatRate, vatRateGroup, type Activity, type TransactionKind } from "./rules";

/**
 * Arvonlisäveron yhteenveto neljänneksittäin ja vuodelta. Metsätalouden ja
 * maatalouden ilmoitusjakso on yleensä kalenterivuosi, mutta neljännekset
 * auttavat, jos asiakas ilmoittaa useammin.
 *
 * Sama verovelvollinen antaa yhden alv-ilmoituksen metsä- ja maataloudesta
 * (docs/maatalous-suunnitelma-2026-10-02.md, 2.1), joten laskelma kattaa
 * kaikki kirjaukset, ja erittely toiminnoittain on vain tietoa.
 *
 * Myynnin vero on koko myynnistä. Ostojen verosta vähennetään oman ja toisen
 * toiminnon osuus (src/lib/tax/share.ts); yksityinen osuus näytetään erikseen
 * (nonDeductible).
 */

export interface VatRow {
  bookedOn: string;
  kind: TransactionKind;
  amountNet: number;
  amountGross: number;
  /** Myynnit ryhmitellään verokannoittain. */
  vatRate: number;
  /** Oman toiminnon osuus prosentteina. Puuttuva = 100. */
  businessSharePct?: number | null;
  /** Toisen toiminnon osuus prosentteina (vain menot). Puuttuva = 0. */
  otherSharePct?: number | null;
  /** Toiminto erittelyä varten. Puuttuva = luokasta, ja ilman luokkaa metsätalous. */
  activity?: Activity | null;
  category?: string;
}

export interface ActivityVat {
  output: number;
  input: number;
}

/** Oma-aloitteisten verojen ilmoituksen (VSRALVKV) kentät, jotka Skog osaa laskea. */
export interface VatReturnFields {
  /** 301 vero yleisestä verokannasta (25,5 %, ennen 1.9.2024 24 %). */
  general: number;
  /** 302 vero alennetusta verokannasta 14 % / 13,5 %. */
  reduced: number;
  /** 303 vero 10 %:n verokannasta. */
  ten: number;
  /** 307 verokauden vähennettävä vero. */
  deductible: number;
  /** 308 maksettava (+) tai palautettava (−) vero. */
  payable: number;
}

export interface VatPeriod {
  label: string;
  /** Myynnin vero (tulot). */
  output: number;
  /** Vähennettävä ostojen vero (menot ja investoinnit, metsän ja maatalouden osuudet). */
  input: number;
  /** Ostojen vero, joka on yksityistä eikä vähennetä. */
  nonDeductible: number;
  payable: number;
  /** Veron määrä verokannoittain myynneistä. */
  byRate: { rate: number; net: number; vat: number }[];
  /** Myynnin ja vähennettävän veron erittely toiminnoittain. */
  byActivity: Record<Activity, ActivityVat>;
  form: VatReturnFields;
}

function period(label: string, rows: VatRow[]): VatPeriod {
  let output = 0;
  let input = 0;
  let nonDeductible = 0;
  const byActivity: Record<Activity, ActivityVat> = { forestry: { output: 0, input: 0 }, agriculture: { output: 0, input: 0 } };
  const rates = new Map<number, { net: number; vat: number }>();
  for (const r of rows) {
    const s = ownShare(r);
    const own = r.activity ?? (r.category ? categoryActivity(r.category) : "forestry");
    const other: Activity = own === "forestry" ? "agriculture" : "forestry";
    if (r.kind === "income") {
      // Myynnin veron peruste on koko myynti, vaikka tulosta osa kuuluisi muulle toiminnalle.
      output += s.vat;
      byActivity[own].output += s.vat;
      const e = rates.get(r.vatRate) ?? { net: 0, vat: 0 };
      e.net += r.amountNet;
      e.vat += s.vat;
      rates.set(r.vatRate, e);
    } else {
      input += s.vat + s.crossVat;
      byActivity[own].input += s.vat;
      byActivity[other].input += s.crossVat;
      nonDeductible += s.nonDeductibleVat;
    }
  }
  const byRate = [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([rate, e]) => ({ rate, net: round2(e.net), vat: round2(e.vat) }));
  const group = (g: string) => round2(byRate.filter((b) => vatRateGroup(b.rate) === g).reduce((s, b) => s + b.vat, 0));
  for (const a of Object.values(byActivity)) {
    a.output = round2(a.output);
    a.input = round2(a.input);
  }
  const payable = round2(output - input);
  return {
    label,
    output: round2(output),
    input: round2(input),
    nonDeductible: round2(nonDeductible),
    payable,
    byRate,
    byActivity,
    form: { general: group("general"), reduced: group("reduced"), ten: group("ten"), deductible: round2(input), payable },
  };
}

export function vatSummary(rows: VatRow[]): { quarters: VatPeriod[]; year: VatPeriod } {
  const quarters = [1, 2, 3, 4].map((q) =>
    period(
      `${q}. neljännes`,
      rows.filter((r) => Math.ceil(Number(r.bookedOn.slice(5, 7)) / 3) === q),
    ),
  );
  return { quarters, year: period("Koko vuosi", rows) };
}

/** Kirjausrivit kannasta yhteenvetoon: summat, osuudet ja toiminto. */
export function vatRowsFrom(
  rows: { booked_on: string; kind: TransactionKind; amount_net: string; amount_gross: string; vat_rate: string; business_share_pct: string; other_share_pct?: string; activity?: Activity; category: string }[],
): VatRow[] {
  return rows.map((r) => ({
    bookedOn: r.booked_on, kind: r.kind, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), vatRate: Number(r.vat_rate),
    businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct ?? 0), activity: r.activity ?? null, category: r.category,
  }));
}

/**
 * Ilmoituksen kentät näytettäviksi riveiksi (alv-sivu ja veroraportti).
 * Kannan teksti tulee vuoden kannoista, jotta vuoden 2024 kentässä 301 näkyy
 * myös 24 % ja kentässä 302 vuoden oikea alennettu kanta.
 */
export function vatFormRows(year: number, form: VatReturnFields): [code: string, label: string, value: number][] {
  const pct = (n: number) => `${String(n).replace(".", ",")} %`;
  const rates = (f: (date: string) => number) => [...new Set([f(`${year}-01-01`), f(`${year}-12-31`)])].map(pct).join(" tai ");
  return [
    ["301", `Vero ${rates(generalVatRate)}`, form.general],
    ["302", `Vero ${rates(reducedVatRate)}`, form.reduced],
    ["303", "Vero 10 %", form.ten],
    ["307", "Verokauden vähennettävä vero", form.deductible],
    ["308", form.payable < 0 ? "Palautettava vero" : "Maksettava vero", Math.abs(form.payable)],
  ];
}
