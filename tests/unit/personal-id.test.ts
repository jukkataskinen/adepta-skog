import { describe, expect, it } from "vitest";
import { isValidPersonalId, normalizePersonalId } from "@/lib/validation/finnish";

/** Tunnukset ovat esimerkkejä (Verohallinnon yleiskuvaus, DVV:n ohje) tai keksittyjä. */
describe("henkilötunnuksen tarkistus", () => {
  it("hyväksyy oikean muodon ja tarkistusmerkin", () => {
    for (const h of ["011073-998R", "131052-308T", "010594Y9032", "010594Y9021", "280264-051U", " 131052-308t "]) expect(isValidPersonalId(h), h).toBe(true);
  });

  it("hylkää väärän tarkistusmerkin, päivän, välimerkin ja yksilönumeron", () => {
    for (const h of ["131052-308U", "310252-308T", "131052G308T", "131052-001T", "131052-000J", "010101-UUUU", "1310523-08T", "", "131052308T"]) {
      expect(isValidPersonalId(h), h).toBe(false);
    }
  });

  it("vuosisadan merkit A–F ja U–Y", () => {
    expect(isValidPersonalId("010101A123N")).toBe(isValidPersonalId("010101-123N"));
    expect(isValidPersonalId("290201A1234")).toBe(false); // 29.2.2001 ei ole olemassa
  });

  it("normalisoi välilyönnit ja kirjainkoon", () => {
    expect(normalizePersonalId(" 131052-308t ")).toBe("131052-308T");
  });
});
