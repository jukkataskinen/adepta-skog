import { describe, expect, it } from "vitest";
import {
  addButtonKeyAction,
  applyGridPaste,
  categoryDigit,
  emptyGridRow,
  gridColumns,
  gridKeyAction,
  offersDeliveryWork,
  planGridChanges,
  rowFromStored,
  rowNet,
  sameRow,
  selectCategory,
  toggleKind,
  validateGridRow,
  type GridRow,
  type KeyInput,
} from "@/lib/ledger/grid";
import { parseClipboard } from "@/lib/ledger/transaction-input";

const PROP = "11111111-1111-4111-8111-111111111111";
const ASSET = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";
const registered = { vatRegistered: true };
const row = (over: Partial<GridRow> = {}): GridRow => ({ ...emptyGridRow("k1", "1.3.2025"), ...over });
const opts = { year: 2025, propertyIds: [PROP], vatRegistered: true, saleableAssetIds: () => [ASSET] };

describe("näppäimet", () => {
  const columns = gridColumns(false);
  const key = (over: Partial<KeyInput>): KeyInput => ({ key: "Enter", shift: false, ctrl: false, row: 0, col: 0, rowCount: 3, columns, menuOpen: false, ...over });

  it("sarakkeet vanhan järjestyksessä, metsätila vain jos tiloja on", () => {
    expect(columns).toEqual(["bookedOn", "description", "category", "amountGross", "vatRate", "kind"]);
    expect(gridColumns(true)).toEqual(["bookedOn", "description", "category", "amountGross", "vatRate", "forestPropertyId", "kind"]);
  });

  it("Enter ja Tab eteenpäin, rivin lopussa rivin loppu", () => {
    expect(gridKeyAction(key({ col: 0 }))).toEqual({ type: "focus", row: 0, col: 1 });
    expect(gridKeyAction(key({ key: "Tab", col: 4 }))).toEqual({ type: "focus", row: 0, col: 5 });
    expect(gridKeyAction(key({ col: 5, row: 1 }))).toEqual({ type: "rowEnd", row: 1 });
    expect(gridKeyAction(key({ key: "Tab", col: 5, row: 2 }))).toEqual({ type: "rowEnd", row: 2 });
  });

  it("Shift takaisin rivien yli, ensimmäisestä kentästä selaimen oletus", () => {
    expect(gridKeyAction(key({ key: "Tab", shift: true, col: 2 }))).toEqual({ type: "focus", row: 0, col: 1 });
    expect(gridKeyAction(key({ key: "Tab", shift: true, col: 0, row: 2 }))).toEqual({ type: "focus", row: 1, col: 5 });
    expect(gridKeyAction(key({ key: "Tab", shift: true, col: 0, row: 0 }))).toBeNull();
    expect(gridKeyAction(key({ key: "Enter", shift: true, col: 1 }))).toEqual({ type: "focus", row: 0, col: 0 });
  });

  it("nuolet samaan sarakkeeseen, ei selitteessä; viimeiseltä riviltä Lisää rivi -painikkeeseen", () => {
    expect(gridKeyAction(key({ key: "ArrowDown", col: 3, row: 0 }))).toEqual({ type: "focus", row: 1, col: 3 });
    expect(gridKeyAction(key({ key: "ArrowUp", col: 3, row: 1 }))).toEqual({ type: "focus", row: 0, col: 3 });
    expect(gridKeyAction(key({ key: "ArrowUp", col: 3, row: 0 }))).toEqual({ type: "none" });
    expect(gridKeyAction(key({ key: "ArrowDown", col: 3, row: 2 }))).toEqual({ type: "addButton" });
    expect(gridKeyAction(key({ key: "ArrowDown", col: 1 }))).toBeNull();
  });

  it("avoin luokkavalikko ottaa nuolet, Enterin, Escin ja Tabin", () => {
    const k = (over: Partial<KeyInput>) => key({ col: 2, menuOpen: true, ...over });
    expect(gridKeyAction(k({ key: "ArrowDown" }))).toEqual({ type: "menuMove", delta: 1 });
    expect(gridKeyAction(k({ key: "ArrowUp" }))).toEqual({ type: "menuMove", delta: -1 });
    expect(gridKeyAction(k({ key: "Enter" }))).toEqual({ type: "menuSelect" });
    expect(gridKeyAction(k({ key: "Escape" }))).toEqual({ type: "menuClose", then: null });
    expect(gridKeyAction(k({ key: "Tab" }))).toEqual({ type: "menuClose", then: { type: "focus", row: 0, col: 3 } });
    expect(gridKeyAction(k({ key: "Tab", shift: true }))).toEqual({ type: "menuClose", then: { type: "focus", row: 0, col: 1 } });
    // Suljetussa valikossa nuolet liikkuvat riveillä, välilyönti avaa.
    expect(gridKeyAction(key({ col: 2, key: "ArrowDown" }))).toEqual({ type: "focus", row: 1, col: 2 });
    expect(gridKeyAction(key({ col: 2, key: " " }))).toEqual({ type: "menuOpen" });
  });

  it("T vaihtaa tyypin muualla kuin tekstissä, Delete poistaa rivin viimeisessä sarakkeessa", () => {
    expect(gridKeyAction(key({ key: "t", col: 3 }))).toEqual({ type: "toggleKind", row: 0 });
    expect(gridKeyAction(key({ key: "T", col: 5 }))).toEqual({ type: "toggleKind", row: 0 });
    expect(gridKeyAction(key({ key: "t", col: 1 }))).toBeNull();
    expect(gridKeyAction(key({ key: "Delete", col: 5, row: 1 }))).toEqual({ type: "deleteRow", row: 1 });
    expect(gridKeyAction(key({ key: "Delete", col: 3 }))).toBeNull();
    expect(gridKeyAction(key({ key: "s", ctrl: true }))).toBeNull();
  });

  it("Lisää rivi -painike: Enter ja välilyönti lisäävät, nuoli ylös palaa", () => {
    expect(addButtonKeyAction("Enter", false, 3, 5)).toEqual({ type: "add" });
    expect(addButtonKeyAction(" ", false, 3, 5)).toEqual({ type: "add" });
    expect(addButtonKeyAction("ArrowUp", false, 3, 5)).toEqual({ type: "focus", row: 2, col: 0 });
    expect(addButtonKeyAction("Tab", true, 3, 5)).toEqual({ type: "focus", row: 2, col: 5 });
    expect(addButtonKeyAction("Tab", false, 3, 5)).toBeNull();
  });
});

