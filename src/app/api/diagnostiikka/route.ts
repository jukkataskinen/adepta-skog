import { NextResponse } from "next/server";
import { databaseUrl, dbDriver } from "@/lib/config/deploy-env";

export const dynamic = "force-dynamic";

/**
 * Esikatselun asetusten tarkistus. Näyttää vain palvelinnimet ja sen, onko
 * muuttuja asetettu, ei koskaan arvoja tai salasanoja. Tuotannossa sivua ei
 * ole, koska sitä tarvitaan vain ympäristön pystytykseen.
 */
export async function GET() {
  if (process.env.VERCEL_ENV === "production") return new NextResponse(null, { status: 404 });
  const host = (v: string | undefined) => {
    if (!v) return null;
    try {
      const u = new URL(v);
      return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
    } catch {
      return "ei kelvollinen osoite";
    }
  };
  const set = (name: string) => Boolean(process.env[name]);
  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    authMode: process.env.AUTH_MODE ?? null,
    dbDriver: dbDriver(),
    database: host(databaseUrl()),
    databaseFrom: process.env.DATABASE_URL ? "DATABASE_URL" : process.env.POSTGRES_URL ? "POSTGRES_URL" : null,
    storageMode: process.env.STORAGE_MODE ?? null,
    supabase: host(process.env.SUPABASE_URL),
    appBaseUrl: process.env.APP_BASE_URL ?? null,
    set: Object.fromEntries(
      ["SESSION_SECRET", "FIELD_ENCRYPTION_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"].map((n) => [n, set(n)]),
    ),
  });
}
