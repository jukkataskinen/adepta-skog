import { describe, expect, it } from "vitest";
import {
  emptyGridRow,
  EMPTY_FILTER,
  gridColumns,
  gridRowVisible,
  isFilterActive,
  matchesLedgerFilter,
  nextVisibleRow,
  parseLedgerFilter,
  planGridChanges,
  rowFromStored,
  rowLivestockDeferral,
  selectCategory,
  validateGridRow,
  type GridRow,
} from "@/lib/ledger/grid";
import { allowsLivestockDeferral, isLivestockDeferral, withLivestockDeferral } from "@/lib/tax/rules";

/** Kirjanpidon suodatin ja haku, kirjauksen maatila ja kotieläinten jaksotus taulukossa (0018). */

const FARM_A = "11111111-1111-4111-8111-111111111111";
const FARM_B = "22222222-2222-4222-8222-222222222222";
const row = (over: Partial<GridRow> = {}): GridRow => ({ ...emptyGridRow("k1", "1.3.2025"), ...over });
const opts = {
  year: 2025, propertyIds: [], farmIds: [FARM_A, FARM_B], vatRegistered: true, saleableAssetIds: () => [], activities: ["forestry", "agriculture"] as ("forestry" | "agriculture")[],
};

describe("suodatin", () => {
  const t = { bookedOn: "2025-03-14", category: "agri_fuels", description: "Diesel Neste", reference: "Lasku 123", amountGross: 1255.5 };

  it("luokka, kuukausi ja teksti", () => {
    expect(matchesLedgerFilter(t, EMPTY_FILTER)).toBe(true);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, category: "agri_fuels" })).toBe(true);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, category: "agri_feed" })).toBe(false);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, month: 3 })).toBe(true);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, month: 4 })).toBe(false);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, text: "neste" })).toBe(true);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, text: "lasku 123" })).toBe(true);
    // Luokan nimi ja numero.
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, text: "polttoaine" })).toBe(true);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, text: "44" })).toBe(true);
    // Summa suomalaisittain.
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, text: "1 255,50" })).toBe(true);
    expect(matchesLedgerFilter(t, { ...EMPTY_FILTER, text: "999" })).toBe(false);
  });

  it("osoitteen parametrit: kelvoton arvo ei rajaa", () => {
    expect(parseLedgerFilter({ luokka: "agri_feed", kk: "12", haku: "rehu" })).toEqual({ category: "agri_feed", month: 12, text: "rehu" });
    expect(parseLedgerFilter({ luokka: "eioo", kk: "13" })).toEqual(EMPTY_FILTER);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, text: " x " })).toBe(true);
  });

  it("taulukko: tallentamaton rivi näkyy aina, tallennettu suodatetaan", () => {
    const filter = { ...EMPTY_FILTER, month: 5 };
    expect(gridRowVisible(row({ description: "uusi" }), filter, 2025)).toBe(true);
    expect(gridRowVisible(row({ id: "x", bookedOn: "1.3.2025" }), filter, 2025)).toBe(false);
    expect(gridRowVisible(row({ id: "x", bookedOn: "2.5.2025" }), filter, 2025)).toBe(true);
  });

  it("näppäinsiirto ohittaa piilotetut rivit", () => {
    const visible = [true, false, false, true, false];
    expect(nextVisibleRow(visible, 0, 1)).toBe(3);
    expect(nextVisibleRow(visible, 3, 2)).toBe(0);
    expect(nextVisibleRow(visible, 3, 4)).toBeNull();
    expect(nextVisibleRow(visible, 0, 0)).toBe(0);
  });
});

describe("kirjauksen maatila", () => {
  it("sarake vain, kun tiloja on useampi (näkymä päättää)", () => {
    expect(gridColumns(false, false, true)).toContain("farmId");
    expect(gridColumns(false, false)).not.toContain("farmId");
  });

  it("maatalouden rivi saa tilan, metsätalouden rivin tila jää pois, vieras tila on virhe", () => {
    const agri = validateGridRow(row({ category: "agri_fuels", amountGross: "100", farmId: FARM_A }), opts);
    expect(agri.ok && agri.value.farmId).toBe(FARM_A);
    const forest = validateGridRow(row({ category: "other_expense", amountGross: "100", farmId: FARM_A }), opts);
    expect(forest.ok && forest.value.farmId).toBeNull();
    const bad = validateGridRow(row({ category: "agri_fuels", amountGross: "100", farmId: "33333333-3333-4333-8333-333333333333" }), opts);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors.farmId).toMatch(/maatila/);
  });

  it("tilan vaihto on muutos, ja metsätalouden luokka tyhjentää tilan", () => {
    const stored = rowFromStored({
      id: "t1", booked_on: "2025-03-01", kind: "expense", category: "agri_fuels", description: "", amount_gross: "100", vat_rate: "25.5", withholding: "0",
      reference: null, asset_id: null, forest_property_id: null, farm_id: FARM_A,
    });
    expect(stored.farmId).toBe(FARM_A);
    expect(planGridChanges([stored], [{ ...stored, farmId: FARM_B }], [], 2025).updated).toHaveLength(1);
    expect(selectCategory(stored, "other_expense", 2025, { vatRegistered: true }).farmId).toBe("");
  });
});

describe("kotieläinten jaksotus taulukossa", () => {
  it("Jaksota vaihtaa luokan parin, muut luokat ennallaan", () => {
    expect(withLivestockDeferral("agri_livestock_sale", true)).toBe("agri_livestock_sale_deferred");
    expect(withLivestockDeferral("agri_livestock_purchase_deferred", false)).toBe("agri_livestock_purchase");
    expect(withLivestockDeferral("agri_feed", true)).toBe("agri_feed");
    expect(allowsLivestockDeferral("agri_livestock_purchase")).toBe(true);
    expect(isLivestockDeferral("agri_livestock_sale")).toBe(false);
  });

  it("rivin alle vuosierät kirjauksen vuodesta alkaen", () => {
    const r = row({ category: "agri_livestock_sale_deferred", kind: "income", amountGross: "12 550", vatRate: "25,5", bookedOn: "10.6.2025" });
    expect(rowLivestockDeferral(r, 2025, { vatRegistered: true })).toEqual([
      { year: 2025, amount: 3333.34 },
      { year: 2026, amount: 3333.33 },
      { year: 2027, amount: 3333.33 },
    ]);
    expect(rowLivestockDeferral(row({ category: "agri_livestock_sale", amountGross: "100" }), 2025, { vatRegistered: true })).toBeNull();
  });
});
