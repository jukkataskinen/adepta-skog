import { describe, expect, it } from "vitest";
import { deliveryWorkValue } from "@/lib/tax/delivery-work";

describe("hankintatyön arvo", () => {
  it("ohjetaksat 2025: valmistus ja kuljetus puutavaralajeittain", () => {
    const r = deliveryWorkValue(2025, [
      { code: "pine_pulp", made: 50, transported: 50 },
      { code: "spruce_log", made: 20, transported: 0 },
    ]);
    // 50 × 15,00 + 50 × 2,63 + 20 × 8,38
    expect(r).toMatchObject({ ratesYear: 2025, made: 70, transported: 50, total: 1049.1, taxable: 0, taxFree: 1049.1 });
  });

  it("yli 125 m³:n osuus on ansiotuloa kertoimella, erikseen valmistukselle ja kuljetukselle", () => {
    const r = deliveryWorkValue(2025, [{ code: "birch_pulp", made: 250, transported: 100 }]);
    // Valmistus 250 × 13,87 = 3 467,50, kerroin (250 − 125) / 250 = 0,5. Kuljetus 100 m³ alle rajan.
    expect(r).toMatchObject({ total: 3774.5, taxable: 1733.75, taxFree: 2040.75 });
  });

  it("vuodelle ilman omia taksoja käytetään uusimpia", () => {
    expect(deliveryWorkValue(2026, [{ code: "firewood", made: 1, transported: 1 }])).toMatchObject({ ratesYear: 2025, total: 34.51 });
  });

  it("tuntematon laji ja tyhjät rivit ohitetaan", () => {
    expect(deliveryWorkValue(2025, [{ code: "x", made: 10, transported: 10 }, { code: "pine_log", made: 0, transported: 0 }]).lines).toEqual([]);
  });
});
