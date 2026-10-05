import { describe, expect, it } from "vitest";
import { generalVatRate, lowestVatRate, reducedVatRate, vatRateGroup, vatRatesOn } from "@/lib/tax/rules";
import { vatFormRows } from "@/lib/tax/vat";

/** Historialliset arvonlisäverokannat Tilitukin vanhoille vuosille (DECISIONS 5.10.2026, koko historia). */

describe("historialliset arvonlisäverokannat", () => {
  it("yleinen kanta 22, 23, 24 ja 25,5 %", () => {
    expect(generalVatRate("2002-05-01")).toBe(22);
    expect(generalVatRate("2010-06-30")).toBe(22);
    expect(generalVatRate("2010-07-01")).toBe(23);
    expect(generalVatRate("2012-12-31")).toBe(23);
    expect(generalVatRate("2013-01-01")).toBe(24);
    expect(generalVatRate("2024-08-31")).toBe(24);
    expect(generalVatRate("2024-09-01")).toBe(25.5);
  });

  it("alennettu kanta 17, 12, 13, 14 ja 13,5 %", () => {
    expect(reducedVatRate("2005-01-01")).toBe(17);
    expect(reducedVatRate("2009-09-30")).toBe(17);
    expect(reducedVatRate("2009-10-01")).toBe(12);
    expect(reducedVatRate("2010-07-01")).toBe(13);
    expect(reducedVatRate("2013-01-01")).toBe(14);
    expect(reducedVatRate("2026-01-01")).toBe(13.5);
  });

  it("alin kanta 8, 9 ja 10 %", () => {
    expect(lowestVatRate("2008-01-01")).toBe(8);
    expect(lowestVatRate("2010-07-01")).toBe(9);
    expect(lowestVatRate("2013-01-01")).toBe(10);
  });

  it("päivän kannat tarkistukseen", () => {
    expect(vatRatesOn("2010-03-31")).toEqual([22, 12, 8, 0]);
    expect(vatRatesOn("2010-08-01")).toEqual([23, 13, 9, 0]);
    expect(vatRatesOn("2024-10-01")).toEqual([25.5, 14, 10, 0]);
    // Vuodesta 2025 myös 14 %, vaikka elintarvikkeet ovat 2026 alkaen 13,5 %.
    expect(vatRatesOn("2026-02-01")).toEqual([25.5, 14, 13.5, 10, 0]);
  });

  it("vanhat kannat oikeisiin ilmoituksen kohtiin", () => {
    expect(vatRateGroup(22)).toBe("general");
    expect(vatRateGroup(23)).toBe("general");
    expect(vatRateGroup(17)).toBe("reduced");
    expect(vatRateGroup(12)).toBe("reduced");
    expect(vatRateGroup(13)).toBe("reduced");
    expect(vatRateGroup(8)).toBe("ten");
    expect(vatRateGroup(9)).toBe("ten");
  });

  it("ilmoituksen kohtien nimet vuoden kannoista", () => {
    const rows = vatFormRows(2010, { general: 0, reduced: 0, ten: 0, deductible: 0, payable: 0 });
    expect(rows[0][1]).toBe("Vero 22 % tai 23 %");
    expect(rows[1][1]).toBe("Vero 12 % tai 13 %");
    expect(rows[2][1]).toBe("Vero 8 % tai 9 %");
    expect(vatFormRows(2025, { general: 0, reduced: 0, ten: 0, deductible: 0, payable: 0 })[2][1]).toBe("Vero 10 %");
  });
});
