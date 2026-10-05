import { describe, expect, it } from "vitest";
import { accountForYear, buildYearPlan, clientName, hasAgriculture, hasForestry, isVatRegistered, mapAccount } from "@/lib/import/tilituki/map";
import { compareForm2, summarizeComparisons } from "@/lib/compare/tilituki";
import { isTilitukiId, tilitukiId } from "@/lib/import/origin";
import { acc, entry, farmFolder } from "../helpers/tilituki";

describe("Tilitukin tilin kartoitus veronumerosta", () => {
  it("vie maatalouden tulot ja menot lomakkeen 2 kenttien luokkiin", () => {
    expect(mapAccount(acc("4000", "Maitotulot", "L2_255", "TU", 14, "K"))).toEqual({ type: "category", category: "agri_livestock_products" });
    expect(mapAccount(acc("6430", "Perustuki", "L2_217"))).toEqual({ type: "category", category: "agri_state_subsidy" });
    expect(mapAccount(acc("3850", "Korkomenot/maatalous", "L2_151"))).toEqual({ type: "category", category: "agri_interest" });
    expect(mapAccount(acc("0910", "Rahapalkat", "L2_223"))).toEqual({ type: "category", category: "agri_wages" });
    expect(mapAccount(acc("7500", "Pystymyynti metsä", "L2C_102"))).toEqual({ type: "category", category: "standing_sale" });
    expect(mapAccount(acc("7200", "Muut menot metsä", "L2C_119"))).toEqual({ type: "category", category: "other_expense" });
  });

  it("tarkentaa luokan vakiotilikartan numerosta vain, jos lomakkeen kohta pysyy samana", () => {
    // Rekisteröity: menon kohta tulee rivin kannasta, joten tarkennus käy.
    expect(mapAccount(acc("2500", "Sähkömenot", "L2_258", "TU", 25.5), true, 25.5)).toEqual({ type: "category", category: "agri_energy" });
    expect(mapAccount(acc("3210", "MYEL-vakuutus", "L2_260"), true, 0)).toEqual({ type: "category", category: "agri_myel" });
    // Lääkkeet ovat Tilitukissa 14 %:n kohdassa, mutta Eläinlääkärin oletuskanta on yleinen: rekisteröimättömällä se veisi kohtaan 226.
    expect(mapAccount(acc("2120", "Lääkkeet", "L2_259", "TU", 14), false, 0)).toEqual({ type: "category", category: "agri_feed" });
    // Rekisteröimättömän 0 %:n menot luokkaan, jonka oletuskanta on 0 %.
    expect(mapAccount(acc("3305", "Muut menot, veroton", "L2_260"), false, 0)).toEqual({ type: "category", category: "agri_rents" });
  });

  it("erottaa investoinnit, alv-tilit, ennakonpidätyksen ja kartoittamattomat", () => {
    expect(mapAccount(acc("3700", "Konehankinnat", "L21_111", "TA"))).toEqual({ type: "agri_asset", assetClass: "agri_machinery", accelerated: false });
    expect(mapAccount(acc("3700_50", "Konehankinnat tuplapoisto", "L21_111T", "TA"))).toEqual({ type: "agri_asset", assetClass: "agri_machinery", accelerated: true });
    expect(mapAccount(acc("3710", "Käyttöönottamattomat koneet", "L21_136", "TA"))).toEqual({ type: "extra", code: "278" });
    expect(mapAccount(acc("3950", "Ostojen ALV", "LALV_307", "TAALVO")).type).toBe("ignore");
    expect(mapAccount(acc("8404", "Ennakonpidätys metsätulosta", "")).type).toBe("withholding");
    expect(mapAccount(acc("8300", "Yksityismenot", "")).type).toBe("ignore");
    expect(mapAccount(acc("8530", "Lainan lyhennys", "LAINA", "TA-LAINASALDO")).type).toBe("ignore");
    expect(mapAccount(acc("8125", "Maatalousmaan vuokratulot", "L2_176"))).toMatchObject({ type: "unmapped" });
    expect(mapAccount(acc("6820", "Koneiden myynti", "L21_113", "TA"))).toMatchObject({ type: "unmapped" });
    expect(mapAccount(acc("9999", "Outo", "L2_999"))).toMatchObject({ type: "unmapped", reason: "tuntematon veronumero L2_999" });
    expect(mapAccount(undefined)).toMatchObject({ type: "unmapped" });
  });

  it("vie vuokratulotilin 6715 aiempina vuosina muihin tuloihin (220), koska Tilitukin 2025-päivitys tyhjensi sen veronumeron", () => {
    const a = acc("6715", "Vuokratulot maatalousmaasta", "", "TU", 0, "K");
    expect(accountForYear(a, 2024)?.taxCode).toBe("L2_257");
    expect(accountForYear(a, 2025)?.taxCode).toBe("");
  });
});

