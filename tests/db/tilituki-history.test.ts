import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { importTilituki } from "@/lib/import/tilituki/run";
import { tilitukiId } from "@/lib/import/origin";
import { loadPlanData } from "@/lib/tax/load";
import type { TtFolder, TtMachineYear } from "@/lib/import/tilituki/map";
import { farmFolder } from "../helpers/tilituki";
import { freshDb } from "../helpers/db";

/**
 * Metsätalouden kalustokorttien koko historia Skogiin kuvitteellisella
 * asiakkaalla: poistot vuosittain, täysi poisto, myynti, toistettavuus,
 * käyttäjän muokkaama investointi ja verovuoden 2026 avaus.
 */

const ORG = "Historiatoimisto Oy";
let db: Database;
let orgId: string;

const yr = (start: number, depreciation: number, p: Partial<TtMachineYear> = {}): TtMachineYear => {
  const base = start + (p.additions ?? 0) - (p.disposals ?? 0);
  return { pct: 25, start, additions: 0, disposals: 0, base, depreciation, end: Math.round((base - depreciation) * 100) / 100, ...p };
};

const folder: TtFolder = farmFolder({
  folder: "902",
  client: { name: "Koetila Historia", businessId: "7654321-0", street: null, postalCode: null, city: null, openYear: 2025, vatMethod: "NETTO" },
  machinery: [
    {
      id: "K1", name: "Mönkijä", type: "Kone", source: "METSÄTALOUS", acquiredOn: "2021-04-01", cost: 0, maxPct: 25,
      years: { "2021": yr(0, 1000, { additions: 4000 }), "2022": yr(3000, 750), "2023": yr(2250, 562.5), "2024": yr(1687.5, 421.88), "2025": yr(1265.62, 316.41) },
    },
    {
      id: "K2", name: "Moottorisaha", type: "Kone", source: "METSÄTALOUS", acquiredOn: "2023-12-31", cost: 300, maxPct: 25,
      years: { "2023": yr(300, 0, { pct: 0 }), "2024": yr(300, 300, { pct: 100 }), "2025": yr(0, 0, { pct: 0 }) },
    },
    {
      id: "K3", name: "Peräkärry", type: "Kone", source: "METSÄTALOUS", acquiredOn: "2019-05-05", cost: 0, maxPct: 25,
      years: { "2019": yr(0, 500, { additions: 2000 }), "2020": yr(1500, 375), "2024": yr(1125, 0, { disposals: 1500 }) },
    },
    {
      id: "T1", name: "Metsätie", type: "Oja/Tie", source: "METSÄTALOUS", acquiredOn: "2005-01-01", cost: 10000, maxPct: 15,
      years: { "2015": yr(4000, 600, { pct: 15 }), "2016": yr(3400, 510, { pct: 15 }) },
    },
  ],
});

const run = (years: number[] = [2025], openYears: number[] = []) =>
  db.asService(async (tx) => {
    let last;
    for (const year of years) last = await importTilituki(tx, { orgName: ORG, createClients: true, includeForestOnly: true, year, openYears }, [folder]);
    return last!;
  });
const clientId = async () =>
  (await db.asService((tx) => tx.query<{ id: string }>("select id from sk_clients where legacy_id = $1", [tilitukiId("client", "902")])))[0].id;
const assetOf = async (card: string) =>
  (await db.asService((tx) => tx.query<{ id: string; acquired_on: string; acquisition_cost: string; opening_year: number | null; disposed_on: string | null; sale_price: string | null }>(
    "select id, acquired_on::text, acquisition_cost, opening_year, disposed_on::text, sale_price from sk_assets where legacy_id = $1",
    [tilitukiId("asset", "902", `machine-${card}`)],
  )))[0];
const depsOf = async (assetId: string) =>
  (await db.asService((tx) => tx.query<{ tax_year: number; amount: string; book_value_end: string }>(
    "select tax_year, amount, book_value_end from sk_depreciations where asset_id = $1 order by tax_year",
    [assetId],
  ))).map((d) => [Number(d.tax_year), Number(d.amount), Number(d.book_value_end)]);

