import { describe, expect, it } from "vitest";
import {
  businessIdOf,
  buildPostingMemory,
  currentVatRate,
  normalizeDescription,
  postingHints,
  similarity,
  suggestPosting,
  suggestWithFallback,
  type PostingEntry,
} from "@/lib/ledger/posting-memory";

/** Tiliöintimuisti (DECISIONS 6.10.2026). Kuvitteellinen data. */

const entry = (over: Partial<PostingEntry> = {}): PostingEntry => ({
  bookedOn: "2024-04-15",
  category: "other_expense",
  kind: "expense",
  description: "Esimerkkitie tiemaksu",
  amountGross: 120,
  vatRate: 0,
  businessSharePct: 100,
  otherSharePct: 0,
  farmId: null,
  ...over,
});

describe("selitteen normalisointi", () => {
  it("poistaa numerot, päivät, viitteet, vuodet, kuukaudet ja yhtiömuodot", () => {
    expect(normalizeDescription("Metsäpalvelu Oy lasku 1182, 15.3.2025 viite 12345 maaliskuu")).toEqual(["metsäpalvelu"]);
    expect(normalizeDescription("Tiemaksu 2024 / Esimerkkitie tiekunta")).toEqual(["esimerkkitie", "tiekunta", "tiemaksu"]);
    expect(normalizeDescription("Y-tunnus 1234567-8")).toEqual(["tunnus"]);
    expect(normalizeDescription("123 456")).toEqual([]);
  });

  it("sanan alku riittää taivutukseen", () => {
    expect(similarity(["tiemaksu"], ["tiemaksut"])).toBe(1);
    expect(similarity(["tiemaksu", "esimerkkitie"], ["tiemaksu"])).toBe(0.5);
    expect(similarity([], ["tiemaksu"])).toBe(0);
  });

  it("löytää Y-tunnuksen selitteestä tai viitteestä", () => {
    expect(businessIdOf("Lasku, Y-tunnus 1234567-8")).toBe("1234567-8");
    expect(businessIdOf(null, "ref 7654321-0")).toBe("7654321-0");
    expect(businessIdOf("Lasku 12345678-9")).toBeNull();
  });
});

describe("alv-kanta nykyiseen", () => {
  it("vanha yleinen ja alennettu kanta päivittyvät, muut säilyvät", () => {
    expect(currentVatRate(24, "2023-05-01", "2026-03-01")).toBe(25.5);
    expect(currentVatRate(22, "2009-05-01", "2026-03-01")).toBe(25.5);
    expect(currentVatRate(14, "2025-05-01", "2026-03-01")).toBe(13.5);
    expect(currentVatRate(10, "2024-05-01", "2026-03-01")).toBe(10);
    expect(currentVatRate(0, "2024-05-01", "2026-03-01")).toBe(0);
    expect(currentVatRate(7, "2024-05-01", "2026-03-01")).toBe(7);
  });
});

