import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Sql } from "@/lib/db/types";
import { createPgliteDatabase } from "@/lib/db/pglite";
import { migrateLocal } from "@/lib/db/migrate";
import { deleteTransaction, LedgerError, saveTransaction } from "@/lib/ledger/write";
import { saveLedgerGrid } from "@/lib/ledger/grid-save";
import { emptyGridRow, rowFromStored } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
import { AgriError, deleteDeferral, deleteFarm, listDeferrals } from "@/lib/agriculture/year";
import { getVehicleReport, saveVehicleReport } from "@/lib/agriculture/vehicle";
import { saveAgriPlanChoices } from "@/lib/agriculture/plan";
import { loadAgriPlanData, loadForm2 } from "@/lib/tax/agri-form-load";
import { loadFilingSource } from "@/lib/filing/load";
import { compute2c } from "@/lib/filing/vsy02c";
import { loadPlanData } from "@/lib/tax/load";
import { EMPTY_VEHICLE_REPORT } from "@/lib/tax/vehicle";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Migraatio 0018: kirjauksen maatila, kotieläinten jaksotus kirjauksesta,
 * tasausvaraus tiloittain sekä ajoneuvo- ja matkaselvitys (DECISIONS 2.10.2026).
 */

let db: Database;
let a: OrgFixture;
let farmA: string;
let farmB: string;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService(async (tx) => {
    await tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]);
    farmA = (await tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name) values ($1,$2,'Ylätila') returning id", [a.id, a.client]))[0].id;
    farmB = (await tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name) values ($1,$2,'Alatila') returning id", [a.id, a.client]))[0].id;
    await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1,$2,2026)", [a.id, a.client]);
  });
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const asStaff = <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(a.staff.sub, fn);
const base = { kind: null, description: "", withholding: 0, businessSharePct: 100, forestPropertyId: null, assetRatePct: null, saleAssetId: null };
const deferralsOf = (transactionId: string) =>
  asStaff((tx) =>
    tx.query<{ tax_year: number; kind: string; amount: string; year1: string; year2: string; year3: string }>(
      "select tax_year, kind, amount, year1, year2, year3 from sk_agri_deferrals where transaction_id = $1",
      [transactionId],
    ),
  );

describe("migraatio 0018", () => {
  it("ei kaadu suljettuun vuoteen, eikä vanhoja rivejä muuteta", async () => {
    const old = await createPgliteDatabase();
    try {
      await migrateLocal(old, undefined, "0017_suggestion_lines_limit.sql");
      const o = await seedOrg(old, "Vanha toimisto");
      await old.asService(async (tx) => {
        await tx.query("update sk_clients set has_agriculture = true where id = $1", [o.client]);
        await tx.query(
          `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net, vat_rate, activity)
           values ($1,$2,'2025-04-01','income','agri_livestock_sale_deferred',3000,25.5,'agriculture')`,
          [o.id, o.client],
        );
        await tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [o.client]);
      });
      const before = await old.asService((tx) => tx.query<{ id: string; updated_at: string }>("select id, updated_at::text from sk_transactions order by id"));
      expect(await migrateLocal(old, undefined, "0018_agri_ledger.sql")).toEqual(["0018_agri_ledger.sql"]);
      const after = await old.asService((tx) =>
        tx.query<{ id: string; updated_at: string; farm_id: string | null }>("select id, updated_at::text, farm_id from sk_transactions order by id"),
      );
      expect(after.map((r) => ({ id: r.id, updated_at: r.updated_at }))).toEqual(before);
      expect(after.every((r) => r.farm_id === null)).toBe(true);
      // Vanha jaksotettava kirjaus ilman jaksotusriviä lasketaan edelleen kirjauksesta.
      const form = await old.asUser(o.staff.sub, (tx) => loadForm2(tx, o.client, 2025));
      expect(form!.fields["211"]).toBe(3000);
      expect(form!.fields["212"]).toBe(1000);
    } finally {
      await old.close();
    }
  });
});

