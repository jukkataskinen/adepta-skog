import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { signValue } from "@/lib/security/crypto";
import path from "node:path";

/**
 * Tositteiden ja raporttien tiedostot (CLAUDE.md: tiedostot Storageen, ei kantaan).
 *
 * - `STORAGE_MODE=local` (oletus): paikallinen kansio `.data/storage`, kehitys ja testit.
 * - `STORAGE_MODE=supabase`: Supabase Storagen yksityinen ämpäri `documents`
 *   (migraatio 0002). Kutsut tehdään palvelimelta service role -avaimella sen
 *   jälkeen, kun oikeus on tarkistettu sk_documents-rivin kautta RLS:llä.
 *   Avain ei koskaan päädy selaimeen.
 *
 * Isot tiedostot (skannattu tositeaineisto) ladataan selaimesta suoraan
 * Storageen kertakäyttöisellä latausosoitteella, koska Vercelin palvelinfunktio
 * ottaa vastaan enintään 4,5 Mt. Palvelin antaa osoitteen vasta oikeuksien
 * tarkistuksen jälkeen ja kirjaa tiedoston kantaan vasta, kun se on perillä.
 */
export interface Storage {
  put(storagePath: string, body: Buffer, contentType: string): Promise<void>;
  get(storagePath: string): Promise<Buffer>;
  /** Poistaa tiedoston. Puuttuva tiedosto ei ole virhe, jotta poiston voi yrittää uudelleen. */
  remove(storagePath: string): Promise<void>;
  /** Kertakäyttöinen latausosoite selaimelle. `form` = lähetetäänkö tiedosto FormDatana. */
  createUploadUrl(storagePath: string): Promise<{ url: string; form: boolean }>;
  /** Tiedoston koko tavuina, tai null jos tiedostoa ei ole. */
  size(storagePath: string): Promise<number | null>;
}

/** Paikallisen latausosoitteen voimassaolo. */
const LOCAL_UPLOAD_TTL_MS = 15 * 60 * 1000;

/** Paikallisen latausosoitteen allekirjoitus: polku ja vanhenemisaika. */
export function signLocalUpload(storagePath: string, now = Date.now()): string {
  return signValue(`${storagePath}|${now + LOCAL_UPLOAD_TTL_MS}`);
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
    async remove(p) {
      await rm(full(p), { force: true });
    },
    async createUploadUrl(p) {
      full(p);
      // Kehityksessä latausosoite on sovelluksen oma reitti (src/app/api/tositteet/lataus).
      return { url: `/api/tositteet/lataus?t=${encodeURIComponent(signLocalUpload(p))}`, form: false };
    },
    async size(p) {
      try {
        return (await stat(full(p))).size;
      } catch {
        return null;
      }
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
    async remove(p) {
      const res = await fetch(endpoint(p), { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) throw new Error(`Tiedoston poisto epäonnistui (${res.status})`);
    },
    async createUploadUrl(p) {
      // Storage API: allekirjoitettu latausosoite (voimassa kaksi tuntia, kertakäyttöinen).
      const res = await fetch(`${url.replace(/\/$/, "")}/storage/v1/object/upload/sign/${BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error(`Latausosoitteen luonti epäonnistui (${res.status})`);
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error("Latausosoite puuttuu vastauksesta");
      return { url: `${url.replace(/\/$/, "")}/storage/v1${json.url}`, form: true };
    },
    async size(p) {
      const res = await fetch(endpoint(p), { method: "HEAD", headers });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`Tiedoston tarkistus epäonnistui (${res.status})`);
      const len = Number(res.headers.get("content-length"));
      return Number.isFinite(len) ? len : 0;
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
