import { describe, expect, it } from "vitest";
import { computeForm2, type AgriFormRow, type Form2Input } from "@/lib/tax/agriculture";
import { agriDepreciation, type AgriAdjustment, type AgriAssetInput, type AgriRecorded } from "@/lib/tax/agri-depreciation";
import { computeAgriPlan, type AgriPlanData } from "@/lib/tax/agri-plan";
import { businessIncomeSplit } from "@/lib/tax/income-split";
import { EMPTY_VEHICLE_REPORT, type VehicleReportInput } from "@/lib/tax/vehicle";
import { vatSummary } from "@/lib/tax/vat";
import { defaultVatRate, reducedVatRate, vatRateGroup } from "@/lib/tax/rules";
import { compute2, render2 } from "@/lib/filing/vsy002";
import { SKOG_SOFTWARE } from "@/lib/filing/vsy02c";

/**
 * Sama kuvitteellinen maatila verovuonna 2026 (jatkoa agri-year-2025.test.ts:lle).
 * Menojäännökset, tasaus- ja jälleenhankintavaraukset sekä kotieläinten
 * jaksotukset jatkuvat vuodesta 2025, ja nettovarallisuus otetaan vuoden 2025
 * lomakkeelta (735 + 30 % palkoista 437). Odotusarvot on laskettu käsin.
 */

const sale = (category: string, amountNet: number, vatRate = 0): AgriFormRow => ({
  kind: "income", category, amountNet, amountGross: Math.round(amountNet * (100 + vatRate)) / 100, vatRate,
});
const buy = (category: string, amountNet: number, vatRate = 0): AgriFormRow => ({
  kind: "expense", category, amountNet, amountGross: Math.round(amountNet * (100 + vatRate)) / 100, vatRate,
});

