import { describe, expect, it } from "vitest";
import {
  ACTIVITY_MESSAGE,
  applyGridPaste,
  categoryDigit,
  emptyGridRow,
  gridColumns,
  gridKeyAction,
  menuCategories,
  menuGroupLabel,
  pastedCategory,
  planGridChanges,
  rowFromStored,
  rowShare,
  selectCategory,
  shareNote,
  validateGridRow,
  type GridRow,
} from "@/lib/ledger/grid";
const fmt = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/** Taulukkosyöttö maatalousasiakkaalle (DECISIONS 2.10.2026). */

const ASSET = "33333333-3333-4333-8333-333333333333";
const row = (over: Partial<GridRow> = {}): GridRow => ({ ...emptyGridRow("k1", "1.3.2025"), ...over });
const both = { hasForestry: true, hasAgriculture: true };
const opts = {
  year: 2025, propertyIds: [], vatRegistered: true, saleableAssetIds: () => [ASSET], activities: ["forestry", "agriculture"] as ("forestry" | "agriculture")[],
  assetActivity: () => "agriculture" as const,
};

describe("valikko ja numerot", () => {
  it("pelkkä metsäasiakas näkee luokat 1–12, ja 3 valitaan heti kuten ennen", () => {
    const menu = menuCategories({ hasForestry: true, hasAgriculture: false });
    expect(menu.map((c) => c.no).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(categoryDigit("", "3", menu.map((c) => c.no))).toEqual({ buffer: "", select: 3, highlight: 3 });
  });

  it("maatalousasiakkaalla 2 odottaa jatkoa ja 24 valitsee maidon", () => {
    const numbers = menuCategories(both).map((c) => c.no);
    const first = categoryDigit("", "2", numbers);
    expect(first.select).toBeNull();
    expect(categoryDigit(first.buffer, "4", numbers).select).toBe(24);
  });

  it("ryhmän otsikossa näkyy toiminto, kun molemmat ovat käytössä", () => {
    const menu = menuCategories(both);
    expect(menuGroupLabel(menu[0], true)).toBe("Metsätalous: Puukauppatulot");
    expect(menuGroupLabel(menu.find((c) => c.code === "agri_crops")!, true)).toBe("Maatalous: myynnit");
  });
});

describe("sarakkeet", () => {
  it("toisen toiminnon osuus vain, kun asiakkaalla on molemmat toiminnot, ja Enter ohittaa sen", () => {
    const columns = gridColumns(false, true);
    expect(columns).toEqual(["bookedOn", "description", "category", "amountGross", "vatRate", "businessSharePct", "otherSharePct", "kind"]);
    const k = { key: "Enter", shift: false, ctrl: false, row: 0, col: columns.indexOf("vatRate"), rowCount: 1, columns, menuOpen: false };
    expect(gridKeyAction(k)).toEqual({ type: "focus", row: 0, col: columns.indexOf("kind") });
    expect(gridKeyAction({ ...k, key: "Tab" })).toEqual({ type: "focus", row: 0, col: columns.indexOf("businessSharePct") });
  });
});

describe("tarkistus", () => {
  it("metsäasiakkaalle ei voi kirjata maatalouden luokkaa", () => {
    const r = validateGridRow(row({ category: "agri_crops", amountGross: "114" }), { ...opts, activities: ["forestry"] });
    expect(r).toEqual({ ok: false, errors: { category: ACTIVITY_MESSAGE } });
  });

  it("maidon oletuskanta 14 % vuonna 2025 ja 13,5 % vuonna 2026", () => {
    const r2025 = selectCategory(row(), "agri_livestock_products", 2025, { vatRegistered: true });
    expect(r2025.vatRate).toBe("14");
    const r2026 = selectCategory(row({ bookedOn: "1.3.2026" }), "agri_livestock_products", 2026, { vatRegistered: true });
    expect(r2026.vatRate).toBe("13,5");
  });

  it("toisen toiminnon osuus menolle, ei tulolle", () => {
    const ok = validateGridRow(row({ category: "agri_energy", amountGross: "1 255", vatRate: "25,5", businessSharePct: "70", otherSharePct: "20" }), opts);
    expect(ok.ok && ok.value).toMatchObject({ businessSharePct: 70, otherSharePct: 20 });
    const income = validateGridRow(row({ category: "agri_crops", amountGross: "114", otherSharePct: "20" }), opts);
    expect(income.ok).toBe(false);
    const over = validateGridRow(row({ category: "agri_energy", amountGross: "100", businessSharePct: "90", otherSharePct: "20" }), opts);
    expect(over.ok).toBe(false);
  });

  it("maatalouden investointi vaatii poistoryhmän ja yli 1 200 euroa", () => {
    const small = validateGridRow(row({ category: "agri_asset_purchase", amountGross: "1 506", vatRate: "25,5", assetRatePct: "agri_machinery" }), opts);
    expect(small.ok).toBe(false);
    const noClass = validateGridRow(row({ category: "agri_asset_purchase", amountGross: "50 000", vatRate: "25,5" }), opts);
    expect(noClass.ok).toBe(false);
    const ok = validateGridRow(row({ category: "agri_asset_purchase", amountGross: "50 000", vatRate: "25,5", assetRatePct: "agri_machinery_accelerated" }), opts);
    expect(ok.ok && ok.value).toMatchObject({ agriAssetChoice: "agri_machinery_accelerated", assetRatePct: null });
    // Korotettu poisto ei ole enää valittavissa vuonna 2026.
    const late = validateGridRow(row({ bookedOn: "1.3.2026", category: "agri_asset_purchase", amountGross: "50 000", assetRatePct: "agri_machinery_accelerated" }), { ...opts, year: 2026 });
    expect(late.ok).toBe(false);
  });

  it("metsän myynnillä ei voi myydä maatalouden investointia", () => {
    const r = validateGridRow(row({ category: "asset_sale", amountGross: "1000", saleAssetId: ASSET }), opts);
    expect(r.ok).toBe(false);
    const a = validateGridRow(row({ category: "agri_asset_sale", amountGross: "1000", saleAssetId: ASSET }), opts);
    expect(a.ok).toBe(true);
  });
});

describe("osuudet ja muutokset", () => {
  it("rivin alle näytetään osuudet toiminnoille ja yksityiseen", () => {
    const r = row({ category: "agri_energy", amountGross: "1 255,00", vatRate: "25,5", businessSharePct: "70", otherSharePct: "20" });
    const share = rowShare(r, 2025, { vatRegistered: true })!;
    expect(shareNote(r, share, fmt)).toBe("Maataloudelle 878,50 €, metsätaloudelle 251,00 €, yksityiseen 125,50 €. Alv:sta 25,50 € ei vähennetä.");
    const forest = row({ category: "other_expense", amountGross: "251,00", vatRate: "25,5", businessSharePct: "50" });
    expect(shareNote(forest, rowShare(forest, 2025, { vatRegistered: true })!, fmt)).toBe("Metsätaloudelle 125,50 €, muulle 125,50 €. Alv:sta 25,50 € ei vähennetä.");
  });

  it("toisen toiminnon osuuden muutos on muutos, ja tallennettu osuus luetaan", () => {
    const stored = rowFromStored({
      id: "44444444-4444-4444-8444-444444444444", booked_on: "2025-04-30", kind: "expense", category: "agri_energy", description: "Sähkö", amount_gross: "1255.00",
      vat_rate: "25.50", withholding: "0", business_share_pct: "70.00", other_share_pct: "20.00", reference: null, asset_id: null, forest_property_id: null,
    });
    expect(stored.otherSharePct).toBe("20");
    const changed = { ...stored, otherSharePct: "25" };
    expect(planGridChanges([stored], [changed], [], 2025).updated).toHaveLength(1);
    expect(planGridChanges([stored], [{ ...stored, otherSharePct: "20,00" }], [], 2025).updated).toHaveLength(0);
  });

  it("Excelin liitoksessa luokka numerolla ja toisen toiminnon osuus viimeisenä", () => {
    expect(pastedCategory("46")).toBe("agri_energy");
    expect(pastedCategory("Maito ja muut kotieläintuotteet")).toBe("agri_livestock_products");
    let n = 0;
    const rows = applyGridPaste([emptyGridRow("a", "")], 0, "bookedOn", [["30.4.2025", "Sähkö", "46", "1255", "25,5", "", "", "70", "20"]], {
      year: 2025, properties: [], newKey: () => `n${n++}`,
    });
    expect(rows[0]).toMatchObject({ category: "agri_energy", businessSharePct: "70", otherSharePct: "20" });
  });
});
