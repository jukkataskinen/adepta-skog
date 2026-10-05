import { describe, expect, it } from "vitest";
import { buildYearPlan, dataYearRange, parseYears, yearEntries, yearRemaps, type TtFolder } from "@/lib/import/tilituki/map";
import { checkEntriesAgainstForm } from "@/lib/compare/tilituki-ledger";
import { acc, entry, farmFolder } from "../helpers/tilituki";

/**
 * Tilitukin koko historia (DECISIONS 5.10.2026): vanhat vuodet, esimerkkiaineisto, vuosikohtainen
 * tilikartoitus ja historialliset verokannat. Aineisto on kuviteltu.
 */

/** Kuvitteellinen tila, jonka Tilituki-kirjanpito alkaa 2005. Vuoden 2001 viennit ovat Tilitukin esimerkkiä. */
function oldFolder(): TtFolder {
  const base = farmFolder({ folder: "903" });
  return {
    ...base,
    accounts: [
      ...base.accounts,
      acc("6720", "Rakennusten vuokrat", "L2_257", "TU", 0, "K"),
      acc("6725", "Mökin vuokra", "L2_256", "TU", 10, "K"),
    ],
    entries: {
      "2001": [entry({ voucher: "1", row: 1, date: "2001-01-15", account: "2500", debit: 207.54 })],
      "2005": [
        entry({ voucher: "21", row: 1, date: "2005-03-31", account: "2500", debit: 1000, vatPct: 22, vat: 220 }),
        entry({ voucher: "21", row: 2, date: "2005-03-31", account: "3950", debit: 220 }),
        entry({ voucher: "22", row: 1, date: "2005-05-31", account: "4000", credit: 5000, vatPct: 17, vat: 850 }),
        entry({ voucher: "22", row: 2, date: "2005-05-31", account: "6942", credit: 850 }),
        // Tilin veronumero on myöhemmin vaihdettu majoitukseen; vuonna 2005 Tilituki vei sen kohtaan 220.
        entry({ voucher: "23", row: 1, date: "2005-06-30", account: "6725", credit: 1200 }),
      ],
      "2010": [
        // Kesäkuun lasku 22 %:lla on päivän kanta, elokuun 22 % ei ole (kanta nousi 1.7.2010).
        entry({ voucher: "31", row: 1, date: "2010-06-30", account: "2500", debit: 100, vatPct: 22, vat: 22 }),
        entry({ voucher: "31", row: 2, date: "2010-08-31", account: "2500", debit: 100, vatPct: 22, vat: 22 }),
        entry({ voucher: "31", row: 3, date: "2010-08-31", account: "3950", debit: 44 }),
      ],
    },
    buildings: [
      {
        id: "B9", number: "9", name: "Kone- ja varastohalli", type: 1, depreciationClass: 1, acquiredYear: "2005", cost: 0, maxPct: 10,
        years: {
          "2005": { start: 0, additions: 30000, sales: 0, compensation: 5000, grants: 0, equalization: 0, base: 25000, pct: 10, depreciation: 2500, end: 22500 },
        },
      },
    ],
    form2: { "2005": { "332": 6200, "357": 1000, "362": 5200, "226": 1000 } },
    form2c: {},
    form2Raw: { "2005": { L2_258: 1000, L2_255: 5000, L2_257: 1200 } },
    form2cRaw: {},
    templates: { entries: ["2001"], forms: [] },
  };
}

describe("vuosien valinta", () => {
  it("lista, väli ja virheet", () => {
    expect(parseYears("2023,2024,2025")).toEqual([2023, 2024, 2025]);
    expect(parseYears("2002-2004,2025")).toEqual([2002, 2003, 2004, 2025]);
    expect(parseYears("2025-2023")).toBeNull();
    expect(parseYears("1999")).toBeNull();
    expect(parseYears("abc")).toBeNull();
  });

  it("esimerkkiaineisto ohitetaan, ja asiakkaan vuodet ovat ensimmäisestä omasta viimeiseen", () => {
    const f = oldFolder();
    expect(yearEntries(f, 2001)).toEqual([]);
    expect(yearEntries(f, 2005)).toHaveLength(5);
    expect(dataYearRange(f)).toEqual({ first: 2005, last: 2010 });
    const plan = buildYearPlan(f, 2001);
    expect(plan.transactions).toEqual([]);
    expect(plan.ignored["Tilitukin esimerkkiaineisto"]).toBe(1);
  });
});

describe("vanha vuosi", () => {
  it("vuoden kartoitus Tilitukin lomakkeesta: tili, jonka veronumero on myöhemmin vaihdettu", () => {
    const f = oldFolder();
    expect([...yearRemaps(f, 2005)]).toEqual([["6725", "L2_257"]]);
    const plan = buildYearPlan(f, 2005);
    const rent = plan.transactions.find((t) => t.reference === "Tilituki 23");
    expect(rent?.category).toBe("agri_other_income");
    expect(checkEntriesAgainstForm(f, 2005).every((c) => c.ok)).toBe(true);
    // Ilman lomaketta tiliä ei siirretä.
    expect(yearRemaps(f, 2010).size).toBe(0);
  });

  it("historialliset verokannat säilyvät, ja päivälle kuulumaton kanta kerrotaan", () => {
    const f = oldFolder();
    const p2005 = buildYearPlan(f, 2005);
    expect(p2005.vatRegistered).toBe(true);
    expect(p2005.transactions.map((t) => t.vatRate).sort()).toEqual([0, 17, 22]);
    expect(p2005.notes["verokanta ei ole päivän kanta (Tilitukin kanta säilytetty)"]).toBeUndefined();
    const p2010 = buildYearPlan(f, 2010);
    expect(p2010.notes["verokanta ei ole päivän kanta (Tilitukin kanta säilytetty)"]).toBe(1);
  });

  it("rakennusmenoista vähennetään korvaus, ja puuttuvan ryhmän poisto otetaan kortilta", () => {
    const plan = buildYearPlan(oldFolder(), 2005);
    const add = plan.newAssets.find((a) => a.key === "building-add-B9-2005");
    expect(add?.acquisitionCost).toBe(25000);
    expect(plan.agriDepreciations).toContainEqual({ pool: "agri_production_building", amount: 2500 });
    expect(plan.notes["rakennusten poisto kortistosta (ryhmä puuttuu Tilitukin lomakkeelta)"]).toBe(1);
  });
});
