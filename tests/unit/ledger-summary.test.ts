import { describe, expect, it } from "vitest";
import { grossAmount, summarize, vatAmount } from "@/lib/ledger/summary";

describe("kirjausten summat", () => {
  it("vero ja bruttosumma pyöristetään senteille", () => {
    expect(vatAmount(100, 25.5)).toBe(25.5);
    expect(vatAmount(33.33, 25.5)).toBe(8.5);
    expect(grossAmount(33.33, 25.5)).toBe(41.83);
  });

  it("yhteenveto tyypeittäin ja maksettava arvonlisävero", () => {
    const s = summarize([
      { kind: "income", amountNet: 42000, vatRate: 25.5, withholding: 0 },
      { kind: "income", amountNet: 900, vatRate: 0, withholding: 0 },
      { kind: "expense", amountNet: 1250, vatRate: 25.5, withholding: 0 },
      { kind: "investment", amountNet: 30000, vatRate: 25.5, withholding: 0 },
      { kind: "income", amountNet: 9500, vatRate: 0, withholding: 3325 },
    ]);
    expect(s.income).toEqual({ net: 52400, vat: 10710, gross: 63110 });
    expect(s.expense.vat).toBe(318.75);
    expect(s.investment.vat).toBe(7650);
    expect(s.vatPayable).toBe(2741.25);
    expect(s.withholding).toBe(3325);
    expect(s.netResult).toBe(51150);
  });

  it("tyhjä vuosi", () => {
    expect(summarize([]).netResult).toBe(0);
  });
});
