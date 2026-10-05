/**
 * Tiliöintiehdotusten takautuva koe (DECISIONS 6.10.2026): vuoden (oletus 2025)
 * jokaiselle kirjaukselle haetaan ehdotus pelkästä selitteestä ja summasta
 * aiempien vuosien kirjauksista, ja ehdotusta verrataan kirjauksen todelliseen
 * tiliöintiin. Vain luku: transaktio on read only. Tulostaa vain määriä ja
 * prosentteja, ei nimiä, selitteitä eikä summia (CLAUDE.md, henkilötiedot).
 *
 *   npm run tiliointi:koe -- [--vuosi 2025] [--tuotanto]
 *
 * Kattavuus: montako kirjausta sai ehdotuksen. Osuma: luokka, alv, osuus,
 * toisen toiminnon osuus ja kaikki yhdessä (myös tyyppi ja maatila). Vahva:
 * ehdotukset, jotka tunnistuksessa ohittavat tekoälyn luokan.
 */
import { openTargetDb } from "./lib/target-db.mts";
import {
  buildPostingMemory,
  POSTING_DEFAULTS,
  suggestPosting,
  type PostingEntry,
  type PostingMemory,
  type PostingOptions,
  type PostingSuggestion,
} from "../src/lib/ledger/posting-memory.ts";
import { categoryActivity, isAssetPurchase, isAssetSale, type TransactionKind } from "../src/lib/tax/rules.ts";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = Number(arg("--vuosi") ?? 2025);

interface Row {
  organization_id: string;
  client_id: string;
  tax_year: number;
  booked_on: string;
  category: string;
  kind: TransactionKind;
  description: string | null;
  reference: string | null;
  amount_gross: string;
  vat_rate: string;
  business_share_pct: string;
  other_share_pct: string;
  farm_id: string | null;
}

