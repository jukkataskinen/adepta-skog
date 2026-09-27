import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { documentPath, getStorage } from "@/lib/storage";

/**
 * Vuoden tositteet: kirjanpitäjän lisäämä tositeaineisto (esimerkiksi
 * skannattu PDF), joka ei kuulu yhteen kirjaukseen. Tallennetaan
 * sk_documents-tauluun lajilla receipt ilman kirjausta, ja lopullisen
 * raportin liitteeksi tulevat sekä nämä että kirjauskohtaiset tositteet.
 *
 * Lataus kulkee kahdessa vaiheessa, koska iso tiedosto ei mahdu palvelimen
 * kautta: 1) palvelin tarkistaa oikeuden ja avoimen vuoden ja antaa
 * latausosoitteen, 2) kun selain on ladannut tiedoston, palvelin tarkistaa,
 * että se on perillä, ja kirjaa sen kantaan ja lokiin.
 */

export const YEAR_RECEIPT_MAX_BYTES = 25 * 1024 * 1024;
export const YEAR_RECEIPT_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export interface PlannedUpload {
  id: string;
  fileName: string;
  contentType: string;
  storagePath: string;
  url: string;
  form: boolean;
}

export class ReceiptError extends Error {}

async function requireOpenYear(tx: Sql, clientId: string, year: number) {
  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (!y) throw new ReceiptError(`Verovuotta ${year} ei ole avattu.`);
  if (y.status === "closed") throw new ReceiptError(`Verovuosi ${year} on suljettu, joten tositteita ei voi lisätä.`);
}

/** Vaihe 1. Käyttäjän RLS-transaktiossa: asiakas näkyy vain, jos käyttäjällä on siihen oikeus. */
export async function planYearReceipts(
  tx: Sql,
  input: { organizationId: string; clientId: string; year: number; files: { name: string; size: number; type: string }[] },
): Promise<PlannedUpload[]> {
  const [client] = await tx.query("select 1 from sk_clients where id = $1 and organization_id = $2", [input.clientId, input.organizationId]);
  if (!client) throw new ReceiptError("Asiakasta ei löytynyt.");
  await requireOpenYear(tx, input.clientId, input.year);
  if (!input.files.length) throw new ReceiptError("Valitse vähintään yksi tiedosto.");
  if (input.files.length > 20) throw new ReceiptError("Lisää kerralla enintään 20 tiedostoa.");
  const storage = getStorage();
  const out: PlannedUpload[] = [];
  for (const f of input.files) {
    if (!YEAR_RECEIPT_TYPES.includes(f.type)) throw new ReceiptError(`${f.name}: tositteen on oltava PDF, JPG tai PNG.`);
    if (f.size <= 0 || f.size > YEAR_RECEIPT_MAX_BYTES) throw new ReceiptError(`${f.name}: tiedoston enimmäiskoko on 25 Mt.`);
    const id = randomUUID();
    const fileName = f.name.slice(0, 200) || "tosite";
    const storagePath = documentPath(input.organizationId, input.clientId, input.year, id, fileName);
    out.push({ id, fileName, contentType: f.type, storagePath, ...(await storage.createUploadUrl(storagePath)) });
  }
  return out;
}

/**
 * Vaihe 2. Polku lasketaan uudelleen palvelimella tunnisteesta ja nimestä,
 * joten selain ei voi kirjata toisen asiakkaan tai vuoden tiedostoa.
 */
export async function confirmYearReceipts(
  tx: Sql,
  input: { organizationId: string; clientId: string; year: number; userId: string; uploads: { id: string; fileName: string; contentType: string }[] },
): Promise<number> {
  await requireOpenYear(tx, input.clientId, input.year);
  const storage = getStorage();
  let saved = 0;
  for (const u of input.uploads) {
    if (!YEAR_RECEIPT_TYPES.includes(u.contentType)) throw new ReceiptError("Tiedostotyyppi ei kelpaa.");
    const storagePath = documentPath(input.organizationId, input.clientId, input.year, u.id, u.fileName);
    const size = await storage.size(storagePath);
    if (size === null) throw new ReceiptError(`${u.fileName}: tiedosto ei tallentunut. Yritä uudelleen.`);
    if (size > YEAR_RECEIPT_MAX_BYTES) {
      await storage.remove(storagePath);
      throw new ReceiptError(`${u.fileName}: tiedoston enimmäiskoko on 25 Mt.`);
    }
    const ins = await tx.query(
      `insert into sk_documents (id, organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path, created_by)
       values ($1,$2,$3,$4,'receipt',$5,$6,$7,$8,$9) on conflict (storage_path) do nothing returning id`,
      [u.id, input.organizationId, input.clientId, input.year, u.fileName.slice(0, 200), u.contentType, size, storagePath, input.userId],
    );
    if (ins.length) {
      saved++;
      await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "document.upload", entity: "sk_documents", entityId: u.id, details: { year: input.year } });
    }
  }
  return saved;
}

export interface YearReceipt {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export async function listYearReceipts(tx: Sql, clientId: string, year: number): Promise<YearReceipt[]> {
  return tx.query<YearReceipt>(
    `select id, file_name, content_type, size_bytes, created_at::text from sk_documents
      where client_id = $1 and tax_year = $2 and kind = 'receipt' and transaction_id is null order by created_at`,
    [clientId, year],
  );
}
