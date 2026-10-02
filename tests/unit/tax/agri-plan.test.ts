import { describe, expect, it } from "vitest";
import { agriTips, combinedTax, computeAgriPlan, initialChoices, recordedChoices, type AgriChoices, type AgriPlanData } from "@/lib/tax/agri-plan";
import { computePlan } from "@/lib/tax/plan";

/**
 * Verosuunnitelman maatalousosa: lomakkeen 2 tulos valinnoilla, tasausvarauksen
 * enimmäismäärä, yritystulon jako ja yhteinen vero metsätalouden kanssa.
 */

const agriYear = {
  spouseWealthSharePct: null, spouseWorkSharePct: null, incomeSplitClaim: null, lossToCapitalIncome: null, wagesSubjectToWithholding: 0, landValue: null,
  rentalDwellingsValue: null, sharesValue: null, otherAssetsValue: null, liabilities: null, otherFarmAssets: null,
};

function data(over: Partial<AgriPlanData> = {}): AgriPlanData {
  return {
    year: 2026,
    form2Base: {
      year: 2026,
      vatRegistered: true,
      rows: [
        { kind: "income", category: "agri_crops", amountNet: 100000, amountGross: 113500, vatRate: 13.5 },
        { kind: "expense", category: "agri_feed", amountNet: 30000, amountGross: 34050, vatRate: 13.5 },
        { kind: "expense", category: "agri_interest", amountNet: 5000, amountGross: 5000, vatRate: 0 },
      ],
      ledgerDeferrals: [],
      manualDeferrals: [],
      agriYear,
      extras: [],
    },
    depreciation: {
      assets: [
        {
          id: "k", description: "Koneet", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2025-12-31", acquisitionCost: 80000,
          openingYear: 2026, openingBookValue: 40000, disposedOn: null, salePrice: null,
        },
      ],
      adjustments: [],
      recorded: [],
    },
    reserves: [{ id: "r2023", kind: "equalization", madeYear: 2023, amount: 3000, farmName: null, usedBefore: 0, assetUseThisYear: 0, incomeThisYear: 0 }],
    equalizationThisYear: { id: null, amount: 0, editable: true, usedThisYear: 0 },
    priorWealth: { netWealth: 150000, wages: 0, source: "manual" },
    confirmedLosses: 0,
    spouseWealthSharePct: null,
    spouseWorkSharePct: null,
    claim: null,
    lossToCapitalIncome: null,
    depreciationConfirmed: false,
    ...over,
  };
}

const none: AgriChoices = { depreciation: {}, equalization: 0, releases: {}, claim: null, lossToCapital: false };
const forest = computePlan({ year: 2026, income: 30000, expense: 2000, depreciation: 0, forestDeduction: 0, saleGain: 0, saleLoss: 0, salePrices: 0 });

