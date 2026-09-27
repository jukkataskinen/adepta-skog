import { describe, expect, it } from "vitest";
import { assetYear, type AssetInput } from "@/lib/tax/depreciation";
import {
  disposalFractions,
  forestDeductionPool,
  forestSaleLines,
  forestSales,
  soldSharePct,
  type ForestDisposalInput,
  type ForestPropertyInput,
} from "@/lib/tax/forest-sale";
import { allocateForestDeduction } from "@/lib/tax/plan";

/** Verohallinnon ohje Metsävähennys, luku 7. Metsän osuus 100 %, jotta luvut vastaavat ohjeen esimerkkejä. */
const forest = (p: Partial<ForestPropertyInput> & { id: string }): ForestPropertyInput => ({
  acquisitionPrice: 100000, acquiredOn: "2023-01-10", forestLandSharePct: 100, usedBefore: 0, deductions: [], disposals: [], ...p,
});
let n = 0;
const sale = (disposedOn: string, salePrice: number, d: Partial<ForestDisposalInput> = {}): ForestDisposalInput => ({
  id: `d${String(++n).padStart(3, "0")}`, disposedOn, salePrice, sharePct: 100, sellingCosts: 0, noDeductionAddition: false, roadDitchCost: 0, ...d,
});

describe("metsätilan myynti", () => {
  it("esimerkki 32: lisäys on kaikki käytetty vähennys, enintään myydyn metsän vähennysoikeus", () => {
    const sold = forest({ id: "a", disposals: [sale("2026-05-01", 150000)] });
    const other = forest({ id: "b", acquisitionPrice: 250000, acquiredOn: "2015-01-01", deductions: [{ taxYear: 2024, amount: 50000 }, { taxYear: 2025, amount: 30000 }] });
    const [s] = forestSales([sold, other]);
    expect(s).toMatchObject({ year: 2026, addition: 60000, cost: 100000, usesDeemedCost: false, gain: 110000 });
  });

  it("lisäys tehdään myös luovutustappioon, ja se voi kääntää tappion voitoksi", () => {
    const s = forestSales([
      forest({ id: "a", acquisitionPrice: 200000, acquiredOn: "2006-01-01", deductions: [{ taxYear: 2008, amount: 72000 }], disposals: [sale("2019-06-01", 100000)] }),
    ]);
    // Olettama 40 % (omistettu yli 10 vuotta) = 40 000 < hankintameno 200 000. 100 000 − 200 000 + 72 000.
    expect(s[0]).toMatchObject({ addition: 72000, gain: -28000 });
  });

  it("aiemmin lisätty vähennys ei lisäänny uudelleen", () => {
    const props = [
      forest({ id: "a", deductions: [{ taxYear: 2024, amount: 40000 }], disposals: [sale("2025-03-01", 120000)] }),
      forest({ id: "b", acquiredOn: "2020-01-01", disposals: [sale("2026-03-01", 120000)] }),
    ];
    expect(forestSales(props).map((x) => x.addition)).toEqual([40000, 0]);
  });

  it("luovutusvuoden oma metsävähennys ei kuulu lisäykseen", () => {
    const s = forestSales([forest({ id: "a", deductions: [{ taxYear: 2025, amount: 30000 }], disposals: [sale("2025-06-01", 90000)] })]);
    expect(s[0].addition).toBe(0);
  });

  it("samana vuonna myydyt tilat jakavat lisäyksen vähennysoikeuksien suhteessa", () => {
    const props = [
      forest({ id: "a", acquisitionPrice: 100000, deductions: [{ taxYear: 2024, amount: 30000 }], disposals: [sale("2025-03-01", 1)] }),
      forest({ id: "b", acquisitionPrice: 200000, disposals: [sale("2025-09-01", 1)] }),
    ];
    expect(forestSales(props).map((x) => x.addition)).toEqual([10000, 20000]);
  });

  it("lahjassa ja samana vuonna hankitussa metsässä lisäystä ei tehdä", () => {
    const used = forest({ id: "u", acquiredOn: "2010-01-01", deductions: [{ taxYear: 2020, amount: 20000 }] });
    expect(forestSales([used, forest({ id: "g", disposals: [sale("2025-01-01", 1, { noDeductionAddition: true })] })])[0].addition).toBe(0);
    expect(forestSales([used, forest({ id: "s", acquiredOn: "2025-02-01", disposals: [sale("2025-11-01", 1)] })])[0].addition).toBe(0);
  });

  it("verovuodesta 2027 lisäyksen enimmäismäärä on 75 %", () => {
    const s = forestSales([forest({ id: "a", deductions: [{ taxYear: 2026, amount: 90000 }], disposals: [sale("2027-01-15", 100000)] })]);
    expect(s[0].addition).toBe(75000);
  });

  it("hankintameno-olettama, jos se on hankintamenoa suurempi", () => {
    const s = forestSales([forest({ id: "a", acquisitionPrice: 10000, acquiredOn: "2000-01-01", disposals: [sale("2025-01-01", 100000)] })]);
    expect(s[0]).toMatchObject({ cost: 40000, deemedCost: 40000, deemedPct: 40, usesDeemedCost: true, gain: 60000 });
  });
});

