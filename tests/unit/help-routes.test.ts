import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_NAV, STAFF_NAV_ORG } from "@/config/nav";
import { HELP_ROUTE_SLUGS, helpFor } from "@/lib/help/routes";
import { HELP_GROUPS, HELP_TOPICS } from "@/lib/help/topics";

/**
 * Jokaisella henkilökunnan sivulla on linkki ohjeeseen. Testi käy läpi kaikki
 * sivutiedostot, joten uusi toiminto ei voi jäädä ilman ohjetta
 * (CLAUDE.md, Ohjeet).
 */

const ROOT = join(process.cwd(), "src", "app", "(henkilokunta)");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

/** Sivutiedosto osoitteeksi: dynaamiset osat korvataan esimerkkiarvolla. */
const toPath = (file: string) =>
  "/" +
  relative(ROOT, file)
    .split(sep)
    .slice(0, -1)
    .map((part) => (part.startsWith("[") ? "00000000-0000-0000-0000-000000000000" : part))
    .join("/");

/**
 * Jokainen henkilökunnan sivu ja ohje, johon sen pitää viedä. Uusi sivu kaataa
 * testin, kunnes se on lisätty tähän ja ohjekarttaan (src/lib/help/routes.ts).
 * Näin sivu ei voi jäädä yleisen säännön varaan vahingossa. search on osoitteen
 * parametri, jolla sama sivu näyttää toisen toiminnon.
 */
const EXPECTED: Record<string, { slug: string; section?: string; variants?: { search: string; slug: string }[] }> = {
  "asetukset": { slug: "asetukset" },
  "asiakkaat": { slug: "asiakkaat" },
  "asiakkaat/uusi": { slug: "asiakkaat", section: "uusi-asiakas" },
  "asiakkaat/[id]": { slug: "asiakkaat" },
  "asiakkaat/[id]/muokkaa": { slug: "asiakkaat", section: "tietojen-muokkaus" },
  "asiakkaat/[id]/alv": { slug: "alv" },
  "asiakkaat/[id]/investoinnit": { slug: "investoinnit" },
  "asiakkaat/[id]/investoinnit/uusi": { slug: "investoinnit", section: "aiemmin-hankittu-investointi-ja-menojaannos" },
  "asiakkaat/[id]/investoinnit/[investointiId]": { slug: "investoinnit", section: "aiemmin-hankittu-investointi-ja-menojaannos" },
  "asiakkaat/[id]/kirjanpito": {
    slug: "kirjanpito",
    variants: [
      { search: "toiminta=maatalous", slug: "maatalouden-kirjanpito" },
      { search: "vuosi=2025&toiminta=maatalous&syotto=lomake", slug: "maatalouden-kirjanpito" },
      { search: "vuosi=2025&syotto=lomake", slug: "kirjanpito" },
    ],
  },
  "asiakkaat/[id]/kirjanpito/[kirjausId]": { slug: "kirjanpito", section: "muokkaus-ja-poisto" },
  "asiakkaat/[id]/maatalous": { slug: "maatalous" },
  "asiakkaat/[id]/metsatilat/uusi": { slug: "metsatilat", section: "uusi-metsatila" },
  "asiakkaat/[id]/metsatilat/[tilaId]": { slug: "metsatilat" },
  "asiakkaat/[id]/raportti": { slug: "veroraportti" },
  "asiakkaat/[id]/verosuunnitelma": { slug: "verosuunnitelma" },
  "kehitystoiveet": { slug: "kehitystoiveet" },
  "kehitystoiveet/uusi": { slug: "kehitystoiveet" },
  "kehitystoiveet/[id]": { slug: "kehitystoiveet" },
  "tyopoyta": { slug: "tyopoyta" },
};

const pageKey = (file: string) => relative(ROOT, file).split(sep).slice(0, -1).join("/");

