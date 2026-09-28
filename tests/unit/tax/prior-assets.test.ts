import { describe, expect, it } from "vitest";
import { assetYear, type AssetInput } from "@/lib/tax/depreciation";
import { priorOpening, priorOpeningText } from "@/lib/tax/load";
import { parseAcquired, priorBookValue, validatePriorAsset, type PriorAssetInput } from "@/lib/assets/prior";

/**
 * Aiemmin hankittu investointi (DECISIONS 28.9.2026): menojäännös on vuoden X
 * lopussa, joten poistot lasketaan vuodesta X + 1 alkaen.
 */

// Metsäautotie, menojäännös 31.12.2024: 3 265,60 €.
const road: AssetInput = {
  acquiredOn: "2024-12-31", acquisitionCost: 5000, method: "declining_balance", usefulLifeYears: null, decliningRatePct: 15,
  openingBookValue: 3265.6, openingYear: 2025, disposedOn: null, salePrice: null,
};

describe("aiemman investoinnin poisto", () => {
  it("metsäautotie 15 %: vuoden 2025 enimmäispoisto 489,84 €", () => {
    expect(assetYear(road, [], 2025)).toMatchObject({ active: true, bookValueStart: 3265.6, max: 489.84, smallBalance: false });
  });

  it("ei näy menojäännöksen vuonna eikä sitä aiemmin", () => {
    expect(assetYear(road, [], 2024).active).toBe(false);
    expect(assetYear({ ...road, acquiredOn: "2015-06-01" }, [], 2020).active).toBe(false);
  });

  it("seuraava vuosi jatkuu vahvistetusta poistosta", () => {
    const y = assetYear(road, [{ taxYear: 2025, amount: 489.84, bookValueEnd: 2775.76 }], 2026);
    expect(y).toMatchObject({ bookValueStart: 2775.76, max: 416.36 });
    // Ilman edellisen vuoden loppuarvoa sama tulos poistoista.
    expect(assetYear(road, [{ taxYear: 2025, amount: 489.84, bookValueEnd: 0 }], 2027).bookValueStart).toBe(2775.76);
  });

  it("ennen avausvuotta kirjattu poisto ei pienennä menojäännöstä toiseen kertaan", () => {
    expect(assetYear(road, [{ taxYear: 2024, amount: 500, bookValueEnd: 3265.6 }], 2025).bookValueStart).toBe(3265.6);
  });

  it("kalusto 25 %", () => {
    const trailer: AssetInput = { ...road, acquisitionCost: 8000, openingBookValue: 5000, decliningRatePct: 25 };
    expect(assetYear(trailer, [], 2025)).toMatchObject({ bookValueStart: 5000, max: 1250 });
  });

  it("enintään 600 euron menojäännöksen saa poistaa kerralla", () => {
    expect(assetYear({ ...road, openingBookValue: 550 }, [], 2025)).toMatchObject({ max: 550, smallBalance: true });
  });

  it("vanhasta ohjelmasta tuotu rivi ilman avausvuotta toimii kuten ennen", () => {
    const legacy: AssetInput = { ...road, acquiredOn: "2020-05-01", openingBookValue: 12000, openingYear: null, acquisitionCost: 20000, decliningRatePct: 25 };
    expect(assetYear(legacy, [], 2020)).toMatchObject({ active: true, bookValueStart: 12000 });
    expect(assetYear(legacy, [{ taxYear: 2020, amount: 3000, bookValueEnd: 9000 }], 2021).bookValueStart).toBe(9000);
  });
});

describe("hankintahinta, kertynyt poisto ja menojäännös", () => {
  it("menojäännös lasketaan hankintahinnasta ja kertyneestä poistosta", () => {
    expect(priorBookValue(5000, 1734.4)).toBe(3265.6);
  });

  it("lähtötiedot ja teksti aiemmalle investoinnille", () => {
    const o = priorOpening({ acquisitionCost: 5000, openingBookValue: 3265.6, openingYear: 2025, openingAccumulated: 1734.4 });
    expect(o).toEqual({ year: 2025, accumulated: 1734.4, bookValue: 3265.6 });
    expect(priorOpeningText(5000, o)?.replace(/\s/g, " ")).toBe(
      "Aiempi investointi: hankintahinta 5 000,00 €, kertynyt poisto 31.12.2024 1 734,40 €, menojäännös 31.12.2024 3 265,60 €",
    );
  });

  it("tuodulle riville kertynyt poisto lasketaan, jos sitä ei ole tallennettu", () => {
    expect(priorOpening({ acquisitionCost: 20000, openingBookValue: 12000, openingYear: null, openingAccumulated: null })).toEqual({
      year: null, accumulated: 8000, bookValue: 12000,
    });
    expect(priorOpening({ acquisitionCost: 20000, openingBookValue: null, openingYear: null, openingAccumulated: null })).toBeNull();
  });
});

describe("lomakkeen tarkistukset", () => {
  const input: PriorAssetInput = {
    description: "Metsäautotie", ratePct: 15, balanceYear: 2024, acquiredOn: null, acquisitionCost: 5000, accumulatedDepreciation: 1734.4, forestPropertyId: null,
  };

  it("hyväksyy kelvollisen investoinnin ja nollan kertyneen poiston", () => {
    expect(validatePriorAsset(input)).toBeNull();
    expect(validatePriorAsset({ ...input, accumulatedDepreciation: 0 })).toBeNull();
  });

  it("kertynyt poisto enintään hankintahinta", () => {
    expect(validatePriorAsset({ ...input, accumulatedDepreciation: 5000.01 })).toMatch(/enintään hankintahinta/);
    expect(validatePriorAsset({ ...input, accumulatedDepreciation: 5000 })).toBeNull();
  });

  it("laji ASSET_CLASSES-listalta ja hankinta viimeistään vuonna X", () => {
    expect(validatePriorAsset({ ...input, ratePct: 20 })).toMatch(/laji/);
    expect(validatePriorAsset({ ...input, acquiredOn: "2025-01-01" })).toMatch(/viimeistään vuonna 2024/);
    expect(validatePriorAsset({ ...input, acquisitionCost: 0 })).toMatch(/hankintahinta/);
  });

  it("hankintavuosi tai -päivä", () => {
    expect(parseAcquired("")).toBeNull();
    expect(parseAcquired("2019")).toBe("2019-12-31");
    expect(parseAcquired("1.5.2019")).toBe("2019-05-01");
    expect(parseAcquired("2019-05-01")).toBe("2019-05-01");
    expect(parseAcquired("31.2.2019")).toBeUndefined();
    expect(parseAcquired("toukokuu")).toBeUndefined();
  });
});
