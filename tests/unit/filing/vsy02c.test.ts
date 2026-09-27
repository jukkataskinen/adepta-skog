import { describe, expect, it } from "vitest";
import { defaultWorkers, parseDeliveryWorkDescription } from "@/lib/filing/load";
import {
  compute2c,
  deliveryWorkTaxable,
  encodeLatin1,
  formatAmount,
  render2c,
  SKOG_SOFTWARE,
  timestamp198,
  toLatin1Text,
  VSY02C_LABELS,
  VSY02C_ORDER,
  type Filing2cData,
} from "@/lib/filing/vsy02c";
import { computePlan } from "@/lib/tax/plan";

/** Kuvitteellinen asiakas: tiedot ovat keksittyjä. Henkilötunnus on Verohallinnon yleiskuvauksen esimerkki. */
const HETU = "011073-998R";
const WORKER_HETU = "131052-308T";

function data(overrides: Partial<Filing2cData> = {}): Filing2cData {
  return {
    year: 2026,
    vatRegistered: true,
    categories: {
      standing_sale: { net: 20000, gross: 25100 },
      delivery_sale: { net: 8000, gross: 10040 },
      firewood_sale: { net: 500, gross: 627.5 },
      insurance_compensation: { net: 300, gross: 300 },
      moose_damage_compensation: { net: 120, gross: 120 },
      forestry_subsidy: { net: 1000, gross: 1000 },
      wages: { net: 700, gross: 700 },
      travel: { net: 200, gross: 251 },
      other_expense: { net: 1500, gross: 1882.5 },
      delivery_work: { net: 2400, gross: 2400 },
      asset_purchase: { net: 5000, gross: 6275 },
    },
    assets: [
      // Traktori 2024: vuoden alussa 22 500, poisto 25 %.
      { method: "declining_balance", decliningRatePct: 25, acquiredOn: "2024-03-01", bookValueStart: 22500, sold: false, transferred: 0, depreciation: 5625 },
      // Vuonna ostettu mönkijä: lisäys 5 000, poisto 1 250.
      { method: "declining_balance", decliningRatePct: 25, acquiredOn: "2026-05-01", bookValueStart: 5000, sold: false, transferred: 0, depreciation: 1250 },
      // Metsätie: 15 %.
      { method: "declining_balance", decliningRatePct: 15, acquiredOn: "2020-01-01", bookValueStart: 10000, sold: false, transferred: 0, depreciation: 1500 },
    ],
    transfersOut: [],
    forestDeduction: 5000,
    tracking: { base: 72000, usedBefore: 3000, addedToGains: 0, missing: 0 },
    planConfirmed: true,
    yearOpen: false,
    hasDisposals: false,
    ...overrides,
  };
}

const field = (c: ReturnType<typeof compute2c>, code: string) => c.fields.find((f) => f.code === code)?.value;

