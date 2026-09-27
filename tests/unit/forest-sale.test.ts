import { describe, expect, it } from "vitest";
import { forestDeductionPool, forestSales, type ForestPropertyInput } from "@/lib/tax/forest-sale";
import { allocateForestDeduction } from "@/lib/tax/plan";

/** Verohallinnon ohje Metsävähennys, luku 7. Metsän osuus 100 %, jotta luvut vastaavat ohjeen esimerkkejä. */
const forest = (p: Partial<ForestPropertyInput> & { id: string }): ForestPropertyInput => ({
  acquisitionPrice: 100000, acquiredOn: "2023-01-10", forestLandSharePct: 100, usedBefore: 0, deductions: [],
  disposedOn: null, salePrice: null, noDeductionAddition: false, ...p,
});

describe("metsätilan myynti", () => {
  it("esimerkki 32: lisäys on kaikki käytetty vähennys, enintään myydyn metsän vähennysoikeus", () => {
    const sold = forest({ id: "a", disposedOn: "2026-05-01", salePrice: 150000 });
    const other = forest({ id: "b", acquisitionPrice: 250000, acquiredOn: "2015-01-01", deductions: [{ taxYear: 2024, amount: 50000 }, { taxYear: 2025, amount: 30000 }] });
    const [s] = forestSales([sold, other]);
    expect(s).toMatchObject({ year: 2026, addition: 60000, cost: 100000, deemedCost: false, gain: 110000 });
  });

  it("lisäys tehdään myös luovutustappioon, ja se voi kääntää tappion voitoksi", () => {
    const s = forestSales([forest({ id: "a", acquisitionPrice: 200000, acquiredOn: "2006-01-01", deductions: [{ taxYear: 2008, amount: 72000 }], disposedOn: "2019-06-01", salePrice: 100000 })]);
    // Olettama 40 % (omistettu yli 10 vuotta) = 40 000 < hankintameno 200 000. 100 000 − 200 000 + 72 000.
    expect(s[0]).toMatchObject({ addition: 72000, gain: -28000 });
  });

  it("aiemmin lisätty vähennys ei lisäänny uudelleen", () => {
    const props = [
      forest({ id: "a", deductions: [{ taxYear: 2024, amount: 40000 }], disposedOn: "2025-03-01", salePrice: 120000 }),
      forest({ id: "b", acquiredOn: "2020-01-01", disposedOn: "2026-03-01", salePrice: 120000 }),
    ];
    const s = forestSales(props);
    expect(s.map((x) => x.addition)).toEqual([40000, 0]);
  });

  it("samana vuonna myydyt tilat jakavat lisäyksen vähennysoikeuksien suhteessa", () => {
    const props = [
      forest({ id: "a", acquisitionPrice: 100000, deductions: [{ taxYear: 2024, amount: 30000 }], disposedOn: "2025-03-01", salePrice: 1 }),
      forest({ id: "b", acquisitionPrice: 200000, disposedOn: "2025-09-01", salePrice: 1 }),
    ];
    expect(forestSales(props).map((x) => x.addition)).toEqual([10000, 20000]);
  });

  it("lahjassa ja samana vuonna hankitussa metsässä lisäystä ei tehdä", () => {
    const used = forest({ id: "u", acquiredOn: "2010-01-01", deductions: [{ taxYear: 2020, amount: 20000 }] });
    expect(forestSales([used, forest({ id: "g", noDeductionAddition: true, disposedOn: "2025-01-01", salePrice: 1 })])[0].addition).toBe(0);
    expect(forestSales([used, forest({ id: "s", acquiredOn: "2025-02-01", disposedOn: "2025-11-01", salePrice: 1 })])[0].addition).toBe(0);
  });

  it("verovuodesta 2027 lisäyksen enimmäismäärä on 75 %", () => {
    const s = forestSales([forest({ id: "a", deductions: [{ taxYear: 2026, amount: 90000 }], disposedOn: "2027-01-15", salePrice: 100000 })]);
    expect(s[0].addition).toBe(75000);
  });

  it("hankintameno-olettama, jos se on hankintamenoa suurempi", () => {
    const s = forestSales([forest({ id: "a", acquisitionPrice: 10000, acquiredOn: "2000-01-01", disposedOn: "2025-01-01", salePrice: 100000 })]);
    expect(s[0]).toMatchObject({ cost: 40000, deemedCost: true, gain: 60000 });
  });
});

describe("verovelvolliskohtainen pohja", () => {
  it("myynnin jälkeen pohja on jäljellä olevat metsät miinus käytetty, jota ei ole lisätty luovutusvoittoon", () => {
    // Esimerkki 37 kokonaisina tiloina: käytetty 72 000, myydyn tilan lisäys 60 000, jäljelle jäävän pohja 60 000.
    const props = [
      forest({ id: "sold", acquisitionPrice: 100000, acquiredOn: "2006-01-01", deductions: [{ taxYear: 2008, amount: 72000 }], disposedOn: "2019-06-01", salePrice: 50000 }),
      forest({ id: "kept", acquisitionPrice: 100000, acquiredOn: "2006-01-01" }),
    ];
    expect(forestDeductionPool(props, 2020)).toBe(48000);
    // Myyntivuonna tila on vielä mukana.
    expect(forestDeductionPool(props, 2019)).toBe(120000 - 72000);
  });

  it("vuodesta 2026 pohja on 75 %", () => {
    expect(forestDeductionPool([forest({ id: "a" })], 2026)).toBe(75000);
  });

  it("tallennus: tilojen jäännöksen ylittävä osa kirjataan viimeiselle tilalle", () => {
    expect(allocateForestDeduction([{ id: "a", remaining: 1000 }, { id: "b", remaining: 500 }], 2000)).toEqual([
      { id: "a", amount: 1000 },
      { id: "b", amount: 1000 },
    ]);
  });
});
