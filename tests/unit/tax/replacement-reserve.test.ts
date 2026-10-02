import { describe, expect, it } from "vitest";
import {
  computeReplacementReserve,
  replacementReserveDeadline,
  replacementReserveMax,
  validateReplacementReserve,
} from "@/lib/tax/replacement-reserve";
import { computeForm2, type Form2Input } from "@/lib/tax/agriculture";
import { agriDepreciation } from "@/lib/tax/agri-depreciation";

/** Jälleenhankintavaraus (MVL 17 §): korvaus − poistamatta oleva hankintameno, käyttö viimeistään tekovuosi + 3. */
describe("jälleenhankintavarauksen laskuri", () => {
  it("enimmäismäärä on poistamattoman hankintamenon ylittävä osa", () => {
    // Konehalli paloi: vakuutuskorvaus 80 000, poistamatta 32 500,40 → 47 499,60.
    expect(replacementReserveMax({ proceeds: 80000, undepreciated: 32500.4 })).toBe(47499.6);
    expect(replacementReserveMax({ proceeds: 20000, undepreciated: 25000 })).toBe(0);
    expect(computeReplacementReserve({ proceeds: 10000, undepreciated: 0 }, 2025)).toEqual({ max: 10000, deadline: 2028 });
    expect(replacementReserveDeadline(2026)).toBe(2029);
  });

  it("tarkistus: ei yli enimmäismäärän, ei ilman ylittävää osaa", () => {
    const basis = { proceeds: 50000, undepreciated: 20000 };
    expect(validateReplacementReserve(30000, basis)).toBeNull();
    expect(validateReplacementReserve(12000, basis)).toBeNull();
    expect(validateReplacementReserve(30000.01, basis)).toMatch(/enintään 30000,00/);
    expect(validateReplacementReserve(0, basis)).toMatch(/määrä/);
    expect(validateReplacementReserve(100, { proceeds: 10000, undepreciated: 10000 })).toMatch(/ei ylitä/);
  });

  it("lomake 2: tekovuoden varaus näkyy kentässä 175 ja saa huomautuksen, tulos ei muutu", () => {
    const base: Form2Input = {
      year: 2025, vatRegistered: true, ledgerDeferrals: [], manualDeferrals: [],
      depreciation: agriDepreciation([], [], [], 2025), reserves: [], extras: [], vehicle: null,
      agriYear: {
        spouseWealthSharePct: null, spouseWorkSharePct: null, incomeSplitClaim: null, lossToCapitalIncome: null, wagesSubjectToWithholding: 0,
        landValue: null, rentalDwellingsValue: null, sharesValue: null, otherAssetsValue: null, liabilities: null, otherFarmAssets: null,
      },
      rows: [{ kind: "income", category: "agri_crops", amountNet: 10000, amountGross: 11400, vatRate: 14 }],
    };
    const without = computeForm2(base);
    const withReserve = computeForm2({ ...base, reserves: [{ kind: "replacement", madeYear: 2025, amount: 30000, usedThroughYear: 0, incomeThisYear: 0 }] });
    expect(withReserve.fields["175"]).toBe(30000);
    expect(withReserve.result).toBe(without.result);
    expect(withReserve.warnings.some((w) => w.includes("Jälleenhankintavaraus") && w.includes("ei vähennä"))).toBe(true);
  });
});
