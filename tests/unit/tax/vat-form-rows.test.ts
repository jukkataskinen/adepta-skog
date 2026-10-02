import { describe, expect, it } from "vitest";
import { vatFormRows } from "@/lib/tax/vat";

describe("alv-ilmoituksen kenttien tekstit", () => {
  const form = { general: 1, reduced: 2, ten: 3, deductible: 4, payable: -5 };
  it("verokanta tulee vuoden kannoista", () => {
    expect(vatFormRows(2024, form).map((r) => r[1]).slice(0, 2)).toEqual(["Vero 24 % tai 25,5 %", "Vero 14 %"]);
    expect(vatFormRows(2025, form).map((r) => r[1]).slice(0, 2)).toEqual(["Vero 25,5 %", "Vero 14 %"]);
    expect(vatFormRows(2026, form).map((r) => r[1]).slice(0, 2)).toEqual(["Vero 25,5 %", "Vero 13,5 %"]);
  });
  it("palautettava vero näytetään positiivisena", () => {
    expect(vatFormRows(2025, form)[4]).toEqual(["308", "Palautettava vero", 5]);
  });
});
