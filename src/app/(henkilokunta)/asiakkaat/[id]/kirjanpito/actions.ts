"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff, type StaffContext } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import type { Sql } from "@/lib/db/types";
import { ASSET_CLASS_PCTS } from "@/lib/tax/rules";
import { effectiveVatRate, SALE_ASSET_MESSAGE, transactionFieldsSchema } from "@/lib/ledger/transaction-input";
import { deleteTransaction, LedgerError, saveTransaction } from "@/lib/ledger/write";
import { GridSaveError, saveLedgerGrid } from "@/lib/ledger/grid-save";
import { MAX_GRID_ROWS, rowFromStored, type GridSaveState } from "@/lib/ledger/grid";
import { listTransactions } from "@/lib/ledger/queries";
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
  const back = editing ? `/asiakkaat/${clientId}/kirjanpito/${formData.get("transactionId")}` : `/asiakkaat/${clientId}/kirjanpito?vuosi=${year}&syotto=lomake`;
  const input = parseForm(transactionSchema, formData, back);
  if (input.category === "asset_sale" && !input.saleAssetId && !editing) fail(back, SALE_ASSET_MESSAGE);

  const actor = { organizationId: ctx.org.organizationId, userId: ctx.user.id };
  try {
    await ctx.run(async (tx) => {
      await requireOpenYear(tx, clientId, Number(input.bookedOn.slice(0, 4)), back);
      const [client] = await tx.query<{ vat_registered: boolean }>("select vat_registered from sk_clients where id = $1", [clientId]);
      if (!client) fail(back, "Asiakasta ei löytynyt.");
      // Tallennus ja investoinnin säännöt ovat samat kuin taulukossa (src/lib/ledger/write.ts).
      await saveTransaction(tx, actor, clientId, input.transactionId, {
        bookedOn: input.bookedOn,
        category: input.category,
        kind: input.kind,
        description: input.description,
        amountGross: input.amountGross!,
        vatRate: effectiveVatRate(input, { vatRegistered: client.vat_registered }),
        withholding: input.withholding ?? 0,
        reference: input.reference,
        forestPropertyId: input.forestPropertyId,
        assetRatePct: input.assetRatePct,
        saleAssetId: input.saleAssetId,
      });
    });
  } catch (err) {
    if (err instanceof LedgerError) fail(back, err.message);
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
  redirect(`/asiakkaat/${clientId}/kirjanpito?vuosi=${input.bookedOn.slice(0, 4)}${editing ? "" : "&syotto=lomake&lisatty=1"}`);
}

const gridRowSchema = z.object({
  key: z.string().max(60),
  id: z.string().uuid().nullable(),
  bookedOn: z.string().max(40),
  description: z.string().max(2000),
  category: z.string().max(100),
  amountGross: z.string().max(40),
  vatRate: z.string().max(40),
  withholding: z.string().max(40),
  forestPropertyId: z.string().max(400),
  kind: z.enum(["", "income", "expense", "investment"]),
  reference: z.string().max(400),
  assetRatePct: z.string().max(10),
  saleAssetId: z.string().max(60),
});

const gridPayloadSchema = z.object({
  rows: z.array(gridRowSchema).max(MAX_GRID_ROWS),
  deletedIds: z.array(z.string().uuid()).max(MAX_GRID_ROWS),
});

/**
 * Kirjanpidon taulukko: koko vuoden muutokset yhdessä transaktiossa.
 * Palauttaa tilan eikä ohjaa uudelleen, koska rivikohtaiset virheet ja syötetyt
 * arvot eivät mahdu URL-osoitteeseen (eikä henkilötietoa saa sinne). Onnistuessa
 * palautetaan vuoden rivit kannasta, jotta uudet rivit saavat tunnisteensa.
 */
export async function saveLedgerGridAction(formData: FormData): Promise<GridSaveState> {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const year = z.coerce.number().int().min(2000).max(2100).parse(formData.get("year"));
  let payload: z.infer<typeof gridPayloadSchema>;
  try {
    payload = gridPayloadSchema.parse(JSON.parse(String(formData.get("payload") ?? "{}")));
  } catch {
    return { status: "error", message: "Taulukon tietoja ei voitu lukea. Tarkista rivit.", rowErrors: {} };
  }
  const actor = { organizationId: ctx.org.organizationId, userId: ctx.user.id };
  try {
    const counts = await ctx.run((tx) => saveLedgerGrid(tx, { actor, clientId, year, rows: payload.rows, deletedIds: payload.deletedIds }));
    const rows = await ctx.run((tx) => listTransactions(tx, clientId, year));
    revalidatePath(`/asiakkaat/${clientId}/kirjanpito`);
    return { status: "saved", ...counts, rows: rows.map(rowFromStored) };
  } catch (err) {
    if (err instanceof GridSaveError) return { status: "error", message: err.message, rowErrors: err.rowErrors };
    const f = friendly(err);
    if (f) return { status: "error", message: f, rowErrors: {} };
    throw err;
  }
}

export async function deleteTransactionAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const id = uuid.parse(formData.get("transactionId"));
  const back = `/asiakkaat/${clientId}/kirjanpito/${id}`;
  let year = 0;
  try {
    year = await ctx.run((tx) => deleteTransaction(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id }, clientId, id));
  } catch (err) {
    if (err instanceof LedgerError) fail(back, err.message);
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
