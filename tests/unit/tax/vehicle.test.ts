import { describe, expect, it } from "vitest";
import { computeVehicleReport, EMPTY_VEHICLE_REPORT, hasVehicleReport, type VehicleReportInput } from "@/lib/tax/vehicle";
import { computeForm2, livestockDeferralFor, type Form2Input } from "@/lib/tax/agriculture";
import { travelRates } from "@/lib/tax/rules";
import { compute2c, type Filing2cData } from "@/lib/filing/vsy02c";

/**
 * Ajoneuvo- ja matkaselvitys (lomake 2, kohdat 7–9; 0018) ja kotieläinten
 * jaksotus kirjauksesta. Luvut ovat kuvitteellisia.
 */

const report = (over: Partial<VehicleReportInput>): VehicleReportInput => ({ ...EMPTY_VEHICLE_REPORT, ...over });

const emptyYear = {
  spouseWealthSharePct: null, spouseWorkSharePct: null, incomeSplitClaim: null, lossToCapitalIncome: null, wagesSubjectToWithholding: 0, landValue: null,
  rentalDwellingsValue: null, sharesValue: null, otherAssetsValue: null, liabilities: null, otherFarmAssets: null,
};

function form(over: Partial<Form2Input> = {}): Form2Input {
  return {
    year: 2026,
    vatRegistered: true,
    rows: [
      { kind: "income", category: "agri_crops", amountNet: 40000, amountGross: 45400, vatRate: 13.5 },
      { kind: "expense", category: "agri_fuels", amountNet: 6000, amountGross: 7530, vatRate: 25.5 },
    ],
    ledgerDeferrals: [],
    manualDeferrals: [],
    depreciation: { year: 2026, pools: [], total: 0, excess: 0 },
    reserves: [],
    agriYear: emptyYear,
    extras: [],
    ...over,
  };
}

describe("verovapaat matkakorvaukset", () => {
  it("vuoden 2026 ja 2025 arvot, tuntematon vuosi lähimmästä aiemmasta", () => {
    expect(travelRates(2026)).toMatchObject({ kmRate: 0.55, fullDay: 54, partDay: 25 });
    expect(travelRates(2025)).toMatchObject({ kmRate: 0.59, fullDay: 53, partDay: 24 });
    expect(travelRates(2027).year).toBe(2026);
    expect(travelRates(2020).year).toBe(2025);
  });
});

describe("ajoneuvo- ja matkaselvitys", () => {
  it("kaluston ajoneuvo: yksityis- ja metsätalouden osuus kilometrien suhteessa", () => {
    const r = computeVehicleReport(report({ vehicleBasis: 1, vehicleTotalKm: 20000, vehiclePrivateKm: 2000, vehicleForestryKm: 1000, vehicleCosts: 8000 }), 2026);
    expect(r.fields).toMatchObject({ "281": 1, "516": 20000, "282": 8000, "283": 800, "284": 400 });
    expect(r.privateUseIncome).toBe(1200);
    expect(r.forestryTransfer).toBe(400);
    expect(r.errors).toEqual([]);
  });

  it("oma auto: kilometrikorvaus miinus jo vähennetty on lisävähennys", () => {
    const r = computeVehicleReport(report({ carBasis: 2, carTotalKm: 25000, carAgriKm: 4000, carDeducted: 500 }), 2026);
    expect(r.fields).toMatchObject({ "534": 2, "287": 25000, "288": 4000, "518": 2200, "519": 500, "285": 1700 });
    expect(r.additionalDeduction).toBe(1700);
  });

  it("matkat: päivärahat vuoden mukaan, yhteensä 532, 533 ja 286", () => {
    const r = computeVehicleReport(
      report({ tripsFullDays: 10, tripsFullDeducted: 100, tripsPartDays: 4, tripsAbroadDays: 2, tripsAbroadMax: 160, tripsAbroadDeducted: 200 }),
      2025,
    );
    expect(r.fields).toMatchObject({
      "401": 10, "402": 53, "403": 530, "404": 100, "405": 430, "406": 4, "407": 24, "408": 96, "410": 96, "411": 2, "423": 160, "424": 200,
      "532": 786, "533": 300, "286": 526,
    });
    // Ulkomaan matkassa vähennetty on enemmän kuin enimmäismäärä: lisävähennys ei ole negatiivinen.
    expect(r.fields["425"]).toBeUndefined();
    expect(r.additionalDeduction).toBe(526);
  });

  it("puutteet: peruste ja kilometrit", () => {
    const r = computeVehicleReport(report({ vehicleCosts: 5000, vehiclePrivateKm: 100 }), 2026);
    expect(r.errors.join(" ")).toMatch(/281/);
    expect(r.errors.join(" ")).toMatch(/516/);
    expect(hasVehicleReport(report({}))).toBe(false);
    expect(hasVehicleReport(report({ carAgriKm: 1 }))).toBe(true);
  });

  it("lomake 2: tuloutus kohtaan 221, lisävähennykset kohtaan 464 ja käsin annetut kentät korvautuvat", () => {
    const vehicle = report({ vehicleBasis: 1, vehicleTotalKm: 10000, vehiclePrivateKm: 1000, vehicleForestryKm: 500, vehicleCosts: 6000, carBasis: 1, carTotalKm: 1000, carAgriKm: 1000 });
    const r = computeForm2(form({ vehicle, extras: [{ code: "283", value: 9999 }, { code: "279", value: 100 }] }));
    expect(r.fields["283"]).toBe(600);
    expect(r.fields["284"]).toBe(300);
    expect(r.fields["221"]).toBe(900);
    expect(r.fields["464"]).toBe(550);
    expect(r.fields["279"]).toBe(100);
    expect(r.forestryTransfer).toBe(300);
    expect(r.income).toBe(40900);
    expect(r.expense).toBe(6550);
    expect(r.warnings.join(" ")).toMatch(/korvaa|jätetty pois/);
    expect(r.errors).toEqual([]);
  });

  it("ilman selvitystä käsin annetut kentät toimivat kuten ennen eivätkä siirry 2C:hen", () => {
    const r = computeForm2(form({ extras: [{ code: "281", value: 1 }, { code: "284", value: 300 }] }));
    expect(r.fields["284"]).toBe(300);
    expect(r.fields["221"]).toBeUndefined();
    expect(r.forestryTransfer).toBe(0);
  });

  it("yksityiskäytön tuloutuskirjaus samaan aikaan: varoitus", () => {
    const vehicle = report({ vehicleBasis: 1, vehicleTotalKm: 10000, vehiclePrivateKm: 1000, vehicleCosts: 6000 });
    const rows = [...form().rows, { kind: "income" as const, category: "agri_private_use", amountNet: 500, amountGross: 500, vatRate: 0 }];
    expect(computeForm2(form({ vehicle, rows })).warnings.join(" ")).toMatch(/kahdesti/);
  });
});