describe("määräalan tai määräosan myynti", () => {
  it("esimerkki 37 määräalana: puolet tilasta, lisäys 60 000, voitto 10 000, jäljelle jäävä pohja 48 000", () => {
    const tila = forest({
      id: "a", acquisitionPrice: 200000, acquiredOn: "2006-01-01", deductions: [{ taxYear: 2008, amount: 72000 }],
      disposals: [sale("2019-06-01", 50000, { sharePct: 50 })],
    });
    const [s] = forestSales([tila]);
    expect(s).toMatchObject({ sharePct: 50, acquisitionCost: 100000, usesDeemedCost: false, addition: 60000, gain: 10000 });
    // Myyty osuus ei tuo pohjaa enää luovutusvuonna: 60 000 − (72 000 − 60 000).
    expect(forestDeductionPool([tila], 2019)).toBe(48000);
    expect(forestDeductionPool([tila], 2020)).toBe(48000);
    expect(forestDeductionPool([tila], 2018)).toBe(120000 - 72000);
  });

  it("esimerkki 33: määräalan hankintameno osuuden mukaan, lisäys enintään määräalan vähennysoikeus", () => {
    const tila = forest({
      id: "a", acquisitionPrice: 50000, acquiredOn: "2011-03-01", deductions: [{ taxYear: 2020, amount: 16000 }],
      disposals: [sale("2026-05-01", 21000, { sharePct: 30 })],
    });
    expect(forestSales([tila])[0]).toMatchObject({ acquisitionCost: 15000, addition: 9000, gain: 15000 });
  });

  it("useita myyntejä samasta tilasta: pohja pienenee, ja tila lakkaa tuomasta pohjaa, kun osuudet ovat 100 %", () => {
    const tila = forest({
      id: "a", acquisitionPrice: 100000, acquiredOn: "2010-01-01", deductions: [{ taxYear: 2015, amount: 50000 }],
      disposals: [sale("2020-04-01", 40000, { sharePct: 30 }), sale("2022-08-01", 90000, { sharePct: 70 })],
    });
    const s = forestSales([tila]);
    // 2020: enintään 60 % × 30 000 = 18 000. 2022: käytetystä jäljellä 32 000, enintään 60 % × 70 000 = 42 000.
    expect(s.map((x) => x.addition)).toEqual([18000, 32000]);
    expect(s.map((x) => x.acquisitionCost)).toEqual([30000, 70000]);
    expect(soldSharePct(tila, 2021)).toBe(30);
    expect(forestDeductionPool([tila], 2021)).toBe(42000 - (50000 - 18000));
    expect(forestDeductionPool([tila], 2022)).toBeNull();
  });

  it("tien ja ojan poistamaton arvo jaetaan samassa suhteessa", () => {
    expect(disposalFractions([{ disposedOn: "2020-04-01", sharePct: 30 }, { disposedOn: "2022-08-01", sharePct: 70 }])).toEqual([
      { year: 2020, fraction: 0.3 },
      { year: 2022, fraction: 1 },
    ]);
    expect(disposalFractions([{ disposedOn: "2020-01-01", sharePct: 25 }, { disposedOn: "2020-06-01", sharePct: 25 }, { disposedOn: "2021-01-01", sharePct: 25 }])).toEqual([
      { year: 2020, fraction: 0.5 },
      { year: 2021, fraction: 0.5 },
    ]);
  });
});

