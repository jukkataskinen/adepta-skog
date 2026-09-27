import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentPath, getStorage } from "@/lib/storage";

let cwd: string;
let dir: string;

beforeAll(async () => {
  cwd = process.cwd();
  dir = await mkdtemp(path.join(tmpdir(), "skog-storage-"));
  process.chdir(dir);
});
afterAll(async () => {
  process.chdir(cwd);
  await rm(dir, { recursive: true, force: true });
});

describe("tiedostot", () => {
  it("polku on organisaation ja asiakkaan alla, ja nimi siistitään", () => {
    expect(documentPath("org", "asiakas", 2025, "id1", "../../kuitti ä 1.pdf")).toBe("org/asiakas/2025/id1-.._.._kuitti_a_1.pdf");
  });

  it("paikallinen tallennus kirjoittaa ja lukee tiedoston", async () => {
    const s = getStorage({ STORAGE_MODE: "local" });
    await s.put("org/a/2025/x.pdf", Buffer.from("sisältö"), "application/pdf");
    expect((await s.get("org/a/2025/x.pdf")).toString()).toBe("sisältö");
  });

  it("poisto poistaa tiedoston, ja puuttuvan poisto ei ole virhe", async () => {
    const s = getStorage({ STORAGE_MODE: "local" });
    await s.put("org/a/2025/poistettava.pdf", Buffer.from("x"), "application/pdf");
    await s.remove("org/a/2025/poistettava.pdf");
    await expect(s.get("org/a/2025/poistettava.pdf")).rejects.toThrow();
    await expect(s.remove("org/a/2025/poistettava.pdf")).resolves.toBeUndefined();
  });

  it("polku ei voi karata tallennuskansiosta", async () => {
    const s = getStorage({ STORAGE_MODE: "local" });
    await expect(s.put("../ulos.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/Virheellinen/);
  });

  it("Supabase-tila vaatii avaimen", () => {
    expect(() => getStorage({ STORAGE_MODE: "supabase" })).toThrow(/puuttuu/);
  });
});

describe("latausosoite ja koko", () => {
  it("paikallinen latausosoite on allekirjoitettu, ja koko löytyy tallennuksen jälkeen", async () => {
    const s = getStorage({ STORAGE_MODE: "local" });
    const { url, form } = await s.createUploadUrl("org/a/2025/iso.pdf");
    expect(form).toBe(false);
    expect(url).toMatch(/^\/api\/tositteet\/lataus\?t=/);
    expect(await s.size("org/a/2025/iso.pdf")).toBeNull();
    await s.put("org/a/2025/iso.pdf", Buffer.from("12345"), "application/pdf");
    expect(await s.size("org/a/2025/iso.pdf")).toBe(5);
  });
});

describe("Supabase: latausosoite ja koko", () => {
  it("pyytää allekirjoitetun latausosoitteen ja lukee koon HEAD-pyynnöllä", async () => {
    const calls: { url: string; method: string }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      if (init?.method === "POST") return new Response(JSON.stringify({ url: "/object/upload/sign/documents/o/a/2025/x.pdf?token=abc" }), { status: 200 });
      if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-length": "1234" } });
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    try {
      const s = getStorage({ STORAGE_MODE: "supabase", SUPABASE_URL: "https://projekti.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "testiavain" });
      expect(await s.createUploadUrl("o/a/2025/x.pdf")).toEqual({
        url: "https://projekti.supabase.co/storage/v1/object/upload/sign/documents/o/a/2025/x.pdf?token=abc",
        form: true,
      });
      expect(await s.size("o/a/2025/x.pdf")).toBe(1234);
      expect(calls.map((c) => c.method)).toEqual(["POST", "HEAD"]);
      expect(calls[0].url).toBe("https://projekti.supabase.co/storage/v1/object/upload/sign/documents/o/a/2025/x.pdf");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
