import { describe, expect, it } from "vitest";
import { assetYear, type AssetInput } from "@/lib/tax/depreciation";
import { allocateForestDeduction, capitalIncomeTax, computePlan, forestDeductionIncome, forestDeductionLimits, validateForestDeduction } from "@/lib/tax/plan";
import { vatSummary } from "@/lib/tax/vat";

const tractor: AssetInput = {
  acquiredOn: "2024-03-01", acquisitionCost: 30000, method: "declining_balance", usefulLifeYears: null, decliningRatePct: 25,
  openingBookValue: null, disposedOn: null, salePrice: null,
};

describe("poistot", () => {
  it("menojäännöspoisto: hankintavuonna 25 % hankintamenosta, sitten edellisen vuoden loppuarvosta", () => {
    expect(assetYear(tractor, [], 2024)).toMatchObject({ active: true, bookValueStart: 30000, min: 0, max: 7500, mandatory: false });
    expect(assetYear(tractor, [{ taxYear: 2024, amount: 5000, bookValueEnd: 25000 }], 2025)).toMatchObject({ bookValueStart: 25000, max: 6250 });
  });

  it("jos edellisen vuoden poistoa ei ole kirjattu, arvo on lähtöarvo miinus aiemmat poistot", () => {
    expect(assetYear(tractor, [{ taxYear: 2024, amount: 7500, bookValueEnd: 22500 }], 2026).bookValueStart).toBe(22500);
    expect(assetYear({ ...tractor, openingBookValue: 12000 }, [], 2026).bookValueStart).toBe(12000);
  });

  it("tie tai oja 15 %, poisto aina vapaaehtoinen", () => {
    const road: AssetInput = { ...tractor, decliningRatePct: 15, acquisitionCost: 10000 };
    expect(assetYear(road, [], 2024)).toMatchObject({ min: 0, max: 1500, mandatory: false });
  });

  it("enintään 600 euron jäännöksen saa poistaa kerralla", () => {
    expect(assetYear(tractor, [{ taxYear: 2025, amount: 1000, bookValueEnd: 580 }], 2026)).toMatchObject({ bookValueStart: 580, max: 580, smallBalance: true });
  });

  it("vanhan sovelluksen tasapoisto on vapaaehtoinen eikä mene nollan alle", () => {
    const old: AssetInput = { ...tractor, method: "straight_line", usefulLifeYears: 4, decliningRatePct: null, acquisitionCost: 10000 };
    expect(assetYear(old, [], 2024)).toMatchObject({ min: 0, max: 2500, mandatory: false });
    expect(assetYear(old, [{ taxYear: 2026, amount: 2500, bookValueEnd: 1000 }], 2027)).toMatchObject({ max: 1000 });
  });

  it("myyntivuonna ei poistoa: voitto tai tappio poistamattomaan arvoon verrattuna", () => {
    const sold = { ...tractor, disposedOn: "2025-10-01", salePrice: 26000 };
    expect(assetYear(sold, [{ taxYear: 2024, amount: 7500, bookValueEnd: 22500 }], 2025)).toMatchObject({ sold: true, max: 0, salePrice: 26000, saleGain: 3500, saleLoss: 0 });
    expect(assetYear({ ...sold, salePrice: 20000 }, [{ taxYear: 2024, amount: 7500, bookValueEnd: 22500 }], 2025).saleLoss).toBe(2500);
    expect(assetYear(sold, [], 2026).active).toBe(false);
    expect(assetYear(tractor, [], 2023).active).toBe(false);
  });
});

describe("pääomatulon vero", () => {
  it("30 % 30 000 euroon asti, 34 % sen yli", () => {
    expect(capitalIncomeTax(20000, 2025)).toEqual({ low: 6000, high: 0, total: 6000 });
    expect(capitalIncomeTax(40000, 2025)).toEqual({ low: 9000, high: 3400, total: 12400 });
    expect(capitalIncomeTax(-5, 2025).total).toBe(0);
  });
});

