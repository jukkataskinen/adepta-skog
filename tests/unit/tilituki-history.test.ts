import { describe, expect, it } from "vitest";
import { buildCardHistory, buildForestHistory, cardKind, tilitukiEndOf } from "@/lib/import/tilituki/history";
import type { TtMachine, TtMachineYear } from "@/lib/import/tilituki/map";
import { forestAssetHistory, agriPoolHistory } from "@/lib/assets/history";
import { checkForest, skogEndOf, type SkogForestAsset } from "@/lib/compare/tilituki-history";
import type { HistoryAsset } from "@/lib/import/tilituki/history";

/**
 * Tilitukin kalustokorttien historia (KALUSTO + KALUSPOI) kuvitteellisilla
 * korteilla: useita poistovuosia, täysi poisto, myynti, rakennus ja kortti,
 * jonka historia alkaa hankinnan jälkeen.
 */

const yr = (start: number, depreciation: number, p: Partial<TtMachineYear> = {}): TtMachineYear => {
  const additions = p.additions ?? 0;
  const disposals = p.disposals ?? 0;
  const base = start + additions - disposals;
  return { pct: 25, start, additions, disposals, base, depreciation, end: Math.round((base - depreciation) * 100) / 100, ...p };
};

const card = (id: string, p: Partial<TtMachine>): TtMachine => ({
  id, name: `Kortti ${id}`, type: "Kone", source: "METSÄTALOUS", acquiredOn: null, cost: 0, maxPct: 25, years: {}, ...p,
});

/** Skogin investointi tuodusta historiasta, kuten run.ts kirjoittaa sen. */
const asSkog = (h: HistoryAsset): SkogForestAsset => ({
  legacyId: h.legacyId,
  input: {
    acquiredOn: h.acquiredOn, acquisitionCost: h.acquisitionCost, method: "declining_balance", usefulLifeYears: null, decliningRatePct: h.ratePct,
    openingBookValue: h.openingBookValue, openingYear: h.openingYear, disposedOn: h.disposedOn, salePrice: h.salePrice,
  },
  recorded: h.depreciations,
});

