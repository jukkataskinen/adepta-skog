import { describe, expect, it } from "vitest";
import { ledgerTarget } from "@/lib/ledger/default-view";

/** Kirjanpidon oletusnäkymä odottavien tulkintojen mukaan (DECISIONS 6.10.2026). */
describe("ledgerTarget", () => {
  const years = [{ year: 2026 }, { year: 2025 }];
  const pending = [
    { year: 2025, activity: "forestry" as const, createdAt: "2026-10-01T08:00:00Z" },
    { year: 2026, activity: "agriculture" as const, createdAt: "2026-10-05T08:00:00Z" },
  ];

  it("ilman parametreja avaa uusimman odottavan tulkinnan vuoden ja toiminnon", () => {
    expect(ledgerTarget({ years, pending })).toEqual({ vuosi: "2026", toiminta: "maatalous" });
    expect(ledgerTarget({ years, pending: [pending[0]] })).toEqual({ vuosi: "2025", toiminta: "metsatalous" });
  });

  it("annettu vuosi tai toiminto pätee sellaisenaan", () => {
    expect(ledgerTarget({ requestedYear: "2025", years, pending })).toEqual({ vuosi: "2025", toiminta: undefined });
    expect(ledgerTarget({ requestedActivity: "maatalous", years, pending })).toEqual({ vuosi: undefined, toiminta: "maatalous" });
  });

  it("ilman odottavia tai avaamattomalle vuodelle käytetään sivun omaa oletusta", () => {
    expect(ledgerTarget({ years, pending: [] })).toEqual({});
    expect(ledgerTarget({ years: [{ year: 2026 }], pending: [pending[0]] })).toEqual({});
  });
});
