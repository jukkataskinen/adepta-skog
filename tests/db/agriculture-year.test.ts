import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, Sql } from "@/lib/db/types";
import {
  addDeferral,
  addFarm,
  addGrant,
  addReserve,
  addReserveUse,
  AgriError,
  deferralThirds,
  EMPTY_AGRI_YEAR,
  getAgriYear,
  listDeferrals,
  listExtras,
  listFarms,
  listReserves,
  saveAgriDepreciations,
  saveAgriYear,
  setExtra,
} from "@/lib/agriculture/year";
import { loadAgriDepreciation } from "@/lib/tax/agri-load";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Maatalous-välilehden tiedot kannan kanssa (DECISIONS 2.10.2026). */

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService((tx) => tx.query("update sk_clients set has_agriculture = true where id = $1", [a.client]));
});
afterAll(async () => {
  await db.close();
});

const actor = () => ({ organizationId: a.id, userId: a.staff.id });
const asStaff = <T,>(fn: (tx: Sql) => Promise<T>) => db.asUser(a.staff.sub, fn);

describe("vuoden tiedot", () => {
  it("tallennus ja päivitys samalle vuodelle, loki ilman lukuja", async () => {
    await asStaff((tx) => saveAgriYear(tx, actor(), a.client, 2025, { ...EMPTY_AGRI_YEAR, liabilities: 120000, landValue: 50000 }));
    await asStaff((tx) => saveAgriYear(tx, actor(), a.client, 2025, { ...EMPTY_AGRI_YEAR, liabilities: 110000, spouseWealthSharePct: 40, spouseWorkSharePct: 50 }));
    const y = await asStaff((tx) => getAgriYear(tx, a.client, 2025));
    expect(y).toMatchObject({ liabilities: 110000, landValue: null, spouseWealthSharePct: 40, spouseWorkSharePct: 50 });
    const [log] = await db.asService((tx) =>
      tx.query<{ details: Record<string, unknown> }>("select details from sk_audit_log where action = 'agri.year.save' order by created_at desc limit 1"),
    );
    expect(JSON.stringify(log.details)).not.toContain("110000");
  });

  it("puolison osuudet annetaan pareittain", async () => {
    await expect(asStaff((tx) => saveAgriYear(tx, actor(), a.client, 2025, { ...EMPTY_AGRI_YEAR, spouseWealthSharePct: 40 }))).rejects.toThrow(AgriError);
  });
});

describe("varaukset, jaksotukset ja kentät", () => {
  it("tasausvarauksen käyttö investointiin ja purkamaton määrä", async () => {
    await asStaff((tx) => addFarm(tx, actor(), a.client, "Kotitila", "123456789"));
    const farms = await asStaff((tx) => listFarms(tx, a.client));
    await asStaff((tx) => addReserve(tx, actor(), a.client, { kind: "equalization", madeYear: 2024, amount: 5000, farmId: farms[0].id, note: null }));
    const [asset] = await asStaff((tx) =>
      tx.query<{ id: string }>(
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, activity, asset_class)
         values ($1, $2, 'Kuivuri', '2025-08-01', 40000, 'declining_balance', 25, 'agriculture', 'agri_machinery') returning id`,
        [a.id, a.client],
      ),
    );
    const reserves = await asStaff((tx) => listReserves(tx, a.client, 2025));
    await asStaff((tx) => addReserveUse(tx, actor(), a.client, { reserveId: reserves[0].id, year: 2025, useKind: "asset", assetId: asset.id, amount: 3000 }));
    await expect(
      asStaff((tx) => addReserveUse(tx, actor(), a.client, { reserveId: reserves[0].id, year: 2025, useKind: "income", assetId: null, amount: 2500 })),
    ).rejects.toThrow(/enemmän kuin sitä on jäljellä/);
    const after = await asStaff((tx) => listReserves(tx, a.client, 2025));
    expect(after[0]).toMatchObject({ farm_name: "Kotitila", amount: 5000, remaining: 2000 });
    // Käytetty varaus pienentää poistopohjaa.
    const dep = await asStaff((tx) => loadAgriDepreciation(tx, a.client, 2025));
    expect(dep.pools[0]).toMatchObject({ additions: 40000, equalization: 3000, base: 37000 });
  });

  it("jaksotus tasaerin, senttien erotus ensimmäiselle vuodelle", async () => {
    expect(deferralThirds(1000)).toEqual([333.34, 333.33, 333.33]);
    await asStaff((tx) => addDeferral(tx, actor(), a.client, { year: 2024, kind: "livestock_sale", amount: 1000, split: null, note: null }));
    await expect(
      asStaff((tx) => addDeferral(tx, actor(), a.client, { year: 2024, kind: "livestock_purchase", amount: 900, split: [100, 100, 100], note: null })),
    ).rejects.toThrow(AgriError);
    expect((await asStaff((tx) => listDeferrals(tx, a.client, 2025)))[0]).toMatchObject({ year1: 333.34, year2: 333.33 });
  });

  it("harvinaisen kentän arvo tarkistetaan lajin mukaan", async () => {
    await asStaff((tx) => setExtra(tx, actor(), a.client, 2025, "281", 1));
    await asStaff((tx) => setExtra(tx, actor(), a.client, 2025, "516", 23000));
    await expect(asStaff((tx) => setExtra(tx, actor(), a.client, 2025, "281", 3))).rejects.toThrow(AgriError);
    await expect(asStaff((tx) => setExtra(tx, actor(), a.client, 2025, "999", 1))).rejects.toThrow(AgriError);
    expect(await asStaff((tx) => listExtras(tx, a.client, 2025))).toEqual([{ code: "281", value: 1 }, { code: "516", value: 23000 }]);
  });
});

describe("ryhmäpoistojen tallennus", () => {
  it("palvelin tarkistaa enimmäismäärän ja tallentaa ryhmille", async () => {
    const [asset] = await asStaff((tx) => tx.query<{ id: string }>("select id from sk_assets where description = 'Kuivuri'"));
    await asStaff((tx) => addGrant(tx, actor(), a.client, { assetId: asset.id, year: 2025, amount: 1000, note: null }));
    const dep = await asStaff((tx) => loadAgriDepreciation(tx, a.client, 2025));
    expect(dep.pools[0]).toMatchObject({ base: 36000, max: 9000 });
    await expect(asStaff((tx) => saveAgriDepreciations(tx, actor(), a.client, 2025, { agri_machinery: 9000.5 }))).rejects.toThrow(/enintään/);
    expect(await asStaff((tx) => saveAgriDepreciations(tx, actor(), a.client, 2025, { agri_machinery: 9000 }))).toBe(9000);
    const after = await asStaff((tx) => loadAgriDepreciation(tx, a.client, 2025));
    expect(after.pools[0]).toMatchObject({ recorded: 9000, end: 27000 });
  });
});