describe("ohjelinkit", () => {
  const files = pages(ROOT);
  const all = files.map(toPath);

  it("löytää sivut", () => expect(all.length).toBeGreaterThan(1));

  it("jokainen sivu on ohjekirjan tarkistuslistalla", () => {
    const keys = files.map(pageKey).sort();
    expect(keys, "Lisää uusi sivu EXPECTED-listaan ja ohjekarttaan src/lib/help/routes.ts").toEqual(Object.keys(EXPECTED).sort());
  });

  for (const [key, want] of Object.entries(EXPECTED)) {
    const path = "/" + key.replace(/\[[^\]]+\]/g, "00000000-0000-0000-0000-000000000000");
    it(`${path} vie ohjeeseen ${want.slug}`, () => {
      const help = helpFor(path);
      expect(help?.slug).toBe(want.slug);
      expect(help?.href).toBe(`/ohjeet/${want.slug}${want.section ? `#${want.section}` : ""}`);
      for (const v of want.variants ?? []) expect(helpFor(path, v.search)?.slug, v.search).toBe(v.slug);
    });
  }

  for (const path of all) {
    it(`${path} osoittaa ohjeeseen`, () => {
      const help = helpFor(path);
      expect(help, `Lisää sivulle ohje tiedostoon src/lib/help/routes.ts`).not.toBeNull();
    });
  }

  it("valikon kohdat osoittavat ohjeeseen", () => {
    for (const item of [...STAFF_NAV, ...STAFF_NAV_ORG].filter((i) => i.href.startsWith("/") && !i.href.startsWith("/ohjeet"))) {
      expect(helpFor(item.href), item.href).not.toBeNull();
    }
  });

  it("kartan ohjeet ja osiot ovat olemassa", () => {
    for (const r of HELP_ROUTE_SLUGS) {
      const topic = HELP_TOPICS.find((t) => t.slug === r.slug);
      expect(topic, r.slug).toBeTruthy();
      if (r.section) expect(topic!.sections.map((s) => s.title), `${r.slug}: ${r.section}`).toContain(r.section);
    }
  });

  it("ohjekirjan rakenne on eheä", () => {
    const slugs = HELP_TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size, "aiheiden tunnukset ovat yksilöllisiä").toBe(slugs.length);
    for (const t of HELP_TOPICS) {
      expect(HELP_GROUPS, `${t.slug}: luku puuttuu sisällysluettelosta`).toContain(t.group);
      for (const r of t.related ?? []) expect(slugs, `${t.slug} → ${r}`).toContain(r);
      const titles = t.sections.map((s) => s.title);
      expect(new Set(titles).size, `${t.slug}: osioiden otsikot ovat yksilöllisiä`).toBe(titles.length);
    }
    // Jokaisessa luvussa on ainakin yksi aihe, joten sisällysluettelossa ei ole tyhjiä lukuja.
    for (const g of HELP_GROUPS) expect(HELP_TOPICS.some((t) => t.group === g), g).toBe(true);
  });

  it("ohjeiden kieli: ei huutomerkkejä eikä emojeita", () => {
    for (const t of HELP_TOPICS) {
      const text = JSON.stringify(t);
      expect(text.includes("!"), `${t.slug}: huutomerkki`).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(text), `${t.slug}: emoji`).toBe(false);
    }
  });

  it("ohje vie oikeaan aiheeseen", () => {
    expect(helpFor("/asetukset")).toEqual({ slug: "asetukset", title: "Asetukset", href: "/ohjeet/asetukset" });
    expect(helpFor("/tyopoyta")?.href).toBe("/ohjeet/tyopoyta");
    expect(helpFor("/kehitystoiveet/uusi")?.slug).toBe("kehitystoiveet");
    expect(helpFor("/asiakkaat/00000000-0000-0000-0000-000000000000/metsatilat/uusi")?.slug).toBe("metsatilat");
    expect(helpFor("/asiakkaat/uusi")?.slug).toBe("asiakkaat");
    expect(helpFor("/asiakkaat/00000000-0000-0000-0000-000000000000/raportti")?.slug).toBe("veroraportti");
    expect(helpFor("/asiakkaat/00000000-0000-0000-0000-000000000000/verosuunnitelma")?.slug).toBe("verosuunnitelma");
    expect(helpFor("/asiakkaat/00000000-0000-0000-0000-000000000000/alv")?.slug).toBe("alv");
    expect(helpFor("/asiakkaat/00000000-0000-0000-0000-000000000000/kirjanpito/00000000-0000-0000-0000-000000000000")?.slug).toBe("kirjanpito");
    // Maatalouden kirjanpito on sama sivu parametrilla, ja sillä on oma ohjeensa.
    const ledger = "/asiakkaat/00000000-0000-0000-0000-000000000000/kirjanpito";
    expect(helpFor(ledger, "vuosi=2025&toiminta=maatalous")?.slug).toBe("maatalouden-kirjanpito");
    expect(helpFor(ledger, "?toiminta=maatalous")?.slug).toBe("maatalouden-kirjanpito");
    expect(helpFor(ledger, "vuosi=2025")?.slug).toBe("kirjanpito");
    expect(helpFor(`${ledger}/00000000-0000-0000-0000-000000000000`, "toiminta=maatalous")?.slug).toBe("kirjanpito");
    expect(helpFor("/asiakkaat/00000000-0000-0000-0000-000000000000/maatalous")?.title).toBe("Lomake 2 (maatalous)");
  });
});