describe("2C:n kentät", () => {
  it("tulot, hankintatyö, korvaukset ja menot oikeisiin tunnuksiin", () => {
    const c = compute2c(data());
    expect(c.spec.recordId).toBe("VSY02C26");
    expect(field(c, "603")).toBe(20000);
    expect(field(c, "604")).toBe(8000);
    expect(field(c, "613")).toBe(500);
    expect(field(c, "690")).toBe(28500);
    expect(field(c, "605")).toBe(2400);
    expect(field(c, "625")).toBeUndefined();
    expect(field(c, "691")).toBe(2400);
    expect(field(c, "607")).toBe(300);
    expect(field(c, "608")).toBe(120);
    expect(field(c, "609")).toBe(1000);
    expect(field(c, "610")).toBe(1420);
    // Alv-velvollinen: menot ilman veroa.
    expect(field(c, "622")).toBe(700);
    expect(field(c, "623")).toBe(200);
    expect(field(c, "624")).toBe(1500);
    expect(field(c, "693")).toBe(2400);
    expect(c.errors).toEqual([]);
  });

  it("alv-velvollisuudeton: menot arvonlisäverollisina, tulot aina ilman", () => {
    const c = compute2c(data({ vatRegistered: false }));
    expect(field(c, "623")).toBe(251);
    expect(field(c, "624")).toBe(1882.5);
    expect(field(c, "693")).toBe(2833.5);
    expect(field(c, "603")).toBe(20000);
    expect(c.warnings.some((w) => w.includes("investoinneissa on arvonlisäveroa"))).toBe(true);
  });

  it("poistotaulukko lajeittain täyttää tarkistukset #2050–#2052", () => {
    const c = compute2c(data());
    expect(field(c, "660")).toBe(22500);
    expect(field(c, "661")).toBe(5000);
    expect(field(c, "642")).toBe(6875);
    expect(field(c, "626")).toBe(22500 + 5000 - 6875);
    expect(field(c, "680")).toBe(10000);
    expect(field(c, "644")).toBe(1500);
    expect(field(c, "628")).toBe(8500);
    expect(field(c, "694")).toBe(8375);
    expect(field(c, "670")).toBeUndefined();
    for (const [s, a, o, d, e] of [["660", "661", "645", "642", "626"], ["680", "681", "682", "644", "628"]]) {
      const v = (k: string) => field(c, k) ?? 0;
      expect(v(s) + v(a) - v(o) - v(d)).toBeCloseTo(v(e), 2);
    }
  });

  it("myyty kone ja tilan mukana siirtynyt tie ovat luovutuksia", () => {
    const c = compute2c(
      data({
        assets: [
          { method: "declining_balance", decliningRatePct: 25, acquiredOn: "2024-03-01", bookValueStart: 22500, sold: true, transferred: 0, depreciation: 0 },
          { method: "declining_balance", decliningRatePct: 15, acquiredOn: "2020-01-01", bookValueStart: 10000, sold: false, transferred: 4000, depreciation: 900 },
        ],
        transfersOut: [{ method: "declining_balance", decliningRatePct: 15, acquiredOn: "2019-01-01", amount: 3000 }],
      }),
    );
    expect(field(c, "645")).toBe(22500);
    expect(field(c, "626")).toBe(0);
    expect(field(c, "680")).toBe(13000);
    expect(field(c, "682")).toBe(7000);
    expect(field(c, "644")).toBe(900);
    expect(field(c, "628")).toBe(5100);
  });

  it("puhdas pääomatulo on sama kuin verosuunnitelmassa metsävähennyksen jälkeen", () => {
    const d = data();
    const c = compute2c(d);
    const income = 20000 + 8000 + 500 + 300 + 120 + 1000;
    const expense = 700 + 200 + 1500 + 2400;
    const plan = computePlan({ year: 2026, income, expense, depreciation: 8375, forestDeduction: 5000, saleGain: 0, saleLoss: 0, salePrices: 0 });
    expect(field(c, "635")).toBe(plan.netBeforeDeduction - 5000);
    expect(field(c, "636")).toBeUndefined();
  });

  it("tappio tunnukseen 636, ja jompikumpi annetaan aina (#1396)", () => {
    const loss = compute2c(data({ categories: { other_expense: { net: 900, gross: 900 } }, assets: [], forestDeduction: 0, tracking: null }));
    expect(field(loss, "636")).toBe(900);
    expect(field(loss, "635")).toBeUndefined();
    const zero = compute2c(data({ categories: {}, assets: [], forestDeduction: 0, tracking: null }));
    expect(zero.fields).toEqual([{ code: "635", label: "Metsätalouden puhdas pääomatulo", value: 0 }]);
  });

  it("metsävähennyksen seuranta ja tarkistukset #1991, #820 ja #2049", () => {
    const c = compute2c(data());
    expect(field(c, "615")).toBe(5000);
    expect(field(c, "618")).toBe(5000);
    expect(field(c, "655")).toBe(72000);
    expect(field(c, "656")).toBe(3000);
    expect(field(c, "715")).toBe(69000);
    // 716 = 603+604+613-605-625+607+608+609 (#1403).
    expect(field(c, "716")).toBe(28500 - 2400 + 1420);
    expect(field(c, "717")).toBe(5000);
    expect(field(c, "720")).toBe(8000);
    expect(compute2c(data({ forestDeduction: 1000 })).errors.join(" ")).toContain("#820");
    const tooBig = compute2c(data({ forestDeduction: 21000 }));
    expect(tooBig.errors.join(" ")).toContain("#2049");
    // Vuonna 2025 raja on 60 % ja tarkistus #819.
    const y2025 = compute2c(data({ year: 2025, forestDeduction: 17000 }));
    expect(y2025.spec.recordId).toBe("VSY02C25");
    expect(y2025.errors.join(" ")).toContain("#819");
  });

  it("hankintatyö ei voi ylittää hankintakaupan tuloa (#1401), ylimenevä osa polttopuukauppaan (#1402)", () => {
    const c = compute2c(data({ categories: { delivery_sale: { net: 1000, gross: 1000 }, firewood_sale: { net: 500, gross: 500 }, delivery_work: { net: 2000, gross: 2000 } }, assets: [], forestDeduction: 0 }));
    expect(field(c, "605")).toBe(1000);
    expect(field(c, "625")).toBe(500);
    expect(field(c, "691")).toBe(1500);
    expect(c.warnings.join(" ")).toContain("500,00");
  });

  it("vahvistamaton suunnitelma, avoin vuosi ja tuntematon laji näkyvät varoituksina", () => {
    const c = compute2c(
      data({ planConfirmed: false, yearOpen: true, assets: [{ method: "straight_line", decliningRatePct: null, acquiredOn: "2015-01-01", bookValueStart: 800, sold: false, transferred: 0, depreciation: 0 }] }),
    );
    expect(c.warnings.join(" ")).toContain("Verosuunnitelmaa ei ole vahvistettu");
    expect(c.warnings.join(" ")).toContain("Vuosi on avoin");
    expect(c.warnings.join(" ")).toContain("lajia ei tiedetä");
    expect(field(c, "660")).toBe(800);
  });

  it("järjestys kattaa kaikki tunnukset", () => {
    expect([...VSY02C_ORDER].sort()).toEqual(Object.keys(VSY02C_LABELS).sort());
    const codes = compute2c(data()).fields.map((f) => f.code);
    expect(codes.slice(0, 4)).toEqual(["603", "604", "613", "690"]);
  });

  it("vuosi ilman tietuekuvausta ei käy", () => {
    expect(() => compute2c(data({ year: 2024 }))).toThrow();
  });
});

