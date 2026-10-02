import { describe, expect, it } from "vitest";
import { computeForm2, thirds, type AgriFormRow, type Form2Input } from "@/lib/tax/agriculture";
import { agriDepreciation, type AgriAdjustment, type AgriAssetInput, type AgriRecorded } from "@/lib/tax/agri-depreciation";
import { businessIncomeSplit, equalizationReserveMax } from "@/lib/tax/income-split";
import { EMPTY_VEHICLE_REPORT, type VehicleReportInput } from "@/lib/tax/vehicle";
import { ownShare } from "@/lib/tax/share";
import { vatSummary, type VatRow } from "@/lib/tax/vat";
import { defaultVatRate, reducedVatRate } from "@/lib/tax/rules";
import { compute2, render2 } from "@/lib/filing/vsy002";
import { SKOG_SOFTWARE } from "@/lib/filing/vsy02c";

/**
 * Kuvitteellinen maatila verovuonna 2025 kokonaisuudessaan: kirjaukset,
 * poistoryhmät, varaukset, kotieläinten jaksotukset, ajoneuvoselvitys,
 * varallisuuslaskelma, yritystulon jako, yhteinen alv ja VSY002-tiedosto.
 * Odotusarvot on laskettu käsin (laskutoimitus kommenttina), jotta testi
 * tarkistaa laskennan eikä vain toista koodin tulosta. Vuosi 2026 jatkaa
 * tästä (agri-year-2026.test.ts): sama investointirekisteri ja kirjatut poistot.
 */

const net = (category: string, amountNet: number, vatRate: number, kind: AgriFormRow["kind"]): AgriFormRow => ({
  kind, category, amountNet, amountGross: Math.round(amountNet * (100 + vatRate)) / 100, vatRate,
});
const sale = (category: string, amountNet: number, vatRate = 0) => net(category, amountNet, vatRate, "income");
const buy = (category: string, amountNet: number, vatRate = 0) => net(category, amountNet, vatRate, "expense");

/** Investointirekisteri (sama 2026-tiedostossa). Aiemmat investoinnit tuovat menojäännöksensä vuoden 2025 alkuun. */
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
  // Vuoden 2023 tasausvarauksesta 5 000 € traktorin hankintaan (262).
  { assetId: "T1", taxYear: 2025, kind: "equalization", amount: 5000 },
  // Salaojituksen investointituki (276).
  { assetId: "D1", taxYear: 2025, kind: "grant", amount: 2000 },
  // Vuoden 2024 tasausvaraus paalaimen hankintaan 2026.
  { assetId: "M3", taxYear: 2026, kind: "equalization", amount: 4000 },
];

/** Vuoden 2025 vahvistetut ryhmäpoistot: kaikissa ryhmissä enimmäismäärä. */
const RECORDED_2025: AgriRecorded[] = [
  { taxYear: 2025, pool: "agri_production_building", amount: 10000 },
  { taxYear: 2025, pool: "agri_greenhouse", amount: 900 },
  { taxYear: 2025, pool: "agri_machinery", amount: 9750 },
  { taxYear: 2025, pool: "agri_machinery_accelerated", amount: 37500 },
  { taxYear: 2025, pool: "agri_bridges", amount: 150 },
  { taxYear: 2025, pool: "agri_drainage", amount: 1200 },
];

const VEHICLE_2025: VehicleReportInput = {
  ...EMPTY_VEHICLE_REPORT,
  vehicleBasis: 1, vehicleTotalKm: 20000, vehiclePrivateKm: 2000, vehicleForestryKm: 1000, vehicleCosts: 10000,
  carBasis: 2, carTotalKm: 15000, carAgriKm: 1000, carDeducted: 200,
  tripsFullDays: 3, tripsFullDeducted: 0, tripsPartDays: 2, tripsPartDeducted: 10,
};

