"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireStaff } from "@/lib/auth/current-user";
import { emptyToNull, fail, isUniqueViolation, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db/types";
import { isValidBusinessId, normalizeBusinessId, normalizePropertyCode } from "@/lib/validation/finnish";
import { archiveReport } from "@/lib/reports/archive";

const optionalText = (max = 200) => z.preprocess(emptyToNull, z.string().max(max).nullable());
// Suomalainen desimaalipilkku ja välilyönnit tuhaterottimina hyväksytään.
const optionalNumber = (min = 0, max = 1e10) =>
  z.preprocess((v) => {
    const e = emptyToNull(v);
    return e === null ? null : Number(String(e).replace(/\s/g, "").replace(",", "."));
  }, z.number({ message: "Tarkista luku." }).min(min).max(max).nullable());
const uuid = z.string().uuid();

/** Kantavirhe suljetusta vuodesta tai toisen asiakkaan rivistä käyttäjälle ymmärrettäväksi. */
function friendly(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : "";
  if (/Verovuosi \d+ on suljettu/.test(msg)) return msg.replace(/^.*(Verovuosi \d+ on suljettu).*$/, "$1. Pääkäyttäjä voi avata vuoden.");
  if (/row-level security/.test(msg)) return "Sinulla ei ole oikeutta tähän asiakkaaseen.";
  return null;
}

// ---------------------------------------------------------------------------
// Asiakas
// ---------------------------------------------------------------------------
const clientSchema = z.object({
  firstName: z.string().max(100),
  lastName: z.string().min(1, "Anna sukunimi tai yrityksen nimi.").max(200),
  businessId: optionalText(20),
  municipality: optionalText(100),
  email: z.preprocess(emptyToNull, z.string().email("Tarkista sähköpostiosoite.").max(200).nullable()),
  phone: optionalText(40),
  street: optionalText(200),
  postalCode: z.preprocess(emptyToNull, z.string().regex(/^\d{5}$/, "Postinumero on viisi numeroa.").nullable()),
  city: optionalText(100),
  taxAccountReference: optionalText(40),
  vatRegistered: z.preprocess((v) => v === "on", z.boolean()),
  vatNumber: optionalText(20),
  // Toiminnot (0015). Lomake lähettää piilokentän, jotta vanha lomake ilman kenttiä ei muuta niitä.
  activitiesSent: z.preprocess((v) => v === "1", z.boolean()),
  hasForestry: z.preprocess((v) => v === "on", z.boolean()),
  hasAgriculture: z.preprocess((v) => v === "on", z.boolean()),
  responsibleUserId: z.preprocess(emptyToNull, uuid.nullable()),
});

function clientValues(input: z.infer<typeof clientSchema>, backTo: string) {
  let businessId: string | null = null;
  if (input.businessId) {
    businessId = normalizeBusinessId(input.businessId);
    if (!isValidBusinessId(businessId)) fail(backTo, "Y-tunnus ei ole oikeaa muotoa.");
  }
  // ALV-numero kirjoitetaan usein välilyönneillä tai pienillä kirjaimilla, joten se yhtenäistetään.
  const vatNumber = input.vatNumber ? input.vatNumber.replace(/[\s-]/g, "").toUpperCase() : null;
  if (vatNumber && !/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(vatNumber)) fail(backTo, "ALV-numero on muotoa FI12345678.");
  // Ilman kumpaakaan toimintoa asiakas on metsäasiakas kuten ennen.
  const hasForestry = input.activitiesSent ? input.hasForestry || !input.hasAgriculture : true;
  const hasAgriculture = input.activitiesSent ? input.hasAgriculture : false;
  return [input.firstName, input.lastName, businessId, input.municipality, input.email, input.phone, input.street, input.postalCode, input.city,
    input.taxAccountReference, input.vatRegistered, vatNumber, hasForestry, hasAgriculture];
}

export async function createClientAction(formData: FormData) {
  const ctx = await requireStaff();
  const back = "/asiakkaat/uusi";
  const input = parseForm(clientSchema, formData, back);
  // Kirjanpitäjän asiakas on aina hänen omansa, muuten se katoaisi häneltä heti (RLS).
  const responsible = ctx.can("owner") ? input.responsibleUserId : ctx.user.id;
  let id = "";
  try {
    id = await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into sk_clients (organization_id, first_name, last_name, business_id, municipality, email, phone, street, postal_code, city,
                                 tax_account_reference, vat_registered, vat_number, has_forestry, has_agriculture, responsible_user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
        [ctx.org.organizationId, ...clientValues(input, back), responsible],
      );
      // Uudelle asiakkaalle avataan heti kuluva verovuosi.
      await tx.query("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, extract(year from now())::int)", [ctx.org.organizationId, row.id]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "client.create", entity: "sk_clients", entityId: row.id });
      return row.id;
    });
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath("/asiakkaat");
  redirect(`/asiakkaat/${id}`);
}

