import { describe, expect, it } from "vitest";
import {
  businessIncomeSplit,
  earnedIncomeTaxEstimate,
  equalizationReserveMax,
  stateIncomeTax,
  validateEqualizationReserve,
  type IncomeSplitInput,
} from "@/lib/tax/income-split";
import { capitalSharePct, municipalTaxAvgPct } from "@/lib/tax/rules";

const base: IncomeSplitInput = {
  result: 25000, confirmedLosses: 0, priorNetWealth: 50000, priorWages: 0, claim: null, spouseWealthSharePct: null, spouseWorkSharePct: null, lossToCapitalIncome: false,
};

describe("yritystulon jako", () => {
  it("Verohallinnon esimerkki: nettovarallisuus 50 000 €, pääomatuloa 20 % eli 10 000 €", () => {
    const s = businessIncomeSplit(base);
    // Ensin 5 % yrittäjävähennys, sitten jako: 25 000 − 1 250 = 23 750, josta pääomatuloa 10 000.
    expect(s).toMatchObject({ distributable: 25000, entrepreneurDeduction: 1250, splitBase: 23750, wealthBase: 50000, capitalPct: 20, capital: 10000, earned: 13750 });
    expect(s.owner).toEqual({ capital: 10000, earned: 13750 });
    expect(s.spouse).toBeNull();
  });

  it("vaatimus 10 % tai 0 %", () => {
    expect(businessIncomeSplit({ ...base, claim: "ten" })).toMatchObject({ capital: 5000, earned: 18750, capitalPct: 10 });
    expect(businessIncomeSplit({ ...base, claim: "earned" })).toMatchObject({ capital: 0, earned: 23750, capitalPct: 0 });
    expect([capitalSharePct(null), capitalSharePct("ten"), capitalSharePct("earned")]).toEqual([20, 10, 0]);
  });

  it("pääomatulo-osuus on enintään jaettava tulo", () => {
    const s = businessIncomeSplit({ ...base, priorNetWealth: 500000 });
    expect(s).toMatchObject({ capitalMax: 100000, capital: 23750, earned: 0 });
  });

  it("30 % palkoista lisätään nettovarallisuuteen", () => {
    const s = businessIncomeSplit({ ...base, priorNetWealth: 10000, priorWages: 10000 });
    expect(s).toMatchObject({ wealthBase: 13000, capital: 2600 });
  });

  it("negatiivinen nettovarallisuus: kaikki ansiotuloa", () => {
    const s = businessIncomeSplit({ ...base, priorNetWealth: -40000 });
    expect(s).toMatchObject({ wealthBase: 0, capital: 0, earned: 23750, wealthMissing: false });
  });

  it("puuttuva nettovarallisuus merkitään, ja kaikki on ansiotuloa", () => {
    expect(businessIncomeSplit({ ...base, priorNetWealth: null })).toMatchObject({ wealthMissing: true, capital: 0, earned: 23750 });
  });

  it("vahvistetut tappiot vähennetään ennen yrittäjävähennystä ja jakoa", () => {
    const s = businessIncomeSplit({ ...base, result: 20000, confirmedLosses: 5000 });
    expect(s).toMatchObject({ lossesUsed: 5000, lossesLeft: 0, distributable: 15000, entrepreneurDeduction: 750, splitBase: 14250, capital: 10000, earned: 4250 });
    const all = businessIncomeSplit({ ...base, result: 20000, confirmedLosses: 30000 });
    expect(all).toMatchObject({ lossesUsed: 20000, lossesLeft: 10000, distributable: 0, entrepreneurDeduction: 0, capital: 0, earned: 0 });
  });

  it("tappiovuosi: vahvistetaan tai vähennetään pääomatuloista vaatimuksesta", () => {
    expect(businessIncomeSplit({ ...base, result: -8000 })).toMatchObject({ loss: 8000, lossConfirmed: 8000, lossToCapital: 0, capital: 0, earned: 0, entrepreneurDeduction: 0 });
    expect(businessIncomeSplit({ ...base, result: -8000, lossToCapitalIncome: true })).toMatchObject({ loss: 8000, lossConfirmed: 0, lossToCapital: 8000 });
  });

  it("nollatulos ei tuota jakoa", () => {
    expect(businessIncomeSplit({ ...base, result: 0 })).toMatchObject({ loss: 0, capital: 0, earned: 0, lossConfirmed: 0 });
  });

  it("puolisot: pääomatulo varallisuusosuuksin, ansiotulo työosuuksin", () => {
    const s = businessIncomeSplit({ ...base, spouseWealthSharePct: 40, spouseWorkSharePct: 50 });
    expect(s.spouse).toEqual({ capital: 4000, earned: 6875 });
    expect(s.owner).toEqual({ capital: 6000, earned: 6875 });
    // Tappio pääomatuloista: asiakkaan osuus varallisuusosuuden mukaan.
    expect(businessIncomeSplit({ ...base, result: -10000, lossToCapitalIncome: true, spouseWealthSharePct: 40, spouseWorkSharePct: 50 }).lossToCapital).toBe(6000);
  });
});

describe("tasausvaraus", () => {
  it("40 % puhtaasta tulosta, alas satoihin, 800–25 000 €", () => {
    expect(equalizationReserveMax(0)).toBe(0);
    expect(equalizationReserveMax(-5000)).toBe(0);
    expect(equalizationReserveMax(1999)).toBe(0); // 799,60 → 700, alle 800
    expect(equalizationReserveMax(2000)).toBe(800);
    expect(equalizationReserveMax(10050)).toBe(4000);
    expect(equalizationReserveMax(62499)).toBe(24900);
    expect(equalizationReserveMax(62500)).toBe(25000);
    expect(equalizationReserveMax(1000000)).toBe(25000);
  });

  it("tarkistus", () => {
    expect(validateEqualizationReserve(0, 0)).toBeNull();
    expect(validateEqualizationReserve(4000, 4000)).toBeNull();
    expect(validateEqualizationReserve(4100, 4000)).toMatch(/enintään/);
    expect(validateEqualizationReserve(700, 4000)).toMatch(/vähintään 800/);
    expect(validateEqualizationReserve(1250, 4000)).toMatch(/satoina/);
    expect(validateEqualizationReserve(1000, 0)).toMatch(/ei voi tehdä/);
  });
});

describe("ansiotulon vero", () => {
  it("valtion asteikko 2025 ja 2026 rajakohdissa", () => {
    expect(stateIncomeTax(0, 2025)).toBe(0);
    expect(stateIncomeTax(21200, 2025)).toBe(2679.68);
    expect(stateIncomeTax(31500, 2025)).toBe(4636.68);
    expect(stateIncomeTax(22000, 2026)).toBe(2780.8);
    expect(stateIncomeTax(50000, 2026)).toBe(10355.3);
    expect(stateIncomeTax(60000, 2026)).toBe(14016.05);
  });

  it("arvio: valtion veron lisäys muiden tulojen päälle ja kunnallisvero", () => {
    expect(municipalTaxAvgPct(2026)).toBe(7.57);
    expect(earnedIncomeTaxEstimate(10000, 2026)).toEqual({ state: 1264, municipal: 757, total: 2021, ratePct: 20.21 });
    // Muut ansiotulot nostavat rajaveroa.
    const withOther = earnedIncomeTaxEstimate(10000, 2026, 40100, 7);
    expect(withOther).toMatchObject({ state: 3325, municipal: 700, total: 4025 });
    expect(earnedIncomeTaxEstimate(0, 2026)).toEqual({ state: 0, municipal: 0, total: 0, ratePct: 0 });
  });
});
