import type { Form2Result } from "@/lib/tax/agriculture";
import { formatAmount, timestamp198, toLatin1Text } from "./vsy02c";
import { FORM2_ORDER, form2Label } from "./vsy002-fields";

/**
 * Maatalouden veroilmoitus (lomake 2) sähköisenä ilmoitustiedostona
 * (tietovirta VSY002), samaan tiedostoon 2C:n kanssa. Puhdas funktio: lomakkeen
 * 2 laskenta (src/lib/tax/agriculture.ts) sisään, tiedoston teksti ulos.
 *
 * Lähteet (luettu 2.10.2026):
 * - Verohallinto: Maatalouden veroilmoitus 2, henkilöasiakas tai kuolinpesä,
 *   tietuekuvaus 2026 v1.0 (22.9.2026) ja 2025 v1.0 (23.9.2025), luvut 7–9.
 * - Sallitut lomakeyhdistelmät: lomakkeen 2 kanssa samassa tiedostossa saa olla 2C.
 * - Sähköisen ilmoittamisen yleiskuvaus: muodot, merkistö ja ohjelmistotiedot kuten 2C:ssä (vsy02c.ts).
 *
 * Tiedostoa ei ole tarkistettu Verohallinnon tarkistusmoduulilla eikä
 * Ilmoitin.fi:n aineiston tarkastuksella (BLOCKERS 13).
 */

export interface Vsy002Spec {
  year: number;
  recordId: string;
  version: string;
  published: string;
  /** Tarkistusten numerot vuoden tietuekuvauksessa: tulot, menot ja tasausvaraus. */
  checks: { income: string; expense: string; reserve: string };
  /** Tunnukset, joita vuoden tietuekuvauksessa ei ole. */
  removed: string[];
}

export const VSY002_SPECS: Record<number, Vsy002Spec> = {
  2025: { year: 2025, recordId: "VSY00225", version: "1.0", published: "2025-09-23", checks: { income: "#1987", expense: "#1988", reserve: "#1989" }, removed: [] },
  2026: {
    year: 2026, recordId: "VSY00226", version: "1.0", published: "2026-09-22", checks: { income: "#2045", expense: "#2046", reserve: "#2047" },
    // Korotettujen poistojen erittely poistui verovuodesta 2026 (tietuekuvaus 2026, luku 6).
    removed: ["364", "365", "366", "367", "581", "368", "584"],
  },
};

/** Tunnusten muoto tietuekuvauksessa: prosentti +D3,2, kokonaisluku tai valinta, muuten rahamäärä R13,2. */
const PERCENT = new Set(["413", "414", "415", "416"]);
const INTEGER = new Set(["418", "281", "534", "516", "287", "288", "401", "406", "411"]);

export interface Field2 {
  code: string;
  label: string;
  value: number;
}

export interface Computed2 {
  spec: Vsy002Spec;
  fields: Field2[];
  /** Ei maataloutta tänä vuonna: tiedostoon 967:1 (lomake on annettava silti). */
  empty: boolean;
  errors: string[];
  warnings: string[];
}