describe("kirjauksen maatila", () => {
  it("vain maatalouden kirjauksella ja vain asiakkaan omalla tilalla", async () => {
    await expect(
      asStaff((tx) =>
        tx.query(
          "insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_gross, vat_rate, farm_id) values ($1,$2,'2025-03-01','expense','other_expense',10,0,$3)",
          [a.id, a.client, farmA],
        ),
      ),
    ).rejects.toThrow(/sk_transactions_farm_agri/);
    const other = await db.asService((tx) =>
      tx.query<{ id: string }>("insert into sk_farms (organization_id, client_id, name) values ($1,$2,'Toisen tila') returning id", [a.id, a.otherClient]),
    );
    await expect(
      asStaff((tx) =>
        saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-03-01", category: "agri_fuels", amountGross: 100, vatRate: 25.5, farmId: other[0].id }),
      ),
    ).rejects.toThrow(LedgerError);
    const id = await asStaff((tx) =>
      saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-03-01", category: "agri_fuels", amountGross: 100, vatRate: 25.5, farmId: farmA }),
    );
    // Muokkaus ilman tilaa (lomake ilman tilavalintaa) pitää tilan, luokan vaihto metsään tyhjentää sen.
    await asStaff((tx) => saveTransaction(tx, actor(), a.client, id, { ...base, bookedOn: "2025-03-02", category: "agri_fuels", amountGross: 120, vatRate: 25.5 }));
    expect((await asStaff((tx) => tx.query<{ farm_id: string }>("select farm_id from sk_transactions where id = $1", [id])))[0].farm_id).toBe(farmA);
    await asStaff((tx) => saveTransaction(tx, actor(), a.client, id, { ...base, bookedOn: "2025-03-02", category: "other_expense", amountGross: 120, vatRate: 25.5, farmId: farmA }));
    expect((await asStaff((tx) => tx.query<{ farm_id: string | null }>("select farm_id from sk_transactions where id = $1", [id])))[0].farm_id).toBeNull();
    await asStaff((tx) => deleteTransaction(tx, actor(), a.client, id));
  });

  it("taulukko tallentaa tilan", async () => {
    const row = { ...emptyGridRow("n1", "5.3.2025"), category: "agri_feed", amountGross: "500", vatRate: "14", farmId: farmB };
    await asStaff(async (tx) => {
      const existing = (await listTransactions(tx, a.client, 2025)).map(rowFromStored);
      return saveLedgerGrid(tx, { actor: actor(), clientId: a.client, year: 2025, rows: [...existing, row], deletedIds: [] });
    });
    const [t] = await asStaff((tx) => tx.query<{ id: string; farm_id: string }>("select id, farm_id from sk_transactions where category = 'agri_feed'"));
    expect(t.farm_id).toBe(farmB);
    await asStaff((tx) => deleteTransaction(tx, actor(), a.client, t.id));
  });
});

describe("kotieläinten jaksotus kirjauksesta", () => {
  it("jaksotettava kirjaus luo, muutos päivittää ja luokan vaihto poistaa jaksotuksen", async () => {
    const id = await asStaff((tx) =>
      saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-09-01", category: "agri_livestock_sale_deferred", amountGross: 12550, vatRate: 25.5 }),
    );
    expect(await deferralsOf(id)).toEqual([{ tax_year: 2025, kind: "livestock_sale", amount: "10000.00", year1: "3333.34", year2: "3333.33", year3: "3333.33" }]);
    // Osuus 60 %: jaksotus on maatalouden osuus.
    await asStaff((tx) =>
      saveTransaction(tx, actor(), a.client, id, { ...base, bookedOn: "2025-09-01", category: "agri_livestock_sale_deferred", amountGross: 12550, vatRate: 25.5, businessSharePct: 60 }),
    );
    expect((await deferralsOf(id))[0]).toMatchObject({ amount: "6000.00", year1: "2000.00" });

    // Lomake 2: 211 vuoden summa, 212 kolmen vuoden erät. Kirjaus ei tule kahdesti (rivi ja kirjaus).
    const f2025 = await asStaff((tx) => loadForm2(tx, a.client, 2025));
    expect(f2025!.fields["211"]).toBe(6000);
    expect(f2025!.fields["212"]).toBe(2000);
    const f2026 = await asStaff((tx) => loadForm2(tx, a.client, 2026));
    expect(f2026!.fields["212"]).toBe(2000);

    // Lomake 2 -välilehti näyttää jaksotuksen kirjauksesta, eikä sitä voi poistaa siellä.
    const list = await asStaff((tx) => listDeferrals(tx, a.client, 2026));
    const linked = list.find((d) => d.transaction_id === id)!;
    expect(linked.transaction_label).toMatch(/^1\.9\.2025/);
    await expect(asStaff((tx) => deleteDeferral(tx, actor(), a.client, linked.id))).rejects.toThrow(AgriError);

    // Jaksota pois: tavallinen myynti.
    await asStaff((tx) => saveTransaction(tx, actor(), a.client, id, { ...base, bookedOn: "2025-09-01", category: "agri_livestock_sale", amountGross: 12550, vatRate: 25.5 }));
    expect(await deferralsOf(id)).toEqual([]);
    await asStaff((tx) => deleteTransaction(tx, actor(), a.client, id));
  });

  it("hankinta verollisena rekisteröimättömälle, ja kirjauksen poisto poistaa jaksotuksen", async () => {
    await db.asService((tx) => tx.query("update sk_clients set vat_registered = false where id = $1", [a.client]));
    try {
      const id = await asStaff((tx) =>
        saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-02-01", category: "agri_livestock_purchase_deferred", amountGross: 3765, vatRate: 25.5 }),
      );
      expect((await deferralsOf(id))[0]).toMatchObject({ kind: "livestock_purchase", amount: "3765.00", year1: "1255.00" });
      const f = await asStaff((tx) => loadForm2(tx, a.client, 2025));
      expect(f!.fields["227"]).toBe(3765);
      expect(f!.fields["228"]).toBe(1255);
      await asStaff((tx) => deleteTransaction(tx, actor(), a.client, id));
      expect(await deferralsOf(id)).toEqual([]);
    } finally {
      await db.asService((tx) => tx.query("update sk_clients set vat_registered = true where id = $1", [a.client]));
    }
  });
});

