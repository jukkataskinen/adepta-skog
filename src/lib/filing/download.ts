import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { isValidBusinessId, isValidPersonalId, normalizeBusinessId, normalizePersonalId } from "@/lib/validation/finnish";
import { loadFilingSource } from "./load";
import { compute2c, encodeLatin1, render2c, SKOG_SOFTWARE, VSY02C_SPECS, type DeliveryWorker } from "./vsy02c";
import { compute2, render2, VSY002_SPECS } from "./vsy002";
import { loadForm2 } from "@/lib/tax/agri-form-load";

/**
 * Ilmoitustiedoston muodostus lomakkeelta: metsätalouden 2C ja
 * maatalousasiakkaalle lomake 2 samaan tiedostoon (ensin VSY002, sitten
 * VSY02C; sallittu lomakeyhdistelmä). Henkilötunnukset (ilmoittaja,
 * hankintatyön tekijät) ovat vain tämän funktion muuttujissa ja palautettavassa
 * tiedostossa: niitä ei tallenneta kantaan, Storageen, lokiin eikä
 * audit-tietoihin, eivätkä ne näy virheviesteissä (DECISIONS 28.9.2026).
 */

export type FilingResult = { ok: true; bytes: Uint8Array; fileName: string } | { ok: false; status: number; error: string };

const MAX_WORKERS = 20;

/** Suomalainen desimaaliluku lomakkeelta; tyhjä on nolla. */
function parseNumber(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseWorkers(form: FormData): { workers: DeliveryWorker[] } | { error: string } {
  const count = Number(form.get("workerCount") ?? 0);
  if (!Number.isInteger(count) || count < 0 || count > MAX_WORKERS) return { error: `Hankintatyön tekijöitä voi olla enintään ${MAX_WORKERS}.` };
  const workers: DeliveryWorker[] = [];
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    const name = String(form.get(`w${i}_name`) ?? "").trim();
    const personalId = normalizePersonalId(String(form.get(`w${i}_personalId`) ?? ""));
    const nums = ["madeM3", "transportedM3", "value", "taxableValue"].map((k) => parseNumber(form.get(`w${i}_${k}`)));
    if (nums.some((x) => x === null)) return { error: `Tarkista tekijän ${n} määrät ja arvot.` };
    const [madeM3, transportedM3, value, taxableValue] = nums as number[];
    // Tyhjä rivi ohitetaan, jotta ylimääräinen rivi ei estä latausta.
    if (!name && !personalId && !madeM3 && !transportedM3 && !value && !taxableValue) continue;
    if (!name) return { error: `Anna tekijän ${n} nimi.` };
    if (!isValidPersonalId(personalId)) return { error: `Tekijän ${n} henkilötunnus ei ole oikeaa muotoa.` };
    if (taxableValue > value) return { error: `Tekijän ${n} veronalainen arvo ei voi olla suurempi kuin hankintatyön arvo.` };
    workers.push({ name, personalId, madeM3, transportedM3, value, taxableValue });
  }
  return { workers };
}

export async function buildFilingDownload(
  tx: Sql,
  ctx: { organizationId: string; userId: string; userName: string | null },
  clientId: string,
  year: number,
  form: FormData,
  now = new Date(),
): Promise<FilingResult> {
  const [client] = await tx.query<{ has_forestry: boolean; has_agriculture: boolean }>(
    "select has_forestry, has_agriculture from sk_clients where id = $1 and organization_id = $2",
    [clientId, ctx.organizationId],
  );
  if (!client) return { ok: false, status: 404, error: "Asiakasta tai verovuotta ei löytynyt." };
  // Metsäasiakas saa 2C:n kuten ennen; maatalousasiakas lomakkeen 2, ja molempia harjoittava molemmat.
  const forestry = client.has_forestry || !client.has_agriculture;
  const agriculture = client.has_agriculture;
  if (forestry && !VSY02C_SPECS[year]) return { ok: false, status: 400, error: `Sähköistä 2C-ilmoitusta ei voi vielä tehdä vuodelle ${year}.` };
  if (agriculture && !VSY002_SPECS[year]) return { ok: false, status: 400, error: `Sähköistä lomaketta 2 ei voi vielä tehdä vuodelle ${year}.` };
  const source = await loadFilingSource(tx, ctx.organizationId, clientId, year);
  if (!source) return { ok: false, status: 404, error: "Asiakasta tai verovuotta ei löytynyt." };

  // Tunniste 010: Y-tunnus, jos asiakkaalla on se ja sitä halutaan käyttää, muuten henkilötunnus.
  let filerId: string;
  const useBusinessId = source.client.businessId && form.get("filerIdType") !== "personal_id";
  if (useBusinessId) {
    filerId = normalizeBusinessId(source.client.businessId!);
    if (!isValidBusinessId(filerId)) return { ok: false, status: 400, error: "Asiakkaan Y-tunnus ei ole oikeaa muotoa. Korjaa se asiakkaan tietoihin." };
  } else {
    filerId = normalizePersonalId(String(form.get("filerPersonalId") ?? ""));
    if (!isValidPersonalId(filerId)) return { ok: false, status: 400, error: "Ilmoittajan henkilötunnus ei ole oikeaa muotoa." };
  }

  const contact = { name: ctx.userName, email: source.office.email, phone: source.office.phone };
  let text = "";

  // Lomake 2 ensin: se on pääveroilmoitus, ja 2C on sen sallittu liite.
  if (agriculture) {
    const form2 = await loadForm2(tx, clientId, year);
    if (!form2) return { ok: false, status: 404, error: "Asiakasta tai verovuotta ei löytynyt." };
    const computed2 = compute2(form2);
    if (computed2.errors.length) return { ok: false, status: 400, error: `Lomake 2: ${computed2.errors.join(" ")}` };
    text += render2({ computed: computed2, filerId, software: SKOG_SOFTWARE, createdAt: now, contact });
    // Lokiin vain se, että tiedosto muodostettiin: ei tunnisteita, nimiä eikä lukuja.
    await audit(tx, {
      organizationId: ctx.organizationId, userId: ctx.userId, action: "filing.2.download", entity: "client", entityId: clientId,
      details: { year, filerIdType: useBusinessId ? "business_id" : "personal_id", fields: computed2.fields.length, empty: computed2.empty },
    });
  }

  if (forestry) {
    const parsed = form.get("itemizeWorkers") === "1" ? parseWorkers(form) : { workers: [] };
    if ("error" in parsed) return { ok: false, status: 400, error: parsed.error };
    const computed = compute2c(source.data);
    if (computed.errors.length) return { ok: false, status: 400, error: agriculture ? `2C: ${computed.errors.join(" ")}` : computed.errors.join(" ") };
    text += render2c({ computed, filerId, software: SKOG_SOFTWARE, createdAt: now, workers: parsed.workers, contact });
    await audit(tx, {
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      action: "filing.2c.download",
      entity: "client",
      entityId: clientId,
      details: { year, filerIdType: useBusinessId ? "business_id" : "personal_id", workers: parsed.workers.length, fields: computed.fields.length },
    });
  }

  const safeName = source.client.lastName.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").slice(0, 30) || "asiakas";
  const forms = agriculture && forestry ? "2_2C" : agriculture ? "2" : "2C";
  return { ok: true, bytes: encodeLatin1(text), fileName: `${forms}_${year}_${safeName}.txt` };
}
