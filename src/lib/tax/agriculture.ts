import { round2 } from "./amounts";
import {
  category,
  COOP_SURPLUS_HIGH_PCT,
  COOP_SURPLUS_LOW_PCT,
  COOP_SURPLUS_THRESHOLD,
  DIVIDEND_LISTED_TAXABLE_PCT,
  DIVIDEND_OTHER_TAXABLE_PCT,
  LIVESTOCK_DEFERRAL_YEARS,
  vatRateGroup,
  type TransactionKind,
} from "./rules";
import { ACCELERATED_POOL, POOL_FIELDS, type AgriDepreciationResult } from "./agri-depreciation";
import { computeVehicleReport, hasVehicleReport, VEHICLE_CODES, type VehicleReportInput } from "./vehicle";
import { ownShare } from "./share";

/**
 * Maatalouden veroilmoitus (lomake 2) kentittäin. Puhdas funktio: kirjausten
 * maatalouden osat, poistot, varaukset, jaksotukset ja vuoden tiedot sisään,
 * kentät ja tarkistukset ulos. Sama tulos näytetään Maatalous-välilehdellä,
 * veroraportissa ja VSY002-tiedostossa (docs/maatalous-suunnitelma-2026-10-02.md, 1).
 *
 * Maatalouden tulos lasketaan maksuperusteella: kirjauksen päivä ratkaisee
 * vuoden, eikä varastoja oteta huomioon. Tulot ovat aina ilman
 * arvonlisäveroa; menot ilman veroa vain alv-velvolliselle (muuten
 * verollisina, ohje lomakkeeseen 2).
 */

export interface AgriFormRow {
  kind: TransactionKind;
  category: string;
  /** Maatalouden osuus (activityRows): veroton ja verollinen. */
  amountNet: number;
  amountGross: number;
  vatRate: number;
  /** Kirjauksen maatila (0018). Tyhjä = ei tilaa; yhden tilan asiakkaalla kaikki kuuluu sille. */
  farmId?: string | null;
}

/** Aiemman vuoden jaksotettava kotieläinkirjaus kirjanpidosta. */
export interface LedgerDeferral {
  year: number;
  kind: "livestock_sale" | "livestock_purchase";
  amount: number;
}

export interface ManualDeferral {
  year: number;
  kind: "livestock_sale" | "livestock_purchase";
  year1: number;
  year2: number;
  year3: number;
}

export interface ReserveInput {
  kind: "equalization" | "replacement";
  madeYear: number;
  amount: number;
  /** Käytetty vuoden loppuun mennessä (investointiin ja tuloutettu). */
  usedThroughYear: number;
  /** Tuloutettu verovuonna. */
  incomeThisYear: number;
}

export interface AgriYearInput {
  spouseWealthSharePct: number | null;
  spouseWorkSharePct: number | null;
  incomeSplitClaim: "ten" | "earned" | null;
  lossToCapitalIncome: number | null;
  wagesSubjectToWithholding: number;
  landValue: number | null;
  rentalDwellingsValue: number | null;
  sharesValue: number | null;
  otherAssetsValue: number | null;
  liabilities: number | null;
  otherFarmAssets: number | null;
}

export interface Form2Input {
  year: number;
  vatRegistered: boolean;
  rows: AgriFormRow[];
  ledgerDeferrals: LedgerDeferral[];
  manualDeferrals: ManualDeferral[];
  depreciation: AgriDepreciationResult;
  reserves: ReserveInput[];
  agriYear: AgriYearInput;
  extras: { code: string; value: number }[];
  /** Ajoneuvo- ja matkaselvitys (0018). Puuttuva tai tyhjä = kentät käsin syötetyistä (extras). */
  vehicle?: VehicleReportInput | null;
}

export interface Form2Result {
  year: number;
  /** Kentät tunnuksittain. Mukana vain annettavat tiedot (nollat pois, paitsi pakolliset). */
  fields: Record<string, number>;
  income: number;
  expense: number;
  /** Tulos (+) tai tappio (−). */
  result: number;
  depreciation: number;
  /** Lomakkeen tyhjä: ei maataloutta tänä vuonna (967). */
  empty: boolean;
  /** Maatalouden kaluston metsätalouden ajot (284): metsätaloudessa 2C:n kohta 630. */
  forestryTransfer: number;
  errors: string[];
  warnings: string[];
}

