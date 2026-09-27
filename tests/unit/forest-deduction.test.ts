import { describe, expect, it } from "vitest";
import { forestDeductionBase } from "@/lib/tax/forest-deduction";

describe("metsävähennyksen pohja", () => {
  it("vuodesta 2026 pohja on 75 %, eli vanha pohja kerrottuna 1,25:llä", () => {
    expect(forestDeductionBase({ acquisitionPrice: 120000, forestLandSharePct: 80, usedBefore: 0, recorded: [] }, 2026).base).toBe(72000);
  });

  it("60 % metsämaan osuudesta hankintahinnasta", () => {
    expect(forestDeductionBase({ acquisitionPrice: 120000, forestLandSharePct: 80, usedBefore: 2000, recorded: [3000, 1500.5] }, 2025)).toEqual({
      base: 57600,
      used: 6500.5,
      remaining: 51099.5,
    });
  });

  it("jäljellä ei mene miinukselle", () => {
    expect(forestDeductionBase({ acquisitionPrice: 10000, forestLandSharePct: 100, usedBefore: 7000, recorded: [] }, 2025).remaining).toBe(0);
  });

  it("ilman hankintatietoja pohjaa ei lasketa", () => {
    expect(forestDeductionBase({ acquisitionPrice: null, forestLandSharePct: 80, usedBefore: 0, recorded: [100] }, 2025)).toEqual({ base: null, used: 100, remaining: null });
  });
});