describe("haku", () => {
  it("palauttaa tiliöinnin, perusteen ja toistuvuuden", () => {
    const m = buildPostingMemory([
      entry({ bookedOn: "2022-04-10", businessSharePct: 50 }),
      entry({ bookedOn: "2023-04-12", businessSharePct: 50 }),
      entry({ bookedOn: "2024-04-15", businessSharePct: 50 }),
    ]);
    const r = suggestPosting(m, { description: "Esimerkkitie tiemaksu 2026", date: "2026-04-01" });
    expect(r.best).toMatchObject({ category: "other_expense", vatRate: 0, businessSharePct: 50, count: 3, strong: true, source: "client" });
    expect(r.best?.basis).toBe("Tiliöity kuten 4/2024: 9 Muut vuosimenot, alv 0 %, osuus 50 %; 3 kertaa vuosina 2022–2024.");
    expect(r.best?.description).toBe("Esimerkkitie tiemaksu");
    expect(r.alternatives).toEqual([]);
  });

  it("päivittää vanhan alv-kannan ja kertoo sen perusteessa", () => {
    const m = buildPostingMemory([entry({ description: "Metsäpalvelu taimikonhoito", vatRate: 24, bookedOn: "2023-06-01", amountGross: 1240 })]);
    const r = suggestPosting(m, { description: "Metsäpalvelu Oy taimikonhoito", date: "2026-06-01" });
    expect(r.best?.vatRate).toBe(25.5);
    expect(r.best?.vatChange).toEqual({ from: 24, to: 25.5 });
    expect(r.best?.basis).toContain("Alv päivitetty nykyiseen kantaan: 24 % → 25,5 %.");
  });

  it("tuore tiliöinti painaa enemmän kuin vanha", () => {
    const m = buildPostingMemory([
      entry({ bookedOn: "2012-03-01", category: "travel" }),
      entry({ bookedOn: "2013-03-01", category: "travel" }),
      entry({ bookedOn: "2025-03-01" }),
    ]);
    const r = suggestPosting(m, { description: "Esimerkkitie tiemaksu", date: "2026-03-01" });
    expect(r.best?.category).toBe("other_expense");
    expect(r.alternatives.map((a) => a.category)).toEqual(["travel"]);
  });

  it("toistuva tiliöinti voittaa kertaluonteisen, ja ristiriita näkyy vaihtoehtoina", () => {
    const m = buildPostingMemory([
      entry({ bookedOn: "2023-03-01" }),
      entry({ bookedOn: "2024-03-01" }),
      entry({ bookedOn: "2025-03-01" }),
      entry({ bookedOn: "2025-05-01", businessSharePct: 50 }),
      entry({ bookedOn: "2024-05-01", category: "travel" }),
    ]);
    const r = suggestPosting(m, { description: "Esimerkkitie tiemaksu", date: "2026-03-01" });
    expect(r.best?.businessSharePct).toBe(100);
    expect(r.best?.strong).toBe(false); // yksimielisyys alle 70 %
    expect(r.alternatives).toHaveLength(2);
    expect(new Set(r.alternatives.map((a) => `${a.category}/${a.businessSharePct}`))).toEqual(new Set(["other_expense/50", "travel/100"]));
  });

  it("summa ratkaisee saman vastapuolen eri tiliöinnit", () => {
    const m = buildPostingMemory([
      entry({ description: "Konepalvelu", bookedOn: "2024-03-01", amountGross: 80, category: "travel" }),
      entry({ description: "Konepalvelu", bookedOn: "2024-08-01", amountGross: 2400 }),
    ]);
    expect(suggestPosting(m, { description: "Konepalvelu", amountGross: 2500, date: "2025-03-01" }).best?.category).toBe("other_expense");
    expect(suggestPosting(m, { description: "Konepalvelu", amountGross: 85, date: "2025-03-01" }).best?.category).toBe("travel");
  });

  it("Y-tunnus löytää kirjauksen, vaikka selite on eri", () => {
    const m = buildPostingMemory([entry({ description: "Lasku", reference: "Y-tunnus 1234567-8", category: "travel" })]);
    const r = suggestPosting(m, { description: "Uusi nimi", businessId: "1234567-8", date: "2025-03-01" });
    expect(r.best?.category).toBe("travel");
    expect(r.best?.similarity).toBe(1);
  });

  it("ei ehdotusta, kun selite on erilainen tai tyhjä, eikä investointeja muisteta", () => {
    const m = buildPostingMemory([entry(), entry({ description: "Traktori", category: "asset_purchase", kind: "investment" })]);
    expect(suggestPosting(m, { description: "Polttopuut", date: "2025-03-01" }).best).toBeNull();
    expect(suggestPosting(m, { description: "2025 1234", date: "2025-03-01" }).best).toBeNull();
    expect(suggestPosting(m, { description: "Traktori", date: "2025-03-01" }).best).toBeNull();
  });

  it("rajaa näkymän toimintoon", () => {
    const m = buildPostingMemory([entry({ description: "Polttoaine", category: "agri_fuels", vatRate: 25.5, farmId: "f1" })]);
    expect(suggestPosting(m, { description: "Polttoaine", date: "2025-03-01", activities: ["forestry"] }).best).toBeNull();
    expect(suggestPosting(m, { description: "Polttoaine", date: "2025-03-01", activities: ["agriculture"] }).best).toMatchObject({ category: "agri_fuels", farmId: "f1" });
  });
});

describe("toimiston varahaku", () => {
  const own = buildPostingMemory([entry()]);
  const office = buildPostingMemory(
    [
      entry({ description: "Metsänhoitoyhdistys jäsenmaksu", clientId: "c2", businessSharePct: 50, farmId: "x" }),
      entry({ description: "Metsänhoitoyhdistys jäsenmaksu", clientId: "c3", bookedOn: "2023-02-01" }),
    ],
    "office",
  );

  it("käytetään vain, kun asiakkaalla ei ole osumaa, eikä se ole koskaan vahva", () => {
    const r = suggestWithFallback(own, office, { description: "Metsänhoitoyhdistys jäsenmaksu", date: "2025-03-01" });
    expect(r.best).toMatchObject({ source: "office", strong: false, businessSharePct: 100, farmId: null, description: null, clients: 2 });
    expect(r.best?.basis).toMatch(/^Toimiston muilta asiakkailta: 9 Muut vuosimenot, alv 0 %; 2 kertaa vuosina 2023–2024, 2 asiakasta\. Tarkista osuus\.$/);
    expect(r.best?.basis).not.toContain("jäsenmaksu");
    const ownHit = suggestWithFallback(own, office, { description: "Esimerkkitie tiemaksu", date: "2025-03-01" });
    expect(ownHit.best?.source).toBe("client");
  });
});

describe("tekoälyn vihje", () => {
  it("tiivis lista toistuvista tiliöinneistä ilman numeroita", () => {
    const m = buildPostingMemory([
      entry({ bookedOn: "2023-04-01", businessSharePct: 50 }),
      entry({ bookedOn: "2024-04-01", businessSharePct: 50 }),
      entry({ description: "Kertaluonteinen 123", bookedOn: "2024-05-01" }),
      entry({ description: "Metsäpalvelu taimikonhoito 4455", vatRate: 24, bookedOn: "2023-06-01" }),
      entry({ description: "Metsäpalvelu taimikonhoito 4456", vatRate: 25.5, bookedOn: "2024-10-01" }),
    ]);
    const hints = postingHints(m, "2025-12-31");
    expect([...hints].sort()).toEqual(["esimerkkitie tiemaksu → other_expense, alv 0, osuus 50", "metsäpalvelu taimikonhoito → other_expense, alv 25.5"]);
    expect(hints.join(" ")).not.toMatch(/\d{3,}/);
    expect(postingHints(m, "2025-12-31", 1)).toHaveLength(1);
  });
});
