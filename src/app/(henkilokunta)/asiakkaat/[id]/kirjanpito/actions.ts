"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db/types";
import { ASSET_CLASS_PCTS, category, SMALL_ASSET_LIMIT } from "@/lib/tax/rules";
import { effectiveVatRate, transactionFieldsSchema, type BatchRowInput, type BatchState } from "@/lib/ledger/transaction-input";
import { saveTransactionBatch } from "@/lib/ledger/batch";
import { documentPath, getStorage } from "@/lib/storage";

const uuid = z.string().uuid();

// Perustiedot tarkistetaan samalla skeemalla kuin taulukkosyötössä (src/lib/ledger/transaction-input.ts).
const transactionSchema = transactionFieldsSchema.extend({
  clientId: uuid,
  transactionId: z.preprocess(emptyToNull, uuid.nullable()),
  // Investoinnin hankinta: hyödykelaji eli menojäännöspoiston enimmäisprosentti.
  // Metsätaloudessa ei ole tasapoistoa (docs/verosaannot-selvitys-2026-09-27.md).
  assetRatePct: z.preprocess(emptyToNull, z.coerce.number().refine((v) => ASSET_CLASS_PCTS.includes(v), "Valitse hyödykkeen laji.").nullable()),
  // Myynti: myytävä investointi.
  saleAssetId: z.preprocess(emptyToNull, uuid.nullable()),
});

/** Kantavirhe ymmärrettäväksi: suljettu vuosi, puuttuva oikeus tai toisen asiakkaan rivi. */
function friendly(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : "";
  const closed = /Verovuosi (\d+) on suljettu/.exec(msg);
  if (closed) return `Verovuosi ${closed[1]} on suljettu. Pääkäyttäjä voi avata vuoden.`;
  if (/row-level security/.test(msg)) return "Sinulla ei ole oikeutta tähän asiakkaaseen.";
  if (/toisen asiakkaan/.test(msg)) return "Investointi tai metsätila kuuluu toiselle asiakkaalle.";
  return null;
}

async function requireOpenYear(tx: Sql, clientId: string, year: number, back: string) {
  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (!y) fail(back, `Verovuotta ${year} ei ole avattu. Avaa vuosi asiakkaan sivulla.`);
  if (y.status === "closed") fail(back, `Verovuosi ${year} on suljettu. Pääkäyttäjä voi avata vuoden.`);
}

export async function saveTransactionAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const editing = typeof formData.get("transactionId") === "string" && formData.get("transactionId") !== "";
  const year = Number(String(formData.get("bookedOn") ?? "").slice(0, 4)) || new Date().getFullYear();
  const back = editing ? `/asiakkaat/${clientId}/kirjanpito/${formData.get("transactionId")}` : `/asiakkaat/${clientId}/kirjanpito?vuosi=${year}`;
  const input = parseForm(transactionSchema, formData, back);
  const cat = category(input.category)!;
  const vatRate = effectiveVatRate(input);
  const amount = input.amountNet!;
  if (cat.code === "asset_sale" && !input.saleAssetId && !editing) fail(back, "Valitse myytävä investointi.");

  let id = input.transactionId ?? "";
  try {
    await ctx.run(async (tx) => {
      await requireOpenYear(tx, clientId, Number(input.bookedOn.slice(0, 4)), back);
      let assetId: string | null = null;
      if (editing) {
        const [prev] = await tx.query<{ asset_id: string | null }>("select asset_id from sk_transactions where id = $1 and client_id = $2", [id, clientId]);
        if (!prev) fail(back, "Kirjausta ei löytynyt.");
        assetId = prev.asset_id;
      }
      // Hankinta luo investoinnin, jota poistetaan vuosittain (vaihe 5).
      if (cat.code === "asset_purchase" && !assetId) {
        // Pieni hankinta vähennetään vuosimenona eikä poistoina (TVL 115 § 3 mom.).
        if (amount <= SMALL_ASSET_LIMIT) {
          fail(back, `Enintään ${SMALL_ASSET_LIMIT} euron hankinta kirjataan vuosimenona. Valitse luokka Muut vuosimenot.`);
        }
        if (!input.assetRatePct) fail(back, "Valitse hyödykkeen laji: kone, tie tai oja, tai rakennus.");
        const [a] = await tx.query<{ id: string }>(
          `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, useful_life_years, declining_rate_pct,
                                  forest_property_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [ctx.org.organizationId, clientId, input.description || cat.label, input.bookedOn, amount, "declining_balance", null, input.assetRatePct,
            input.forestPropertyId],
        );
        assetId = a.id;
        await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "asset.create", entity: "sk_assets", entityId: a.id });
      } else if (cat.code === "asset_purchase" && assetId) {
        // Hankinnan muutos päivittää investoinnin hinnan ja päivän.
        await tx.query("update sk_assets set acquisition_cost = $2, acquired_on = $3, description = $4, forest_property_id = $5 where id = $1", [
          assetId, amount, input.bookedOn, input.description || cat.label, input.forestPropertyId,
        ]);
      }
      if (cat.code === "asset_sale" && input.saleAssetId) {
        assetId = input.saleAssetId;
        await tx.query("update sk_assets set disposed_on = $2, sale_price = $3 where id = $1 and client_id = $4", [assetId, input.bookedOn, amount, clientId]);
      }
      if (cat.code !== "asset_purchase" && cat.code !== "asset_sale") assetId = null;

      const values = [input.bookedOn, cat.kind, cat.code, input.description, amount, vatRate, input.withholding ?? 0, input.reference, assetId, input.forestPropertyId];
      if (editing) {
        await tx.query(
          `update sk_transactions set booked_on = $3, kind = $4, category = $5, description = $6, amount_net = $7, vat_rate = $8, withholding = $9,
                  reference = $10, asset_id = $11, forest_property_id = $12 where id = $1 and client_id = $2`,
          [id, clientId, ...values],
        );
      } else {
        const [row] = await tx.query<{ id: string }>(
          `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_net, vat_rate, withholding, reference, asset_id,
                                        forest_property_id, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
          [ctx.org.organizationId, clientId, ...values, ctx.user.id],
        );
        id = row.id;
      }
      await audit(tx, {
        organizationId: ctx.org.organizationId, userId: ctx.user.id, action: editing ? "transaction.update" : "transaction.create", entity: "sk_transactions", entityId: id,
      });
    });
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
  redirect(`/asiakkaat/${clientId}/kirjanpito?vuosi=${input.bookedOn.slice(0, 4)}${editing ? "" : "&lisatty=1"}`);
}