describe("maatalouden suunnitelma", () => {
  it("poistot, tasausvaraus ja tuloutus muuttavat lomakkeen 2 tulosta", () => {
    const d = data();
    const zero = computeAgriPlan(d, none);
    // 100 000 − 30 000 − 5 000 korkoja = 65 000.
    expect(zero.form2.result).toBe(65000);
    // Tasausvarauksen pohja ennen korkoja: 70 000 → 40 % = 28 000 → enintään 25 000.
    expect(zero.equalization).toMatchObject({ base: 70000, max: 25000, amount: 0 });

    const c: AgriChoices = { ...none, depreciation: { agri_machinery: 10000 }, equalization: 5000, releases: { r2023: 3000 } };
    const p = computeAgriPlan(d, c);
    expect(p.depreciation.total).toBe(10000);
    expect(p.form2.fields["232"]).toBe(5000);
    expect(p.form2.fields["219"]).toBe(3000);
    expect(p.form2.result).toBe(65000 - 10000 - 5000 + 3000);
    // Pohja ei riipu tämän vuoden varauksesta: 53 000 + 5 000 + 5 000 korkoja = 63 000.
    expect(p.equalization).toMatchObject({ base: 63000, max: 25000, amount: 5000 });
  });

  it("poisto rajataan ryhmän enimmäismäärään, tuloutus purkamattomaan määrään", () => {
    const p = computeAgriPlan(data(), { ...none, depreciation: { agri_machinery: 99999 }, releases: { r2023: 9999 } });
    expect(p.depreciation.total).toBe(10000);
    expect(p.form2.fields["219"]).toBe(3000);
  });

  it("alkuarvot: enimmäispoistot, kun poistoja ei ole vahvistettu; muuten kirjatut", () => {
    expect(initialChoices(data()).depreciation).toEqual({ agri_machinery: 10000 });
    const confirmed = data({ depreciationConfirmed: true, depreciation: { ...data().depreciation, recorded: [{ taxYear: 2026, pool: "agri_machinery", amount: 4000 }] } });
    expect(initialChoices(confirmed).depreciation).toEqual({ agri_machinery: 4000 });
    expect(recordedChoices(data()).depreciation).toEqual({});
  });

  it("jakovaatimus ja yritystulon jako", () => {
    const p = computeAgriPlan(data(), { ...none, claim: "ten" });
    expect(p.form2.fields["418"]).toBe(1);
    // 65 000 − 5 % = 61 750; pääomatuloa 10 % × 150 000 = 15 000.
    expect(p.split).toMatchObject({ splitBase: 61750, capital: 15000, earned: 46750 });
  });

  it("tappio pääomatuloista (420) vain tappiovuonna", () => {
    const loss = data({ form2Base: { ...data().form2Base, rows: [{ kind: "expense", category: "agri_feed", amountNet: 8000, amountGross: 9080, vatRate: 13.5 }] } });
    const p = computeAgriPlan(loss, { ...none, lossToCapital: true });
    expect(p.form2.result).toBe(-8000);
    expect(p.form2.fields["420"]).toBe(8000);
    expect(p.split.lossToCapital).toBe(8000);
    expect(computeAgriPlan(data(), { ...none, lossToCapital: true }).form2.fields["420"]).toBeUndefined();
  });

  it("useamman tilan varaus ei muutu suunnitelmassa", () => {
    const d = data({ equalizationThisYear: { id: "x", amount: 6000, editable: false, usedThisYear: 0 } });
    const p = computeAgriPlan(d, { ...none, equalization: 1000 });
    expect(p.equalization.amount).toBe(6000);
  });
});

describe("yhteinen vero", () => {
  it("pelkkä metsäasiakas: sama vero kuin metsän laskelmassa", () => {
    const t = combinedTax(2026, forest, null);
    expect(t.capital).toBe(forest.taxable);
    expect(t.capitalTax).toEqual(forest.tax);
    expect(t.earnedTax.total).toBe(0);
    expect(t.total).toBe(forest.tax.total);
  });

  it("metsän ja maatalouden pääomatulot yhteen 30/34 %:n rajaan", () => {
    const split = computeAgriPlan(data(), none).split;
    // Metsä 26 600 + maatalous 30 000 (20 % × 150 000) = 56 600.
    const t = combinedTax(2026, forest, split);
    expect(forest.forestryTaxable).toBe(26600);
    expect(t).toMatchObject({ forestCapital: 26600, agriCapital: 30000, capital: 56600, aboveThreshold: true });
    expect(t.capitalTax).toEqual({ low: 9000, high: 9044, total: 18044 });
    expect(t.agriEarned).toBe(31750);
    expect(t.total).toBe(Math.round((t.capitalTax.total + t.earnedTax.total) * 100) / 100);
  });

  it("maatalouden tappio vähentää metsän pääomatuloa vaatimuksesta", () => {
    const loss = data({ form2Base: { ...data().form2Base, rows: [{ kind: "expense", category: "agri_feed", amountNet: 8000, amountGross: 9080, vatRate: 13.5 }] } });
    const t = combinedTax(2026, forest, computeAgriPlan(loss, { ...none, lossToCapital: true }).split);
    expect(t.capital).toBe(18600);
  });
});

