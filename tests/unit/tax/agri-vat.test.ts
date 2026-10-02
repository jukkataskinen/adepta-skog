import { describe, expect, it } from "vitest";
import { vatSummary, type VatRow } from "@/lib/tax/vat";

/** Yhteinen arvonlisävero metsälle ja maataloudelle (docs/maatalous-suunnitelma-2026-10-02.md, B). */

const rows: VatRow[] = [
  // Pystykauppa 10 000 € + 25,5 %.
  { bookedOn: "2025-02-01", kind: "income", category: "standing_sale", amountNet: 10000, amountGross: 12550, vatRate: 25.5 },
  // Maito 1 000 € + 14 %.
  { bookedOn: "2025-03-31", kind: "income", category: "agri_livestock_products", amountNet: 1000, amountGross: 1140, vatRate: 14 },
  // Rehu 500 € + 14 %.
  { bookedOn: "2025-04-15", kind: "expense", category: "agri_feed", amountNet: 500, amountGross: 570, vatRate: 14 },
  // Sähkö 1 000 € + 25,5 %: 70 % maatalous, 20 % metsätalous, 10 % yksityinen.
  { bookedOn: "2025-05-31", kind: "expense", category: "agri_energy", amountNet: 1000, amountGross: 1255, vatRate: 25.5, businessSharePct: 70, otherSharePct: 20 },
  // Tuki 0 %.
  { bookedOn: "2025-10-15", kind: "income", category: "agri_state_subsidy", amountNet: 8000, amountGross: 8000, vatRate: 0 },
];

describe("yhteinen alv-laskelma", () => {
  it("vähennettävä vero on metsän ja maatalouden osuus, yksityinen ei", () => {
    const y = vatSummary(rows).year;
    expect(y.output).toBe(2690);
    expect(y.input).toBe(70 + 178.5 + 51);
    expect(y.nonDeductible).toBe(25.5);
    expect(y.payable).toBe(2690 - 299.5);
  });

  it("erittely toiminnoittain", () => {
    const y = vatSummary(rows).year;
    expect(y.byActivity.forestry).toEqual({ output: 2550, input: 51 });
    expect(y.byActivity.agriculture).toEqual({ output: 140, input: 248.5 });
  });

  it("ilmoituksen kentät verokannoittain", () => {
    const y = vatSummary(rows).year;
    expect(y.form).toEqual({ general: 2550, reduced: 140, ten: 0, deductible: 299.5, payable: 2390.5 });
  });

  it("vuoden 2026 alennettu kanta 13,5 % on samassa kentässä", () => {
    const y = vatSummary([{ bookedOn: "2026-03-31", kind: "income", category: "agri_crops", amountNet: 1000, amountGross: 1135, vatRate: 13.5 }]).year;
    expect(y.form.reduced).toBe(135);
  });
});