const batchRowSchema = z.object({
  key: z.string().max(40),
  bookedOn: z.string().max(40),
  category: z.string().max(100),
  description: z.string().max(2000),
  amountNet: z.string().max(40),
  vatRate: z.string().max(40),
  withholding: z.string().max(40),
  reference: z.string().max(400),
  forestPropertyId: z.string().max(400),
});

/**
 * Taulukkosyöttö: monta uutta kirjausta kerralla yhdessä transaktiossa.
 * Palauttaa tilan eikä ohjaa uudelleen, koska rivikohtaiset virheet ja syötetyt
 * arvot eivät mahdu URL-osoitteeseen (eikä henkilötietoa saa sinne).
 */
export async function saveTransactionBatchAction(formData: FormData): Promise<BatchState> {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const year = z.coerce.number().int().min(2000).max(2100).parse(formData.get("year"));
  let rows: BatchRowInput[];
  try {
    rows = z.array(batchRowSchema).parse(JSON.parse(String(formData.get("rows") ?? "[]")));
  } catch {
    return { status: "error", message: "Taulukon tietoja ei voitu lukea. Tarkista rivit.", rowErrors: {} };
  }
  let result: BatchState;
  try {
    result = await ctx.run((tx) => saveTransactionBatch(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, clientId, year, rows }));
  } catch (err) {
    const f = friendly(err);
    if (f) return { status: "error", message: f, rowErrors: {} };
    throw err;
  }
  if (result.status === "saved") revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
  return result;
}

export async function deleteTransactionAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const id = uuid.parse(formData.get("transactionId"));
  const back = `/asiakkaat/${clientId}/kirjanpito/${id}`;
  let year = "";
  try {
    await ctx.run(async (tx) => {
      const [t] = await tx.query<{ tax_year: number; category: string; asset_id: string | null }>(
        "select tax_year, category, asset_id from sk_transactions where id = $1 and client_id = $2",
        [id, clientId],
      );
      if (!t) fail(back, "Kirjausta ei löytynyt.");
      year = String(t.tax_year);
      await tx.query("delete from sk_transactions where id = $1", [id]);
      // Myynnin poisto palauttaa investoinnin käyttöön. Hankinnan poisto poistaa investoinnin, jos sillä ei ole poistoja.
      if (t.asset_id && t.category === "asset_sale") {
        await tx.query("update sk_assets set disposed_on = null, sale_price = null where id = $1", [t.asset_id]);
      } else if (t.asset_id && t.category === "asset_purchase") {
        const [dep] = await tx.query("select 1 from sk_depreciations where asset_id = $1 limit 1", [t.asset_id]);
        if (dep) fail(back, "Investoinnista on jo tehty poistoja, joten hankintaa ei voi poistaa.");
        await tx.query("delete from sk_assets where id = $1", [t.asset_id]);
      }
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "transaction.delete", entity: "sk_transactions", entityId: id });
    });
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
  redirect(`/asiakkaat/${clientId}/kirjanpito?vuosi=${year}`);
}