describe("luokan numerovalinta", () => {
  it("yksiselitteinen numero valitaan heti", () => {
    expect(categoryDigit("", "2")).toEqual({ buffer: "", select: 2, highlight: 2 });
    expect(categoryDigit("", "9")).toEqual({ buffer: "", select: 9, highlight: 9 });
  });

  it("1 odottaa toista numeroa: 10, 11 ja 12", () => {
    expect(categoryDigit("", "1")).toEqual({ buffer: "1", select: null, highlight: 1 });
    expect(categoryDigit("1", "0")).toEqual({ buffer: "", select: 10, highlight: 10 });
    expect(categoryDigit("1", "2")).toEqual({ buffer: "", select: 12, highlight: 12 });
  });

  it("numero, joka ei jatka syötettä, aloittaa uuden", () => {
    expect(categoryDigit("1", "5")).toEqual({ buffer: "", select: 5, highlight: 5 });
    expect(categoryDigit("", "0")).toEqual({ buffer: "", select: null, highlight: null });
  });
});

describe("rivin laskenta", () => {
  it("luokan valinta asettaa tyypin ja verokannan; rekisteröimättömällä 0 %", () => {
    const r = selectCategory(row(), "standing_sale", 2025, registered);
    expect(r).toMatchObject({ category: "standing_sale", kind: "income", vatRate: "25,5" });
    expect(selectCategory(row(), "other_expense", 2025, { vatRegistered: false }).vatRate).toBe("0");
    expect(selectCategory(row({ bookedOn: "1.8.2024" }), "travel", 2024, registered).vatRate).toBe("24");
  });

  it("veroton summa bruttosta", () => {
    expect(rowNet(row({ category: "other_expense", amountGross: "125,50", vatRate: "25,5" }), 2025, registered)).toBe(100);
    expect(rowNet(row({ category: "other_expense", amountGross: "125,50" }), 2025, { vatRegistered: false })).toBe(125.5);
    expect(rowNet(row({ amountGross: "x", vatRate: "25,5" }), 2025, registered)).toBeNull();
  });

  it("tyypin vaihto: tulo ja meno vaihtuvat, investointi ei", () => {
    expect(toggleKind(row({ category: "standing_sale", kind: "income" })).kind).toBe("expense");
    expect(toggleKind(row({ category: "travel" })).kind).toBe("income");
    expect(toggleKind(row({ category: "asset_purchase", kind: "investment" })).kind).toBe("investment");
  });

  it("hankintatyötä tarjotaan hankintakaupan alle, jos sitä ei vielä ole", () => {
    const sale = row({ category: "delivery_sale", amountGross: "5 000,00" });
    expect(offersDeliveryWork([sale], 0)).toBe(true);
    expect(offersDeliveryWork([sale, row({ key: "k2", category: "delivery_work" })], 0)).toBe(false);
    expect(offersDeliveryWork([row({ category: "standing_sale", amountGross: "5000" })], 0)).toBe(false);
    expect(offersDeliveryWork([row({ category: "delivery_sale" })], 0)).toBe(false);
  });
});