describe("2C: toisesta tulolähteestä siirrettävät menot (630)", () => {
  const data = (over: Partial<Filing2cData> = {}): Filing2cData => ({
    year: 2026, vatRegistered: true, categories: { standing_sale: { net: 10000, gross: 12550 } }, assets: [], transfersOut: [], forestDeduction: 0,
    tracking: null, planConfirmed: true, yearOpen: false, hasDisposals: false, ...over,
  });
  const field = (c: ReturnType<typeof compute2c>, code: string) => c.fields.find((f) => f.code === code)?.value;

  it("630 pienentää metsätalouden pääomatuloa kaavan mukaan", () => {
    const c = compute2c(data({ otherSourceExpense: 400 }));
    expect(field(c, "630")).toBe(400);
    expect(field(c, "635")).toBe(9600);
    const order = c.fields.map((f) => f.code);
    expect(order.indexOf("630")).toBeGreaterThan(order.indexOf("690"));
    expect(order.indexOf("630")).toBeLessThan(order.indexOf("635"));
  });

  it("ilman siirtoa 630 puuttuu", () => {
    expect(field(compute2c(data()), "630")).toBeUndefined();
  });
});

describe("kotieläinten jaksotus kirjauksesta", () => {
  it("myynti ilman veroa, osuus huomioiden, kolme yhtä suurta erää", () => {
    const d = livestockDeferralFor({ category: "agri_livestock_sale_deferred", kind: "income", amountNet: 10000, amountGross: 12550, businessSharePct: 100 }, true);
    expect(d).toEqual({ kind: "livestock_sale", amount: 10000, split: [3333.34, 3333.33, 3333.33] });
  });

  it("hankinta verollisena, jos asiakas ei ole alv-velvollinen", () => {
    const d = livestockDeferralFor({ category: "agri_livestock_purchase_deferred", kind: "expense", amountNet: 3000, amountGross: 3765, businessSharePct: 100 }, false);
    expect(d).toEqual({ kind: "livestock_purchase", amount: 3765, split: [1255, 1255, 1255] });
  });

  it("muu luokka ei jaksotu", () => {
    expect(livestockDeferralFor({ category: "agri_livestock_sale", kind: "income", amountNet: 1000, amountGross: 1255, businessSharePct: 100 }, true)).toBeNull();
  });

  it("käsin syötetty epätasainen jako saa varoituksen, tasainen ei", () => {
    const uneven = computeForm2(form({ manualDeferrals: [{ year: 2025, kind: "livestock_sale", year1: 500, year2: 300, year3: 200 }] }));
    expect(uneven.fields["212"]).toBe(300);
    expect(uneven.warnings.join(" ")).toMatch(/ei ole jaettu tasan/);
    const even = computeForm2(form({ manualDeferrals: [{ year: 2025, kind: "livestock_sale", year1: 333.34, year2: 333.33, year3: 333.33 }] }));
    expect(even.warnings.join(" ")).not.toMatch(/tasan/);
  });
});