describe("metsävähennys", () => {
  const props = [
    { id: "a", remaining: 5000 },
    { id: "b", remaining: 20000 },
    { id: "c", remaining: null },
  ];

  it("vuosiraja: 60 % (2025) tai 75 % (2026) veronalaisesta tulosta, enintään käyttämätön pohja", () => {
    expect(forestDeductionLimits(props, 30000, 2025)).toEqual({ available: 25000, annualPct: 60, annualMax: 18000, max: 18000, min: 1500 });
    expect(forestDeductionLimits(props, 30000, 2026)).toMatchObject({ annualPct: 75, annualMax: 22500, max: 22500 });
    expect(forestDeductionLimits(props, 100000, 2025).max).toBe(25000);
  });

  it("vuosirajan tulosta vähennetään oman hankintatyön arvo, ei muita kuluja", () => {
    expect(forestDeductionIncome(30000, 4000)).toBe(26000);
    expect(forestDeductionIncome(1000, 4000)).toBe(0);
  });

  it("alle 1 500 euron enimmäismäärällä vähennystä ei voi tehdä", () => {
    expect(forestDeductionLimits(props, 2000, 2025).max).toBe(0);
    expect(forestDeductionLimits(props, 2000, 2026).max).toBe(1500);
  });

  it("valinnan tarkistus", () => {
    const l = forestDeductionLimits(props, 30000, 2025);
    expect(validateForestDeduction(0, l)).toBeNull();
    expect(validateForestDeduction(1000, l)).toMatch(/vähintään/);
    expect(validateForestDeduction(18001, l)).toMatch(/enintään/);
    expect(validateForestDeduction(18000, l)).toBeNull();
  });

  it("jako tiloille järjestyksessä", () => {
    expect(allocateForestDeduction(props, 8000)).toEqual([
      { id: "a", amount: 5000 },
      { id: "b", amount: 3000 },
    ]);
  });
});

describe("verosuunnitelma", () => {
  const base = { year: 2025, saleGain: 0, saleLoss: 0, salePrices: 0 };

  it("metsävähennys, yrittäjävähennys 5 % ja vero", () => {
    const r = computePlan({ ...base, income: 49100, expense: 340, depreciation: 5625, forestDeduction: 10000 });
    expect(r.netBeforeDeduction).toBe(43135);
    // (43 135 − 10 000) × 5 % = 1 656,75
    expect(r.entrepreneurDeduction).toBe(1656.75);
    expect(r.forestryTaxable).toBe(31478.25);
    expect(r.taxable).toBe(31478.25);
    expect(r.tax.total).toBe(9502.61);
    expect(r.taxWithoutDeductions.total).toBe(15378.4);
    expect(r.saving).toBe(5875.79);
  });

  it("tappiolliseen tulokseen ei tehdä yrittäjävähennystä", () => {
    expect(computePlan({ ...base, income: 1000, expense: 3000, depreciation: 0, forestDeduction: 0 })).toMatchObject({ entrepreneurDeduction: 0, taxable: 0 });
  });

  it("koneen luovutusvoitto on pääomatuloa metsätalouden tuloksen ulkopuolella", () => {
    const r = computePlan({ ...base, income: 0, expense: 0, depreciation: 0, forestDeduction: 0, saleGain: 3500, salePrices: 26000 });
    expect(r).toMatchObject({ netBeforeDeduction: 0, entrepreneurDeduction: 0, saleResult: 3500, taxable: 3500 });
  });

  it("luovutustappio vähentää pääomatuloa, ja enintään 1 000 euron myynnit ovat verovapaita", () => {
    expect(computePlan({ ...base, income: 10000, expense: 0, depreciation: 0, forestDeduction: 0, saleLoss: 2000, salePrices: 5000 }).taxable).toBe(7500);
    expect(computePlan({ ...base, income: 0, expense: 0, depreciation: 0, forestDeduction: 0, saleGain: 800, salePrices: 900 })).toMatchObject({ saleExempt: true, taxable: 0 });
  });
});

describe("arvonlisävero", () => {
  it("neljännekset ja vuosi, myynti verokannoittain", () => {
    const s = vatSummary([
      { bookedOn: "2025-01-28", kind: "income", amountNet: 6200, amountGross: 7781, vatRate: 25.5 },
      { bookedOn: "2025-06-15", kind: "income", amountNet: 42000, amountGross: 52710, vatRate: 25.5 },
      { bookedOn: "2025-08-30", kind: "income", amountNet: 900, amountGross: 900, vatRate: 0 },
      { bookedOn: "2025-10-05", kind: "expense", amountNet: 1000, amountGross: 1255, vatRate: 25.5 },
      { bookedOn: "2025-11-05", kind: "investment", amountNet: 8000, amountGross: 10040, vatRate: 25.5 },
    ]);
    expect(s.quarters.map((q) => q.payable)).toEqual([1581, 10710, 0, -2295]);
    expect(s.year).toMatchObject({ output: 12291, input: 2295, payable: 9996 });
    expect(s.year.byRate).toEqual([
      { rate: 25.5, net: 48200, vat: 12291 },
      { rate: 0, net: 900, vat: 0 },
    ]);
  });
});