function input2025(): Form2Input {
  return {
    year: 2025,
    vatRegistered: true,
    rows: [
      sale("agri_livestock_sale", 12000, 25.5), // 210
      sale("agri_livestock_sale_deferred", 30001, 25.5), // 211, jaksotus ledgerDeferrals
      sale("agri_other_sales", 2000, 25.5), // 213
      sale("agri_livestock_products", 80000, 14), // 214
      sale("agri_crops", 10000, 14), // 215
      sale("agri_state_subsidy", 40000), // 217
      sale("agri_other_subsidy", 1500), // 218
      sale("agri_other_income", 1000), // 220
      sale("agri_additions", 700), // 222
      sale("agri_coop_surplus", 6000), // 327/328
      sale("agri_dividends", 1000), // 321/322
      sale("agri_dividends_listed", 200), // 223/224
      sale("agri_own_use_vat", 500, 14), // vain alv
      sale("agri_asset_sale", 4000, 25.5), // poistoryhmän kautta (263)
      buy("agri_wages", 8000), // 225
      buy("agri_fertilizers", 15000, 25.5), // 226
      buy("agri_fuels", 5000, 25.5), // 226
      buy("agri_feed", 20000, 14), // 229
      buy("agri_veterinary", 1000, 10), // eläinlääke 10 % → 229
      buy("agri_insurance", 3000), // 230
      buy("agri_myel", 6000), // 230
      buy("agri_rents", 2000), // by_vat 0 % → 230
      buy("agri_livestock_purchase_deferred", 9000, 25.5), // 227
      buy("agri_interest", 4000), // 465
      buy("agri_other_deductions", 300), // 464
      net("agri_asset_purchase", 60000, 25.5, "investment"), // poistoryhmän kautta (261)
    ],
    ledgerDeferrals: [
      { year: 2023, kind: "livestock_sale", amount: 6000 },
      { year: 2025, kind: "livestock_sale", amount: 30001 },
      { year: 2025, kind: "livestock_purchase", amount: 9000 },
    ],
    manualDeferrals: [{ year: 2024, kind: "livestock_sale", year1: 4000, year2: 4000, year3: 4000 }],
    depreciation: agriDepreciation(ASSETS, ADJUSTMENTS, RECORDED_2025, 2025),
    reserves: [
      // Tasausvaraus 2023: 5 000 traktoriin ja 2 000 tuloutettu 2025.
      { kind: "equalization", madeYear: 2023, amount: 10000, usedThroughYear: 7000, incomeThisYear: 2000 },
      { kind: "equalization", madeYear: 2024, amount: 4000, usedThroughYear: 0, incomeThisYear: 0 },
      { kind: "equalization", madeYear: 2025, amount: 10000, usedThroughYear: 0, incomeThisYear: 0 },
      { kind: "replacement", madeYear: 2024, amount: 5000, usedThroughYear: 1000, incomeThisYear: 1000 },
    ],
    agriYear: {
      spouseWealthSharePct: 40, spouseWorkSharePct: 50, incomeSplitClaim: null, lossToCapitalIncome: null, wagesSubjectToWithholding: 6000,
      landValue: 50000, rentalDwellingsValue: null, sharesValue: 5000, otherAssetsValue: null, liabilities: 120000, otherFarmAssets: null,
    },
    extras: [],
    vehicle: VEHICLE_2025,
  };
}

