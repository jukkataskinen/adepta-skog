import { describe, expect, it } from "vitest";
import { coopTaxable, computeForm2, thirds, type AgriFormRow, type Form2Input } from "@/lib/tax/agriculture";
import { agriDepreciation } from "@/lib/tax/agri-depreciation";

/** Lomakkeen 2 laskenta (tietuekuvaus 2025 ja 2026, tarkistukset #1987/#2045, #1988/#2046, #1450, #1886, #1447, #419). */

const row = (category: string, amountNet: number, vatRate = 0, kind: AgriFormRow["kind"] = "expense"): AgriFormRow => ({
  kind, category, amountNet, amountGross: Math.round(amountNet * (100 + vatRate)) / 100, vatRate,
});
const income = (category: string, amountNet: number, vatRate = 0) => row(category, amountNet, vatRate, "income");

const assets = [
  { id: "m", description: "Koneet", assetClass: "agri_machinery" as const, accelerated: false, acquiredOn: "2024-12-31", acquisitionCost: 90000, openingYear: 2025, openingBookValue: 40000, disposedOn: null, salePrice: null },
  { id: "t", description: "Traktori", assetClass: "agri_machinery" as const, accelerated: true, acquiredOn: "2025-04-01", acquisitionCost: 50000, openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null },
];

const emptyYear = {
  spouseWealthSharePct: null, spouseWorkSharePct: null, incomeSplitClaim: null, lossToCapitalIncome: null, wagesSubjectToWithholding: 0, landValue: 30000,
  rentalDwellingsValue: null, sharesValue: null, otherAssetsValue: null, liabilities: 20000, otherFarmAssets: null,
};

function input2025(): Form2Input {
  return {
    year: 2025,
    vatRegistered: true,
    rows: [
      income("agri_livestock_products", 20000, 14),
      income("agri_crops", 10000, 14),
      income("agri_livestock_sale", 5000, 25.5),
      income("agri_state_subsidy", 15000),
      income("agri_other_subsidy", 2000),
      income("agri_livestock_sale_deferred", 3000, 25.5),
      income("agri_own_use_vat", 100, 14),
      income("agri_coop_surplus", 6000),
      income("agri_dividends", 1000),
      income("agri_asset_sale", 999, 25.5),
      row("agri_fertilizers", 4000, 25.5),
      row("agri_feed", 3000, 14),
      row("agri_insurance", 1200),
      row("agri_myel", 3500),
      row("agri_interest", 800),
      row("agri_wages", 2000),
      row("agri_livestock_purchase_deferred", 900, 25.5),
      row("agri_asset_purchase", 50000, 25.5),
    ],
    ledgerDeferrals: [
      { year: 2025, kind: "livestock_sale", amount: 3000 },
      { year: 2025, kind: "livestock_purchase", amount: 900 },
    ],
    manualDeferrals: [{ year: 2024, kind: "livestock_sale", year1: 300, year2: 300, year3: 300 }],
    depreciation: agriDepreciation(assets, [], [], 2025, { agri_machinery: 10000, agri_machinery_accelerated: 25000 }),
    reserves: [
      { kind: "equalization", madeYear: 2025, amount: 4000, usedThroughYear: 0, incomeThisYear: 0 },
      { kind: "equalization", madeYear: 2023, amount: 2000, usedThroughYear: 2000, incomeThisYear: 2000 },
    ],
    agriYear: emptyYear,
    extras: [],
  };
}

describe("apufunktiot", () => {
  it("jaksotus kolmelle vuodelle tasaerin", () => {
    expect(thirds(3000)).toEqual([1000, 1000, 1000]);
    expect(thirds(1000)).toEqual([333.34, 333.33, 333.33]);
  });

  it("osuuskunnan ylijäämä: 25 % 5 000 euroon asti, 75 % sen yli (#1322)", () => {
    expect(coopTaxable(4000)).toBe(1000);
    expect(coopTaxable(6000)).toBe(2000);
  });
});

