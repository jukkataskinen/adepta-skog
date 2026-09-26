import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Tositteiden ja raporttien tiedostot (CLAUDE.md: tiedostot Storageen, ei kantaan).
 *
 * - `STORAGE_MODE=local` (oletus): paikallinen kansio `.data/storage`, kehitys ja testit.
 * - `STORAGE_MODE=supabase`: Supabase Storagen yksityinen ämpäri `documents`
 *   (migraatio 0002). Kutsut tehdään palvelimelta service role -avaimella sen
 *   jälkeen, kun oikeus on tarkistettu sk_documents-rivin kautta RLS:llä.
 *   Avain ei koskaan päädy selaimeen.
 */
export interface Storage {
  put(storagePath: string, body: Buffer, contentType: string): Promise<void>;
  get(storagePath: string): Promise<Buffer>;
}

const BUCKET = "documents";

/** Tiedoston polku ämpärissä: organisaatio/asiakas/vuosi/tunniste-nimi. Nimi siistitään, koska se tulee käyttäjältä. */
export function documentPath(organizationId: string, clientId: string, taxYear: number, id: string, fileName: string): string {
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .slice(-80);
  return `${organizationId}/${clientId}/${taxYear}/${id}-${safe || "tiedosto"}`;
}

function localStorage(root: string): Storage {
  const full = (p: string) => {
    const resolved = path.resolve(root, p);
    // Polku ei saa karata juurikansion ulkopuolelle.
    if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error("Virheellinen tiedostopolku");
    return resolved;
  };
  return {
    async put(p, body) {
      await mkdir(path.dirname(full(p)), { recursive: true });
      await writeFile(full(p), body);
    },
    async get(p) {
      return readFile(full(p));
    },
  };
}

function supabaseStorage(url: string, key: string): Storage {
  const endpoint = (p: string) => `${url.replace(/\/$/, "")}/storage/v1/object/${BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    async put(p, body, contentType) {
      const res = await fetch(endpoint(p), {
        method: "POST",
        headers: { ...headers, "Content-Type": contentType, "x-upsert": "false" },
        body: new Uint8Array(body),
      });
      // Tiedosto on jo olemassa: tuonti ajetaan uudelleen, sisältö on sama.
      if (!res.ok && res.status !== 409) throw new Error(`Tiedoston tallennus epäonnistui (${res.status})`);
    },
    async get(p) {
      const res = await fetch(endpoint(p), { headers });
      if (!res.ok) throw new Error(`Tiedoston haku epäonnistui (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export function getStorage(env: Record<string, string | undefined> = process.env): Storage {
  if (env.STORAGE_MODE === "supabase") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL tai SUPABASE_SERVICE_ROLE_KEY puuttuu");
    return supabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return localStorage(path.join(process.cwd(), ".data", "storage"));
}