/** Lomakkeen 2 kentät tiedoston järjestyksessä ja tarkistukset ennen latausta. */
export function compute2(form: Form2Result): Computed2 {
  const spec = VSY002_SPECS[form.year];
  if (!spec) throw new Error(`Lomakkeen 2 tietuekuvausta vuodelle ${form.year} ei ole`);
  const errors = [...form.errors];
  const warnings = [...form.warnings];
  const unknown = Object.keys(form.fields).filter((c) => !FORM2_ORDER.includes(c) || spec.removed.includes(c));
  for (const c of unknown) errors.push(`Kenttää ${c} ei ole vuoden ${form.year} lomakkeella 2.`);
  // Laskennan pitäisi aina täsmätä; tarkistetaan silti samoilla kaavoilla kuin Verohallinto.
  const v = (c: string) => form.fields[c] ?? 0;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const income = ["210", "212", "213", "214", "215", "216", "217", "218", "219", "220", "221", "222", "224", "322", "326", "328"].reduce((s, c) => s + v(c), 0);
  if (!near(income, v("332"))) errors.push(`Tulot yhteensä ei täsmää (tarkistus ${spec.checks.income}).`);
  const expense = ["225", "226", "228", "229", "230", "231", "232", "465", "464"].reduce((s, c) => s + v(c), 0);
  if (!near(expense, v("357"))) errors.push(`Menot yhteensä ei täsmää (tarkistus ${spec.checks.expense}).`);
  if (!near(v("332") - v("357"), v("362") - v("363"))) errors.push("Tulos ei täsmää tuloihin ja menoihin (tarkistus #1450).");
  if (v("362") && v("363")) errors.push("Vain tulos tai tappio voi olla annettu (tarkistus #880).");
  if (v("232") && !v("172")) errors.push(`Verovuodelta tehty tasausvaraus vaatii purkamattoman tasausvarauksen (tarkistus ${spec.checks.reserve}).`);
  if (v("735") && v("736")) errors.push("Vain positiivinen tai negatiivinen nettovarallisuus voi olla annettu (tarkistus #992).");
  if (form.fields["413"] !== undefined && !near(v("413") + v("414"), 100)) errors.push("Puolisoiden osuudet nettovarallisuudesta eivät ole yhteensä 100 % (tarkistus #38).");
  if (form.fields["415"] !== undefined && !near(v("415") + v("416"), 100)) errors.push("Puolisoiden osuudet työskentelystä eivät ole yhteensä 100 % (tarkistus #39).");
  if (v("327") && v("328") < v("327") * 0.25 - 0.005) warnings.push("Osuuskunnan ylijäämän veronalainen osuus on alle 25 % (huomautus #1322).");

  const fields = FORM2_ORDER.filter((c) => form.fields[c] !== undefined && !spec.removed.includes(c)).map((code) => ({ code, label: form2Label(code, form.year), value: form.fields[code] }));
  return { spec, fields, empty: form.empty, errors, warnings };
}

/** Prosentti muodossa +D3,2: kaksi desimaalia pilkulla, ei etumerkkiä. */
export function formatPercent(n: number): string {
  if (n < 0 || n > 100) throw new Error("Prosentti ei ole välillä 0–100");
  return n.toFixed(2).replace(".", ",");
}

function formatValue(code: string, value: number): string {
  if (PERCENT.has(code)) return formatPercent(value);
  if (INTEGER.has(code)) return String(Math.round(value));
  return formatAmount(value);
}

export interface Render2Input {
  computed: Computed2;
  /** Tunnus 010: Y-tunnus tai henkilötunnus (sama kuin 2C:ssä). */
  filerId: string;
  software: { name: string; id: string };
  createdAt: Date;
  contact?: { name: string | null; email: string | null; phone: string | null };
}

/** Lomakkeen 2 tietue tunnus:tieto-muodossa, rivinvaihto CRLF. Tunnisteet tarkistetaan ennen tätä. */
export function render2(input: Render2Input): string {
  const { computed } = input;
  const lines: string[] = [];
  const add = (code: string, value: string) => lines.push(`${code}:${value}`);
  add("000", computed.spec.recordId);
  add("198", timestamp198(input.createdAt));
  // 045 (välityspalvelun tunnus) jätetään pois kuten 2C:ssä: sen lisää välittävä palvelu.
  add("048", toLatin1Text(input.software.name, 35));
  add("014", input.software.id);
  add("010", input.filerId);
  if (computed.empty) {
    // Lomake on annettava, vaikka maataloutta ei ollut; silloin vain 967 ja yhteystiedot (#1445).
    add("967", "1");
  } else {
    for (const f of computed.fields) add(f.code, formatValue(f.code, f.value));
  }
  if (input.contact?.name) add("041", toLatin1Text(input.contact.name, 140));
  if (input.contact?.email) add("044", toLatin1Text(input.contact.email, 140));
  if (input.contact?.phone) add("042", toLatin1Text(input.contact.phone, 35));
  add("999", "1");
  return lines.join("\r\n") + "\r\n";
}