describe("Tilitukin vuoden tuontisuunnitelma", () => {
  const f = farmFolder();
  const plan = buildYearPlan(f, 2025);

  it("tunnistaa toiminnot ja arvonlisäverovelvollisuuden", () => {
    expect(hasAgriculture(f, 2025)).toBe(true);
    expect(hasForestry(f, 2025)).toBe(true);
    expect(isVatRegistered(f, 2025)).toBe(true);
    expect(hasAgriculture(farmFolder({ form2: { "2025": { "413": 50, "414": 50 } }, entries: {} }), 2025)).toBe(false);
  });

  it("tekee kirjaukset verottomina summina, tulot positiivisina ja veron kannaksi", () => {
    const byCat = (c: string) => plan.transactions.filter((t) => t.category === c);
    expect(byCat("agri_livestock_products")).toEqual([expect.objectContaining({ kind: "income", amountNet: 20000, vatRate: 14, reference: "Tilituki 11" })]);
    // Hyvitys ilman veroa on 0 %:n kirjaus ja negatiivinen.
    expect(byCat("agri_energy").map((t) => [t.amountNet, t.vatRate])).toEqual([[1000, 25.5], [-100, 0]]);
    expect(byCat("agri_myel")[0]).toMatchObject({ kind: "expense", amountNet: 3000, vatRate: 0 });
    expect(byCat("standing_sale")[0]).toMatchObject({ amountNet: 30000, vatRate: 25.5, withholding: 7500 });
    // Pysyvä tunniste: sama vienti saa saman tunnisteen joka ajossa.
    expect(byCat("agri_myel")[0].legacyId).toBe(tilitukiId("entry", "901", f.entries["2025"].find((e) => e.account === "3210")!.id));
  });

  it("ohittaa vastakirjaukset, alv-tilit ja yksityiset tilit ja raportoi kartoittamattomat", () => {
    expect(plan.ignored).toMatchObject({ "vastakirjaus (kassa tai pankki)": 1, "arvonlisävero (kirjauksen verokanta)": 2, "ei verolomakkeella (yksityinen tai muu)": 1 });
    expect(plan.unmapped).toEqual([expect.objectContaining({ account: "8125", taxCode: "L2_176", count: 1 })]);
    expect(plan.notes["veroton rivi verollisella tilillä (Skog: kohta 230)"]).toBe(1);
  });

  it("tuo käsin annetun lomakkeen 2 erän vuoden lopun kirjauksena", () => {
    const adj = plan.transactions.filter((t) => t.reference === "Tilituki lomake 2");
    expect(adj).toEqual([expect.objectContaining({ category: "agri_other_deductions", amountNet: 150, bookedOn: "2025-12-31" })]);
  });

  it("tekee investoinnin hankinnasta ja aiemmat investoinnit menojäännöksistä", () => {
    expect(plan.newAssets).toEqual([expect.objectContaining({ assetClass: "agri_machinery", acquisitionCost: 10000, openingYear: null })]);
    expect(plan.transactions.find((t) => t.category === "agri_asset_purchase")).toMatchObject({ kind: "investment", assetKey: plan.newAssets[0].key });
    const opening = Object.fromEntries(plan.openingAssets.map((a) => [a.key, a.openingBookValue]));
    // Rakennus kortistosta, koska summa täsmää lomakkeeseen; poistoprosentiton asuinrakennus jää pois.
    expect(opening).toEqual({ "pool-agri_machinery": 12000, "building-B1": 45000 });
    expect(plan.openingAssets.every((a) => a.openingYear === 2025)).toBe(true);
    // Ryhmän hankintaa ei tiedetä; rakennuksen hankintavuosi ja -hinta tulevat kortistosta (kertynyt poisto on erotus).
    expect(plan.openingAssets.find((a) => a.key === "pool-agri_machinery")).toMatchObject({ acquiredOn: "2024-12-31", acquisitionCost: 12000 });
    expect(plan.openingAssets.find((a) => a.key === "building-B1")).toMatchObject({ acquiredOn: "2010-12-31", acquisitionCost: 100000 });
    expect(plan.notes["rakennus ilman poistoprosenttia jätettiin pois (ei Tilitukin lomakkeella)"]).toBe(1);
    expect(plan.agriDepreciations).toEqual([{ pool: "agri_production_building", amount: 4500 }, { pool: "agri_machinery", amount: 5500 }]);
  });

  it("käyttää laskemattomalle vuodelle edellisen vuoden loppuarvoja", () => {
    const open = buildYearPlan(farmFolder({ form2: { "2024": { "265": 12000, "244": 45000 }, "2025": {} } }), 2025);
    expect(Object.fromEntries(open.openingAssets.map((a) => [a.key, a.openingBookValue]))).toEqual({ "pool-agri_machinery": 12000, "building-B1": 45000 });
    expect(open.agriDepreciations).toEqual([]);
  });

  it("erottaa korotetun poiston koneet omaksi ryhmäkseen", () => {
    const p = buildYearPlan(farmFolder({ form2Raw: { "2025": { L21_110T: 2000, L21_117T: 1000 }, "2024": {} } }), 2025);
    expect(p.openingAssets.find((a) => a.key === "pool-agri_machinery")?.openingBookValue).toBe(10000);
    expect(p.openingAssets.find((a) => a.key === "pool-agri_machinery_accelerated")).toMatchObject({ accelerated: true, openingBookValue: 2000 });
    expect(p.agriDepreciations).toContainEqual({ pool: "agri_machinery_accelerated", amount: 1000 });
    expect(p.agriDepreciations).toContainEqual({ pool: "agri_machinery", amount: 4500 });
  });

  it("tuo vuoden tiedot, varaukset ja jaksotukset lomakkeelta", () => {
    expect(plan.agriYear).toMatchObject({ spouseWealthSharePct: 0, spouseWorkSharePct: 0, liabilities: 30000, otherAssetsValue: null });
    const p = buildYearPlan(
      farmFolder({ form2: { "2024": { "171": 3000, "211": 900 }, "2025": { "219": 1000, "232": 2000, "362": 1, "414": 40, "413": 60 } } }),
      2025,
    );
    expect(p.openingReserves).toEqual([{ kind: "equalization", madeYear: 2023, amount: 3000, incomeThisYear: 1000 }]);
    expect(p.yearReserves).toEqual([{ kind: "equalization", madeYear: 2025, amount: 2000, incomeThisYear: 0 }]);
    expect(p.openingDeferrals).toEqual([{ taxYear: 2024, kind: "livestock_sale", amount: 900 }]);
    expect(p.agriYear).toMatchObject({ spouseWealthSharePct: 40, spouseWorkSharePct: null });
  });

  it("ei liitä ennakonpidätystä, jos tositteella on useampi metsätalouden tulo", () => {
    const f2 = farmFolder();
    f2.entries["2025"].push(entry({ voucher: "13", row: 3, date: "2025-09-30", account: "7500", credit: 100 }));
    const p = buildYearPlan(f2, 2025);
    expect(p.transactions.filter((t) => t.category === "standing_sale").every((t) => t.withholding === 0)).toBe(true);
    expect(p.notes["ennakonpidätystä ei voitu liittää tuloon"]).toBe(1);
  });
});