export async function updateClientAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const back = `/asiakkaat/${clientId}/muokkaa`;
  const input = parseForm(clientSchema, formData, back);
  const updated = await ctx.run(async (tx) => {
    const rows = await tx.query(
      `update sk_clients set first_name = $3, last_name = $4, business_id = $5, municipality = $6, email = $7, phone = $8, street = $9,
              postal_code = $10, city = $11, tax_account_reference = $12, vat_registered = $13, vat_number = $14, has_forestry = $15, has_agriculture = $16
        where id = $1 and organization_id = $2 returning id`,
      [clientId, ctx.org.organizationId, ...clientValues(input, back)],
    );
    if (rows.length) await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "client.update", entity: "sk_clients", entityId: clientId });
    return rows.length;
  });
  if (!updated) fail(back, "Asiakasta ei löytynyt.");
  revalidatePath(`/asiakkaat/${clientId}`);
  redirect(`/asiakkaat/${clientId}`);
}

export async function setResponsibleAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ clientId: uuid, responsibleUserId: z.preprocess(emptyToNull, uuid.nullable()) }), formData, "/asiakkaat");
  const back = `/asiakkaat/${input.clientId}`;
  try {
    await ctx.run(async (tx) => {
      await tx.query("update sk_clients set responsible_user_id = $3 where id = $1 and organization_id = $2", [
        input.clientId,
        ctx.org.organizationId,
        input.responsibleUserId,
      ]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "client.responsible", entity: "sk_clients", entityId: input.clientId });
    });
  } catch (err) {
    if (err instanceof Error && /ei ole toimiston jäsen/.test(err.message)) fail(back, "Valitse toimiston käyttäjä.");
    throw err;
  }
  revalidatePath(back);
  redirect(`${back}?ilmoitus=tallennettu`);
}

/** Asiakasta ei poisteta, koska kirjanpitoaineisto on säilytettävä. Arkistoitu asiakas piiloutuu listasta. */
export async function setArchivedAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ clientId: uuid, archived: z.enum(["1", "0"]) }), formData, "/asiakkaat");
  await ctx.run(async (tx) => {
    await tx.query("update sk_clients set archived_at = case when $3 then now() else null end where id = $1 and organization_id = $2", [
      input.clientId,
      ctx.org.organizationId,
      input.archived === "1",
    ]);
    await audit(tx, {
      organizationId: ctx.org.organizationId, userId: ctx.user.id, action: input.archived === "1" ? "client.archive" : "client.restore", entity: "sk_clients", entityId: input.clientId,
    });
  });
  revalidatePath("/asiakkaat");
  redirect(`/asiakkaat/${input.clientId}`);
}

// ---------------------------------------------------------------------------
// Metsätilat
// ---------------------------------------------------------------------------
const propertySchema = z.object({
  clientId: uuid,
  name: z.string().min(1, "Anna tilan nimi.").max(200),
  propertyCode: optionalText(40),
  areaHa: optionalNumber(0, 1e6),
  acquisitionPrice: optionalNumber(0),
  acquiredOn: z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista hankintapäivä.").nullable()),
  forestLandSharePct: optionalNumber(0, 100),
  forestLandHa: optionalNumber(0, 1e6),
  deductionUsedBefore: optionalNumber(0),
});

function propertyValues(input: z.infer<typeof propertySchema>, backTo: string) {
  let code: string | null = null;
  if (input.propertyCode) {
    code = normalizePropertyCode(input.propertyCode);
    if (!code) fail(backTo, "Kiinteistötunnus on muotoa 172-401-3-45.");
  }
  return [input.name, code, input.areaHa, input.acquisitionPrice, input.acquiredOn, input.forestLandSharePct, input.deductionUsedBefore ?? 0, input.forestLandHa];
}

export async function createPropertyAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const back = `/asiakkaat/${clientId}/metsatilat/uusi`;
  const input = parseForm(propertySchema, formData, back);
  try {
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `insert into sk_forest_properties (organization_id, client_id, name, property_code, area_ha, acquisition_price, acquired_on,
                                           forest_land_share_pct, deduction_used_before, forest_land_ha)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [ctx.org.organizationId, clientId, ...propertyValues(input, back)],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "property.create", entity: "sk_forest_properties", entityId: row.id });
    });
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`);
  redirect(`/asiakkaat/${clientId}#metsatilat`);
}