describe("Maatila 2025: poistoryhmät", () => {
  const dep = agriDepreciation(ASSETS, ADJUSTMENTS, RECORDED_2025, 2025);
  const pool = (p: string) => dep.pools.find((x) => x.pool === p)!;

  it("menojäännösketju ryhmittäin: loppu = alku + lisäys − tasausvaraus − myynti − tuki − poisto", () => {
    // Tuotantorakennus: 100 000 × 10 % = 10 000; loppu 90 000.
    expect(pool("agri_production_building")).toMatchObject({ start: 100000, max: 10000, depreciation: 10000, end: 90000 });
    // Kasvihuone: 900 ≤ 1 000 (rakennusten pieni menojäännös) → koko 900 kerralla, loppu 0.
    expect(pool("agri_greenhouse")).toMatchObject({ start: 900, smallBalance: true, max: 900, depreciation: 900, end: 0 });
    // Koneet: 40 000 + 3 000 = 43 000 − myynti 4 000 = 39 000; 25 % = 9 750; loppu 29 250.
    expect(pool("agri_machinery")).toMatchObject({ start: 43000, sales: 4000, base: 39000, max: 9750, depreciation: 9750, end: 29250, excess: 0 });
    // Korotettu: 20 000 + 60 000 − tasausvaraus 5 000 = 75 000; 50 % = 37 500; loppu 37 500.
    expect(pool("agri_machinery_accelerated")).toMatchObject({ pct: 50, start: 20000, additions: 60000, equalization: 5000, base: 75000, max: 37500, end: 37500, priorCost: 40000 });
    // Sillat: 1 500 × 10 % = 150 (ei pienen erän rajaa); loppu 1 350.
    expect(pool("agri_bridges")).toMatchObject({ start: 1500, smallBalance: false, max: 150, end: 1350 });
    // Salaojat: 8 000 − tuki 2 000 = 6 000; 20 % = 1 200; loppu 4 800.
    expect(pool("agri_drainage")).toMatchObject({ additions: 8000, grants: 2000, base: 6000, max: 1200, end: 4800 });
    // Yhteensä 10 000 + 900 + 9 750 + 37 500 + 150 + 1 200 = 59 500.
    expect(dep.total).toBe(59500);
    expect(dep.excess).toBe(0);
  });
});