describe("lomakkeen 2 vertailu Tilitukiin", () => {
  it("erottaa täsmäävät, poikkeavat ja Skogille tuntemattomat kentät", () => {
    const c = compareForm2({ "226": 100, "230": 50, "413": 100, "737": 900 }, { "226": 100, "230": 49.99, "231": 10 });
    expect(c.matching).toEqual(["226", "413"]);
    expect(c.differing).toEqual([{ code: "230", tilituki: 50, skog: 49.99, diff: -0.01 }, { code: "231", tilituki: 0, skog: 10, diff: 10 }]);
    expect(c.unsupported).toEqual([{ code: "737", tilituki: 900, skog: 0, diff: -900 }]);
  });

  it("laskee yhteenvedon ja yleisimmät poikkeavat kentät", () => {
    const ok = compareForm2({ "226": 1 }, { "226": 1 });
    const bad = compareForm2({ "226": 1, "230": 1 }, { "226": 2 });
    const s = summarizeComparisons([{ folder: "1", result: ok }, { folder: "2", result: bad }, { folder: "3", result: bad }]);
    expect(s).toMatchObject({ total: 3, identical: 1, partial: 2 });
    expect(s.commonFields).toEqual([["226", 2], ["230", 2]]);
  });
});

describe("tuotujen rivien alkuperä", () => {
  it("Tilitukin tunniste on pysyvä ja erottuu vanhan kannan satunnaisista tunnisteista", () => {
    const id = tilitukiId("entry", "9", "0000000123-4");
    expect(id).toBe(tilitukiId("entry", "9", "0000000123-4"));
    expect(id).not.toBe(tilitukiId("entry", "10", "0000000123-4"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(isTilitukiId(id)).toBe(true);
    expect(isTilitukiId("00000000-0000-4000-8000-000000000041")).toBe(false);
  });
});

describe("clientName", () => {
  const base = { name: null, businessId: null, street: null, postalCode: null, city: null, openYear: null, vatMethod: null };
  it("Verohallinnon muodosta sukunimi ja etunimet", () => {
    expect(clientName({ ...base, taxName: "Virtanen Matti Juhani" }, "1")).toEqual({ firstName: "Matti Juhani", lastName: "Virtanen" });
  });
  it("yhtymä tai kuolinpesä jää kokonaan sukunimeksi", () => {
    expect(clientName({ ...base, taxName: "Virtanen Matti ja Liisa" }, "1")).toEqual({ firstName: "", lastName: "Virtanen Matti ja Liisa" });
    expect(clientName({ ...base, taxName: "Virtasen Matin kuolinpesä" }, "1").firstName).toBe("");
  });
  it("ilman ilmoitusnimeä virallinen nimi tai tunniste", () => {
    expect(clientName({ ...base, name: "Maatila Esimerkki" }, "1")).toEqual({ firstName: "", lastName: "Maatila Esimerkki" });
    expect(clientName(base, "7")).toEqual({ firstName: "", lastName: "Tilituki-asiakas 7" });
  });
});
