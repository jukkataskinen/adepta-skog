import { createPgliteDatabase } from "../src/lib/db/pglite.ts";
import { migrateLocal } from "../src/lib/db/migrate.ts";
import { createPostgresDatabase } from "../src/lib/db/postgres.ts";
import { databaseUrl } from "../src/lib/config/deploy-env.ts";
import path from "node:path";

/**
 * Käyttäjän lisäys organisaatioon ennen ensimmäistä kirjautumista.
 *
 *   npm run kayttaja:lisaa -- --email etunimi.sukunimi@adepta.fi --nimi "Etunimi Sukunimi" \
 *     --org "Tilitoimisto Oy" --rooli owner [--luo-org] [--tuotanto]
 *
 * Käyttäjä luodaan tunnisteella `pending|<sähköposti>`. Ensimmäisellä
 * Auth0-kirjautumisella tunniste vaihtuu oikeaan, kun Auth0 on varmentanut
 * saman osoitteen (src/lib/auth/resolve-user.ts).
 *
 * Oletuksena paikallinen kanta. `--tuotanto` käyttää `.env.local`:n
 * DATABASE_URL-osoitetta eli Supabasea.
 */

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const email = arg("--email")?.trim().toLowerCase();
const fullName = arg("--nimi");
const orgName = arg("--org");
const role = arg("--rooli") ?? "owner";
const createOrg = process.argv.includes("--luo-org");
const production = args.includes("--tuotanto");

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !orgName || !["owner", "staff"].includes(role)) {
  console.log('Käyttö: npm run kayttaja:lisaa -- --email x@y.fi --nimi "Nimi" --org "Organisaatio" --rooli owner|staff [--luo-org] [--tuotanto]');
  process.exit(1);
}

let db;
if (production) {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL puuttuu .env.local-tiedostosta.");
  db = createPostgresDatabase(url);
  console.log(`Kohde: tuotantokanta (${new URL(url).hostname})`);
} else {
  db = await createPgliteDatabase(path.join(process.cwd(), ".data", "pglite"));
  await migrateLocal(db);
  console.log("Kohde: paikallinen kanta");
}

try {
  await db.asService(async (tx) => {
    let [org] = await tx.query<{ id: string }>("select id from sk_organizations where name = $1", [orgName]);
    if (!org) {
      if (!createOrg) throw new Error(`Organisaatiota "${orgName}" ei ole. Lisää --luo-org, jos haluat luoda sen.`);
      [org] = await tx.query<{ id: string }>(
        "insert into sk_organizations (name) values ($1) returning id",
        [orgName],
      );
      console.log(`Organisaatio luotu: ${orgName}.`);
    }
    let [user] = await tx.query<{ id: string }>("select id from sk_users where lower(email) = $1", [email]);
    if (!user) {
      [user] = await tx.query<{ id: string }>("insert into sk_users (auth_sub, email, full_name) values ($1, $2, $3) returning id", [
        `pending|${email}`,
        email,
        fullName ?? null,
      ]);
      console.log("Käyttäjä luotu. Tunniste päivittyy ensimmäisellä kirjautumisella.");
    } else if (fullName) {
      await tx.query("update sk_users set full_name = $2 where id = $1", [user.id, fullName]);
    }
    await tx.query(
      `insert into sk_org_members (organization_id, user_id, role) values ($1, $2, $3)
       on conflict (organization_id, user_id) do update set role = excluded.role`,
      [org.id, user.id, role],
    );
    await tx.query(
      "insert into sk_audit_log (organization_id, action, entity, entity_id, details) values ($1, 'member.set', 'sk_org_members', $2, $3)",
      [org.id, user.id, JSON.stringify({ role, via: "kayttaja:lisaa" })],
    );
    console.log(`Rooli ${role} organisaatiossa ${orgName}.`);
  });
} finally {
  await db.close();
}