describe("rivin tarkistus", () => {
  it("kelvollinen rivi: brutto, oletuskanta ja tyyppi", () => {
    const r = validateGridRow(row({ category: "other_expense", amountGross: "125,50" }), opts);
    expect(r.ok && r.value).toMatchObject({ bookedOn: "2025-03-01", amountGross: 125.5, vatRate: 25.5, kind: "expense", withholding: 0 });
    const n = validateGridRow(row({ category: "other_expense", amountGross: "125,50" }), { ...opts, vatRegistered: false });
    expect(n.ok && n.value.vatRate).toBe(0);
  });

  it("käännetty tyyppi säilyy", () => {
    const r = validateGridRow(row({ category: "travel", amountGross: "10", kind: "income" }), opts);
    expect(r.ok && r.value.kind).toBe("income");
  });

  it("virheet kentittäin ja vuosi", () => {
    const r = validateGridRow(row({ bookedOn: "31.2.2025", category: "", amountGross: "x", vatRate: "120" }), opts);
    expect(!r.ok && r.errors).toEqual({ bookedOn: "Tarkista päivä.", category: "Valitse luokka.", amountGross: "Tarkista summa.", vatRate: "Tarkista verokanta." });
    const y = validateGridRow(row({ bookedOn: "1.1.2024", category: "travel", amountGross: "10" }), opts);
    expect(!y.ok && y.errors.bookedOn).toBe("Päivän on oltava vuonna 2025.");
    const p = validateGridRow(row({ category: "travel", amountGross: "10", forestPropertyId: "22222222-2222-4222-8222-222222222222" }), opts);
    expect(!p.ok && p.errors.forestPropertyId).toBe("Valitse asiakkaan metsätila.");
  });

  it("investoinnin hankinta: laji pakollinen, enintään 600 euroa vuosimenoksi (veroton summa)", () => {
    const noClass = validateGridRow(row({ category: "asset_purchase", amountGross: "5 000" }), opts);
    expect(!noClass.ok && noClass.errors.asset).toMatch(/hyödykkeen laji/);
    // 750 € sis. alv 25,5 % = 597,61 € veroton
    const small = validateGridRow(row({ category: "asset_purchase", amountGross: "750", vatRate: "25,5", assetRatePct: "25" }), opts);
    expect(!small.ok && small.errors.category).toMatch(/vuosimenona/);
    const ok = validateGridRow(row({ category: "asset_purchase", amountGross: "5 000", assetRatePct: "25" }), opts);
    expect(ok.ok && ok.value).toMatchObject({ kind: "investment", assetRatePct: 25 });
    // Tallennetun hankinnan investointi on jo olemassa: lajia ei kysytä.
    const existing = validateGridRow(row({ id: ID, category: "asset_purchase", amountGross: "5 000", assetId: ASSET }), opts);
    expect(existing.ok && existing.value.assetRatePct).toBeNull();
  });

  it("investoinnin myynti: myytävä kohde uudelle riville, vain sallituista", () => {
    const none = validateGridRow(row({ category: "asset_sale", amountGross: "2000" }), opts);
    expect(!none.ok && none.errors.asset).toBe("Valitse myytävä investointi.");
    const wrong = validateGridRow(row({ category: "asset_sale", amountGross: "2000", saleAssetId: ID }), opts);
    expect(wrong.ok).toBe(false);
    const ok = validateGridRow(row({ category: "asset_sale", amountGross: "2000", saleAssetId: ASSET }), opts);
    expect(ok.ok && ok.value).toMatchObject({ kind: "income", saleAssetId: ASSET });
  });
});

