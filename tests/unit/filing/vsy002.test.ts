import { describe, expect, it } from "vitest";
import { compute2, formatPercent, render2, VSY002_SPECS } from "@/lib/filing/vsy002";
import { SKOG_SOFTWARE } from "@/lib/filing/vsy02c";
import { computeForm2, type Form2Input, type Form2Result } from "@/lib/tax/agriculture";
import { agriDepreciation } from "@/lib/tax/agri-depreciation";

/**
 * Lomakkeen 2 tiedosto (VSY002) tietuekuvauksia 2025 ja 2026 vasten. Tiedot
 * ovat keksittyjä; henkilötunnus on Verohallinnon yleiskuvauksen esimerkki.
 */
const HETU = "011073-998R";
const AT = new Date("2026-03-01T10:15:30Z");

const assets = [
  { id: "m", description: "Koneet", assetClass: "agri_machinery" as const, accelerated: false, acquiredOn: "2024-12-31", acquisitionCost: 90000, openingYear: 2025, openingBookValue: 40000, disposedOn: null, salePrice: null },
  { id: "t", description: "Traktori", assetClass: "agri_machinery" as const, accelerated: true, acquiredOn: "2025-04-01", acquisitionCost: 50000, openingYear: null, openingBookValue: null, disposedOn: null, salePrice: null },
];

function input(year: number): Form2Input {
  return {
    year,
    vatRegistered: true,
    rows: [
      { kind: "income", category: "agri_livestock_products", amountNet: 20000, amountGross: 22800, vatRate: 14 },
      { kind: "income", category: "agri_state_subsidy", amountNet: 15000, amountGross: 15000, vatRate: 0 },
      { kind: "expense", category: "agri_feed", amountNet: 3000, amountGross: 3420, vatRate: 14 },
      { kind: "expense", category: "agri_myel", amountNet: 3500, amountGross: 3500, vatRate: 0 },
    ],
    ledgerDeferrals: [],
    manualDeferrals: [],
    depreciation: agriDepreciation(assets, [], [], year, { agri_machinery: 10000, agri_machinery_accelerated: 25000 }),
    reserves: [{ kind: "equalization", madeYear: year, amount: 2000, usedThroughYear: 0, incomeThisYear: 0 }],
    agriYear: {
      spouseWealthSharePct: 40, spouseWorkSharePct: 50, incomeSplitClaim: "ten", lossToCapitalIncome: null, wagesSubjectToWithholding: 0, landValue: null,
      rentalDwellingsValue: null, sharesValue: null, otherAssetsValue: null, liabilities: 10000, otherFarmAssets: null,
    },
    extras: [{ code: "281", value: 1 }, { code: "516", value: 23000 }, { code: "282", value: 4000 }],
  };
}

describe("VSY002 kentät", () => {
  it("vuoden 2025 tietuetunnus ja korotettujen poistojen erittely", () => {
    const c = compute2(computeForm2(input(2025)));
    expect(c.spec).toMatchObject({ recordId: "VSY00225", published: "2025-09-23" });
    expect(c.errors).toEqual([]);
    const codes = c.fields.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["214", "217", "229", "230", "231", "232", "332", "357", "363", "260", "261", "511", "265", "581", "368", "584", "172"]));
    // Järjestys tietuekuvauksen mukaan: tulot ennen menoja, poistot ennen varallisuutta.
    expect(codes.indexOf("332")).toBeLessThan(codes.indexOf("225") === -1 ? codes.indexOf("229") : codes.indexOf("225"));
    expect(codes.indexOf("584")).toBeLessThan(codes.indexOf("731"));
    expect(c.fields.find((f) => f.code === "229")?.label).toMatch(/14 %/);
  });

  it("vuoden 2026 tietuetunnus, ei korotettujen poistojen kenttiä, alennettu kanta 13,5 %", () => {
    const c = compute2(computeForm2(input(2026)));
    expect(c.spec.recordId).toBe("VSY00226");
    expect(c.fields.some((f) => f.code === "584")).toBe(false);
    expect(c.fields.find((f) => f.code === "229")?.label).toMatch(/13,5 %/);
  });

  it("vuoden 2026 lomakkeelta poistettu kenttä on virhe", () => {
    const form = computeForm2(input(2026));
    const c = compute2({ ...form, fields: { ...form.fields, "584": 100 } });
    expect(c.errors.join(" ")).toMatch(/584/);
  });

  it("ristiriitaiset summat jäävät kiinni samoilla tarkistuksilla kuin Verohallinnossa", () => {
    const form = computeForm2(input(2026));
    const broken: Form2Result = { ...form, fields: { ...form.fields, "332": form.fields["332"] + 1, "735": 1, "736": 1 } };
    const c = compute2(broken);
    expect(c.errors.join(" ")).toMatch(/#2045/);
    expect(c.errors.join(" ")).toMatch(/#1450/);
    expect(c.errors.join(" ")).toMatch(/#992/);
    expect(VSY002_SPECS[2025].checks.income).toBe("#1987");
  });
});

describe("VSY002 tiedosto", () => {
  it("tunnus:tieto-muoto, prosentit ja kokonaisluvut, CRLF, loppumerkki", () => {
    const text = render2({
      computed: compute2(computeForm2(input(2025))), filerId: HETU, software: SKOG_SOFTWARE, createdAt: AT,
      contact: { name: "Kaisa Kirjanpitäjä", email: "toimisto@example.test", phone: null },
    });
    const lines = text.split("\r\n");
    expect(lines.slice(0, 5)).toEqual(["000:VSY00225", "198:01032026121530", "048:Adepta Skog 2", "014:2237131-2_SK", `010:${HETU}`]);
    expect(lines).toContain("214:20000,00");
    expect(lines).toContain("413:60,00");
    expect(lines).toContain("414:40,00");
    expect(lines).toContain("418:1");
    expect(lines).toContain("281:1");
    expect(lines).toContain("516:23000");
    expect(lines).toContain("041:Kaisa Kirjanpitäjä");
    expect(lines.at(-2)).toBe("999:1");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text).not.toMatch(/[^\r]\n/);
  });

  it("tyhjä lomake: vain 967 ja yhteystiedot", () => {
    const empty = computeForm2({
      ...input(2026), rows: [], depreciation: agriDepreciation([], [], [], 2026), reserves: [], extras: [],
      agriYear: { ...input(2026).agriYear, spouseWealthSharePct: null, spouseWorkSharePct: null, incomeSplitClaim: null, liabilities: null },
    });
    const text = render2({ computed: compute2(empty), filerId: HETU, software: SKOG_SOFTWARE, createdAt: AT });
    expect(text.split("\r\n").filter(Boolean)).toEqual(["000:VSY00226", "198:01032026121530", "048:Adepta Skog 2", "014:2237131-2_SK", `010:${HETU}`, "967:1", "999:1"]);
  });

  it("prosentin muoto", () => {
    expect(formatPercent(33.33)).toBe("33,33");
    expect(() => formatPercent(101)).toThrow();
  });
});
