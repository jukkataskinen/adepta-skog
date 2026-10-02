import { describe, expect, it } from "vitest";
import { agriDepreciation, type AgriAssetInput } from "@/lib/tax/agri-depreciation";

/** Maatalouden ryhmäpoistot (lomake 2: 240–277, 511–527, 2025: 364–584). */

const asset = (over: Partial<AgriAssetInput>): AgriAssetInput => ({
  id: "a1", description: "Koneet", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2025-03-01", acquisitionCost: 0,
  openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null, ...over,
});
const machinesPrior = asset({ id: "m", acquiredOn: "2024-12-31", acquisitionCost: 80000, openingYear: 2025, openingBookValue: 40000 });

describe("ryhmän menojäännös ja poisto", () => {
  it("aiempi menojäännös 40 000 €: enintään 25 %, loppu siirtyy seuraavaan vuoteen", () => {
    const y25 = agriDepreciation([machinesPrior], [], [], 2025, { agri_machinery: 10000 });
    expect(y25.pools).toEqual([expect.objectContaining({ pool: "agri_machinery", start: 40000, additions: 0, base: 40000, max: 10000, depreciation: 10000, end: 30000 })]);
    const y26 = agriDepreciation([machinesPrior], [], [{ taxYear: 2025, pool: "agri_machinery", amount: 10000 }], 2026);
    expect(y26.pools[0]).toMatchObject({ start: 30000, max: 7500, depreciation: 0, recorded: null, end: 30000 });
  });

  it("valinta rajataan enimmäismäärään", () => {
    const r = agriDepreciation([machinesPrior], [], [], 2025, { agri_machinery: 99999 });
    expect(r.total).toBe(10000);
  });

  it("uusi kone 2025: korotettu poisto 50 % omana ryhmänään, vuonna 2026 koneisiin", () => {
    const tractor = asset({ id: "t", accelerated: true, acquiredOn: "2025-04-01", acquisitionCost: 50000 });
    const y25 = agriDepreciation([machinesPrior, tractor], [], [], 2025, { agri_machinery_accelerated: 25000 });
    expect(y25.pools.find((p) => p.pool === "agri_machinery_accelerated")).toMatchObject({ pct: 50, additions: 50000, max: 25000, end: 25000, priorCost: 0 });
    const recorded = [
      { taxYear: 2025, pool: "agri_machinery" as const, amount: 10000 },
      { taxYear: 2025, pool: "agri_machinery_accelerated" as const, amount: 25000 },
    ];
    const y26 = agriDepreciation([machinesPrior, tractor], [], recorded, 2026);
    expect(y26.pools.map((p) => p.pool)).toEqual(["agri_machinery"]);
    expect(y26.pools[0]).toMatchObject({ start: 55000, pct: 25, max: 13750 });
  });

  it("korotetun ryhmän aiempien vuosien hankintamenot (364)", () => {
    const old = asset({ id: "o", accelerated: true, acquiredOn: "2023-05-01", acquisitionCost: 30000, openingYear: 2025, openingBookValue: 7500 });
    const r = agriDepreciation([old], [], [], 2025);
    expect(r.pools[0]).toMatchObject({ pool: "agri_machinery_accelerated", start: 7500, priorCost: 30000 });
  });
});

describe("myynti, tuet ja tasausvaraus", () => {
  it("myyntihinta vähennetään menojäännöksestä, ylittävä osa on tuloa", () => {
    const sold = asset({ id: "s", acquiredOn: "2024-12-31", openingYear: 2025, openingBookValue: 500, disposedOn: "2025-06-01", salePrice: 2000 });
    const r = agriDepreciation([sold], [], [], 2025);
    expect(r.pools[0]).toMatchObject({ sales: 2000, base: 0, max: 0, excess: 1500 });
    expect(r.excess).toBe(1500);
  });

  it("investointituki ja käytetty tasausvaraus pienentävät pohjaa", () => {
    const barn = asset({ id: "b", assetClass: "agri_production_building", acquiredOn: "2025-02-01", acquisitionCost: 200000 });
    const r = agriDepreciation(
      [barn],
      [
        { assetId: "b", taxYear: 2025, kind: "grant", amount: 80000 },
        { assetId: "b", taxYear: 2025, kind: "equalization", amount: 10000 },
      ],
      [],
      2025,
    );
    expect(r.pools[0]).toMatchObject({ pool: "agri_production_building", additions: 200000, grants: 80000, equalization: 10000, base: 110000, max: 11000 });
  });

  it("pieni menojäännös poistetaan kerralla: koneet 1 200 €, salaojilla rajaa ei ole", () => {
    const small = asset({ id: "k", acquiredOn: "2024-12-31", openingYear: 2025, openingBookValue: 1100 });
    expect(agriDepreciation([small], [], [], 2025).pools[0]).toMatchObject({ smallBalance: true, max: 1100 });
    const drain = asset({ id: "d", assetClass: "agri_drainage", acquiredOn: "2024-12-31", openingYear: 2025, openingBookValue: 800 });
    expect(agriDepreciation([drain], [], [], 2025).pools[0]).toMatchObject({ smallBalance: false, max: 160 });
  });

  it("ilman investointeja tulos on tyhjä", () => {
    expect(agriDepreciation([], [], [], 2025)).toEqual({ year: 2025, pools: [], total: 0, excess: 0 });
  });
});