describe("kalustokortin historia", () => {
  it("kone, jolla useita poistovuosia: tavallinen investointi hankintavuodesta", () => {
    const h = buildCardHistory("900", card("1", {
      acquiredOn: "2021-05-10",
      years: { "2021": yr(0, 1000, { additions: 4000 }), "2022": yr(3000, 750), "2023": yr(2250, 562.5), "2024": yr(1687.5, 421.88) },
    }))!;
    expect(h).toMatchObject({ kind: "machinery", ratePct: 25, acquiredOn: "2021-05-10", acquisitionCost: 4000, openingYear: null, disposedOn: null });
    expect(h.depreciations.map((d) => [d.taxYear, d.amount, d.bookValueEnd])).toEqual([[2021, 1000, 3000], [2022, 750, 2250], [2023, 562.5, 1687.5], [2024, 421.88, 1265.62]]);
    const s = asSkog(h);
    expect([2021, 2022, 2023, 2024].map((y) => skogEndOf(s, y))).toEqual([3000, 2250, 1687.5, 1265.62]);
    expect(checkForest([h], [s], [2022, 2023, 2024]).every((c) => c.ok)).toBe(true);
    const view = forestAssetHistory(s.input, s.recorded);
    expect(view).toMatchObject({ latest: { year: 2024, end: 1265.62 }, accumulated: 2734.38, status: "open" });
    expect(view.rows[0]).toEqual({ year: 2021, start: 4000, depreciation: 1000, end: 3000 });
  });

  it("täysi poisto: arvo nolla poistovuoden jälkeen, eikä seuraavalle vuodelle tule poistoa", () => {
    const h = buildCardHistory("900", card("2", {
      acquiredOn: "2023-12-31", cost: 300,
      years: { "2023": yr(300, 0, { pct: 0 }), "2024": yr(300, 300, { pct: 100 }), "2025": yr(0, 0, { pct: 0 }) },
    }))!;
    expect(h).toMatchObject({ acquisitionCost: 300, openingYear: null, lastEnd: 0 });
    const s = asSkog(h);
    expect([2023, 2024, 2025].map((y) => skogEndOf(s, y))).toEqual([300, 0, 0]);
    const view = forestAssetHistory(s.input, s.recorded);
    expect(view).toMatchObject({ latest: { year: 2025, end: 0 }, accumulated: 300, status: "fully_depreciated" });
  });

  it("myynti: myyntivuodelta ei poistoriviä, myyntihinta ja erotus talteen", () => {
    const h = buildCardHistory("900", card("3", {
      acquiredOn: "2018-03-30",
      years: { "2018": yr(0, 500, { additions: 2000 }), "2019": yr(1500, 375), "2020": yr(1125, 0, { disposals: 1500 }), "2021": yr(0, 0) },
    }))!;
    expect(h).toMatchObject({ disposedOn: "2020-12-31", salePrice: 1500, lastEnd: -375 });
    expect(h.depreciations.map((d) => d.taxYear)).toEqual([2018, 2019]);
    const s = asSkog(h);
    const check = checkForest([h], [s], [2020]);
    expect(check[0]).toMatchObject({ tilituki: -375, skog: 0, ok: true });
    const view = forestAssetHistory(s.input, s.recorded);
    expect(view.status).toBe("sold");
    expect(view.rows[view.rows.length - 1]).toMatchObject({ year: 2020, start: 1125, sold: true, salePrice: 1500 });
  });

  it("rakennus ja tie: laji kortin tyypistä", () => {
    expect(cardKind("Rakennus")).toEqual({ kind: "building", ratePct: 10 });
    expect(cardKind("Oja/Tie")).toEqual({ kind: "road", ratePct: 15 });
    expect(cardKind("Kone")).toEqual({ kind: "machinery", ratePct: 25 });
    const h = buildCardHistory("900", card("4", { type: "Rakennus", acquiredOn: "2010-06-01", cost: 5000, years: { "2015": yr(3000, 300, { pct: 10 }), "2016": yr(2700, 270, { pct: 10 }) } }))!;
    // Historia alkaa hankinnan jälkeen: aiempi investointi, jonka lähtöarvo on ensimmäisen vuoden alun menojäännös.
    expect(h).toMatchObject({ kind: "building", ratePct: 10, acquisitionCost: 5000, openingYear: 2015, openingBookValue: 3000, openingAccumulated: 2000 });
    const s = asSkog(h);
    expect(skogEndOf(s, 2016)).toBe(2430);
    expect(skogEndOf(s, 2017)).toBe(2430);
  });

  it("vuosi ilman Tilitukin laskentaa saa nollapoiston ja ketju jatkuu", () => {
    const h = buildCardHistory("900", card("5", { acquiredOn: "2019-01-01", years: { "2019": yr(0, 1000, { additions: 4000 }), "2022": yr(3000, 750) } }))!;
    expect(h.years.filter((y) => y.gap).map((y) => y.year)).toEqual([2020, 2021]);
    expect(h.depreciations.map((d) => [d.taxYear, d.amount, d.bookValueEnd])).toEqual([[2019, 1000, 3000], [2020, 0, 3000], [2021, 0, 3000], [2022, 750, 2250]]);
    expect(tilitukiEndOf(h, 2021)).toBe(3000);
    expect(h.notes).toContain("vuosi ilman Tilitukin laskentaa (nollapoisto)");
  });

  it("ohittaa tyhjät kortit ja muun kuin metsätalouden kaluston", () => {
    const list = buildForestHistory("900", [
      card("6", { years: { "2020": yr(0, 0) } }),
      card("7", { source: "MAATALOUS", years: { "2020": yr(100, 25) } }),
      card("8", { years: { "2020": yr(100, 25) } }),
    ]);
    expect(list.map((h) => h.cardId)).toEqual(["8"]);
    // Ilman ostopäivää kortti, jolla on arvoa jo ensimmäisen vuoden alussa, on hankittu ennen sitä.
    expect(list[0]).toMatchObject({ acquiredOn: "2019-12-31", openingYear: 2020, openingBookValue: 100 });
  });
});

describe("maatalouden poistoryhmän historia", () => {
  it("ketju aloitusarvosta kirjattujen poistojen kautta", () => {
    const pools = agriPoolHistory({
      assets: [
        { id: "a", description: "Koneet", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2022-12-31", acquisitionCost: 10000, openingYear: 2023, openingBookValue: 10000, disposedOn: null, salePrice: null },
        { id: "b", description: "Uusi", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2024-06-01", acquisitionCost: 2000, openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null },
      ],
      adjustments: [],
      recorded: [
        { taxYear: 2023, pool: "agri_machinery", amount: 2500 },
        { taxYear: 2024, pool: "agri_machinery", amount: 2375 },
      ],
    });
    expect(pools).toHaveLength(1);
    expect(pools[0].rows.map((r) => [r.year, r.start, r.additions, r.depreciation, r.end])).toEqual([[2023, 10000, 0, 2500, 7500], [2024, 7500, 2000, 2375, 7125]]);
    expect(pools[0].latest).toEqual({ year: 2024, end: 7125 });
  });
});