export async function updatePropertyAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const propertyId = uuid.parse(formData.get("propertyId"));
  const back = `/asiakkaat/${clientId}/metsatilat/${propertyId}`;
  const input = parseForm(propertySchema, formData, back);
  await ctx.run(async (tx) => {
    // Hankintapäivä ei voi siirtyä luovutuksen jälkeen.
    if (input.acquiredOn) {
      const [early] = await tx.query("select 1 from sk_forest_property_disposals where forest_property_id = $1 and disposed_on < $2 limit 1", [propertyId, input.acquiredOn]);
      if (early) fail(back, "Tilalla on luovutus ennen hankintapäivää.");
    }
    await tx.query(
      `update sk_forest_properties set name = $3, property_code = $4, area_ha = $5, acquisition_price = $6, acquired_on = $7,
              forest_land_share_pct = $8, deduction_used_before = $9, forest_land_ha = $10
        where id = $1 and client_id = $2`,
      [propertyId, clientId, ...propertyValues(input, back)],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "property.update", entity: "sk_forest_properties", entityId: propertyId });
  });
  revalidatePath(`/asiakkaat/${clientId}`);
  redirect(`/asiakkaat/${clientId}#metsatilat`);
}

// ---------------------------------------------------------------------------
// Metsätilan luovutukset (koko tila tai määräala / määräosa)
// ---------------------------------------------------------------------------
const disposalSchema = z.object({
  disposalId: z.preprocess(emptyToNull, uuid.nullable()),
  disposedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarkista luovutuspäivä."),
  salePrice: optionalNumber(0).refine((v) => v !== null, "Anna kauppahinta."),
  sharePct: optionalNumber(0.01, 100).refine((v) => v !== null, "Anna myyty osuus prosentteina, enintään 100."),
  sellingCosts: optionalNumber(0),
  noDeductionAddition: z.preprocess((v) => v === "on", z.boolean()),
  note: optionalText(1000),
});

/**
 * Luovutuksen voi lisätä, muuttaa ja poistaa vain avatulla ja avoimella
 * verovuodella, kuten kirjauksen (DECISIONS 27.9.2026). Kanta varmistaa saman
 * lukituksen, osuuksien enimmäismäärän ja päivän hankinnan jälkeen.
 */
async function requireOpenYear(tx: Sql, clientId: string, year: number, back: string) {
  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (!y) fail(back, `Verovuotta ${year} ei ole avattu. Avaa vuosi asiakkaan sivulla.`);
  if (y.status === "closed") fail(back, `Verovuosi ${year} on suljettu. Pääkäyttäjä voi avata vuoden.`);
}

function disposalError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : "";
  if (/yli 100 prosenttia/.test(msg)) return "Tilasta on myyty yhteensä yli 100 %. Tarkista osuudet.";
  if (/ennen tilan hankintaa/.test(msg)) return "Luovutuspäivä on ennen tilan hankintapäivää.";
  return friendly(err);
}

