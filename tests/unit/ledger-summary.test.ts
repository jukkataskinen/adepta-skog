import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/ledger/summary";

describe("kirjausten summat", () => {
  it("yhteenveto tyypeittäin ja maksettava arvonlisävero: vero on brutto miinus veroton", () => {
    const s = summarize([
      { kind: "income", amountNet: 42000, amountGross: 52710, withholding: 0 },
      { kind: "income", amountNet: 900, amountGross: 900, withholding: 0 },
      { kind: "expense", amountNet: 1250, amountGross: 1568.75, withholding: 0 },
      { kind: "investment", amountNet: 30000, amountGross: 37650, withholding: 0 },
      { kind: "income", amountNet: 9500, amountGross: 9500, withholding: 3325 },
    ]);
    expect(s.income).toEqual({ net: 52400, vat: 10710, gross: 63110 });
    expect(s.expense.vat).toBe(318.75);
    expect(s.investment.vat).toBe(7650);
    expect(s.vatPayable).toBe(2741.25);
    expect(s.withholding).toBe(3325);
    expect(s.netResult).toBe(51150);
  });

  it("kuitin summa säilyy: brutto ei muutu verottomasta laskettaessa", () => {
    const s = summarize([{ kind: "expense", amountNet: 33.33, amountGross: 41.83, withholding: 0 }]);
    expect(s.expense).toEqual({ net: 33.33, vat: 8.5, gross: 41.83 });
  });

  it("tyhjä vuosi", () => {
    expect(summarize([]).netResult).toBe(0);
  });
});