describe("Maatila 2025: lomake 2", () => {
  const form = computeForm2(input2025());
  const f = form.fields;

  it("ei virheitä eikä varoituksia", () => {
    expect(form.errors).toEqual([]);
    expect(form.warnings).toEqual([]);
  });

  it("tulot kentittäin ja 332 (#1987: 211 ei mukana)", () => {
    expect(f["210"]).toBe(12000);
    expect(f["211"]).toBe(30001);
    // 212 = 2025:n 30 001 ensimmäinen erä 10 000,34 (sentti ensimmäiselle vuodelle)
    //     + 2024:n käsin jaksotettu 4 000 (toinen erä) + 2023:n 6 000 kolmas erä 2 000 = 16 000,34.
    expect(thirds(30001)).toEqual([10000.34, 10000.33, 10000.33]);
    expect(f["212"]).toBe(16000.34);
    expect(f["213"]).toBe(2000);
    expect(f["214"]).toBe(80000);
    expect(f["215"]).toBe(10000);
    expect(f["217"]).toBe(40000);
    expect(f["218"]).toBe(1500);
    // 219 = tasausvarauksen 2023 tuloutus 2 000.
    expect(f["219"]).toBe(2000);
    // 220 = vahingonkorvaus 1 000 + jälleenhankintavarauksen tuloutus 1 000 = 2 000.
    expect(f["220"]).toBe(2000);
    // 221 = ajoneuvon yksityisajot 10 000 × 2 000 / 20 000 = 1 000 + metsätalouden ajot 10 000 × 1 000 / 20 000 = 500.
    expect(f["221"]).toBe(1500);
    expect(f["222"]).toBe(700);
    // Osingot: pörssi 200 × 85 % = 170; muut 1 000 × 75 % = 750.
    expect([f["223"], f["224"], f["321"], f["322"]]).toEqual([200, 170, 1000, 750]);
    // Osuuskunta: 5 000 × 25 % + 1 000 × 75 % = 1 250 + 750 = 2 000.
    expect([f["327"], f["328"]]).toEqual([6000, 2000]);
    // 332 = 12 000 + 16 000,34 + 2 000 + 80 000 + 10 000 + 40 000 + 1 500 + 2 000 + 2 000
    //     + 1 500 + 700 + 170 + 750 + 2 000 = 170 620,34.
    expect(f["332"]).toBe(170620.34);
    expect(form.income).toBe(170620.34);
  });

  it("menot kentittäin ja 357 (#1988: 227 ei mukana)", () => {
    expect(f["225"]).toBe(8000);
    // 226 = lannoitteet 15 000 + polttoaineet 5 000 (verottomina, alv-velvollinen).
    expect(f["226"]).toBe(20000);
    expect(f["227"]).toBe(9000);
    // 228 = 9 000 / 3 = 3 000.
    expect(f["228"]).toBe(3000);
    // 229 = rehut 14 % 20 000 + eläinlääke 10 % 1 000 = 21 000.
    expect(f["229"]).toBe(21000);
    // 230 = vakuutukset 3 000 + MYEL 6 000 + vuokrat 2 000 = 11 000.
    expect(f["230"]).toBe(11000);
    // 231 = 524 + 525 + 526 + 527 + 511 + 513 + 515 = 10 000 + 0 + 900 + 0 + 47 250 + 150 + 1 200 = 59 500.
    expect(f["231"]).toBe(59500);
    expect(f["524"] + (f["525"] ?? 0) + f["526"] + (f["527"] ?? 0) + f["511"] + f["513"] + f["515"]).toBe(59500);
    expect(f["232"]).toBe(10000);
    expect(f["465"]).toBe(4000);
    // 464 = muut vähennykset 300 + oman auton lisävähennys 390 + matkojen lisävähennys 197 = 887.
    expect(f["464"]).toBe(887);
    // 357 = 8 000 + 20 000 + 3 000 + 21 000 + 11 000 + 59 500 + 10 000 + 4 000 + 887 = 137 387.
    expect(f["357"]).toBe(137387);
  });

  it("tulos 362 = 332 − 357, tappiota 363 ei anneta", () => {
    // 170 620,34 − 137 387 = 33 233,34.
    expect(f["362"]).toBe(33233.34);
    expect(f["363"]).toBeUndefined();
    expect(form.result).toBe(33233.34);
  });

  it("poistoryhmien kentät: koneisiin kuuluu myös korotettu ryhmä", () => {
    expect([f["240"], f["524"], f["244"]]).toEqual([100000, 10000, 90000]);
    expect([f["250"], f["526"], f["254"]]).toEqual([900, 900, 0]);
    // 260 = 43 000 + 20 000 = 63 000; 261 = 60 000; 262 = 5 000; 263 = 4 000;
    // 511 = 9 750 + 37 500 = 47 250; 265 = 63 000 + 60 000 − 5 000 − 4 000 − 47 250 = 66 750.
    expect([f["260"], f["261"], f["262"], f["263"], f["511"], f["265"]]).toEqual([63000, 60000, 5000, 4000, 47250, 66750]);
    expect([f["266"], f["513"], f["271"]]).toEqual([1500, 150, 1350]);
    expect([f["273"], f["276"], f["515"], f["277"]]).toEqual([8000, 2000, 1200, 4800]);
    // Rakennukset 6 % ja 25 % ovat tyhjiä: ei kenttiä.
    expect(f["245"]).toBeUndefined();
    expect(f["259"]).toBeUndefined();
  });

  it("korotetun poiston erittely 364–584 (vain 2025)", () => {
    // 364 = aiempien vuosien korotetut investoinnit (K1) 40 000; 365 = 40 000 − 20 000 = 20 000; 366 = 20 000.
    expect([f["364"], f["365"], f["366"]]).toEqual([40000, 20000, 20000]);
    // 581 = verovuoden investoinnit 60 000.
    expect(f["581"]).toBe(60000);
    // Täysi poisto jakautuu pohjien suhteessa: 367 = 50 % × 20 000 = 10 000,
    // 368 = 50 % × (60 000 − tasausvaraus 5 000) = 27 500; 584 = 37 500.
    expect([f["367"], f["368"], f["584"]]).toEqual([10000, 27500, 37500]);
  });

  it("purkamattomat varaukset 170–175 oikeille vuosille", () => {
    // 2025: 170 = vuosi 2023, 171 = 2024, 172 = 2025. 2023: 10 000 − 7 000 = 3 000.
    expect([f["170"], f["171"], f["172"]]).toEqual([3000, 4000, 10000]);
    // Jälleenhankintavaraus 2024: 5 000 − 1 000 = 4 000 → 174.
    expect(f["174"]).toBe(4000);
    expect(f["173"]).toBeUndefined();
    expect(f["175"]).toBeUndefined();
  });

  it("ajoneuvoselvitys 2025: km-korvaus 0,59 €/km", () => {
    expect([f["281"], f["516"], f["282"], f["283"], f["284"]]).toEqual([1, 20000, 10000, 1000, 500]);
    // 518 = 1 000 km × 0,59 = 590; 285 = 590 − 200 = 390.
    expect([f["534"], f["287"], f["288"], f["518"], f["519"], f["285"]]).toEqual([2, 15000, 1000, 590, 200, 390]);
    // Kokopäivät 3 × 53 = 159 (405 = 159); osapäivät 2 × 24 = 48 − 10 = 38.
    expect([f["401"], f["402"], f["403"], f["405"]]).toEqual([3, 53, 159, 159]);
    expect([f["406"], f["407"], f["408"], f["429"], f["410"]]).toEqual([2, 24, 48, 10, 38]);
    // 532 = 159 + 48 = 207; 533 = 10; 286 = 159 + 38 = 197.
    expect([f["532"], f["533"], f["286"]]).toEqual([207, 10, 197]);
    // Metsätalouden ajot 500 → 2C:n kohta 630.
    expect(form.forestryTransfer).toBe(500);
  });

  it("varallisuuslaskelma, puolisot ja palkat", () => {
    // 466 = 244 + 249 + 254 + 259 = 90 000 + 0; 467 = 265 = 66 750; 469 = 271 + 277 = 1 350 + 4 800 = 6 150.
    expect([f["432"], f["466"], f["467"], f["468"], f["469"]]).toEqual([50000, 90000, 66750, 5000, 6150]);
    // 731 = 50 000 + 90 000 + 66 750 + 5 000 + 6 150 = 217 900; 735 = 217 900 − 120 000 = 97 900.
    expect([f["731"], f["732"], f["735"], f["736"]]).toEqual([217900, 120000, 97900, undefined]);
    expect([f["413"], f["414"], f["415"], f["416"]]).toEqual([60, 40, 50, 50]);
    expect(f["418"]).toBeUndefined();
    expect(f["437"]).toBe(6000);
  });

  it("tasausvarauksen enimmäismäärä: 40 % tuloksesta ennen korkoja ja varausta, alas sataan", () => {
    // Pohja = 362 + 232 + 465 = 33 233,34 + 10 000 + 4 000 = 47 233,34; 40 % = 18 893,34 → 18 800.
    const base = f["362"] + f["232"] + f["465"];
    expect(base).toBeCloseTo(47233.34, 2);
    expect(equalizationReserveMax(base)).toBe(18800);
    // Rajat: alle 800 ei varausta, katto 25 000.
    expect(equalizationReserveMax(1999)).toBe(0);
    expect(equalizationReserveMax(2000)).toBe(800);
    expect(equalizationReserveMax(70000)).toBe(25000);
  });

  it("yritystulon jako: tappiot, yrittäjävähennys 5 %, 20 % nettovarallisuudesta, puolisot", () => {
    // Edellisen vuoden (2024) nettovarallisuus syötetty käsin 80 000, palkkoja ei lisätä.
    const s = businessIncomeSplit({
      result: form.result, confirmedLosses: 8033.34, priorNetWealth: 80000, priorWages: 0, claim: null,
      spouseWealthSharePct: 40, spouseWorkSharePct: 50, lossToCapitalIncome: false,
    });
    // Jaettava = 33 233,34 − 8 033,34 = 25 200; vähennys 5 % = 1 260; jaettava 23 940.
    // Pääomatuloa enintään 20 % × 80 000 = 16 000; ansiotuloa 23 940 − 16 000 = 7 940.
    expect(s).toMatchObject({ lossesUsed: 8033.34, lossesLeft: 0, distributable: 25200, entrepreneurDeduction: 1260, splitBase: 23940, capitalMax: 16000, capital: 16000, earned: 7940 });
    // Puoliso: pääomatulo 40 % × 16 000 = 6 400, ansiotulo 50 % × 7 940 = 3 970.
    expect(s.spouse).toEqual({ capital: 6400, earned: 3970 });
    expect(s.owner).toEqual({ capital: 9600, earned: 3970 });
  });
});

