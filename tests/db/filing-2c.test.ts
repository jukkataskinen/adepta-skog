import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";
import { buildFilingDownload, type FilingResult } from "@/lib/filing/download";
import { loadFilingSource } from "@/lib/filing/load";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/**
 * Sähköinen 2C-ilmoitus kannan kanssa: tiedosto syntyy vahvistetuista
 * luvuista, ja henkilötunnukset ovat vain tiedostossa. Tunnukset ovat
 * Verohallinnon ja DVV:n esimerkkejä, eivät kenenkään oikeita.
 */
const FILER = "011073-998R";
const WORKER = "131052-308T";

let db: Database;
let a: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  await db.asService(async (tx) => {
    await tx.query("update sk_organizations set contact_email = 'toimisto@example.test', contact_phone = '0401234567' where id = $1", [a.id]);
    await tx.query(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate)
       values ($1, $2, '2025-02-01', 'income', 'delivery_sale', 'Hankintakauppa', 5000, 25.5),
              ($1, $2, '2025-02-01', 'expense', 'delivery_work', 'Hankintatyö — Veli Metsänen', 1200, 0),
              ($1, $2, '2025-03-01', 'expense', 'other_expense', 'Taimet', 400, 25.5)`,
      [a.id, a.client],
    );
  });
});
afterAll(async () => {
  await db.close();
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const run = (fields: Record<string, string>, year = 2025): Promise<FilingResult> =>
  db.asUser(a.staff.sub, (tx) => buildFilingDownload(tx, { organizationId: a.id, userId: a.staff.id, userName: "Kaisa Kirjanpitäjä" }, a.client, year, form(fields)));

const worker = {
  itemizeWorkers: "1",
  workerCount: "1",
  w0_name: "Veli Metsänen",
  w0_personalId: WORKER,
  w0_madeM3: "80",
  w0_transportedM3: "80",
  w0_value: "1200",
  w0_taxableValue: "0",
};

describe("2C-tiedosto kannasta", () => {
  it("lähtötiedot: luokat, vahvistettu poisto ja metsävähennys, tekijä selitteestä", async () => {
    const s = await db.asUser(a.staff.sub, (tx) => loadFilingSource(tx, a.id, a.client, 2025));
    expect(s?.data.categories.standing_sale).toEqual({ net: 15000, gross: 18825 });
    expect(s?.data.assets[0]).toMatchObject({ bookValueStart: 30000, depreciation: 7500 });
    expect(s?.data.forestDeduction).toBe(3000);
    expect(s?.data.tracking).toMatchObject({ base: 57600, usedBefore: 0 });
    expect(s?.workers).toEqual([{ name: "Veli Metsänen", value: 1200, madeM3: null }]);
    expect(s?.client.businessId).toBeNull();
  });

  it("ilman Y-tunnusta tarvitaan ilmoittajan henkilötunnus, eikä virhe kerro tunnusta", async () => {
    const r = await run({ filerPersonalId: "131052-308U" });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(JSON.stringify(r)).not.toContain("131052-308U");
    const w = await run({ filerPersonalId: FILER, ...worker, w0_personalId: "999999-999X" });
    expect(w.ok).toBe(false);
    expect(JSON.stringify(w)).not.toContain("999999-999X");
  });

  it("muodostaa tiedoston ISO-8859-1-merkistöllä, ja henkilötunnukset ovat vain tiedostossa", async () => {
    const log = vi.spyOn(console, "log");
    const err = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const r = await run({ filerPersonalId: FILER, ...worker });
    if (!r.ok) throw new Error(r.error);
    const text = new TextDecoder("latin1").decode(r.bytes);
    expect(r.fileName).toBe("2C_2025_Metsanen.txt");
    expect(text.startsWith("000:VSY02C25\r\n")).toBe(true);
    expect(text).toContain(`010:${FILER}\r\n`);
    expect(text).toContain("603:15000,00\r\n604:5000,00\r\n690:20000,00\r\n605:1200,00\r\n691:1200,00\r\n");
    expect(text).toContain("624:400,00\r\n");
    expect(text).toContain("660:30000,00\r\n");
    expect(text).toContain("642:7500,00\r\n");
    expect(text).toContain("626:22500,00\r\n");
    expect(text).toContain("615:3000,00\r\n");
    expect(text).toContain(`001:1\r\n700:Veli Metsänen\r\n701:${WORKER}\r\n702:80\r\n703:80\r\n704:1200,00\r\n009:1\r\n706:1200,00\r\n`);
    expect(text).toContain("041:Kaisa Kirjanpitäjä\r\n044:toimisto@example.test\r\n042:0401234567\r\n999:1\r\n");
    // 20000 - 1200 - 3000 - 400 - 7500
    expect(text).toContain("635:7900,00\r\n");
    expect(r.bytes[text.indexOf("ä")]).toBe(0xe4);

    for (const spy of [log, err, warn]) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/011073|131052/);

    // Lokiin merkintä ilman tunnisteita.
    const audit = await db.asService((tx) => tx.query<{ details: unknown }>("select details from sk_audit_log where action = 'filing.2c.download' and entity_id = $1", [a.client]));
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toEqual({ year: 2025, filerIdType: "personal_id", workers: 1, fields: expect.any(Number) });

    // Mikään taulu ei sisällä henkilötunnuksia.
    const tables = await db.asService((tx) => tx.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"));
    for (const t of tables) {
      const rows = await db.asService((tx) => tx.query<{ r: string }>(`select t::text as r from "${t.table_name}" t`));
      expect(rows.map((x) => x.r).join("\n"), t.table_name).not.toMatch(/011073-998R|131052-308T/);
    }
  });

  it("Y-tunnuksellinen asiakas: tunnus 010 on Y-tunnus, henkilötunnusta ei kysytä", async () => {
    await db.asService((tx) => tx.query("update sk_clients set business_id = '2237131-2' where id = $1", [a.client]));
    const r = await run({});
    if (!r.ok) throw new Error(r.error);
    const text = new TextDecoder("latin1").decode(r.bytes);
    expect(text).toContain("010:2237131-2\r\n");
    expect(text).not.toContain("001:");
    const p = await run({ filerIdType: "personal_id", filerPersonalId: FILER });
    expect(p.ok && new TextDecoder("latin1").decode(p.bytes)).toContain(`010:${FILER}`);
    await db.asService((tx) => tx.query("update sk_clients set business_id = null where id = $1", [a.client]));
  });

  it("toimii suljetulle vuodelle, ja vuosi ilman tietuekuvausta estetään", async () => {
    await db.asService((tx) => tx.query("update sk_tax_years set status = 'closed', closed_at = now() where client_id = $1 and year = 2025", [a.client]));
    const r = await run({ filerPersonalId: FILER });
    expect(r.ok).toBe(true);
    expect(await run({ filerPersonalId: FILER }, 2024)).toMatchObject({ ok: false, status: 400 });
  });

  it("toisen toimiston asiakasta ei löydy", async () => {
    const b = await seedOrg(db, "Toimisto B");
    const r = await db.asUser(b.staff.sub, (tx) => buildFilingDownload(tx, { organizationId: b.id, userId: b.staff.id, userName: null }, a.client, 2025, form({ filerPersonalId: FILER })));
    expect(r).toMatchObject({ ok: false, status: 404 });
  });
});
