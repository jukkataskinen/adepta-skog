import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { importTilituki } from "@/lib/import/tilituki/run";
import { importLegacyData } from "@/lib/import/run";
import { tilitukiId } from "@/lib/import/origin";
import { loadForm2 } from "@/lib/tax/agri-form-load";
import { compareForm2 } from "@/lib/compare/tilituki";
import type { TtFolder } from "@/lib/import/tilituki/map";
import { farmFolder } from "../helpers/tilituki";
import { freshDb } from "../helpers/db";

/**
 * Tilituki-tuonti kuvitteellisella maatilalla: Skogin lomake 2 vastaa
 * Tilitukin lomaketta, ja uusintatuonti synkronoi eikä tuplaa.
 */

const ORG = "Tilitukitoimisto Oy";
let db: Database;
let orgId: string;
const folder = farmFolder();

const run = (data: TtFolder[], extra: { createClients?: boolean; year?: number } = {}) =>
  db.asService((tx) => importTilituki(tx, { orgName: ORG, createClients: extra.createClients ?? true, year: extra.year ?? 2025 }, data));
const clientId = async () =>
  (await db.asService((tx) => tx.query<{ id: string }>("select id from sk_clients where legacy_id = $1", [tilitukiId("client", "901")])))[0]?.id;

beforeAll(async () => {
  db = await freshDb();
  orgId = (await db.asService((tx) => tx.query<{ id: string }>("insert into sk_organizations (name) values ($1) returning id", [ORG])))[0].id;
});
afterAll(async () => {
  await db.close();
});