export async function saveDisposalAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const propertyId = uuid.parse(formData.get("propertyId"));
  const back = `/asiakkaat/${clientId}/metsatilat/${propertyId}`;
  const input = parseForm(disposalSchema, formData, back);
  const year = Number(input.disposedOn.slice(0, 4));
  const share = input.sharePct!;
  try {
    await ctx.run(async (tx) => {
      const [p] = await tx.query<{ acquired_on: string | null }>("select acquired_on::text from sk_forest_properties where id = $1 and client_id = $2", [
        propertyId,
        clientId,
      ]);
      if (!p) fail(back, "Metsätilaa ei löytynyt.");
      if (p.acquired_on && input.disposedOn < p.acquired_on) fail(back, "Luovutuspäivä on ennen tilan hankintapäivää.");
      await requireOpenYear(tx, clientId, year, back);
      const [{ other }] = await tx.query<{ other: string }>(
        "select coalesce(sum(share_pct), 0) as other from sk_forest_property_disposals where forest_property_id = $1 and id is distinct from $2",
        [propertyId, input.disposalId],
      );
      const sold = Number(other);
      if (sold + share > 100) {
        fail(back, `Tilasta on jo myyty ${sold.toLocaleString("fi-FI")} %. Tämän luovutuksen osuus voi olla enintään ${(100 - sold).toLocaleString("fi-FI")} %.`);
      }
      const values = [input.disposedOn, input.salePrice, share, input.sellingCosts ?? 0, input.noDeductionAddition, input.note];
      let id = input.disposalId;
      if (id) {
        const [prev] = await tx.query<{ year: number }>("select tax_year as year from sk_forest_property_disposals where id = $1 and forest_property_id = $2", [
          id,
          propertyId,
        ]);
        if (!prev) fail(back, "Luovutusta ei löytynyt.");
        if (Number(prev.year) !== year) await requireOpenYear(tx, clientId, Number(prev.year), back);
        await tx.query(
          `update sk_forest_property_disposals set disposed_on = $2, sale_price = $3, share_pct = $4, selling_costs = $5, no_deduction_addition = $6, note = $7
            where id = $1`,
          [id, ...values],
        );
      } else {
        const [row] = await tx.query<{ id: string }>(
          `insert into sk_forest_property_disposals (organization_id, client_id, forest_property_id, disposed_on, sale_price, share_pct, selling_costs,
                                                    no_deduction_addition, note)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [ctx.org.organizationId, clientId, propertyId, ...values],
        );
        id = row.id;
      }
      await audit(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, action: input.disposalId ? "property_disposal.update" : "property_disposal.create",
        entity: "sk_forest_property_disposals", entityId: id, details: { year, sharePct: share },
      });
    });
  } catch (err) {
    const f = disposalError(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`, "layout");
  redirect(`${back}#luovutukset`);
}

export async function deleteDisposalAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const propertyId = uuid.parse(formData.get("propertyId"));
  const disposalId = uuid.parse(formData.get("disposalId"));
  const back = `/asiakkaat/${clientId}/metsatilat/${propertyId}`;
  try {
    await ctx.run(async (tx) => {
      const [prev] = await tx.query<{ year: number }>(
        "select tax_year as year from sk_forest_property_disposals where id = $1 and forest_property_id = $2 and client_id = $3",
        [disposalId, propertyId, clientId],
      );
      if (!prev) fail(back, "Luovutusta ei löytynyt.");
      await requireOpenYear(tx, clientId, Number(prev.year), back);
      await tx.query("delete from sk_forest_property_disposals where id = $1", [disposalId]);
      await audit(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "property_disposal.delete", entity: "sk_forest_property_disposals",
        entityId: disposalId, details: { year: Number(prev.year) },
      });
    });
  } catch (err) {
    const f = disposalError(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`, "layout");
  redirect(`${back}#luovutukset`);
}

export async function deletePropertyAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const propertyId = uuid.parse(formData.get("propertyId"));
  const back = `/asiakkaat/${clientId}/metsatilat/${propertyId}`;
  try {
    await ctx.run(async (tx) => {
      await tx.query("delete from sk_forest_properties where id = $1 and client_id = $2", [propertyId, clientId]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "property.delete", entity: "sk_forest_properties", entityId: propertyId });
    });
  } catch (err) {
    // Suljetun vuoden metsävähennys estää poiston (lukitustriggeri).
    const f = friendly(err);
    if (f) fail(back, `Tilaa ei voi poistaa: ${f}`);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`);
  redirect(`/asiakkaat/${clientId}#metsatilat`);
}

// ---------------------------------------------------------------------------
// Verovuodet
// ---------------------------------------------------------------------------
export async function addTaxYearAction(formData: FormData) {
  const ctx = await requireStaff();
  const input = parseForm(z.object({ clientId: uuid, year: z.coerce.number().int().min(2000, "Tarkista vuosi.").max(2100, "Tarkista vuosi.") }), formData, "/asiakkaat");
  const back = `/asiakkaat/${input.clientId}`;
  try {
    await ctx.run(async (tx) => {
      const [row] = await tx.query<{ id: string }>("insert into sk_tax_years (organization_id, client_id, year) values ($1, $2, $3) returning id", [
        ctx.org.organizationId,
        input.clientId,
        input.year,
      ]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "tax_year.open", entity: "sk_tax_years", entityId: row.id, details: { year: input.year } });
    });
  } catch (err) {
    if (isUniqueViolation(err)) fail(`${back}#verovuodet`, `Vuosi ${input.year} on jo olemassa.`);
    throw err;
  }
  revalidatePath(back);
  redirect(`${back}#verovuodet`);
}

/** Sulkeminen ja uudelleen avaus: vain pääkäyttäjä (RLS). Avaus kirjataan lokiin (CLAUDE.md). */
export async function setTaxYearStatusAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ clientId: uuid, yearId: uuid, status: z.enum(["open", "closed"]) }), formData, "/asiakkaat");
  const back = `/asiakkaat/${input.clientId}`;
  const changed = await ctx.run(async (tx) => {
    const rows = await tx.query<{ year: number }>(
      `update sk_tax_years set status = $3, closed_at = case when $3 = 'closed' then now() end, closed_by = case when $3 = 'closed' then $4::uuid end
        where id = $1 and client_id = $2 and status <> $3 returning year`,
      [input.yearId, input.clientId, input.status, ctx.user.id],
    );
    if (rows.length) {
      await audit(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, action: input.status === "closed" ? "tax_year.close" : "tax_year.reopen",
        entity: "sk_tax_years", entityId: input.yearId, details: { year: rows[0].year },
      });
      // Suljetun vuoden raportti arkistoon samassa transaktiossa.
      if (input.status === "closed") {
        await archiveReport(tx, { organizationId: ctx.org.organizationId, clientId: input.clientId, year: rows[0].year, userId: ctx.user.id });
      }
    }
    return rows.length;
  });
  if (!changed) fail(`${back}#verovuodet`, "Vuoden tila ei muuttunut.");
  revalidatePath(back);
  redirect(`${back}#verovuodet`);
}