describe("myyntikulut ja tie- ja ojamenot", () => {
  const base = { id: "a", acquisitionPrice: 60000, acquiredOn: "2020-01-01" };

  it("myyntikulut ja poistamattomat tie- ja ojamenot vähennetään todellisen hankintamenon kanssa", () => {
    const [s] = forestSales([forest({ ...base, disposals: [sale("2025-06-01", 100000, { sellingCosts: 3000, roadDitchCost: 8000 })] })]);
    expect(s).toMatchObject({ acquisitionCost: 60000, roadDitchCost: 8000, sellingCosts: 3000, cost: 71000, usesDeemedCost: false, gain: 29000 });
  });

  it("olettamaa käytettäessä myyntikuluja ei vähennetä erikseen", () => {
    // Olettama 40 % × 100 000 = 40 000 > 10 000 + 5 000.
    const [s] = forestSales([forest({ id: "a", acquisitionPrice: 10000, acquiredOn: "2000-01-01", disposals: [sale("2025-06-01", 100000, { sellingCosts: 5000 })] })]);
    expect(s).toMatchObject({ cost: 40000, usesDeemedCost: true, gain: 60000 });
  });

  it("myyntikulut ja tie- ja ojamenot voivat tehdä todellisesta hankintamenosta edullisemman", () => {
    const [s] = forestSales([
      forest({ id: "a", acquisitionPrice: 36000, acquiredOn: "2000-01-01", disposals: [sale("2025-06-01", 100000, { sellingCosts: 3000, roadDitchCost: 2000 })] }),
    ]);
    expect(s).toMatchObject({ cost: 41000, usesDeemedCost: false, gain: 59000 });
  });

  it("laskelman rivit näytölle ja raporttiin", () => {
    const [s] = forestSales([forest({ ...base, disposals: [sale("2025-06-01", 50000, { sharePct: 50, sellingCosts: 1000, roadDitchCost: 2000 })] })]);
    const { lines, result, note } = forestSaleLines(s);
    expect(lines).toEqual([
      ["Kauppahinta (myyty 50 % tilasta)", 50000],
      ["Hankintameno, 50 % tilan hankintamenosta", -30000],
      ["Poistamattomat tie- ja ojamenot", -2000],
      ["Myyntikulut", -1000],
      ["Käytetty metsävähennys lisätään (TVL 46 § 8 mom.)", 0],
    ]);
    expect(result).toEqual(["Luovutusvoitto", 17000]);
    expect(note).toBeNull();
  });
});

describe("tie tai oja tilan myynnissä", () => {
  const road: AssetInput = {
    acquiredOn: "2020-05-01", acquisitionCost: 10000, method: "declining_balance", usefulLifeYears: null, decliningRatePct: 15,
    openingBookValue: null, disposedOn: null, salePrice: null,
  };

  it("osan myynnissä myyty osuus siirtyy hankintamenoon, ja poisto lasketaan loppuosasta", () => {
    const y = assetYear({ ...road, transferFractions: [{ year: 2022, fraction: 0.5 }] }, [{ taxYear: 2021, amount: 1500, bookValueEnd: 8500 }], 2022);
    expect(y).toMatchObject({ active: true, bookValueStart: 8500, transferred: 4250, bookValueBase: 4250, max: 637.5 });
  });

  it("seuraavana vuonna arvo lasketaan siirron ja kirjatun poiston jälkeen", () => {
    const deps = [
      { taxYear: 2021, amount: 1500, bookValueEnd: 8500 },
      // Loppuarvo kirjattu ennen luovutusta, joten siihen ei luoteta.
      { taxYear: 2022, amount: 600, bookValueEnd: 7900 },
    ];
    expect(assetYear({ ...road, transferFractions: [{ year: 2022, fraction: 0.5 }] }, deps, 2023).bookValueStart).toBe(3650);
  });

  it("koko tilan myynnissä koko arvo siirtyy, eikä tietä enää poisteta", () => {
    const input = { ...road, transferFractions: [{ year: 2022, fraction: 1 }] };
    expect(assetYear(input, [{ taxYear: 2021, amount: 1500, bookValueEnd: 8500 }], 2022)).toMatchObject({ active: false, transferred: 8500, max: 0 });
    expect(assetYear(input, [{ taxYear: 2021, amount: 1500, bookValueEnd: 8500 }], 2023).active).toBe(false);
  });
});

describe("verovelvolliskohtainen pohja", () => {
  it("myynnin jälkeen pohja on jäljellä olevat metsät miinus käytetty, jota ei ole lisätty luovutusvoittoon", () => {
    // Esimerkki 37 kokonaisina tiloina: käytetty 72 000, myydyn tilan lisäys 60 000, jäljelle jäävän pohja 60 000.
    const props = [
      forest({ id: "sold", acquisitionPrice: 100000, acquiredOn: "2006-01-01", deductions: [{ taxYear: 2008, amount: 72000 }], disposals: [sale("2019-06-01", 50000)] }),
      forest({ id: "kept", acquisitionPrice: 100000, acquiredOn: "2006-01-01" }),
    ];
    expect(forestDeductionPool(props, 2020)).toBe(48000);
    // Myyntivuonna myyty tila ei enää tuo pohjaa (Metsävähennys, luku 3.4), mutta lisäys palauttaa käytettyä.
    expect(forestDeductionPool(props, 2019)).toBe(48000);
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