describe("muutosten erottelu", () => {
  const stored = rowFromStored({
    id: ID, booked_on: "2025-03-01", kind: "expense", category: "travel", description: "Ajot", amount_gross: "125.50", vat_rate: "25.50", withholding: "0.00",
    reference: "T-1", asset_id: null, forest_property_id: null, document_count: 2,
  });

  it("tallennettu rivi taulukkoon suomalaisittain", () => {
    expect(stored).toMatchObject({ key: ID, id: ID, bookedOn: "1.3.2025", amountGross: "125,50", vatRate: "25,5", withholding: "", reference: "T-1", documentCount: 2 });
  });

  it("sama arvo eri kirjoitusasussa ei ole muutos", () => {
    expect(sameRow(stored, { ...stored, amountGross: "125.5", vatRate: "25.50", bookedOn: "2025-03-01" }, 2025)).toBe(true);
    expect(sameRow(stored, { ...stored, amountGross: "125,51" }, 2025)).toBe(false);
    expect(sameRow(stored, { ...stored, kind: "income" }, 2025)).toBe(false);
  });

  it("uusi, muuttunut ja poistettu; tyhjä uusi rivi ohitetaan", () => {
    const other = { ...stored, key: "55555555-5555-4555-8555-555555555555", id: "55555555-5555-4555-8555-555555555555" };
    const changed = { ...stored, description: "Ajot metsään" };
    const created = row({ key: "n1", category: "travel", amountGross: "10" });
    const c = planGridChanges([stored, other], [changed, created, emptyGridRow("n2", "1.3.2025")], [other.id!], 2025);
    expect(c.created.map((r) => r.key)).toEqual(["n1"]);
    expect(c.updated.map((r) => r.key)).toEqual([ID]);
    expect(c.deleted).toEqual([other.id]);
    expect(c.unknown).toEqual([]);
  });

  it("palautettu poisto ei ole poisto, tuntematon tunniste erotellaan", () => {
    const c = planGridChanges([stored], [stored], [ID], 2025);
    expect(c.deleted).toEqual([]);
    const u = planGridChanges([], [stored], [], 2025);
    expect(u.unknown).toHaveLength(1);
  });
});

describe("liittäminen Excelistä", () => {
  let n = 0;
  const pasteOpts = { year: 2025, properties: [{ id: PROP, name: "Kotimetsä" }], newKey: () => `p${n++}` };

  it("otsikkorivi ohitetaan, sarakkeet taulukon järjestyksessä, summa bruttona", () => {
    const text = [
      "Päivä\tSelite\tLuokka\tSumma\tAlv\tEnnakko\tTila\tViite",
      "2025-03-01\tLeimikko 1\tPystykauppa\t15 060,00\t25,5\t3 600\tKotimetsä\tL-1",
      "15.4.2025\tAjot\t8\t120,50\t\t\t\t",
    ].join("\n");
    const out = applyGridPaste([emptyGridRow("r0", "1.1.2025")], 0, "bookedOn", parseClipboard(text), pasteOpts);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      key: "r0", bookedOn: "1.3.2025", category: "standing_sale", kind: "income", description: "Leimikko 1", amountGross: "15 060,00", vatRate: "25,5",
      withholding: "3 600", forestPropertyId: PROP, reference: "L-1",
    });
    // Luokka myös vanhan sovelluksen numerolla.
    expect(out[1]).toMatchObject({ bookedOn: "15.4.2025", category: "travel", amountGross: "120,50" });
    const v = validateGridRow(out[0], opts);
    expect(v.ok && v.value).toMatchObject({ amountGross: 15060, vatRate: 25.5, withholding: 3600 });
  });

  it("liitos keskelle alkaa valitusta kentästä", () => {
    const rows = [emptyGridRow("r0", "1.1.2025"), emptyGridRow("r1", "1.1.2025")];
    const out = applyGridPaste(rows, 1, "category", parseClipboard("Tuntematon\t50"), pasteOpts);
    expect(out[0]).toEqual(rows[0]);
    expect(out[1]).toMatchObject({ category: "Tuntematon", amountGross: "50" });
  });
});