beforeAll(async () => {
  db = await freshDb();
  orgId = (await db.asService((tx) => tx.query<{ id: string }>("insert into sk_organizations (name) values ($1) returning id", [ORG])))[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("Tilitukin investointihistoria", () => {
  it("tuo kortit koko historiana ja avaa vuoden 2026", async () => {
    const r = await run([2024, 2025], [2026]);
    expect(r.folders[0].status).toBe("imported");
    const k1 = await assetOf("K1");
    expect(k1).toMatchObject({ acquired_on: "2021-04-01", acquisition_cost: "4000.00", opening_year: null, disposed_on: null });
    expect(await depsOf(k1.id)).toEqual([[2021, 1000, 3000], [2022, 750, 2250], [2023, 562.5, 1687.5], [2024, 421.88, 1265.62], [2025, 316.41, 949.21]]);
    // Myyty kortti: myyntivuodelta ei poistoriviä, aukkovuodet nollapoistolla.
    const k3 = await assetOf("K3");
    expect(k3).toMatchObject({ disposed_on: "2024-12-31", sale_price: "1500.00" });
    expect(await depsOf(k3.id)).toEqual([[2019, 500, 1500], [2020, 375, 1125], [2021, 0, 1125], [2022, 0, 1125], [2023, 0, 1125]]);
    // Ennen historiaa hankittu tie: aiempi investointi.
    expect(await assetOf("T1")).toMatchObject({ acquired_on: "2005-01-01", acquisition_cost: "10000.00", opening_year: 2015 });
    const cid = await clientId();
    const years = await db.asService((tx) => tx.query<{ year: number }>("select year from sk_tax_years where client_id = $1 order by year", [cid]));
    expect(years.map((y) => Number(y.year))).toEqual([2024, 2025, 2026]);
  });

  it("vuoden 2026 suunnitelma alkaa vuoden 2025 loppuarvoista, eikä täysin poistettu tai myyty näy", async () => {
    const id = await clientId();
    const plan = await db.asService((tx) => loadPlanData(tx, id, 2026));
    const starts = plan.assets.map((a) => [a.acquisitionCost, a.year.bookValueStart]).sort((a, b) => a[0] - b[0]);
    expect(starts).toEqual([[4000, 949.21], [10000, 2890]]);
    const k2 = await assetOf("K2");
    expect(await depsOf(k2.id)).toEqual([[2023, 0, 300], [2024, 300, 0], [2025, 0, 0]]);
  });

  it("uusintatuonti ei muuta mitään", async () => {
    const r = await run([2025], [2026]);
    const historyCounts = Object.entries(r.folders[0].counts).filter(([k]) => k.startsWith("historia") || k.startsWith("verovuosia avattu"));
    expect(historyCounts).toEqual([]);
  });

  it("ei koske Skogissa muokattuun investointiin eikä suljetun vuoden poistoon", async () => {
    const id = await clientId();
    const k1 = await assetOf("K1");
    const k2 = await assetOf("K2");
    const [user] = await db.asService((tx) => tx.query<{ id: string }>("insert into sk_users (auth_sub, email) values ('dev|historia', 'kirjanpitaja@example.test') returning id"));
    await db.asService(async (tx) => {
      await tx.query("update sk_depreciations set amount = 300, book_value_end = 1387.5 where asset_id = $1 and tax_year = 2023", [k1.id]);
      await tx.query("insert into sk_audit_log (organization_id, user_id, action, entity, entity_id) values ($1,$2,'asset.prior.update','sk_assets',$3)", [orgId, user.id, k1.id]);
      // Kortin K2 vuosi 2024 suljetaan, ja sen poistoa muutetaan ennen sulkemista.
      await tx.query("update sk_depreciations set amount = 0, book_value_end = 300 where asset_id = $1 and tax_year = 2024", [k2.id]);
      await tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2024", [id]);
    });
    const r = await run([2025]);
    expect(r.folders[0].counts).toMatchObject({ "historia: investointeja ohitettu (muokattu Skogissa)": 1, "historia: suljetun vuoden poistoa ei muutettu": 1 });
    expect((await depsOf(k1.id))[2]).toEqual([2023, 300, 1387.5]);
  });

  it("käsin lisätty sama kohde korvaa tuodun kaksoiskappaleen", async () => {
    const id = await clientId();
    // Kirjanpitäjä on lisännyt tien itse: menojäännös 31.12.2015 on sama kuin Tilitukissa.
    await db.asService((tx) =>
      tx.query(
        `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, declining_rate_pct, opening_book_value, opening_year,
                                opening_accumulated_depreciation, activity)
         values ($1,$2,'Metsätie','2005-12-31',10000,'declining_balance',15,3400,2016,6600,'forestry')`,
        [orgId, id],
      ),
    );
    const r = await run([2025]);
    expect(r.folders[0].counts["historia: tuotu kaksoiskappale poistettu (sama kohde lisätty Skogissa)"]).toBe(1);
    expect(await assetOf("T1")).toBeUndefined();
    const again = await run([2025]);
    expect(again.folders[0].counts["historia: investointeja ohitettu (sama kohde lisätty Skogissa)"]).toBe(1);
  });
});
