/**
 * Odotettujen kirjausten takautuva koe: ennustetaan vuosi (oletus 2025) sitä
 * edeltävien vuosien kirjauksista ja verrataan vuoden todellisiin kirjauksiin.
 * Vain luku: transaktio on read only. Tulostaa vain määriä ja prosentteja,
 * ei nimiä, selitteitä eikä summia asiakkaittain (CLAUDE.md, henkilötiedot).
 *
 *   npm run odotetut:koe -- [--vuosi 2025] [--tuotanto]
 *
 * Tarkkuus: odotetuista ryhmistä ja kerroista kirjattiin. Kattavuus: vuoden
 * kirjauksista (ilman investointeja) ennustettiin. Summan arvio verrattuna toteutuneeseen.
 */
import { openTargetDb } from "./lib/target-db.mts";
import { expectedStatus, findExpected, matchToEntries, type HistoryEntry } from "../src/lib/ledger/expected.ts";
import { isAssetPurchase, isAssetSale, type Activity, type TransactionKind } from "../src/lib/tax/rules.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = Number(arg("--vuosi") ?? 2025);

interface Row {
  id: string;
  client_id: string;
  vat_registered: boolean;
  tax_year: number;
  booked_on: string;
  category: string;
  kind: TransactionKind;
  activity: Activity;
  description: string;
  amount_gross: string;
  vat_rate: string;
  business_share_pct: string;
  other_share_pct: string;
  farm_id: string | null;
  forest_property_id: string | null;
}

const db = await openTargetDb(args);
try {
  const rows = await db.asService(async (tx) => {
    await tx.query("set transaction read only");
    return tx.query<Row>(
      `select t.id, t.client_id, c.vat_registered, t.tax_year, t.booked_on::text, t.category, t.kind, t.activity, t.description, t.amount_gross, t.vat_rate,
              t.business_share_pct, t.other_share_pct, t.farm_id, t.forest_property_id
         from sk_transactions t join sk_clients c on c.id = t.client_id
        where t.tax_year between $1 and $2`,
      [target - 5, target],
    );
  });
  const byClient = new Map<string, Row[]>();
  for (const r of rows) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);
  const toEntry = (r: Row): HistoryEntry & { id: string } => ({
    id: r.id, year: Number(r.tax_year), bookedOn: r.booked_on, category: r.category, kind: r.kind, activity: r.activity, description: r.description ?? "",
    amountGross: Number(r.amount_gross), vatRate: Number(r.vat_rate), businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct),
    farmId: r.farm_id, forestPropertyId: r.forest_property_id,
  });
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "–");

  const variants = [
    { name: "oletus: 2/3 vuotta, selite 0,5, summa ±20 %", lookbackYears: 3, minYears: 2, threshold: 0.5, amountTolerance: 0.2, historyFrom: target - 3 },
    { name: "vain selite: 2/3 vuotta, selite 0,5", lookbackYears: 3, minYears: 2, threshold: 0.5, amountTolerance: 0, historyFrom: target - 3 },
    { name: "summa ±10 %", lookbackYears: 3, minYears: 2, threshold: 0.5, amountTolerance: 0.1, historyFrom: target - 3 },
    { name: "summa ±30 %", lookbackYears: 3, minYears: 2, threshold: 0.5, amountTolerance: 0.3, historyFrom: target - 3 },
    { name: "tiukka: 3/3 vuotta", lookbackYears: 3, minYears: 3, threshold: 0.5, historyFrom: target - 3 },
    { name: "väljä selite 0,34", lookbackYears: 3, minYears: 2, threshold: 0.34, historyFrom: target - 3 },
    { name: "tiukka selite 0,67", lookbackYears: 3, minYears: 2, threshold: 0.67, historyFrom: target - 3 },
    { name: "toinen vuosi: vain edellinen vuosi", lookbackYears: 1, minYears: 1, threshold: 0.5, historyFrom: target - 1 },
  ];

  console.log(`Ennustettava vuosi ${target}. Asiakkaita, joilla kirjauksia: ${byClient.size}. Kirjauksia yhteensä ${rows.length}.`);
  for (const v of variants) {
    let clients = 0, entries = 0, entriesHit = 0, inst = 0, instBooked = 0, actual = 0, actualMatched = 0, absActual = 0, absMatched = 0;
    const errors: number[] = [];
    const conf = { high: [0, 0], medium: [0, 0], low: [0, 0] } as Record<string, [number, number]>;
    for (const list of byClient.values()) {
      const history = list.filter((r) => Number(r.tax_year) >= v.historyFrom && Number(r.tax_year) < target).map(toEntry);
      const current = list.filter((r) => Number(r.tax_year) === target && !isAssetPurchase(r.category) && !isAssetSale(r.category)).map(toEntry);
      if (!history.length || !current.length) continue;
      clients++;
      const exp = findExpected(history, { year: target, vatRegistered: list[0].vat_registered, ...v });
      const tol = "amountTolerance" in v ? v.amountTolerance : undefined;
      const st = expectedStatus(exp, current, { year: target, today: `${target + 1}-01-01`, threshold: v.threshold, amountTolerance: tol });
      const matched = matchToEntries(exp, current, v.threshold, tol);
      const matchedIds = new Set([...matched.values()].flat().map((t) => t.id));
      entries += st.length;
      for (const s of st) {
        if (s.booked) entriesHit++;
        conf[s.confidence][0]++;
        if (s.booked) conf[s.confidence][1]++;
        inst += s.states.length;
        instBooked += s.booked;
        for (const x of s.states) if (x.amount !== null && x.amount !== 0) errors.push(Math.abs(x.amount - s.estimate) / Math.abs(x.amount));
      }
      actual += current.length;
      actualMatched += current.filter((t) => matchedIds.has(t.id)).length;
      absActual += current.reduce((a, t) => a + Math.abs(t.amountGross), 0);
      absMatched += current.filter((t) => matchedIds.has(t.id)).reduce((a, t) => a + Math.abs(t.amountGross), 0);
    }
    errors.sort((a, b) => a - b);
    const med = errors.length ? errors[Math.floor(errors.length / 2)] : 0;
    console.log(`\n${v.name}`);
    console.log(`  asiakkaita ${clients}, odotettuja ryhmiä ${entries}, kertoja ${inst}`);
    console.log(`  tarkkuus: ryhmistä toteutui ${pct(entriesHit, entries)}, kerroista kirjattiin ${pct(instBooked, inst)}`);
    console.log(`  kattavuus: vuoden kirjauksista ennustettiin ${pct(actualMatched, actual)} (${actualMatched}/${actual}), euroista ${pct(absMatched, absActual)}`);
    console.log(`  luotettavuus: korkea ${pct(conf.high[1], conf.high[0])} (${conf.high[0]}), keskitaso ${pct(conf.medium[1], conf.medium[0])} (${conf.medium[0]}), heikko ${pct(conf.low[1], conf.low[0])} (${conf.low[0]})`);
    console.log(`  summan arvio: mediaanivirhe ${(100 * med).toFixed(1)} %, ±20 %:n sisällä ${pct(errors.filter((e) => e <= 0.2).length, errors.length)}`);
  }
} finally {
  await db.close();
}