describe("ajoneuvo- ja matkaselvitys", () => {
  it("tallennus, lomake 2 ja 2C:n kohta 630 samasta luvusta", async () => {
    await asStaff((tx) =>
      saveVehicleReport(tx, actor(), a.client, 2025, {
        ...EMPTY_VEHICLE_REPORT, vehicleBasis: 1, vehicleTotalKm: 20000, vehiclePrivateKm: 2000, vehicleForestryKm: 1000, vehicleCosts: 8000,
      }),
    );
    expect(await asStaff((tx) => getVehicleReport(tx, a.client, 2025))).toMatchObject({ vehicleBasis: 1, vehicleCosts: 8000, carBasis: null });
    const f = await asStaff((tx) => loadForm2(tx, a.client, 2025));
    expect(f!.fields).toMatchObject({ "281": 1, "283": 800, "284": 400, "221": 1200 });
    const plan = await asStaff((tx) => loadPlanData(tx, a.client, 2025));
    expect(plan.otherSourceExpense).toBe(400);
    const source = await asStaff((tx) => loadFilingSource(tx, a.id, a.client, 2025));
    const c = compute2c(source!.data);
    expect(c.fields.find((x) => x.code === "630")?.value).toBe(400);

    await expect(
      asStaff((tx) => saveVehicleReport(tx, actor(), a.client, 2025, { ...EMPTY_VEHICLE_REPORT, carTotalKm: 100, carAgriKm: 200 })),
    ).rejects.toThrow(AgriError);
    // Tyhjä selvitys poistaa rivin.
    await asStaff((tx) => saveVehicleReport(tx, actor(), a.client, 2025, EMPTY_VEHICLE_REPORT));
    expect(await asStaff((tx) => getVehicleReport(tx, a.client, 2025))).toBeNull();
  });
});

describe("tasausvaraus tiloittain", () => {
  it("suunnitelma tallentaa varauksen kullekin tilalle omaan enimmäismääräänsä", async () => {
    await asStaff(async (tx) => {
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2026-05-01", category: "agri_crops", amountGross: 68100, vatRate: 13.5, farmId: farmA });
      await saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2026-05-02", category: "agri_crops", amountGross: 22700, vatRate: 13.5, farmId: farmB });
    });
    const d = await asStaff((tx) => loadAgriPlanData(tx, a.client, 2026));
    expect(d!.equalizationFarms!.map((f) => f.farmName).sort()).toEqual(["Alatila", "Ylätila"]);
    const choices = (amounts: Record<string, number>) => ({ depreciation: {}, equalization: 0, farmEqualization: amounts, releases: {}, claim: null, lossToCapital: false });
    // Alatilan pohja 20 000 €: enintään 8 000 €.
    await expect(asStaff((tx) => saveAgriPlanChoices(tx, actor(), a.client, d!, choices({ [farmA]: 10000, [farmB]: 9000 })))).rejects.toThrow(/Alatila/);
    await asStaff((tx) => saveAgriPlanChoices(tx, actor(), a.client, d!, choices({ [farmA]: 10000, [farmB]: 8000 })));
    const reserves = await asStaff((tx) =>
      tx.query<{ farm_id: string; amount: string }>("select farm_id, amount from sk_agri_reserves where client_id = $1 and made_year = 2026 order by amount", [a.client]),
    );
    expect(reserves).toEqual([
      { farm_id: farmB, amount: "8000.00" },
      { farm_id: farmA, amount: "10000.00" },
    ]);
    const again = await asStaff((tx) => loadAgriPlanData(tx, a.client, 2026));
    expect(again!.equalizationFarms!.find((f) => f.farmId === farmA)).toMatchObject({ amount: 10000, editable: true });
    const f = await asStaff((tx) => loadForm2(tx, a.client, 2026));
    expect(f!.fields["232"]).toBe(18000);
  });

  it("tilaa ei voi poistaa, jos sillä on kirjauksia suljetulta vuodelta", async () => {
    await asStaff((tx) =>
      saveTransaction(tx, actor(), a.client, null, { ...base, bookedOn: "2025-08-01", category: "agri_feed", amountGross: 114, vatRate: 14, farmId: farmB }),
    );
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]));
    await expect(db.asUser(a.owner.sub, (tx) => deleteFarm(tx, { organizationId: a.id, userId: a.owner.id }, a.client, farmB))).rejects.toThrow(/suljetulta vuodelta 2025/);
  });
});
