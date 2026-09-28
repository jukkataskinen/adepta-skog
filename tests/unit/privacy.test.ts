import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpFor } from "@/lib/help/routes";
import { SUBPROCESSORS } from "@/lib/privacy/subprocessors";

/**
 * Tietosuojasivun alikäsittelijät ja käsittelysopimuksen liite pysyvät samoina:
 * jos sovellukseen lisätään palvelu, se lisätään myös asiakirjaan.
 */
describe("tietosuoja", () => {
  const doc = readFileSync(join(process.cwd(), "docs", "tietosuoja", "alikasittelijat.md"), "utf-8");

  for (const s of SUBPROCESSORS) {
    it(`${s.name} on alikäsittelijäluettelossa`, () => expect(doc).toContain(s.name));
  }

  it("EU:n ulkopuolella käsittelevät on merkitty", () => {
    expect(SUBPROCESSORS.filter((s) => s.outsideEu).map((s) => s.name)).toEqual(["Okta Inc. (Auth0)", "Anthropic PBC"]);
  });

  it("tietosuojasivu on julkinen eikä henkilökunnan sivu", () => {
    expect(existsSync(join(process.cwd(), "src", "app", "tietosuoja", "page.tsx"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src", "app", "(henkilokunta)", "tietosuoja"))).toBe(false);
    expect(helpFor("/tietosuoja")).toBeNull();
  });
});
