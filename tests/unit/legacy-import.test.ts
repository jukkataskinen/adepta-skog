import { describe, expect, it } from "vitest";
import { isSkipped, mapAsset, mapClient, mapProperty, mapRole, mapTransaction, mapUser, taxYears } from "@/lib/import/legacy";
import { defaultVatRate, generalVatRate } from "@/lib/tax/rules";

describe("vanhan kannan muunnos", () => {
  it("roolit: pääkäyttäjä ja kirjanpitäjä siirtyvät, lukija ei", () => {
    expect(mapRole("paakayttaja")).toBe("owner");
    expect(mapRole("kirjanpitaja")).toBe("staff");
    expect(mapRole("lukija")).toBeNull();
    const u = mapUser({ id: "u1", auth_sub: null, sahkoposti: "Lukija@Example.test", etunimi: "L", sukunimi: "K", rooli: "lukija", aktiivinen: true, organisaatio_id: "o" });
    expect(isSkipped(u) && u.reason).toMatch(/lukija/);
  });

  it("asiakas: virheellinen postinumero jää tyhjäksi, poistettu arkistoidaan", () => {
    const c = mapClient({
      id: "c1", organisaatio_id: "o", etunimi: " Aino ", sukunimi: "Metsänen", y_tunnus: null, kotikunta: "Joutsa", sahkoposti: "", puhelin: null,
      osoite: "Tie 1", postinumero: "1965", postitoimipaikka: "Joutsa", verotiliviite: null, alv_rekisterissa: null, avoin_vuosi: 2025,
      vastuukirjanpitaja_id: "u1", poistettu_at: "2025-02-01T10:00:00Z",
    });
    expect(isSkipped(c)).toBe(false);
    if (isSkipped(c)) return;
    expect(c.firstName).toBe("Aino");
    expect(c.email).toBeNull();
    expect(c.postalCode).toBeNull();
    expect(c.vatRegistered).toBe(false);
    expect(c.archivedAt).toBe("2025-02-01T10:00:00Z");
  });

  it("metsätila: ennen ohjelmaa käytetty vähennys on erotus ohjelmassa kirjatuista", () => {
    const p = mapProperty(
      { id: "t1", asiakas_id: "c1", nimi: "Kotimetsä", kiinteistotunnus: "172-401-3-45", pinta_ala_ha: "42,5", hankintahinta: "120000", hankintapvm: "2018-05-01", metsämaan_osuus_prosentti: 80, vahennyspohjaa_kaytetty: "10000" },
      [
        { metsatila_id: "t1", verovuosi: 2024, kaytettava_vahennys: "3000" },
        { metsatila_id: "t1", verovuosi: 2025, kaytettava_vahennys: 2500 },
        { metsatila_id: "muu", verovuosi: 2025, kaytettava_vahennys: 999 },
      ],
    );
    expect(p.areaHa).toBe(42.5);
    expect(p.deductionUsedBefore).toBe(4500);
  });

  it("investointi: menojäännöspoisto 25 %, tasapoisto vaatii poistoajan", () => {
    const a = mapAsset({ id: "i1", asiakas_id: "c1", kuvaus: "Traktori", hankintapvm: "2024-03-01", hankintahinta: 30000, jaannosarvo: 22500, poistoaika_vuotta: null, poistotapa: "menojannos", aktiivinen: false });
    expect(!isSkipped(a) && a.method).toBe("declining_balance");
    expect(!isSkipped(a) && a.decliningRatePct).toBe(25);
    expect(!isSkipped(a) && a.disposed).toBe(true);
    const b = mapAsset({ id: "i2", asiakas_id: "c1", kuvaus: "Tie", hankintapvm: "2024-03-01", hankintahinta: 5000, jaannosarvo: null, poistoaika_vuotta: null, poistotapa: "tasa", aktiivinen: true });
    expect(isSkipped(b)).toBe(true);
  });

  it("kirjaus: luokka vanhalla nimellä, tuntematon luokka päätellään tyypistä", () => {
    const t = mapTransaction({ id: "k1", asiakas_id: "c1", tyyppi: "tulo", kuvaus: "Leimikko", paivamaara: "2025-06-15", summa_alv0: "15000.00", alv_prosentti: "25.5", kategoria: "Pystykauppa", ennakko: 0, viite: null, verovuosi: 2025 });
    expect(!isSkipped(t) && t.row.category).toBe("standing_sale");
    expect(!isSkipped(t) && t.categoryGuessed).toBe(false);
    // Vanha summa on veroton; brutto kuten vanha sovellus sen näytti.
    expect(!isSkipped(t) && [t.row.amountNet, t.row.amountGross]).toEqual([15000, 18825]);
    const u = mapTransaction({ id: "k2", asiakas_id: "c1", tyyppi: "meno", kuvaus: "", paivamaara: "2025-07-01", summa_alv0: 120, alv_prosentti: 25.5, kategoria: "", ennakko: null, viite: null, verovuosi: 2025 });
    expect(!isSkipped(u) && u.row.category).toBe("other_expense");
    expect(!isSkipped(u) && u.categoryGuessed).toBe(true);
    expect(!isSkipped(u) && u.row.amountGross).toBe(150.6);
  });

  it("kirjaus: päivä kelpaa myös Date-oliona", () => {
    const t = mapTransaction({ id: "k4", asiakas_id: "c1", tyyppi: "meno", kuvaus: "", paivamaara: new Date(2025, 4, 2) as unknown as string, summa_alv0: 10, alv_prosentti: 0, kategoria: "Muut vuosimenot", ennakko: null, viite: null, verovuosi: 2025 });
    expect(!isSkipped(t) && t.row.bookedOn).toBe("2025-05-02");
  });

  it("kirjaus: päivän on oltava verovuodella", () => {
    const t = mapTransaction({ id: "k3", asiakas_id: "c1", tyyppi: "meno", kuvaus: "", paivamaara: "2024-12-31", summa_alv0: 10, alv_prosentti: 0, kategoria: "Muut vuosimenot", ennakko: null, viite: null, verovuosi: 2025 });
    expect(isSkipped(t)).toBe(true);
  });

  it("verovuodet: avointa vuotta aiemmat suljetaan", () => {
    expect(taxYears(2025, [2023, 2024, 2024])).toEqual([
      { year: 2023, closed: true },
      { year: 2024, closed: true },
      { year: 2025, closed: false },
    ]);
    expect(taxYears(null, [2024])).toEqual([{ year: 2024, closed: false }]);
  });
});

describe("arvonlisävero", () => {
  it("yleinen verokanta nousi 1.9.2024", () => {
    expect(generalVatRate("2024-08-31")).toBe(24);
    expect(generalVatRate("2024-09-01")).toBe(25.5);
    expect(defaultVatRate("standing_sale", "2025-01-01", { vatRegistered: true })).toBe(25.5);
    // Arvonlisäverorekisteriin kuulumattomalle oletus on aina 0 %.
    expect(defaultVatRate("standing_sale", "2025-01-01", { vatRegistered: false })).toBe(0);
    expect(defaultVatRate("wages", "2025-01-01", { vatRegistered: true })).toBe(0);
  });
});
