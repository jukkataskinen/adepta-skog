import { describe, expect, it } from "vitest";
import {
  activitiesOf,
  agriAssetChoices,
  allowsOtherShare,
  CATEGORIES,
  categoriesFor,
  categoryActivity,
  crossCategory,
  defaultVatRate,
  FORESTRY_CATEGORIES,
  parseAgriAssetChoice,
  reducedVatRate,
  smallAssetLimit,
  vatRateGroup,
} from "@/lib/tax/rules";
import { activityPart, activityRows, ownShare } from "@/lib/tax/share";

/** Maatalouden säännöt ja luokat (docs/maatalous-suunnitelma-2026-10-02.md, DECISIONS 2.10.2026). */

describe("luokat", () => {
  it("numerot ja tunnukset ovat yksilöllisiä koko luettelossa", () => {
    expect(new Set(CATEGORIES.map((c) => c.no)).size).toBe(CATEGORIES.length);
    expect(new Set(CATEGORIES.map((c) => c.code)).size).toBe(CATEGORIES.length);
  });

  it("maatalouden luokat alkavat agri_ ja niillä on lomakkeen 2 kenttä", () => {
    for (const c of CATEGORIES) {
      expect(categoryActivity(c.code)).toBe(c.activity);
      if (c.activity === "agriculture") {
        expect(c.code.startsWith("agri_")).toBe(true);
        expect(c.form2, c.code).toBeTruthy();
        expect(c.no).toBeGreaterThanOrEqual(21);
      }
    }
  });

  it("metsätalouden luokat ovat ennallaan (1–12)", () => {
    expect(FORESTRY_CATEGORIES.map((c) => c.no).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("MYEL-maksut menevät lomakkeen 2 kohtaan 230 (Jukka 2.10.2026)", () => {
    expect(CATEGORIES.find((c) => c.code === "agri_myel")).toMatchObject({ label: "MYEL-maksut", kind: "expense", vat: "none", form2: "230" });
  });

  it("pelkkä metsäasiakas näkee vain metsätalouden luokat", () => {
    expect(categoriesFor({ hasForestry: true, hasAgriculture: false })).toEqual(FORESTRY_CATEGORIES);
    expect(categoriesFor({ hasForestry: false, hasAgriculture: true }).every((c) => c.activity === "agriculture")).toBe(true);
    expect(activitiesOf({ hasForestry: false, hasAgriculture: false })).toEqual(["forestry"]);
    expect(activitiesOf({ hasForestry: true, hasAgriculture: true })).toEqual(["forestry", "agriculture"]);
  });

  it("toisen toiminnon luokka", () => {
    expect(crossCategory("agri_energy")).toBe("other_expense");
    expect(crossCategory("agri_wages")).toBe("wages");
    expect(crossCategory("other_expense")).toBe("agri_other_purchases");
    expect(crossCategory("wages")).toBe("agri_wages");
    expect(allowsOtherShare("agri_energy")).toBe(true);
    expect(allowsOtherShare("delivery_work")).toBe(false);
    expect(allowsOtherShare("agri_crops")).toBe(false);
    expect(allowsOtherShare("agri_asset_purchase")).toBe(false);
  });
});

describe("arvonlisäverokannat", () => {
  it("alennettu kanta 14 % vuonna 2025 ja 13,5 % 1.1.2026 alkaen", () => {
    expect(reducedVatRate("2025-12-31")).toBe(14);
    expect(reducedVatRate("2026-01-01")).toBe(13.5);
  });

  it("luokan oletus päivän mukaan, rekisteröimättömälle 0 %", () => {
    const reg = { vatRegistered: true };
    expect(defaultVatRate("agri_livestock_products", "2025-06-01", reg)).toBe(14);
    expect(defaultVatRate("agri_livestock_products", "2026-06-01", reg)).toBe(13.5);
    expect(defaultVatRate("agri_livestock_sale", "2026-06-01", reg)).toBe(25.5);
    expect(defaultVatRate("agri_state_subsidy", "2026-06-01", reg)).toBe(0);
    expect(defaultVatRate("agri_feed", "2026-06-01", { vatRegistered: false })).toBe(0);
  });

  it("verokannan ryhmä", () => {
    expect(vatRateGroup(25.5)).toBe("general");
    expect(vatRateGroup(24)).toBe("general");
    expect(vatRateGroup(14)).toBe("reduced");
    expect(vatRateGroup(13.5)).toBe("reduced");
    expect(vatRateGroup(10)).toBe("ten");
    expect(vatRateGroup(0)).toBe("zero");
  });
});

describe("maatalouden investoinnit", () => {
  it("korotettu poisto on valittavissa vain vuoteen 2025", () => {
    expect(agriAssetChoices(2025).some((c) => c.id === "agri_machinery_accelerated")).toBe(true);
    expect(agriAssetChoices(2026).some((c) => c.id === "agri_machinery_accelerated")).toBe(false);
    expect(parseAgriAssetChoice("agri_machinery_accelerated", 2025)).toEqual({ assetClass: "agri_machinery", accelerated: true, pct: 25 });
    expect(parseAgriAssetChoice("agri_machinery_accelerated", 2026)).toBeNull();
    expect(parseAgriAssetChoice("agri_drainage", 2026)).toEqual({ assetClass: "agri_drainage", accelerated: false, pct: 20 });
    expect(parseAgriAssetChoice("25", 2026)).toBeNull();
  });

  it("pienhankinnan raja toiminnon mukaan", () => {
    expect(smallAssetLimit("forestry")).toBe(600);
    expect(smallAssetLimit("agriculture")).toBe(1200);
  });
});

describe("osuudet kolmelle", () => {
  it("sähkölasku 70 % maatalous, 20 % metsä, 10 % yksityinen", () => {
    // 1 255 € sis. alv 25,5 %: veroton 1 000, vero 255.
    const s = ownShare({ kind: "expense", amountNet: 1000, amountGross: 1255, businessSharePct: 70, otherSharePct: 20 });
    expect(s).toMatchObject({ net: 700, vat: 178.5, crossPct: 20, crossNet: 200, crossVat: 51, crossGross: 251, nonDeductibleVat: 25.5, privateGross: 125.5 });
    expect(s.gross + s.crossGross + s.privateGross).toBe(1255);
  });

  it("toisen toiminnon osuus ei ole tuloilla, ja osuudet ovat enintään 100 %", () => {
    expect(ownShare({ kind: "income", amountNet: 1000, amountGross: 1255, businessSharePct: 50, otherSharePct: 50 }).crossPct).toBe(0);
    expect(ownShare({ kind: "expense", amountNet: 1000, amountGross: 1000, businessSharePct: 80, otherSharePct: 50 }).crossPct).toBe(20);
  });

  it("kirjauksen osa toiminnolle", () => {
    const row = { kind: "expense" as const, category: "agri_energy", amountNet: 1000, amountGross: 1255, businessSharePct: 70, otherSharePct: 20 };
    expect(activityPart(row, "agriculture")).toMatchObject({ category: "agri_energy", amountNet: 700, amountGross: 878.5, cross: false });
    expect(activityPart(row, "forestry")).toMatchObject({ category: "other_expense", amountNet: 200, amountGross: 251, cross: true });
    const forest = { kind: "income" as const, category: "standing_sale", amountNet: 1000, amountGross: 1255 };
    expect(activityPart(forest, "agriculture")).toBeNull();
    expect(activityRows([row, forest], "forestry").map((r) => r.category)).toEqual(["other_expense", "standing_sale"]);
  });
});