describe("Maatila 2025: rekisteröimätön asiakas", () => {
  it("ostot luokan oletuskannan kenttään bruttona", () => {
    // Rekisteröimättömän kirjauksissa kanta on 0 % ja veroton = brutto (defaultVatRate).
    expect(defaultVatRate("agri_feed", "2025-05-01", { vatRegistered: false })).toBe(0);
    const gross = (category: string, amount: number) => ({ kind: "expense" as const, category, amountNet: amount, amountGross: amount, vatRate: 0 });
    const form = computeForm2({
      ...input2025(), vatRegistered: false, vehicle: null, reserves: [], ledgerDeferrals: [], manualDeferrals: [],
      depreciation: agriDepreciation([], [], [], 2025),
      rows: [gross("agri_fertilizers", 18825), gross("agri_feed", 22800), gross("agri_rents", 2000), { ...gross("agri_livestock_purchase_deferred", 11295) }],
    });
    // Lannoite (yleinen) → 226, rehu (alennettu) → 229, vuokra (ei alv) → 230; kaikki verollisina.
    expect([form.fields["226"], form.fields["229"], form.fields["230"], form.fields["227"]]).toEqual([18825, 22800, 2000, 11295]);
  });
});

describe("Maatila 2025: tuloluokka menona", () => {
  it("menoksi käännetty tuloluokka on meno eikä kasvata tuloja", () => {
    const form = computeForm2({
      ...input2025(), vehicle: null, reserves: [], ledgerDeferrals: [], manualDeferrals: [], depreciation: agriDepreciation([], [], [], 2025),
      rows: [sale("agri_livestock_products", 1000, 14), buy("agri_livestock_products", 100, 14)],
    });
    // Maito 1 000 tuloa; meijerin veloitus 100 (14 %) menona kohtaan 229 eikä tuloon 214.
    expect(form.fields["214"]).toBe(1000);
    expect(form.fields["229"]).toBe(100);
    expect(form.result).toBe(900);
    expect(form.warnings.join(" ")).toMatch(/meno tuloluokassa/);
  });
});