const eur = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

/** Tasaerät kolmelle vuodelle senteissä; ensimmäinen vuosi saa pyöristyksen erotuksen. */
export function thirds(amount: number): [number, number, number] {
  const c = Math.round(amount * 100);
  const third = Math.trunc(c / LIVESTOCK_DEFERRAL_YEARS);
  return [(c - 2 * third) / 100, third / 100, third / 100];
}

/**
 * Jaksotettavan kotieläinkirjauksen jaksotus (0018): maatalouden osuus
 * kirjauksesta yhtä suurina erinä verovuodelle ja kahdelle seuraavalle (MVL 5 §
 * ja 6 §). Myynti on aina ilman arvonlisäveroa, hankinta ilman veroa vain
 * alv-velvolliselle, kuten lomakkeen 2 kentissä 211 ja 227.
 */
export function livestockDeferralFor(
  t: { category: string; kind: TransactionKind; amountNet: number; amountGross: number; businessSharePct: number },
  vatRegistered: boolean,
): { kind: "livestock_sale" | "livestock_purchase"; amount: number; split: [number, number, number] } | null {
  const kind = t.category === "agri_livestock_sale_deferred" ? "livestock_sale" : t.category === "agri_livestock_purchase_deferred" ? "livestock_purchase" : null;
  if (!kind) return null;
  const s = ownShare({ kind: t.kind, amountNet: t.amountNet, amountGross: t.amountGross, businessSharePct: t.businessSharePct, otherSharePct: 0 });
  const amount = round2(kind === "livestock_purchase" && !vatRegistered ? s.gross : s.net);
  if (amount <= 0) return null;
  return { kind, amount, split: thirds(amount) };
}

/** Muiden osuuskuntien ylijäämän veronalainen osuus: 25 % 5 000 euroon asti, 75 % sen yli. */
export function coopTaxable(surplus: number): number {
  const low = Math.min(surplus, COOP_SURPLUS_THRESHOLD);
  return round2((low * COOP_SURPLUS_LOW_PCT) / 100 + (Math.max(0, surplus - COOP_SURPLUS_THRESHOLD) * COOP_SURPLUS_HIGH_PCT) / 100);
}

/** Menon kenttä alv-kannan mukaan: rekisteröidyllä rivin kanta, muuten luokan oletus. */
function vatField(row: AgriFormRow, vatRegistered: boolean): "226" | "229" | "230" {
  if (vatRegistered) {
    const g = vatRateGroup(row.vatRate);
    return g === "general" ? "226" : g === "zero" ? "230" : "229";
  }
  const v = category(row.category)?.vat;
  return v === "general" ? "226" : v === "reduced" ? "229" : "230";
}