describe("lomake 2, verovuosi 2025", () => {
  const r = computeForm2(input2025());

  it("tulot kentittäin ja yhteensä", () => {
    expect(r.fields).toMatchObject({
      "210": 5000, "211": 3000, "212": 1300, "214": 20000, "215": 10000, "217": 15000, "218": 2000, "219": 2000,
      "321": 1000, "322": 750, "327": 6000, "328": 2000,
    });
    // #1987: 332 = 210+212+213+214+215+216+217+218+219+220+221+222+224+322+326+328 (211 ei ole summassa).
    expect(r.fields["332"]).toBe(58050);
    // Oma käyttö on vain arvonlisäveroa, ja investoinnin myynti kulkee poistoryhmän kautta.
    expect(r.fields["213"]).toBeUndefined();
    expect(r.fields["220"]).toBeUndefined();
  });

  it("menot alv-kannan mukaan, MYEL ja vakuutukset kohtaan 230", () => {
    expect(r.fields).toMatchObject({ "225": 2000, "226": 4000, "227": 900, "228": 300, "229": 3000, "230": 4700, "231": 35000, "232": 4000, "465": 800 });
    // #1988: 357 = 225+226+228+229+230+231+232+465+464.
    expect(r.fields["357"]).toBe(53800);
    // #1450 ja #880: tulos tai tappio.
    expect(r.fields["362"]).toBe(4250);
    expect(r.fields["363"]).toBeUndefined();
    expect(r.result).toBe(4250);
  });

  it("koneiden poistotaulukko ja korotetun poiston erittely", () => {
    expect(r.fields).toMatchObject({ "260": 40000, "261": 50000, "511": 35000, "265": 55000, "581": 50000, "368": 25000, "584": 25000 });
    // #1451: 260 + 261 − 262 − 263 − 264 − 511 = 265.
    expect(r.fields["260"] + r.fields["261"] - r.fields["511"]).toBe(r.fields["265"]);
    // #1886: 231 = 524 + 525 + 526 + 527 + 511 + 513 + 515.
    expect(r.fields["231"]).toBe(r.fields["511"]);
  });

  it("varallisuuslaskelma ja varaukset", () => {
    expect(r.fields).toMatchObject({ "432": 30000, "467": 55000, "731": 85000, "732": 20000, "735": 65000, "172": 4000 });
    expect(r.fields["736"]).toBeUndefined();
    expect(r.fields["170"]).toBeUndefined();
    expect(r.errors).toEqual([]);
  });
});

describe("lomake 2, verovuosi 2026", () => {
  it("korotettu ryhmä yhdistyy koneisiin, erittelyä ei ole, ja varausten vuodet siirtyvät", () => {
    const recorded = [
      { taxYear: 2025, pool: "agri_machinery" as const, amount: 10000 },
      { taxYear: 2025, pool: "agri_machinery_accelerated" as const, amount: 25000 },
    ];
    const r = computeForm2({
      ...input2025(),
      year: 2026,
      rows: [income("agri_livestock_products", 10000, 13.5), row("agri_feed", 1000, 13.5)],
      ledgerDeferrals: [{ year: 2025, kind: "livestock_sale", amount: 3000 }],
      manualDeferrals: [{ year: 2024, kind: "livestock_sale", year1: 300, year2: 300, year3: 300 }],
      depreciation: agriDepreciation(assets, [], recorded, 2026, { agri_machinery: 13750 }),
      reserves: [{ kind: "equalization", madeYear: 2025, amount: 4000, usedThroughYear: 0, incomeThisYear: 0 }],
    });
    expect(r.fields).toMatchObject({ "214": 10000, "229": 1000, "212": 1300, "260": 55000, "511": 13750, "265": 41250, "171": 4000 });
    expect(r.fields["584"]).toBeUndefined();
    expect(r.fields["172"]).toBeUndefined();
  });
});

describe("rekisteröimätön ja tappio", () => {
  it("menot verollisina luokan oletuskannan mukaan, tappio pääomatuloista enintään tappio", () => {
    const r = computeForm2({
      ...input2025(),
      vatRegistered: false,
      rows: [income("agri_crops", 1000), { kind: "expense", category: "agri_feed", amountNet: 1140, amountGross: 1140, vatRate: 0 }],
      ledgerDeferrals: [],
      manualDeferrals: [],
      reserves: [],
      depreciation: agriDepreciation([], [], [], 2025),
      agriYear: { ...emptyYear, lossToCapitalIncome: 500, spouseWealthSharePct: 40, spouseWorkSharePct: 50, incomeSplitClaim: "ten" },
    });
    expect(r.fields).toMatchObject({ "215": 1000, "229": 1140, "363": 140, "413": 60, "414": 40, "415": 50, "416": 50, "418": 1 });
    expect(r.errors.join(" ")).toMatch(/#392/);
  });

  it("harvinaisten kenttien tarkistukset #826 ja #827", () => {
    const r = computeForm2({ ...input2025(), extras: [{ code: "282", value: 5000 }, { code: "285", value: 300 }] });
    expect(r.errors.join(" ")).toMatch(/#826/);
    expect(r.errors.join(" ")).toMatch(/#827/);
  });

  it("tyhjä vuosi: ei maataloutta", () => {
    const r = computeForm2({
      year: 2026, vatRegistered: true, rows: [], ledgerDeferrals: [], manualDeferrals: [], depreciation: agriDepreciation([], [], [], 2026), reserves: [],
      agriYear: { ...emptyYear, landValue: null, liabilities: null }, extras: [],
    });
    expect(r.empty).toBe(true);
  });
});