describe("Maatila 2025: yhteinen alv metsän kanssa", () => {
  it("alennettu kanta 14 % vuonna 2025", () => {
    expect(reducedVatRate("2025-12-31")).toBe(14);
    expect(defaultVatRate("agri_livestock_products", "2025-06-01", { vatRegistered: true })).toBe(14);
  });

  it("myynnin vero kokonaan, ostoista oma ja toisen toiminnon osuus, yksityinen ei", () => {
    const rows: VatRow[] = [
      { bookedOn: "2025-03-10", kind: "income", amountNet: 80000, amountGross: 91200, vatRate: 14, category: "agri_livestock_products" },
      { bookedOn: "2025-05-10", kind: "income", amountNet: 12000, amountGross: 15060, vatRate: 25.5, category: "agri_livestock_sale" },
      { bookedOn: "2025-06-10", kind: "income", amountNet: 20000, amountGross: 25100, vatRate: 25.5, category: "standing_sale" },
      { bookedOn: "2025-07-10", kind: "expense", amountNet: 20000, amountGross: 22800, vatRate: 14, category: "agri_feed" },
      { bookedOn: "2025-08-10", kind: "expense", amountNet: 1000, amountGross: 1100, vatRate: 10, category: "agri_veterinary" },
      // Sähkö: maatalous 60 %, metsätalous 30 %, yksityinen 10 %.
      { bookedOn: "2025-11-10", kind: "expense", amountNet: 1000, amountGross: 1255, vatRate: 25.5, category: "agri_energy", businessSharePct: 60, otherSharePct: 30 },
    ];
    const y = vatSummary(rows).year;
    // Myynnin vero 11 200 + 3 060 + 5 100 = 19 360.
    expect(y.output).toBe(19360);
    // Ostojen vero: 2 800 + 100 + sähkö 255 × 60 % = 153 + 255 × 30 % = 76,50 → 3 129,50; yksityinen 25,50.
    expect(y.input).toBe(3129.5);
    expect(y.nonDeductible).toBe(25.5);
    expect(y.payable).toBe(16230.5);
    expect(y.byActivity).toEqual({ agriculture: { output: 14260, input: 3053 }, forestry: { output: 5100, input: 76.5 } });
    // VSRALVKV: 301 = 3 060 + 5 100 = 8 160; 302 = 11 200.
    expect(y.form).toMatchObject({ general: 8160, reduced: 11200, ten: 0, deductible: 3129.5, payable: 16230.5 });
  });

  it("osien pyöristys täsmää kuittiin", () => {
    // Vero 25,51; 33,33 % → 8,50 kummallekin toiminnolle, yksityinen 25,51 − 17,00 = 8,51.
    const s = ownShare({ kind: "expense", amountNet: 100, amountGross: 125.51, businessSharePct: 33.33, otherSharePct: 33.33 });
    expect([s.vat, s.crossVat, s.nonDeductibleVat]).toEqual([8.5, 8.5, 8.51]);
    // Brutto: oma 33,33 + 8,50 = 41,83; toinen 41,83; yksityinen 125,51 − 83,66 = 41,85.
    expect([s.gross, s.crossGross, s.privateGross]).toEqual([41.83, 41.83, 41.85]);
  });
});

