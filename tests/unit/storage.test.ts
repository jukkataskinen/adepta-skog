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

  it("polku ei voi karata tallennuskansiosta", async () => {
    const s = getStorage({ STORAGE_MODE: "local" });
    await expect(s.put("../ulos.txt", Buffer.from("x"), "text/plain")).rejects.toThrow(/Virheellinen/);
  });

  it("Supabase-tila vaatii avaimen", () => {
    expect(() => getStorage({ STORAGE_MODE: "supabase" })).toThrow(/puuttuu/);
  });
});
