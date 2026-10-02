import { describe, expect, it } from "vitest";
import { percentOf } from "@/lib/tax/amounts";
import { forestryShare, formatSharePct, isPartialShare, sharePct } from "@/lib/tax/share";
import { summarize } from "@/lib/ledger/summary";
import { vatSummary } from "@/lib/tax/vat";

describe("prosenttiosuus senteiksi", () => {
  it("pyöristys lähimpään senttiin, puolikas pois nollasta kuten kannassa", () => {
    expect(percentOf(200, 50)).toBe(100);
    expect(percentOf(100, 33.33)).toBe(33.33);
    expect(percentOf(0.05, 50)).toBe(0.03);
    expect(percentOf(-0.05, 50)).toBe(-0.03);
    expect(percentOf(33.33, 33.33)).toBe(11.11);
    expect(percentOf(1000, 100)).toBe(1000);
  });
});

describe("metsätalouden osuus", () => {
  it("tiemaksu 50 %: veroton ja ostojen vero puoliksi, loppu muulle", () => {
    const s = forestryShare({ kind: "expense", amountNet: 200, amountGross: 251, businessSharePct: 50 });
    expect(s).toMatchObject({ sharePct: 50, net: 100, vat: 25.5, gross: 125.5, nonDeductibleVat: 25.5, otherNet: 100, otherGross: 125.5 });
  });

  it("33,33 %: pyöristykset erikseen verottomasta ja verosta", () => {
    // 41,83 € sis. alv 25,5 %: veroton 33,33, vero 8,50.
    const s = forestryShare({ kind: "expense", amountNet: 33.33, amountGross: 41.83, businessSharePct: 33.33 });
    expect(s.net).toBe(11.11);
    expect(s.vat).toBe(2.83);
    expect(s.gross).toBe(13.94);
    expect(s.nonDeductibleVat).toBe(5.67);
    expect(s.otherGross).toBe(27.89);
    // Osat täsmäävät kuittiin sentilleen.
    expect(Math.round((s.gross + s.otherGross) * 100) / 100).toBe(41.83);
  });

  it("investoinnin ostojen verosta vain osuus", () => {
    const s = forestryShare({ kind: "investment", amountNet: 20000, amountGross: 25100, businessSharePct: 40 });
    expect(s).toMatchObject({ net: 8000, vat: 2040, nonDeductibleVat: 3060 });
  });

  it("myynnin vero on koko myynnistä, vaikka tulosta osa kuuluu muulle", () => {
    const s = forestryShare({ kind: "income", amountNet: 1000, amountGross: 1255, businessSharePct: 50 });
    expect(s).toMatchObject({ sharePct: 50, net: 500, vat: 255, gross: 755, nonDeductibleVat: 0, otherNet: 500, otherGross: 500 });
  });

  it("puuttuva, tyhjä tai kelvoton osuus on 100 %", () => {
    expect(sharePct(undefined)).toBe(100);
    expect(sharePct(null)).toBe(100);
    expect(sharePct("")).toBe(100);
    expect(sharePct("50.00")).toBe(50);
    expect(sharePct(0)).toBe(100);
    expect(sharePct(120)).toBe(100);
    expect(isPartialShare("100.00")).toBe(false);
    expect(isPartialShare("33.33")).toBe(true);
    const s = forestryShare({ kind: "expense", amountNet: 33.33, amountGross: 41.83 });
    expect(s).toMatchObject({ net: 33.33, vat: 8.5, gross: 41.83, nonDeductibleVat: 0, otherGross: 0 });
  });

  it("osuus tekstiksi", () => {
    expect(formatSharePct(50)).toBe("50");
    expect(formatSharePct(33.33)).toBe("33,33");
  });
});

describe("summat osuudella", () => {
  it("kirjanpidon yhteenveto: menoihin ja ostojen veroon vain osuus", () => {
    const s = summarize([
      { kind: "income", amountNet: 1000, amountGross: 1255, withholding: 0 },
      { kind: "expense", amountNet: 200, amountGross: 251, withholding: 0, businessSharePct: 50 },
      { kind: "investment", amountNet: 20000, amountGross: 25100, withholding: 0, businessSharePct: 40 },
    ]);
    expect(s.expense).toEqual({ net: 100, vat: 25.5, gross: 125.5 });
    expect(s.investment).toEqual({ net: 8000, vat: 2040, gross: 10040 });
    expect(s.nonDeductibleVat).toBe(3085.5);
    expect(s.partialCount).toBe(2);
    expect(s.vatPayable).toBe(255 - 25.5 - 2040);
    expect(s.netResult).toBe(900);
  });

  it("arvonlisäveron yhteenveto: myynnin vero kokonaan, ostojen vero osuudelta", () => {
    const v = vatSummary([
      { bookedOn: "2025-02-01", kind: "income", amountNet: 1000, amountGross: 1255, vatRate: 25.5, businessSharePct: 50 },
      { bookedOn: "2025-05-01", kind: "expense", amountNet: 200, amountGross: 251, vatRate: 25.5, businessSharePct: 50 },
    ]);
    expect(v.year).toMatchObject({ output: 255, input: 25.5, nonDeductible: 25.5, payable: 229.5 });
    expect(v.year.byRate).toEqual([{ rate: 25.5, net: 1000, vat: 255 }]);
    expect(v.quarters[1]).toMatchObject({ input: 25.5, nonDeductible: 25.5 });
  });
});