const db = await openTargetDb(args);
try {
  const rows = await db.asService(async (tx) => {
    await tx.query("set transaction read only");
    return tx.query<Row>(
      `select organization_id, client_id, tax_year, booked_on::text, category, kind, description, reference, amount_gross, vat_rate,
              business_share_pct, other_share_pct, farm_id
         from sk_transactions where tax_year <= $1`,
      [target],
    );
  });
  const toEntry = (r: Row): PostingEntry => ({
    clientId: r.client_id, bookedOn: r.booked_on, category: r.category, kind: r.kind, description: r.description ?? "", reference: r.reference,
    amountGross: Number(r.amount_gross), vatRate: Number(r.vat_rate), businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct),
    farmId: r.farm_id,
  });
  const byClient = new Map<string, Row[]>();
  for (const r of rows) byClient.set(r.client_id, [...(byClient.get(r.client_id) ?? []), r]);
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "–");

  type Case = { actual: PostingEntry; own: PostingSuggestion | null; office: PostingSuggestion | null };
  const run = (fromYear: number, opts: Partial<PostingOptions> = {}) => {
    const cases: Case[] = [];
    for (const [clientId, list] of byClient) {
      const current = list.filter((r) => Number(r.tax_year) === target && !isAssetPurchase(r.category) && !isAssetSale(r.category));
      if (!current.length) continue;
      const history = list.filter((r) => Number(r.tax_year) < target && Number(r.tax_year) >= fromYear).map(toEntry);
      const own = buildPostingMemory(history, "client");
      const org = list[0].organization_id;
      // Toimiston muisti: saman organisaation muut asiakkaat, samat vuodet.
      const officeRows = rows.filter((r) => r.organization_id === org && r.client_id !== clientId && Number(r.tax_year) < target && Number(r.tax_year) >= fromYear);
      let office: PostingMemory | null = null;
      for (const r of current) {
        const e = toEntry(r);
        const q = { description: e.description, amountGross: e.amountGross, date: e.bookedOn };
        const o = suggestPosting(own, q, opts).best;
        let f: PostingSuggestion | null = null;
        if (!o) {
          office ??= buildPostingMemory(officeRows.map(toEntry), "office");
          f = suggestPosting(office, q, opts).best;
        }
        cases.push({ actual: e, own: o, office: f });
      }
    }
    return cases;
  };

  const hit = (s: PostingSuggestion, a: PostingEntry) => {
    const cat = s.category === a.category;
    const vat = s.vatRate === a.vatRate;
    const share = s.businessSharePct === a.businessSharePct;
    const other = s.otherSharePct === a.otherSharePct;
    const all = cat && vat && share && other && s.kind === a.kind && (s.farmId ?? null) === (a.farmId ?? null);
    return { cat, vat, share, other, all };
  };

  const report = (name: string, cases: Case[]) => {
    const n = cases.length;
    const withOwn = cases.filter((c) => c.own);
    const withOffice = cases.filter((c) => c.office);
    const count = (list: Case[], k: keyof ReturnType<typeof hit>, pick: (c: Case) => PostingSuggestion | null) =>
      list.filter((c) => hit(pick(c)!, c.actual)[k]).length;
    console.log(`\n${name}`);
    console.log(`  kirjauksia ${n}, joista ehdotus asiakkaan omasta historiasta ${pct(withOwn.length, n)} (${withOwn.length}), toimistosta lisäksi ${pct(withOffice.length, n)} (${withOffice.length})`);
    for (const [label, list, pick] of [
      ["oma historia", withOwn, (c: Case) => c.own],
      ["toimiston muut asiakkaat", withOffice, (c: Case) => c.office],
    ] as const) {
      if (!list.length) continue;
      console.log(
        `  ${label}: luokka ${pct(count(list, "cat", pick), list.length)}, alv ${pct(count(list, "vat", pick), list.length)}, osuus ${pct(count(list, "share", pick), list.length)}, ` +
          `toinen ${pct(count(list, "other", pick), list.length)}, kaikki ${pct(count(list, "all", pick), list.length)}`,
      );
    }
    const strong = withOwn.filter((c) => c.own!.strong);
    console.log(
      `  vahvat (oletusrajat): ${strong.length} = ${pct(strong.length, n)} kirjauksista; oikein: luokka ${pct(count(strong, "cat", (c) => c.own), strong.length)}, kaikki ${pct(count(strong, "all", (c) => c.own), strong.length)}`,
    );
    const weak = withOwn.filter((c) => !c.own!.strong);
    console.log(`  heikot: ${weak.length}; oikein: luokka ${pct(count(weak, "cat", (c) => c.own), weak.length)}, kaikki ${pct(count(weak, "all", (c) => c.own), weak.length)}`);
    // Toiminnoittain (vain määrät).
    for (const act of ["forestry", "agriculture"] as const) {
      const l = withOwn.filter((c) => categoryActivity(c.actual.category) === act);
      if (l.length) console.log(`  ${act === "forestry" ? "metsätalous" : "maatalous"}: ${l.length} ehdotusta, kaikki oikein ${pct(count(l, "all", (c) => c.own), l.length)}`);
    }
    return withOwn;
  };

  console.log(`Koevuosi ${target}. Asiakkaita ${byClient.size}, kirjauksia (kaikki vuodet) ${rows.length}.`);
  report(`Historia ${target - 3}–${target - 1}`, run(target - 3));
  const all = run(0);
  const withOwn = report(`Koko historia (–${target - 1})`, all);

  // Haun rajat: kattavuus ja osuma (kaikki yhdessä) koko historialla.
  console.log("\nHaun rajat (koko historia): samankaltaisuus / puoliintumisaika / summan paino → ehdotuksia, kaikki oikein");
  for (const minSimilarity of [0.34, 0.5, 0.67])
    for (const halfLifeYears of [1.5, 3, 6])
      for (const amountBoost of [1, 1.5, 3]) {
        const cs = run(0, { minSimilarity, halfLifeYears, amountBoost }).filter((c) => c.own);
        const ok = cs.filter((c) => hit(c.own!, c.actual).all).length;
        console.log(`  ${minSimilarity} / ${halfLifeYears} / ${amountBoost}: ${pct(cs.length, all.length)}, ${pct(ok, cs.length)}`);
      }
  // Osuma samankaltaisuuden mukaan.
  for (const [lo, hi] of [[0.5, 0.67], [0.67, 0.99], [0.99, 1.01]]) {
    const cs = withOwn.filter((c) => c.own!.similarity >= lo && c.own!.similarity < hi);
    console.log(`  samankaltaisuus ${lo}–${hi}: ${cs.length}, kaikki oikein ${pct(cs.filter((c) => hit(c.own!, c.actual).all).length, cs.length)}`);
  }

  // Vahvan rajan säätö: kaikki yhdessä oikein vähintään 90 %, kattavuus mahdollisimman suuri.
  console.log("\nVahvan ehdotuksen rajat (koko historia): agreement / samankaltaisuus / vähintään kertoja / enintään vuotta vanha → vahvoja, oikein (kaikki), oikein (luokka)");
  const grid: Partial<PostingOptions>[] = [];
  for (const strongAgreement of [0.6, 0.7, 0.8, 0.9, 1])
    for (const strongSimilarity of [0.5, 0.75, 1])
      for (const strongCount of [1, 2, 3, 4])
        for (const strongMaxAgeYears of [1, 2, 4, 99]) grid.push({ strongAgreement, strongSimilarity, strongCount, strongMaxAgeYears });
  const results = grid.map((g) => {
    const o = { ...POSTING_DEFAULTS, ...g };
    const strong = withOwn.filter((c) => {
      const s = c.own!;
      return s.agreement >= o.strongAgreement && s.similarity >= o.strongSimilarity && s.count >= o.strongCount && target - s.lastYear <= o.strongMaxAgeYears;
    });
    const ok = strong.filter((c) => hit(c.own!, c.actual).all).length;
    const okCat = strong.filter((c) => hit(c.own!, c.actual).cat).length;
    return { g, n: strong.length, acc: strong.length ? ok / strong.length : 0, accCat: strong.length ? okCat / strong.length : 0 };
  });
  const best = results.filter((r) => r.acc >= 0.9).sort((a, b) => b.n - a.n).slice(0, 8);
  for (const r of best) {
    console.log(
      `  ${r.g.strongAgreement} / ${r.g.strongSimilarity} / ${r.g.strongCount} / ${r.g.strongMaxAgeYears}: ${r.n} (${pct(r.n, all.length)}), ${(100 * r.acc).toFixed(1)} %, ${(100 * r.accCat).toFixed(1)} %`,
    );
  }
  if (!best.length) console.log("  Mikään raja ei yltänyt 90 %:iin.");
} finally {
  await db.close();
}
