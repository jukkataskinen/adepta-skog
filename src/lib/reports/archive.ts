import { randomUUID } from "node:crypto";
import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { documentPath, getStorage } from "@/lib/storage";
import { loadReportData } from "./data";
import { renderTaxReport } from "./pdf";

/**
 * Suljetun vuoden veroraportti arkistoon. Kutsutaan samassa transaktiossa kuin
 * vuoden sulkeminen: jos raportin tallennus epäonnistuu, vuosi jää avoimeksi.
 * Uudelleen suljettaessa syntyy uusi versio, vanha säilyy arkistossa.
 */
export async function archiveReport(tx: Sql, input: { organizationId: string; clientId: string; year: number; userId: string }): Promise<string> {
  const data = await loadReportData(tx, input.organizationId, input.clientId, input.year);
  if (!data) throw new Error("Raportin tiedot puuttuvat");
  const bytes = Buffer.from(await renderTaxReport(data));
  const id = randomUUID();
  const fileName = `veroraportti_${input.year}.pdf`;
  const storagePath = documentPath(input.organizationId, input.clientId, input.year, id, fileName);
  await tx.query(
    `insert into sk_documents (id, organization_id, client_id, tax_year, kind, file_name, content_type, size_bytes, storage_path, created_by)
     values ($1,$2,$3,$4,'report',$5,'application/pdf',$6,$7,$8)`,
    [id, input.organizationId, input.clientId, input.year, fileName, bytes.length, storagePath, input.userId],
  );
  await audit(tx, { organizationId: input.organizationId, userId: input.userId, action: "report.archive", entity: "sk_documents", entityId: id, details: { year: input.year } });
  await getStorage().put(storagePath, bytes, "application/pdf");
  return id;
}
