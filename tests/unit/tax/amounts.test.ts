import { describe, expect, it } from "vitest";
import { grossFromNet, netFromGross, round2, splitGross, vatOf } from "@/lib/tax/amounts";

describe("brutto ja veroton", () => {
  it("veroton bruttosta, vero erotuksena: kuitin summa säilyy", () => {
    expect(splitGross(125.5, 25.5)).toEqual({ net: 100, vat: 25.5, gross: 125.5 });
    expect(splitGross(41.83, 25.5)).toEqual({ net: 33.33, vat: 8.5, gross: 41.83 });
    expect(splitGross(10, 25.5)).toEqual({ net: 7.97, vat: 2.03, gross: 10 });
    expect(splitGross(99.99, 14)).toEqual({ net: 87.71, vat: 12.28, gross: 99.99 });
    expect(splitGross(500, 0)).toEqual({ net: 500, vat: 0, gross: 500 });
  });

  it("pyöristys puolikas pois nollasta kuten Postgresin round", () => {
    // 1,255 / 1,255 = 1 tarkasti; 0,01255 → 0,01; puolikas: 12,55 / 1,255 = 10 tarkasti
    expect(netFromGross(12.55, 25.5)).toBe(10);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(-0.125)).toBe(-0.13);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    // Negatiivinen summa (hyvitys) pyöristyy symmetrisesti.
    expect(netFromGross(-41.83, 25.5)).toBe(-33.33);
  });

  it("vanhan sovelluksen brutto verottomasta antaa takaisin saman verottoman", () => {
    for (const rate of [0, 10, 14, 24, 25.5]) {
      for (const net of [0.01, 1, 33.33, 99.99, 1234.56, 15000, 7.97, -250.1]) {
        const gross = grossFromNet(net, rate);
        expect(netFromGross(gross, rate)).toBe(net);
        expect(vatOf(net, gross)).toBe(round2(gross - net));
      }
    }
    expect(grossFromNet(15000, 25.5)).toBe(18825);
    expect(grossFromNet(33.33, 25.5)).toBe(41.83);
  });
});