// ---------------------------------------------------------------------------
// Tositteet
// ---------------------------------------------------------------------------
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];

export async function uploadReceiptAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const transactionId = uuid.parse(formData.get("transactionId"));
  const back = `/asiakkaat/${clientId}/kirjanpito/${transactionId}`;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail(back, "Valitse tiedosto.");
  if (file.size > MAX_BYTES) fail(back, "Tiedosto on liian suuri. Enimmäiskoko on 4 Mt.");
  if (!ALLOWED.includes(file.type)) fail(back, "Tositteen on oltava PDF tai kuva.");
  const body = Buffer.from(await file.arrayBuffer());
  await saveReceipt(ctx, { clientId, transactionId, fileName: file.name, contentType: file.type, body, back });
  revalidatePath(back);
  redirect(back);
}

async function saveReceipt(
  ctx: StaffContext,
  input: { clientId: string; transactionId: string; fileName: string; contentType: string; body: Buffer; back: string },
) {
  try {
    await ctx.run(async (tx) => {
      // Rivi haetaan RLS:n läpi: jos kirjaus ei näy käyttäjälle, tositetta ei tallenneta.
      const [t] = await tx.query<{ tax_year: number }>("select tax_year from sk_transactions where id = $1 and client_id = $2", [
        input.transactionId,
        input.clientId,
      ]);
      if (!t) fail(input.back, "Kirjausta ei löytynyt.");
      const docId = randomUUID();
      const storagePath = documentPath(ctx.org.organizationId, input.clientId, t.tax_year, docId, input.fileName);
      await tx.query(
        `insert into sk_documents (id, organization_id, client_id, tax_year, kind, transaction_id, file_name, content_type, size_bytes, storage_path, created_by)
         values ($1,$2,$3,$4,'receipt',$5,$6,$7,$8,$9,$10)`,
        [docId, ctx.org.organizationId, input.clientId, t.tax_year, input.transactionId, input.fileName.slice(0, 200), input.contentType, input.body.length,
          storagePath, ctx.user.id],
      );
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "document.upload", entity: "sk_documents", entityId: docId });
      // Tallennus ennen transaktion loppua: epäonnistuminen peruu rivin.
      await getStorage().put(storagePath, input.body, input.contentType);
    });
  } catch (err) {
    const f = friendly(err);
    if (f) fail(input.back, f);
    throw err;
  }
}

export async function deleteDocumentAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const transactionId = uuid.parse(formData.get("transactionId"));
  const documentId = uuid.parse(formData.get("documentId"));
  const back = `/asiakkaat/${clientId}/kirjanpito/${transactionId}`;
  const storagePath = await ctx.run(async (tx) => {
    // Suljetun vuoden tosite säilytetään: kirjanpitoaineistoa ei poisteta jälkikäteen.
    const [d] = await tx.query<{ closed: boolean; storage_path: string }>(
      `select exists (select 1 from sk_tax_years y where y.client_id = d.client_id and y.year = d.tax_year and y.status = 'closed') as closed, d.storage_path
         from sk_documents d where d.id = $1 and d.client_id = $2`,
      [documentId, clientId],
    );
    if (!d) fail(back, "Tositetta ei löytynyt.");
    if (d.closed) fail(back, "Suljetun vuoden tositetta ei voi poistaa.");
    await tx.query("delete from sk_documents where id = $1", [documentId]);
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "document.delete", entity: "sk_documents", entityId: documentId });
    return d.storage_path;
  });
  // Tiedosto poistetaan vasta, kun rivin poisto on tallentunut, jotta epäonnistunut
  // transaktio ei vie tiedostoa. Jos tiedoston poisto epäonnistuu, rivi on jo poissa
  // eikä tiedostoa näe kukaan; se jää ämpäriin orvoksi, mikä on pienempi haitta kuin virhe käyttäjälle.
  try {
    await getStorage().remove(storagePath);
  } catch (err) {
    console.error("Tositteen tiedoston poisto epäonnistui", { documentId, error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(back);
  redirect(back);
}
