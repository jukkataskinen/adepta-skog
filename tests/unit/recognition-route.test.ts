import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Kirjautumista ei saa edes kysyä, jos pyyntö tulee toisesta osoitteesta.
const requireStaff = vi.fn(async () => {
  throw new Error("requireStaff kutsuttiin");
});
vi.mock("@/lib/auth/current-user", () => ({ requireStaff }));

const { POST } = await import("@/app/api/tunnistus/pala/route");

const request = (headers: Record<string, string>) =>
  new NextRequest("https://skog.example.test/api/tunnistus/pala", { method: "POST", headers, body: "{}" });

describe("tositteen palan tunnistusreitti", () => {
  it("hylkää pyynnön ilman Originia, toisesta osoitteesta tai Origin null", async () => {
    for (const headers of <Record<string, string>[]>[
      { host: "skog.example.test" },
      { host: "skog.example.test", origin: "https://evil.example.test" },
      { host: "skog.example.test", origin: "null" },
    ]) {
      const res = await POST(request(headers));
      expect(res.status).toBe(403);
    }
    expect(requireStaff).not.toHaveBeenCalled();
  });

  it("samasta osoitteesta pyyntö etenee kirjautumisen tarkistukseen", async () => {
    await expect(POST(request({ host: "skog.example.test", origin: "https://skog.example.test" }))).rejects.toThrow(/requireStaff/);
    expect(requireStaff).toHaveBeenCalledTimes(1);
  });
});
