import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { freshDb, seedOrg, type OrgFixture } from "../helpers/db";

/** Kehitystoiveet (0005): kaikki käyttäjät jättävät, vain pääkäyttäjä käsittelee. */

let db: Database;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  db = await freshDb();
  a = await seedOrg(db, "Toimisto A");
  b = await seedOrg(db, "Toimisto B");
});
afterAll(async () => {
  await db.close();
});

const insert = (user: OrgFixture["staff"], orgId: string, createdBy: string) =>
  db.asUser(user.sub, (tx) =>
    tx.query<{ id: string }>(
      "insert into sk_feature_requests (organization_id, created_by, feature, title, description) values ($1, $2, 'kirjanpito', 'Toive', 'Kuvaus') returning id",
      [orgId, createdBy],
    ),
  );

describe("kehitystoiveet", () => {
  it("kirjanpitäjä jättää toiveen omissa nimissään, mutta ei toisen nimissä eikä toiseen organisaatioon", async () => {
    const [row] = await insert(a.staff, a.id, a.staff.id);
    expect(row.id).toBeTruthy();
    await expect(insert(a.staff, a.id, a.owner.id)).rejects.toThrow();
    await expect(insert(a.staff, b.id, a.staff.id)).rejects.toThrow();
  });

  it("tilaa muuttaa pääkäyttäjä, ei kirjanpitäjä", async () => {
    const byStaff = await db.asUser(a.staff.sub, (tx) => tx.query("update sk_feature_requests set status = 'done' returning id", []));
    expect(byStaff).toHaveLength(0);
    const byOwner = await db.asUser(a.owner.sub, (tx) => tx.query("update sk_feature_requests set status = 'planned' returning id", []));
    expect(byOwner.length).toBeGreaterThan(0);
  });

  it("kirjanpitäjä ei poista toivetta", async () => {
    const rows = await db.asUser(a.staff.sub, (tx) => tx.query("delete from sk_feature_requests returning id", []));
    expect(rows).toHaveLength(0);
  });

  it("toinen organisaatio ei näe toiveita", async () => {
    const rows = await db.asUser(b.staff.sub, (tx) => tx.query<{ organization_id: string }>("select organization_id from sk_feature_requests", []));
    expect(rows.every((r) => r.organization_id === b.id)).toBe(true);
  });
});