export function computeForm2(input: Form2Input): Form2Result {
  const { year } = input;
  const f = new Map<string, number>();
  const add = (code: string, v: number) => f.set(code, round2((f.get(code) ?? 0) + v));
  const errors: string[] = [];
  const warnings: string[] = [];
  // Tulot ilman veroa, menot ilman veroa vain alv-velvolliselle.
  const cost = (r: AgriFormRow) => (input.vatRegistered ? r.amountNet : r.amountGross);

  let listed = 0;
  let otherDividends = 0;
  let coop = 0;
  for (const r of input.rows) {
    const c = category(r.category);
    const target = c?.form2;
    if (!c || !target) {
      errors.push(`Luokkaa ${r.category} ei osata viedä lomakkeelle 2.`);
      continue;
    }
    // Tulon tyypiksi käännetty menoluokka (T-näppäin) käsitellään tuloksi muihin tuloihin ja päinvastoin.
    if (r.kind === "income" && c.kind === "expense") {
      add("220", r.amountNet);
      warnings.push(`${c.label}: tulo menoluokassa on viety kohtaan 220. Tarkista luokka.`);
      continue;
    }
    // Menoksi käännetty tuloluokka on meno eikä tulo: ilman tätä se kasvattaisi tuloluokan kenttää.
    // Meno viedään alv-kannan mukaan kohtaan 226, 229 tai 230 kuten muut ostot (vat.ts vähentää sen veron).
    if (r.kind === "expense" && c.kind === "income") {
      add(vatField(r, input.vatRegistered), cost(r));
      warnings.push(`${c.label}: meno tuloluokassa on viety menoihin alv-kannan mukaan. Tarkista luokka.`);
      continue;
    }
    switch (target) {
      case "vat_only":
      case "asset_purchase":
      case "asset_sale":
        // Oma käyttö on vain arvonlisäveroa; investointi ja myynti kulkevat poistoryhmän kautta.
        break;
      case "dividend_listed":
        listed += r.amountNet;
        break;
      case "dividend_other":
        otherDividends += r.amountNet;
        break;
      case "coop_surplus":
        coop += r.amountNet;
        break;
      case "by_vat":
        add(vatField(r, input.vatRegistered), cost(r));
        break;
      case "225":
      case "227":
      case "230":
      case "464":
      case "465":
        add(target, cost(r));
        break;
      default:
        // Tulot: aina ilman arvonlisäveroa.
        add(target, r.amountNet);
    }
  }
  if (listed) {
    add("223", listed);
    add("224", (listed * DIVIDEND_LISTED_TAXABLE_PCT) / 100);
  }
  if (otherDividends) {
    add("321", otherDividends);
    add("322", (otherDividends * DIVIDEND_OTHER_TAXABLE_PCT) / 100);
  }
  if (coop) {
    add("327", coop);
    add("328", coopTaxable(coop));
  }

  // Kotieläinten jaksotus: tämän ja kahden edellisen vuoden jaksotuksista verovuodelle kuuluva osa.
  for (const [kind, code] of [["livestock_sale", "212"], ["livestock_purchase", "228"]] as const) {
    let part = 0;
    for (const d of input.ledgerDeferrals.filter((x) => x.kind === kind && x.year <= year && x.year > year - LIVESTOCK_DEFERRAL_YEARS)) {
      part += thirds(d.amount)[year - d.year];
    }
    for (const d of input.manualDeferrals.filter((x) => x.kind === kind && x.year <= year && x.year > year - LIVESTOCK_DEFERRAL_YEARS)) {
      part += [d.year1, d.year2, d.year3][year - d.year];
      // MVL 5 § ja 6 §: erät ovat yhtä suuret. Sentin pyöristysero sallitaan.
      if (Math.max(d.year1, d.year2, d.year3) - Math.min(d.year1, d.year2, d.year3) > 0.015) {
        warnings.push(`Kotieläinten ${kind === "livestock_sale" ? "myynnin" : "hankinnan"} jaksotus vuodelta ${d.year} ei ole jaettu tasan. Lain mukaan vuosien erät ovat yhtä suuret.`);
      }
    }
    if (part) add(code, part);
  }

  // Varaukset: tuloutus tuloksi, verovuodelta tehty tasausvaraus menoksi.
  for (const r of input.reserves) {
    if (r.incomeThisYear) add(r.kind === "equalization" ? "219" : "220", r.incomeThisYear);
    if (r.kind === "equalization" && r.madeYear === year) add("232", r.amount);
    const remaining = round2(r.amount - r.usedThroughYear);
    if (remaining > 0 && r.madeYear >= year - 2 && r.madeYear <= year) {
      const code = (r.kind === "equalization" ? 170 : 173) + (r.madeYear - (year - 2));
      add(String(code), remaining);
    } else if (remaining > 0 && r.madeYear < year - 2) {
      warnings.push(`${r.kind === "equalization" ? "Tasausvaraus" : "Jälleenhankintavaraus"} vuodelta ${r.madeYear} (${eur(remaining)}) on purkamatta. Se on tuloutettava viimeistään kolmantena vuonna.`);
    }
  }

  // Poistot ryhmittäin. Korotettu ryhmä kuuluu koneisiin (260–265, 511), ja vuonna 2025 se eritellään (364–584).
  const dep = input.depreciation;
  for (const p of dep.pools) {
    const codes = POOL_FIELDS[p.pool === ACCELERATED_POOL ? "agri_machinery" : p.pool];
    add(codes.start, p.start);
    add(codes.add, p.additions);
    add(codes.eq, p.equalization);
    add(codes.sale, p.sales);
    add(codes.grant, p.grants);
    add(codes.dep, p.depreciation);
    add(codes.end, p.end);
    if (p.excess) add("220", p.excess);
    if (p.pool === ACCELERATED_POOL && year <= 2025) {
      add("364", p.priorCost);
      add("365", Math.max(0, p.priorCost - p.start));
      add("366", p.start);
      add("581", p.additions);
      // Poisto jaetaan aiempien ja verovuoden investointien poistopohjien suhteessa. Verovuoden
      // pohja on hankintameno miinus siihen käytetty tasausvaraus ja tuki, jotta täysi 50 %:n
      // poisto jakautuu 367 = 50 % × aiempien pohja ja 368 = 50 % × uusien nettopohja.
      // Myyty kone on tavallisesti aiempi, joten myyntihinta pienentää aiempien pohjaa.
      const oldBase = Math.max(0, p.start - p.sales);
      const newBase = Math.max(0, p.additions - p.equalization - p.grants);
      const old = oldBase + newBase > 0 ? round2((p.depreciation * oldBase) / (oldBase + newBase)) : 0;
      add("367", old);
      add("368", p.depreciation - old);
      add("584", p.depreciation);
    }
  }
  if (dep.excess) warnings.push(`Myyntihinnoista ${eur(dep.excess)} ylittää ryhmän menojäännöksen. Se on viety tuloksi kohtaan 220.`);
  // Loppuarvot annetaan aina, kun ryhmässä on jotain, jotta taulukko on täydellinen (#1424 jne.).
  add("231", dep.total);

  // Ajoneuvo- ja matkaselvitys korvaa samat käsin syötetyt kentät. Tyhjä selvitys ei korvaa mitään.
  const vehicle = hasVehicleReport(input.vehicle ?? null) ? computeVehicleReport(input.vehicle!, year) : null;
  const vehicleCodes = new Set<string>(VEHICLE_CODES);
  const extras = vehicle ? input.extras.filter((x) => !vehicleCodes.has(x.code)) : input.extras;
  if (vehicle && extras.length < input.extras.length) {
    warnings.push("Ajoneuvo- ja matkakentät tulevat selvityksestä. Samat käsin annetut kentät on jätetty pois.");
  }
  const extra = (code: string) => extras.find((x) => x.code === code)?.value ?? 0;
  for (const x of extras) add(x.code, x.value);
  if (vehicle) {
    for (const [code, v] of Object.entries(vehicle.fields)) add(code, v);
    // Lomakkeen alaviitteet: yksityis- ja metsätalouden ajot tuloutetaan (221), lisävähennykset muihin vähennyksiin (464).
    if (vehicle.privateUseIncome) add("221", vehicle.privateUseIncome);
    if (vehicle.additionalDeduction) add("464", vehicle.additionalDeduction);
    errors.push(...vehicle.errors);
    if (vehicle.privateUseIncome && input.rows.some((r) => r.category === "agri_private_use")) {
      warnings.push("Ajoneuvon yksityis- ja metsätalouden ajot on tuloutettu selvityksestä, ja kirjanpidossa on myös Tuloutus yksityiskäytöstä -kirjauksia. Tarkista, ettei sama tuloutus ole kahdesti.");
    }
  }
  const field = (code: string) => f.get(code) ?? 0;

  // Summat ja tulos.
  const sum = (codes: string[]) => round2(codes.reduce((s, c) => s + (f.get(c) ?? 0), 0));
  const income = sum(["210", "212", "213", "214", "215", "216", "217", "218", "219", "220", "221", "222", "224", "322", "326", "328"]);
  const expense = sum(["225", "226", "228", "229", "230", "231", "232", "465", "464"]);
  f.set("332", income);
  f.set("357", expense);
  const result = round2(income - expense);
  // Joko tulos tai tappio annetaan, nollakin käy (#880, #1450).
  if (result >= 0) f.set("362", result);
  else f.set("363", -result);

  const y = input.agriYear;
  if (y.lossToCapitalIncome) {
    if (result >= 0) errors.push("Pääomatuloista vähennettävä tappio on annettu, mutta maatalouden tulos ei ole tappiollinen (tarkistus #392).");
    else if (y.lossToCapitalIncome > -result) errors.push(`Pääomatuloista vähennettävä tappio voi olla enintään maatalouden tappio ${eur(-result)} (tarkistus #392).`);
    else f.set("420", y.lossToCapitalIncome);
  }
  if (y.spouseWealthSharePct !== null && y.spouseWorkSharePct !== null) {
    f.set("413", round2(100 - y.spouseWealthSharePct));
    f.set("414", y.spouseWealthSharePct);
    f.set("415", round2(100 - y.spouseWorkSharePct));
    f.set("416", y.spouseWorkSharePct);
  }
  if (y.incomeSplitClaim) f.set("418", y.incomeSplitClaim === "ten" ? 1 : 2);
  if (y.wagesSubjectToWithholding) f.set("437", y.wagesSubjectToWithholding);

  // Varallisuuslaskelma: rakennusten ja koneiden arvot poistoista, muut syötetyt.
  const buildings = sum(["244", "249", "254", "259"]) + extra("279");
  const machinery = Math.max(0, round2((f.get("265") ?? 0) + extra("278") - extra("280")));
  const other = round2((y.otherAssetsValue ?? 0) + (f.get("271") ?? 0) + (f.get("277") ?? 0));
  const wealth: [string, number][] = [
    ["432", y.landValue ?? 0], ["466", round2(buildings)], ["431", y.rentalDwellingsValue ?? 0], ["467", machinery], ["468", y.sharesValue ?? 0], ["469", other],
  ];
  for (const [code, v] of wealth) if (v) f.set(code, v);
  const assets = round2(wealth.reduce((s, [, v]) => s + v, 0));
  const liabilities = y.liabilities ?? 0;
  if (assets || liabilities) {
    f.set("731", assets);
    f.set("732", liabilities);
    const net = round2(assets - liabilities);
    if (net >= 0) f.set("735", net);
    else f.set("736", -net);
  }
  if (y.otherFarmAssets) f.set("470", y.otherFarmAssets);

  // Harvinaisten kenttien tarkistukset (#826, #827).
  if (!vehicle && (field("282") || field("283") || field("284")) && !field("281")) errors.push("Ajoneuvon kustannukset on annettu, mutta käyttötietojen peruste (281) puuttuu (tarkistus #826).");
  if (!vehicle && field("285") && (!field("287") || !field("288"))) errors.push("Oman auton lisävähennys on annettu, mutta kilometrit (287 ja 288) puuttuvat (tarkistus #827).");
  if (!input.vatRegistered && input.rows.some((r) => r.kind !== "income" && r.amountGross !== r.amountNet)) {
    warnings.push("Asiakas ei ole alv-velvollinen, mutta menoissa on arvonlisäveroa. Menot on viety lomakkeelle verollisina.");
  }

  // Nollat pois, paitsi pakolliset parit (362/363, 735/736) ja ryhmien loppuarvot.
  const keep = new Set(["332", "357", "362", "363", "731", "732", "735", "736", ...Object.values(POOL_FIELDS).map((c) => c.end)]);
  const fields: Record<string, number> = {};
  for (const [code, v] of f) {
    if (v < 0) {
      errors.push(`Kentän ${code} arvo olisi negatiivinen (${eur(v)}). Tarkista kirjaukset.`);
      continue;
    }
    if (v !== 0 || (keep.has(code) && (code !== "362" || result >= 0) && (code !== "363" || result < 0))) fields[code] = v;
  }
  for (const pool of Object.values(POOL_FIELDS)) {
    // Ryhmän loppuarvo vain, jos ryhmässä on jotain.
    const used = [pool.start, pool.add, pool.eq, pool.sale, pool.grant, pool.dep].some((c) => fields[c]);
    if (!used && fields[pool.end] === 0) delete fields[pool.end];
  }
  const meaningful = Object.keys(fields).filter((c) => !["332", "357", "362", "363"].includes(c));
  const empty = meaningful.length === 0 && result === 0;
  return { year, fields, income, expense, result, depreciation: dep.total, empty, forestryTransfer: vehicle?.forestryTransfer ?? 0, errors, warnings };
}