describe("Maatila 2025: VSY002", () => {
  const computed = compute2(computeForm2(input2025()));

  it("tarkistukset menevät läpi", () => {
    expect(computed.errors).toEqual([]);
    expect(computed.spec.recordId).toBe("VSY00225");
  });

  it("keskeiset rivit", () => {
    const lines = render2({ computed, filerId: "011073-998R", software: SKOG_SOFTWARE, createdAt: new Date("2026-02-01T10:00:00Z") }).split("\r\n");
    for (const l of [
      "000:VSY00225", "211:30001,00", "212:16000,34", "332:170620,34", "227:9000,00", "228:3000,00", "229:21000,00", "231:59500,00", "232:10000,00",
      "357:137387,00", "362:33233,34", "260:63000,00", "265:66750,00", "254:0,00", "364:40000,00", "367:10000,00", "368:27500,00", "584:37500,00",
      "281:1", "516:20000", "413:60,00", "416:50,00", "735:97900,00", "437:6000,00", "170:3000,00", "171:4000,00", "172:10000,00", "174:4000,00",
    ]) {
      expect(lines).toContain(l);
    }
    expect(lines.some((l) => l.startsWith("363:"))).toBe(false);
    // Tulot ennen menoja ja tulosta, korotetun poiston erittely ennen varallisuutta.
    expect(lines.indexOf("332:170620,34")).toBeLessThan(lines.indexOf("357:137387,00"));
    expect(lines.indexOf("584:37500,00")).toBeLessThan(lines.indexOf("735:97900,00"));
  });
});
