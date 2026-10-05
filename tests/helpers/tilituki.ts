import type { TtAccount, TtEntry, TtFolder } from "@/lib/import/tilituki/map";

/**
 * Kuvitteellinen Tilituki-asiakas testeihin. Tilit ovat Tilitukin
 * vakiotilikartan mukaisia; nimet, tunnukset ja summat on keksitty.
 */

export const acc = (number: string, name: string, taxCode: string, cls = "TU", vatPct = 0, side = "D"): TtAccount => ({
  number, name, class: cls, taxCode, vatPct, side, vatAccount: null,
});

/** Viennin tunniste tositteesta ja rivistä kuten Tilitukissa, jotta sama aineisto saa joka kerta samat tunnisteet. */
export const entry = (p: Partial<TtEntry> & { account: string }): TtEntry => ({
  id: `${p.voucher ?? "11"}-${p.row ?? 1}`, voucher: "11", row: 1, date: "2025-03-31", debit: 0, credit: 0, gross: null, vatPct: 0, vat: 0, description: "", ...p,
});

export function farmFolder(overrides: Partial<TtFolder> = {}): TtFolder {
  return {
    folder: "901",
    client: { name: "Koetila Mäkelä", businessId: "1234567-1", street: null, postalCode: "19650", city: "Joutsa", openYear: 2025, vatMethod: "NETTO" },
    accounts: [
      acc("4000", "Maitotulot", "L2_255", "TU", 14, "K"),
      acc("6430", "Perustuki", "L2_217", "TU-TUKIJULKINEN", 0, "K"),
      acc("2500", "Sähkömenot", "L2_258", "TU", 25.5),
      acc("2000", "Rehuostot", "L2_259", "TU", 14),
      acc("3210", "MYEL-vakuutus", "L2_260"),
      acc("3305", "Muut menot, veroton", "L2_260"),
      acc("3850", "Korkomenot/maatalous", "L2_151", "TU-KORKOKULUT"),
      acc("3700", "Konehankinnat", "L21_111", "TA", 25.5),
      acc("6666", "Energian valmisteveron palautus", "L2_240A", "TU", 0, "K"),
      acc("7500", "Pystymyynti metsä", "L2C_102", "TU", 25.5, "K"),
      acc("8404", "Ennakonpidätys metsätulosta", "", "TU"),
      acc("8300", "Yksityismenot", "", "TU"),
      acc("8125", "Maatalousmaan vuokratulot alv 0%", "L2_176", "TU", 0, "K"),
      acc("3950", "Ostojen ALV Maatalous", "LALV_307", "TAALVO"),
      acc("6942", "Myynnin ALV maatalous, kanta 2", "LALV_302", "TAALVM", 0, "K"),
    ],
    entries: {
      "2025": [
        entry({ voucher: "11", row: -1, account: "AUTOKASSA", credit: 5000 }),
        entry({ voucher: "11", row: 1, account: "4000", credit: 20000, vatPct: 14, vat: 2800 }),
        entry({ voucher: "11", row: 2, account: "6942", credit: 2800 }),
        entry({ voucher: "11", row: 3, account: "2500", debit: 1000, vatPct: 25.5, vat: 255 }),
        entry({ voucher: "11", row: 4, account: "3950", debit: 255 }),
        // Hyvitys ilman veroa verollisella tilillä: Skog vie kohtaan 230.
        entry({ voucher: "11", row: 5, account: "2500", debit: -100 }),
        entry({ voucher: "11", row: 6, account: "2000", debit: 500, vatPct: 14, vat: 70 }),
        entry({ voucher: "11", row: 7, account: "3210", debit: 3000 }),
        entry({ voucher: "11", row: 8, account: "3305", debit: 50 }),
        entry({ voucher: "11", row: 9, account: "3850", debit: 400 }),
        entry({ voucher: "11", row: 10, account: "6430", credit: 8000 }),
        entry({ voucher: "11", row: 11, account: "8300", debit: 99 }),
        entry({ voucher: "12", row: 1, date: "2025-06-30", account: "3700", debit: 10000, vatPct: 25.5, vat: 2550 }),
        entry({ voucher: "13", row: 1, date: "2025-09-30", account: "7500", credit: 30000, vatPct: 25.5, vat: 7650 }),
        entry({ voucher: "13", row: 2, date: "2025-09-30", account: "8404", debit: 7500 }),
        entry({ voucher: "14", row: 1, date: "2025-10-31", account: "8125", credit: 900 }),
        entry({ voucher: "14", row: 2, date: "2025-10-31", account: "6666", credit: 300 }),
      ],
    },
    machinery: [],
    buildings: [
      {
        id: "B1", number: "1", name: "Navetta", type: 1, depreciationClass: 1, acquiredYear: "2010", cost: 100000, maxPct: 10,
        years: { "2024": { start: 50000, additions: 0, sales: 0, compensation: 0, grants: 0, equalization: 0, base: 50000, pct: 10, depreciation: 5000, end: 45000 },
          "2025": { start: 45000, additions: 0, sales: 0, compensation: 0, grants: 0, equalization: 0, base: 45000, pct: 10, depreciation: 4500, end: 40500 } },
      },
      {
        // Poistoprosentti puuttuu: Tilituki jättää rakennuksen pois lomakkeelta.
        id: "B2", number: "2", name: "Asuinrakennus", type: 2, depreciationClass: 2, acquiredYear: "1990", cost: 0, maxPct: 6,
        years: { "2025": { start: 20000, additions: 0, sales: 0, compensation: 0, grants: 0, equalization: 0, base: 20000, pct: 0, depreciation: 0, end: 20000 } },
      },
    ],
    form2: {
      "2024": { "265": 12000, "244": 45000 },
      "2025": {
        "214": 20000, "217": 8000, "222": 300, "226": 1000, "229": 500, "230": 2950, "465": 400, "464": 150,
        "240": 45000, "524": 4500, "244": 40500, "260": 12000, "261": 10000, "511": 5500, "265": 16500, "231": 10000,
        "413": 100, "415": 100, "466": 40500, "467": 16500, "731": 57000, "732": 30000, "735": 27000, "332": 28300, "357": 15000, "362": 13300,
      },
    },
    form2c: { "2025": { "603": 30000 } },
    form2Raw: { "2025": {}, "2024": {} },
    ...overrides,
  };
}