describe("maatalouden suositukset", () => {
  it("ehdottaa tasausvarausta ja poistoja sekä varoittaa purettavasta varauksesta", () => {
    const tips = agriTips(data(), none, forest).map((t) => t.text);
    expect(tips.some((t) => /^Tasausvarausta voisi tehdä 25\s000,00\s€/.test(t))).toBe(true);
    expect(tips.some((t) => /^Maatalouden poistoja jää tekemättä 10\s000,00\s€/.test(t))).toBe(true);
    // Ansiotulon rajavero on tässä suurempi kuin 34 %, joten oletusjako on edullisin eikä muuta ehdoteta.
    expect(tips.some((t) => t.startsWith("Pääomatulo-osuus"))).toBe(false);
    // Vuoden 2023 varaus on purettava viimeistään 2026.
    expect(tips.some((t) => t.startsWith("Tasausvaraus vuodelta 2023"))).toBe(true);
    expect(agriTips(data(), { ...none, releases: { r2023: 3000 } }, forest).some((t) => t.text.startsWith("Tasausvaraus vuodelta 2023"))).toBe(false);
  });

  it("ehdottaa pienempää pääomatulo-osuutta, kun se on edullisempi", () => {
    // Suuri nettovarallisuus: kaikki olisi pääomatuloa 34 %:n alueella, ansiotulona osa jää alemmille portaille.
    const d = data({ priorWealth: { netWealth: 600000, wages: 0, source: "manual" } });
    const tips = agriTips(d, none, forest).map((t) => t.text);
    const tip = tips.find((t) => t.startsWith("Pääomatulo-osuus"));
    expect(tip).toMatch(/pienentäisi arvioitua veroa/);
    expect(tip).toMatch(/kohta 418/);
  });

  it("kertoo puuttuvasta nettovarallisuudesta", () => {
    const tips = agriTips(data({ priorWealth: { netWealth: null, wages: 0, source: "none" } }), none, forest);
    expect(tips[0]).toMatchObject({ tone: "warn" });
    expect(tips[0].text).toMatch(/nettovarallisuus puuttuu/);
  });
});

describe("tasausvaraus maatiloittain (0018)", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  // Tila A: kasvinviljely 60 000 €, rehut 10 000 €. Tila B: kasvinviljely 20 000 €. Yhteiset: korot 5 000 € ja kone (poisto valitaan).
  const farmData = () =>
    data({
      form2Base: {
        ...data().form2Base,
        rows: [
          { kind: "income", category: "agri_crops", amountNet: 60000, amountGross: 68100, vatRate: 13.5, farmId: A },
          { kind: "expense", category: "agri_feed", amountNet: 10000, amountGross: 11350, vatRate: 13.5, farmId: A },
          { kind: "income", category: "agri_crops", amountNet: 20000, amountGross: 22700, vatRate: 13.5, farmId: B },
          { kind: "expense", category: "agri_interest", amountNet: 5000, amountGross: 5000, vatRate: 0 },
        ],
      },
      reserves: [],
      equalizationThisYear: { id: null, amount: 0, editable: false, usedThisYear: 0 },
      equalizationFarms: [
        { farmId: A, farmName: "Ylätila", id: null, amount: 0, editable: true, usedThisYear: 0 },
        { farmId: B, farmName: "Alatila", id: null, amount: 0, editable: true, usedThisYear: 0 },
      ],
    });

  it("pohja tiloittain: omat kirjaukset ja yhteiset erät tulojen suhteessa, yhteensä koko pohja", () => {
    const p = computeAgriPlan(farmData(), { ...none, depreciation: { agri_machinery: 8000 }, farmEqualization: {} });
    // Koko pohja: tulos 57 000 + korot 5 000 = 62 000 (poisto 8 000 on yhteinen erä).
    expect(p.equalization.base).toBe(62000);
    const [a, b] = p.equalization.farms!;
    // Yhteinen erä −8 000 jaetaan 60/20: A −6 000, B −2 000.
    expect(a).toMatchObject({ farmId: A, base: 44000, max: 17600 });
    expect(b).toMatchObject({ farmId: B, base: 18000, max: 7200 });
    expect(a.base + b.base).toBe(p.equalization.base);
    expect(p.equalization.max).toBe(24800);
  });

  it("tilojen varaukset menevät lomakkeelle, ja suositus koskee tiloja", () => {
    const d = farmData();
    const p = computeAgriPlan(d, { ...none, farmEqualization: { [A]: 10000, [B]: 1000 } });
    expect(p.form2.fields["232"]).toBe(11000);
    expect(p.equalization.amount).toBe(11000);
    expect(p.equalization.farms!.map((f) => f.amount)).toEqual([10000, 1000]);
    // Pohja ei muutu varauksesta.
    expect(p.equalization.base).toBe(computeAgriPlan(d, { ...none, farmEqualization: {} }).equalization.base);
    const tips = agriTips(d, { ...none, farmEqualization: {} }, forest);
    expect(tips.some((t) => /tiloille/.test(t.text))).toBe(true);
  });

  it("recordedChoices ottaa tilojen tallennetut varaukset", () => {
    const d = farmData();
    d.equalizationFarms![0] = { ...d.equalizationFarms![0], id: "r", amount: 3000 };
    expect(recordedChoices(d).farmEqualization).toEqual({ [A]: 3000, [B]: 0 });
  });
});