// Sama investointirekisteri kuin vuoden 2025 testissä; S1 myydään ja M3 hankitaan 2026.
const ASSETS: AgriAssetInput[] = [
  { id: "B1", description: "Navetta", assetClass: "agri_production_building", accelerated: false, acquiredOn: "2010-06-01", acquisitionCost: 150000, openingYear: 2025, openingBookValue: 100000, disposedOn: null, salePrice: null },
  { id: "G1", description: "Kasvihuone", assetClass: "agri_greenhouse", accelerated: false, acquiredOn: "2015-05-01", acquisitionCost: 5000, openingYear: 2025, openingBookValue: 900, disposedOn: null, salePrice: null },
  { id: "M1", description: "Koneet", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2018-05-01", acquisitionCost: 90000, openingYear: 2025, openingBookValue: 40000, disposedOn: null, salePrice: null },
  { id: "M2", description: "Vanha niittokone", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2012-03-01", acquisitionCost: 15000, openingYear: 2025, openingBookValue: 3000, disposedOn: "2025-08-15", salePrice: 4000 },
  { id: "K1", description: "Kylvökone 2023", assetClass: "agri_machinery", accelerated: true, acquiredOn: "2023-05-01", acquisitionCost: 40000, openingYear: 2025, openingBookValue: 20000, disposedOn: null, salePrice: null },
  { id: "T1", description: "Traktori 2025", assetClass: "agri_machinery", accelerated: true, acquiredOn: "2025-04-01", acquisitionCost: 60000, openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null },
  { id: "S1", description: "Silta", assetClass: "agri_bridges", accelerated: false, acquiredOn: "2005-01-01", acquisitionCost: 3000, openingYear: 2025, openingBookValue: 1500, disposedOn: "2026-06-01", salePrice: 2000 },
  { id: "D1", description: "Salaojitus", assetClass: "agri_drainage", accelerated: false, acquiredOn: "2025-09-01", acquisitionCost: 8000, openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null },
  { id: "M3", description: "Paalain 2026", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2026-03-01", acquisitionCost: 10000, openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null },
];

const ADJUSTMENTS: AgriAdjustment[] = [
  { assetId: "T1", taxYear: 2025, kind: "equalization", amount: 5000 },
  { assetId: "D1", taxYear: 2025, kind: "grant", amount: 2000 },
  { assetId: "M3", taxYear: 2026, kind: "equalization", amount: 4000 },
];

const RECORDED: AgriRecorded[] = [
  { taxYear: 2025, pool: "agri_production_building", amount: 10000 },
  { taxYear: 2025, pool: "agri_greenhouse", amount: 900 },
  { taxYear: 2025, pool: "agri_machinery", amount: 9750 },
  { taxYear: 2025, pool: "agri_machinery_accelerated", amount: 37500 },
  { taxYear: 2025, pool: "agri_bridges", amount: 150 },
  { taxYear: 2025, pool: "agri_drainage", amount: 1200 },
  // 2026: rakennuksesta vain 5 000 (enimmäismäärä 9 000), muista enimmäismäärä.
  { taxYear: 2026, pool: "agri_production_building", amount: 5000 },
  { taxYear: 2026, pool: "agri_machinery", amount: 18187.5 },
  { taxYear: 2026, pool: "agri_drainage", amount: 960 },
];

const VEHICLE_2026: VehicleReportInput = {
  ...EMPTY_VEHICLE_REPORT,
  vehicleBasis: 1, vehicleTotalKm: 20000, vehiclePrivateKm: 2000, vehicleForestryKm: 3000, vehicleCosts: 12000,
  carBasis: 1, carTotalKm: 12000, carAgriKm: 1000, carDeducted: 200,
  tripsFullDays: 2, tripsFullDeducted: 0,
};

const AGRI_YEAR = {
  spouseWealthSharePct: 40, spouseWorkSharePct: 40, incomeSplitClaim: "ten" as const, lossToCapitalIncome: null, wagesSubjectToWithholding: 7000,
  landValue: 50000, rentalDwellingsValue: null, sharesValue: 5000, otherAssetsValue: null, liabilities: 110000, otherFarmAssets: null,
};

const ROWS: AgriFormRow[] = [
  sale("agri_livestock_sale", 5000, 25.5), // 210
  sale("agri_livestock_products", 85000, 13.5), // 214
  sale("agri_crops", 8000, 13.5), // 215
  sale("agri_state_subsidy", 42000), // 217
  sale("agri_asset_sale", 2000, 25.5), // sillan myynti poistoryhmän kautta (269)
  buy("agri_wages", 9000), // 225
  buy("agri_fertilizers", 16000, 25.5), // 226
  buy("agri_feed", 22000, 13.5), // 229
  buy("agri_insurance", 3000), // 230
  buy("agri_myel", 6500), // 230
  buy("agri_interest", 3500), // 465
  buy("agri_livestock_purchase_deferred", 6000, 25.5), // 227, jaksotus manualDeferrals
];

const LEDGER_DEFERRALS: Form2Input["ledgerDeferrals"] = [
  // Vuoden 2023 erä on jo kokonaan tuloutettu 2023–2025, joten se ei saa näkyä 2026.
  { year: 2023, kind: "livestock_sale", amount: 6000 },
  { year: 2025, kind: "livestock_sale", amount: 30001 },
  { year: 2025, kind: "livestock_purchase", amount: 9000 },
];
const MANUAL_DEFERRALS: Form2Input["manualDeferrals"] = [
  { year: 2024, kind: "livestock_sale", year1: 4000, year2: 4000, year3: 4000 },
  { year: 2026, kind: "livestock_purchase", year1: 2000, year2: 2000, year3: 2000 },
];

function input2026(): Form2Input {
  return {
    year: 2026,
    vatRegistered: true,
    rows: ROWS,
    ledgerDeferrals: LEDGER_DEFERRALS,
    manualDeferrals: MANUAL_DEFERRALS,
    depreciation: agriDepreciation(ASSETS, ADJUSTMENTS, RECORDED, 2026),
    reserves: [
      // 2023: 7 000 käytetty 2025 mennessä, loput 3 000 tuloutetaan viimeisenä vuonna 2026.
      { kind: "equalization", madeYear: 2023, amount: 10000, usedThroughYear: 10000, incomeThisYear: 3000 },
      // 2024: koko 4 000 paalaimen hankintaan 2026 (262).
      { kind: "equalization", madeYear: 2024, amount: 4000, usedThroughYear: 4000, incomeThisYear: 0 },
      { kind: "equalization", madeYear: 2025, amount: 10000, usedThroughYear: 0, incomeThisYear: 0 },
      { kind: "equalization", madeYear: 2026, amount: 25000, usedThroughYear: 0, incomeThisYear: 0 },
      // Jälleenhankintavaraus 2024: 1 000 tuloutettu 2025, loput 4 000 nyt.
      { kind: "replacement", madeYear: 2024, amount: 5000, usedThroughYear: 5000, incomeThisYear: 4000 },
    ],
    agriYear: AGRI_YEAR,
    extras: [],
    vehicle: VEHICLE_2026,
  };
}

describe("Maatila 2026: poistoryhmät jatkuvat vuodesta 2025", () => {
  const d25 = agriDepreciation(ASSETS, ADJUSTMENTS, RECORDED, 2025);
  const d26 = agriDepreciation(ASSETS, ADJUSTMENTS, RECORDED, 2026);
  const p25 = (p: string) => d25.pools.find((x) => x.pool === p);
  const p26 = (p: string) => d26.pools.find((x) => x.pool === p);

  it("alku = edellisen vuoden loppu; korotettu ryhmä yhdistyy koneisiin", () => {
    expect(p26("agri_production_building")!.start).toBe(p25("agri_production_building")!.end);
    expect(p26("agri_drainage")!.start).toBe(p25("agri_drainage")!.end);
    // Koneet 2026 alussa = 29 250 + korotetun ryhmän 37 500 = 66 750.
    expect(p26("agri_machinery")!.start).toBe(p25("agri_machinery")!.end + p25("agri_machinery_accelerated")!.end);
    expect(p26("agri_machinery")!.start).toBe(66750);
    expect(p26("agri_machinery_accelerated")).toBeUndefined();
    // Kasvihuone poistettiin kokonaan 2025, joten ryhmää ei enää ole.
    expect(p26("agri_greenhouse")).toBeUndefined();
  });

  it("vuoden 2026 ryhmät", () => {
    // Rakennus: 90 000 × 10 % = 9 000 enimmäismäärä, kirjattu 5 000 → loppu 85 000.
    expect(p26("agri_production_building")).toMatchObject({ start: 90000, max: 9000, depreciation: 5000, end: 85000 });
    // Koneet: 66 750 + 10 000 − tasausvaraus 4 000 = 72 750; 25 % = 18 187,50; loppu 54 562,50.
    expect(p26("agri_machinery")).toMatchObject({ pct: 25, additions: 10000, equalization: 4000, base: 72750, max: 18187.5, depreciation: 18187.5, end: 54562.5 });
    // Silta: 1 350 − myynti 2 000 = −650 → ylitys 650 tuloksi, pohja 0, loppu 0.
    expect(p26("agri_bridges")).toMatchObject({ start: 1350, sales: 2000, base: 0, excess: 650, depreciation: 0, end: 0 });
    // Salaojat: 4 800 × 20 % = 960; loppu 3 840.
    expect(p26("agri_drainage")).toMatchObject({ start: 4800, max: 960, end: 3840 });
    // 5 000 + 18 187,50 + 960 = 24 147,50.
    expect(d26.total).toBe(24147.5);
    expect(d26.excess).toBe(650);
  });

  it("koneiden pieni menojäännös 1 200 €", () => {
    const small = (bv: number) =>
      agriDepreciation([{ id: "x", description: "Kone", assetClass: "agri_machinery", accelerated: false, acquiredOn: "2020-01-01", acquisitionCost: 5000, openingYear: 2026, openingBookValue: bv, disposedOn: null, salePrice: null }], [], [], 2026).pools[0];
    expect(small(1200)).toMatchObject({ smallBalance: true, max: 1200 });
    // 1 200,01 ylittää rajan: 25 % = 300.
    expect(small(1200.01)).toMatchObject({ smallBalance: false, max: 300 });
  });

  it("korotettu poisto on valittavissa vain 2025 asti", () => {
    const t = agriDepreciation([{ ...ASSETS[5], acquiredOn: "2026-02-01" }], [], [], 2026).pools[0];
    expect(t).toMatchObject({ pool: "agri_machinery", pct: 25 });
  });
});

describe("Maatila 2026: lomake 2", () => {
  const form = computeForm2(input2026());
  const f = form.fields;

  it("ei virheitä; varoitus sillan myyntihinnan ylityksestä", () => {
    expect(form.errors).toEqual([]);
    expect(form.warnings).toHaveLength(1);
    expect(form.warnings[0]).toMatch(/650,00 €/);
  });

  it("tulot ja 332 (#2045)", () => {
    expect(f["210"]).toBe(5000);
    expect(f["211"]).toBeUndefined();
    // 212 = 2025:n 30 001 toinen erä 10 000,33 + 2024:n kolmas erä 4 000 = 14 000,33 (2023:n erä ei enää).
    expect(f["212"]).toBe(14000.33);
    expect([f["214"], f["215"], f["217"]]).toEqual([85000, 8000, 42000]);
    // 219 = tasausvaraus 2023 viimeisenä vuonna 3 000.
    expect(f["219"]).toBe(3000);
    // 220 = sillan myyntihinnan ylitys 650 + jälleenhankintavarauksen tuloutus 4 000 = 4 650.
    expect(f["220"]).toBe(4650);
    // 221 = 12 000 × 2 000 / 20 000 = 1 200 + 12 000 × 3 000 / 20 000 = 1 800 → 3 000.
    expect(f["221"]).toBe(3000);
    // 332 = 5 000 + 14 000,33 + 85 000 + 8 000 + 42 000 + 3 000 + 4 650 + 3 000 = 164 650,33.
    expect(f["332"]).toBe(164650.33);
  });

  it("menot ja 357 (#2046)", () => {
    expect([f["225"], f["226"], f["229"]]).toEqual([9000, 16000, 22000]);
    expect(f["227"]).toBe(6000);
    // 228 = 2025:n 9 000 toinen erä 3 000 + 2026:n käsin jaksotettu 2 000 = 5 000.
    expect(f["228"]).toBe(5000);
    // 230 = 3 000 + 6 500.
    expect(f["230"]).toBe(9500);
    // 231 = 524 + 511 + 515 = 5 000 + 18 187,50 + 960 = 24 147,50 (513 = 0).
    expect(f["231"]).toBe(24147.5);
    expect(f["513"]).toBeUndefined();
    expect(f["232"]).toBe(25000);
    expect(f["465"]).toBe(3500);
    // 464 = oman auton lisävähennys 350 + matkat 108 = 458.
    expect(f["464"]).toBe(458);
    // 357 = 9 000 + 16 000 + 5 000 + 22 000 + 9 500 + 24 147,50 + 25 000 + 3 500 + 458 = 114 605,50.
    expect(f["357"]).toBe(114605.5);
  });

  it("tulos 362 ja tasausvarauksen enimmäismäärä", () => {
    // 164 650,33 − 114 605,50 = 50 044,83.
    expect(f["362"]).toBe(50044.83);
    expect(f["363"]).toBeUndefined();
  });

  it("poistokentät: ei korotetun poiston erittelyä 2026", () => {
    expect([f["260"], f["261"], f["262"], f["511"], f["265"]]).toEqual([66750, 10000, 4000, 18187.5, 54562.5]);
    expect([f["240"], f["524"], f["244"]]).toEqual([90000, 5000, 85000]);
    // Silta: 266 = 1 350, 269 = 2 000, loppu 271 = 0 annetaan, koska ryhmässä oli liikettä.
    expect([f["266"], f["269"], f["271"]]).toEqual([1350, 2000, 0]);
    expect([f["272"], f["515"], f["277"]]).toEqual([4800, 960, 3840]);
    for (const c of ["364", "365", "366", "367", "581", "368", "584"]) expect(f[c]).toBeUndefined();
  });

  it("purkamattomat varaukset: 170 = 2024, 171 = 2025, 172 = 2026", () => {
    // 2024 käytetty kokonaan → 170 puuttuu; 2023 ei kuulu enää kenttiin.
    expect([f["170"], f["171"], f["172"]]).toEqual([undefined, 10000, 25000]);
    expect([f["173"], f["174"], f["175"]]).toEqual([undefined, undefined, undefined]);
  });

  it("ajoneuvoselvitys 2026: km-korvaus 0,55 €/km ja päiväraha 54 €", () => {
    expect([f["283"], f["284"]]).toEqual([1200, 1800]);
    // 518 = 1 000 × 0,55 = 550; 285 = 550 − 200 = 350.
    expect([f["518"], f["285"]]).toEqual([550, 350]);
    // 2 × 54 = 108.
    expect([f["401"], f["402"], f["403"], f["405"], f["532"], f["286"]]).toEqual([2, 54, 108, 108, 108, 108]);
    expect(f["533"]).toBeUndefined();
    expect(form.forestryTransfer).toBe(1800);
  });

  it("varallisuuslaskelma", () => {
    // 466 = 85 000; 467 = 54 562,50; 469 = 271 0 + 277 3 840 = 3 840.
    expect([f["432"], f["466"], f["467"], f["468"], f["469"]]).toEqual([50000, 85000, 54562.5, 5000, 3840]);
    // 731 = 50 000 + 85 000 + 54 562,50 + 5 000 + 3 840 = 198 402,50; 735 = 198 402,50 − 110 000 = 88 402,50.
    expect([f["731"], f["732"], f["735"]]).toEqual([198402.5, 110000, 88402.5]);
    expect([f["413"], f["414"], f["415"], f["416"], f["418"], f["437"]]).toEqual([60, 40, 60, 40, 1, 7000]);
  });

  it("kotieläinten epätasainen jaksotus varoittaa, vanha purkamaton varaus varoittaa", () => {
    const form = computeForm2({
      ...input2026(),
      manualDeferrals: [{ year: 2025, kind: "livestock_sale", year1: 3000, year2: 3000, year3: 3100 }],
      reserves: [{ kind: "equalization", madeYear: 2022, amount: 1000, usedThroughYear: 500, incomeThisYear: 0 }],
    });
    expect(form.warnings.join(" ")).toMatch(/vuodelta 2025 ei ole jaettu tasan/);
    expect(form.warnings.join(" ")).toMatch(/vuodelta 2022 .*purkamatta/);
  });
});

describe("Maatila 2026: verosuunnitelma ja yritystulon jako", () => {
  function plan(): AgriPlanData {
    const i = input2026();
    return {
      year: 2026,
      form2Base: { year: 2026, vatRegistered: true, rows: i.rows, ledgerDeferrals: i.ledgerDeferrals, manualDeferrals: i.manualDeferrals, agriYear: i.agriYear, extras: [], vehicle: VEHICLE_2026 },
      depreciation: { assets: ASSETS, adjustments: ADJUSTMENTS, recorded: RECORDED },
      reserves: [
        { id: "r2023", kind: "equalization", madeYear: 2023, amount: 10000, farmName: null, usedBefore: 7000, assetUseThisYear: 0, incomeThisYear: 3000 },
        { id: "r2024", kind: "equalization", madeYear: 2024, amount: 4000, farmName: null, usedBefore: 0, assetUseThisYear: 4000, incomeThisYear: 0 },
        { id: "r2025", kind: "equalization", madeYear: 2025, amount: 10000, farmName: null, usedBefore: 0, assetUseThisYear: 0, incomeThisYear: 0 },
        { id: "r2026", kind: "equalization", madeYear: 2026, amount: 25000, farmName: null, usedBefore: 0, assetUseThisYear: 0, incomeThisYear: 0 },
        { id: "j2024", kind: "replacement", madeYear: 2024, amount: 5000, farmName: null, usedBefore: 1000, assetUseThisYear: 0, incomeThisYear: 4000 },
      ],
      equalizationThisYear: { id: "r2026", amount: 25000, editable: true, usedThisYear: 0 },
      // Vuoden 2025 lomakkeelta: 735 = 97 900 ja 437 = 6 000.
      priorWealth: { netWealth: 97900, wages: 6000, source: "computed" },
      confirmedLosses: 0,
      spouseWealthSharePct: 40,
      spouseWorkSharePct: 40,
      claim: "ten",
      lossToCapitalIncome: null,
      depreciationConfirmed: true,
    };
  }
  const choices = { depreciation: { agri_production_building: 5000, agri_machinery: 18187.5, agri_drainage: 960 }, equalization: 25000, releases: {}, claim: "ten" as const, lossToCapital: false };

  it("suunnitelma antaa saman lomakkeen kuin Lomake 2 -välilehti", () => {
    const p = computeAgriPlan(plan(), choices);
    expect(p.form2.fields).toEqual(computeForm2(input2026()).fields);
  });

  it("tasausvarauksen pohja ja enimmäismäärä (katto 25 000)", () => {
    const p = computeAgriPlan(plan(), choices);
    // Pohja = 50 044,83 + 25 000 + korot 3 500 = 78 544,83; 40 % = 31 417,93 → katto 25 000.
    expect(p.equalization).toMatchObject({ base: 78544.83, max: 25000, amount: 25000 });
  });

  it("jako 10 %:n vaatimuksella, nettovarallisuus + 30 % palkoista", () => {
    const s = computeAgriPlan(plan(), choices).split;
    // Pohja 97 900 + 30 % × 6 000 = 99 700; 10 % = 9 970.
    // Jaettava 50 044,83; vähennys 5 % = 2 502,24; jaettava 47 542,59; ansiotuloa 47 542,59 − 9 970 = 37 572,59.
    expect(s).toMatchObject({ wealthBase: 99700, capitalPct: 10, capitalMax: 9970, distributable: 50044.83, entrepreneurDeduction: 2502.24, splitBase: 47542.59, capital: 9970, earned: 37572.59 });
    // Puoliso 40 %: 3 988 ja 37 572,59 × 40 % = 15 029,04; asiakas 5 982 ja 22 543,55.
    expect(s.spouse).toEqual({ capital: 3988, earned: 15029.04 });
    expect(s.owner).toEqual({ capital: 5982, earned: 22543.55 });
  });

  it("negatiivinen nettovarallisuus: kaikki ansiotuloa", () => {
    const s = businessIncomeSplit({ result: 10000, confirmedLosses: 0, priorNetWealth: -5000, priorWages: 0, claim: null, spouseWealthSharePct: null, spouseWorkSharePct: null, lossToCapitalIncome: false });
    // 10 000 − 5 % = 9 500 ansiotuloa.
    expect(s).toMatchObject({ wealthBase: 0, capital: 0, earned: 9500 });
  });
});

describe("Maatila 2026: tappiovuosi", () => {
  // Sama vuosi ilman tämän vuoden tasausvarausta ja 80 000 € lisää ostoja (25,5 %).
  const loss = (lossToCapitalIncome: number | null) =>
    computeForm2({
      ...input2026(),
      rows: [...ROWS, buy("agri_seeds", 80000, 25.5)],
      reserves: input2026().reserves.filter((r) => r.madeYear !== 2026),
      agriYear: { ...AGRI_YEAR, lossToCapitalIncome },
    });

  it("363 annetaan ja 362 ei; 420 ≤ 363", () => {
    const form = loss(4000);
    // 357 = 114 605,50 − 25 000 + 80 000 = 169 605,50; 164 650,33 − 169 605,50 = −4 955,17.
    expect(form.fields["357"]).toBe(169605.5);
    expect(form.fields["363"]).toBe(4955.17);
    expect(form.fields["362"]).toBeUndefined();
    expect(form.fields["420"]).toBe(4000);
    expect(compute2(form).errors).toEqual([]);
    expect(loss(5000).errors.join(" ")).toMatch(/#392/);
  });

  it("tappion vähennys pääomatuloista puolisoilla asiakkaan varallisuusosuuden mukaan", () => {
    const s = businessIncomeSplit({ result: -4955.17, confirmedLosses: 1000, priorNetWealth: 97900, priorWages: 6000, claim: "ten", spouseWealthSharePct: 40, spouseWorkSharePct: 40, lossToCapitalIncome: true });
    // Asiakkaan osuus 60 % × 4 955,17 = 2 973,10; vahvistettavaa ei jää; aiemmat tappiot säilyvät.
    expect(s).toMatchObject({ loss: 4955.17, lossToCapital: 2973.1, lossConfirmed: 0, lossesLeft: 1000, capital: 0, earned: 0 });
    const noClaim = businessIncomeSplit({ result: -4955.17, confirmedLosses: 0, priorNetWealth: 97900, priorWages: 0, claim: null, spouseWealthSharePct: null, spouseWorkSharePct: null, lossToCapitalIncome: false });
    expect(noClaim).toMatchObject({ lossToCapital: 0, lossConfirmed: 4955.17 });
  });
});

describe("Maatila 2026: alv", () => {
  it("alennettu kanta 13,5 % vuodesta 2026", () => {
    expect(reducedVatRate("2025-12-31")).toBe(14);
    expect(reducedVatRate("2026-01-01")).toBe(13.5);
    expect(defaultVatRate("agri_feed", "2026-01-02", { vatRegistered: true })).toBe(13.5);
    expect(vatRateGroup(13.5)).toBe("reduced");
    expect(vatRateGroup(10)).toBe("ten");
    const y = vatSummary([
      { bookedOn: "2026-02-01", kind: "income", amountNet: 85000, amountGross: 96475, vatRate: 13.5, category: "agri_livestock_products" },
      { bookedOn: "2026-02-01", kind: "expense", amountNet: 22000, amountGross: 24970, vatRate: 13.5, category: "agri_feed" },
    ]).year;
    // 85 000 × 13,5 % = 11 475; 22 000 × 13,5 % = 2 970; maksettava 8 505.
    expect(y.form).toMatchObject({ reduced: 11475, deductible: 2970, payable: 8505 });
  });
});

describe("Maatila 2026: VSY002", () => {
  const computed = compute2(computeForm2(input2026()));

  it("tarkistukset ja keskeiset rivit", () => {
    expect(computed.errors).toEqual([]);
    const lines = render2({ computed, filerId: "011073-998R", software: SKOG_SOFTWARE, createdAt: new Date("2027-02-01T10:00:00Z") }).split("\r\n");
    for (const l of [
      "000:VSY00226", "212:14000,33", "220:4650,00", "221:3000,00", "332:164650,33", "228:5000,00", "231:24147,50", "232:25000,00", "357:114605,50",
      "362:50044,83", "260:66750,00", "262:4000,00", "511:18187,50", "265:54562,50", "269:2000,00", "271:0,00", "518:550,00", "285:350,00",
      "413:60,00", "414:40,00", "418:1", "735:88402,50", "171:10000,00", "172:25000,00",
    ]) {
      expect(lines).toContain(l);
    }
    expect(lines.some((l) => /^(364|365|366|367|581|368|584|363):/.test(l))).toBe(false);
  });
});