describe("ilmoitustiedosto", () => {
  const createdAt = new Date("2026-09-28T09:05:07Z"); // Helsingissä 12.05.07
  const workers = [{ name: "Veli Metsänen — poika", personalId: WORKER_HETU, madeM3: 150.4, transportedM3: 0, value: 2400, taxableValue: 400 }];
  const text = render2c({ computed: compute2c(data()), filerId: HETU, software: SKOG_SOFTWARE, createdAt, workers, contact: { name: "Kirjanpitäjä Kaisa", email: "toimisto@example.test", phone: "0401234567" } });
  const lines = text.split("\r\n");

  it("alkaa tietuetunnuksella ja päättyy loppumerkkiin, rivinvaihto CRLF", () => {
    expect(lines[0]).toBe("000:VSY02C26");
    expect(lines[1]).toBe("198:28092026120507");
    expect(lines).toContain("048:Adepta Skog 2");
    expect(lines).toContain("014:2237131-2_SK");
    expect(lines).toContain(`010:${HETU}`);
    expect(lines.at(-2)).toBe("999:1");
    expect(lines.at(-1)).toBe("");
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    // Välityspalvelun tunnuksen lisää Ilmoitin.fi.
    expect(lines.some((l) => l.startsWith("045:"))).toBe(false);
  });

  it("jokainen rivi on tunnus:tieto ilman ylimääräisiä välilyöntejä", () => {
    for (const l of lines.slice(0, -1)) {
      expect(l).toMatch(/^\d{3}:\S(.*\S)?$/);
    }
  });

  it("rahat pilkulla ja kahdella desimaalilla, määrät kokonaislukuina", () => {
    expect(lines).toContain("603:20000,00");
    expect(lines).toContain("610:1420,00");
    expect(lines).toContain("702:150");
    expect(lines).not.toContain("703:0");
    expect(formatAmount(1234.5)).toBe("1234,50");
    expect(() => formatAmount(-1)).toThrow();
  });

  it("hankintatyön osatietoryhmä: 001, tekijän tiedot, 009 ja 706 (#821)", () => {
    const i = lines.indexOf("001:1");
    expect(lines.slice(i, i + 8)).toEqual(["001:1", "700:Veli Metsänen - poika", `701:${WORKER_HETU}`, "702:150", "704:2400,00", "705:400,00", "009:1", "706:2400,00"]);
    // Seuranta tulee hankintatyön jälkeen kuten tietuekuvauksessa.
    expect(lines.indexOf("655:72000,00")).toBeGreaterThan(i);
  });

  it("merkistö on ISO-8859-1", () => {
    const bytes = encodeLatin1(text);
    const a = text.indexOf("ä");
    expect(bytes[a]).toBe(0xe4);
    expect(bytes.length).toBe(text.length);
    expect(toLatin1Text("Łukasz Żółć 5 €\nrivi", 70)).toBe("Lukasz Zólc 5 EUR rivi");
    expect(toLatin1Text("日本", 10)).toBe("??");
    expect(() => encodeLatin1("日")).toThrow();
  });

  it("aikaleima Suomen ajassa", () => {
    expect(timestamp198(new Date("2026-01-15T22:30:00Z"))).toBe("16012026003000");
  });

  it("ilman tekijöitä osatietoryhmää ei ole", () => {
    const t = render2c({ computed: compute2c(data()), filerId: "2237131-2", software: SKOG_SOFTWARE, createdAt, workers: [] });
    expect(t).not.toContain("001:");
    expect(t).not.toContain("701:");
  });
});

describe("hankintatyön tekijät", () => {
  it("tekijä ja määrä kirjauksen selitteestä", () => {
    expect(parseDeliveryWorkDescription("Hankintatyö — Veli Metsänen")).toEqual({ name: "Veli Metsänen", madeM3: null });
    expect(parseDeliveryWorkDescription("Hankintatyö 150,5 m³, taksat 2025")).toEqual({ name: null, madeM3: 150.5 });
    expect(
      defaultWorkers([
        { description: "Hankintatyö — Veli", amount: 100 },
        { description: "Hankintatyö — Veli", amount: 50.5 },
        { description: "Hankintatyö 20 m³, taksat 2025", amount: 200 },
      ]),
    ).toEqual([
      { name: "Veli", value: 150.5, madeM3: null },
      { name: "", value: 200, madeM3: 20 },
    ]);
  });

  it("veronalainen arvo yli 125 m³:n osalta", () => {
    expect(deliveryWorkTaxable(1000, 100)).toBe(0);
    expect(deliveryWorkTaxable(1000, 250)).toBe(500);
  });
});