describe("Tilituki-tuonti", () => {
  it("ei luo asiakasta ilman lupaa", async () => {
    const r = await run([folder], { createClients: false });
    expect(r.folders[0]).toMatchObject({ status: "skipped", reason: "asiakasta ei ole Skogissa (luo lipulla --luo)" });
  });

  it("tuo asiakkaan, kirjaukset, investoinnit ja poistot, ja lomake 2 vastaa Tilitukia", async () => {
    const r = await run([folder]);
    expect(r.folders[0].status).toBe("imported");
    expect(r.folders[0].counts).toMatchObject({ "asiakkaita luotu": 1, "verovuosia avattu": 1, "aiempia investointeja": 2, investointeja: 1, ryhmäpoistoja: 2 });
    const id = await clientId();
    const [c] = await db.asService((tx) =>
      tx.query<{ has_agriculture: boolean; has_forestry: boolean; vat_registered: boolean; first_name: string; business_id: string }>(
        "select has_agriculture, has_forestry, vat_registered, first_name, business_id from sk_clients where id = $1",
        [id],
      ),
    );
    expect(c).toEqual({ has_agriculture: true, has_forestry: true, vat_registered: true, first_name: "", business_id: "1234567-1" });
    const form = await db.asService((tx) => loadForm2(tx, id, 2025));
    const cmp = compareForm2(folder.form2["2025"], form!.fields);
    expect(cmp.differing).toEqual([]);
    expect(form!.errors).toEqual([]);
    // Metsätalouden puukauppa ennakonpidätyksineen on metsätalouden kirjanpidossa.
    const [sale] = await db.asService((tx) =>
      tx.query<{ activity: string; amount_net: string; withholding: string }>("select activity, amount_net, withholding from sk_transactions where client_id = $1 and category = 'standing_sale'", [id]),
    );
    expect(sale).toMatchObject({ activity: "forestry", amount_net: "30000.00", withholding: "7500.00" });
  });

  it("toinen ajo ei tuplaa, ja Skogissa tehty kirjaus säilyy", async () => {
    const id = await clientId();
    await db.asService((tx) =>
      tx.query("insert into sk_transactions (organization_id, client_id, booked_on, kind, category, amount_net, vat_rate, activity) values ($1,$2,'2025-05-05','expense','agri_seeds',80,25.5,'agriculture')", [orgId, id]),
    );
    const before = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_transactions where client_id = $1", [id]));
    const r = await run([folder]);
    expect(r.folders[0].counts.kirjauksia ?? 0).toBe(0);
    expect(r.folders[0].counts["kirjauksia päivitetty"] ?? 0).toBe(0);
    expect(r.folders[0].counts["asiakkaita luotu"] ?? 0).toBe(0);
    const after = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_transactions where client_id = $1", [id]));
    expect(after[0].n).toBe(before[0].n);
    const [a] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_assets where client_id = $1", [id]));
    expect(a.n).toBe(3);
  });

  it("aineistosta poistettu vienti poistuu ja muuttunut päivittyy", async () => {
    const id = await clientId();
    const changed = farmFolder();
    changed.entries["2025"] = changed.entries["2025"]
      .filter((e) => e.account !== "3305")
      .map((e) => (e.account === "3210" ? { ...e, debit: 3100 } : e));
    const r = await run([changed]);
    expect(r.folders[0].counts).toMatchObject({ "kirjauksia poistettu": 1, "kirjauksia päivitetty": 1 });
    const [m] = await db.asService((tx) => tx.query<{ amount_net: string }>("select amount_net from sk_transactions where client_id = $1 and category = 'agri_myel'", [id]));
    expect(m.amount_net).toBe("3100.00");
    await run([folder]);
  });

  it("vanhan Skog-kannan synkronointi ei poista Tilitukista tuotuja kirjauksia", async () => {
    const id = await clientId();
    const legacyClient = "00000000-0000-4000-8000-0000000000aa";
    await db.asService((tx) => tx.query("update sk_clients set legacy_id = $2 where id = $1", [id, legacyClient]));
    try {
      await db.asService((tx) =>
        importLegacyData(tx, { orgName: ORG }, {
          users: [], properties: [], deductions: [], assets: [], depreciations: [], transactions: [], archive: [],
          clients: [{
            id: legacyClient, organisaatio_id: "o", etunimi: null, sukunimi: "Mäkelä", y_tunnus: null, kotikunta: null, sahkoposti: null, puhelin: null, osoite: null,
            postinumero: null, postitoimipaikka: null, verotiliviite: null, alv_rekisterissa: true, avoin_vuosi: 2025, vastuukirjanpitaja_id: null, poistettu_at: null,
          }],
        }),
      );
      const [n] = await db.asService((tx) => tx.query<{ n: number }>("select count(*)::int as n from sk_transactions where client_id = $1 and legacy_id is not null", [id]));
      expect(n.n).toBeGreaterThan(10);
    } finally {
      await db.asService((tx) => tx.query("update sk_clients set legacy_id = $2 where id = $1", [id, tilitukiId("client", "901")]));
    }
  });

  it("yhdistää asiakkaan Y-tunnuksella", async () => {
    const other = { ...farmFolder({ folder: "902" }), client: { ...folder.client, businessId: "7654321-0" } };
    const [existing] = await db.asService((tx) =>
      tx.query<{ id: string }>("insert into sk_clients (organization_id, first_name, last_name, business_id) values ($1, 'Eero', 'Peltonen', '7654321-0') returning id", [orgId]),
    );
    const r = await run([other], { createClients: false });
    expect(r.folders[0].status).toBe("imported");
    const [c] = await db.asService((tx) => tx.query<{ has_agriculture: boolean; n: number }>(
      "select has_agriculture, (select count(*)::int from sk_transactions t where t.client_id = c.id) as n from sk_clients c where id = $1", [existing.id],
    ));
    expect(c.has_agriculture).toBe(true);
    expect(c.n).toBeGreaterThan(10);
  });

  it("suljettuun vuoteen ei kosketa", async () => {
    const id = await clientId();
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [id]));
    const r = await run([folder]);
    expect(r.folders[0]).toMatchObject({ status: "skipped", reason: "verovuosi on suljettu" });
  });
});
