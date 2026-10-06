import type { Sql } from "@/lib/db/types";
import { parseStoredLines, suggestionAnchor } from "@/lib/ai/receipts/schema";
import { ACTIVITY_PARAM, type Activity } from "@/lib/tax/rules";

/**
 * Asiakkaan kaikki odottavat tunnistuksen ehdotukset kaikilta vuosilta ja
 * molemmista toiminnoista (DECISIONS 6.10.2026, odottavat tositteet).
 * Kirjanpidon taulukko näyttää ehdotukset vain oman vuotensa ja toimintonsa
 * näkymässä, joten tämä kooste näkyy sivun yläosassa, jotta keskeneräinen työ
 * ei katoa näkyvistä, kun näkymä tai vuosi vaihtuu. Käyttäjän RLS-transaktiossa.
 */
export interface PendingOverviewItem {
  suggestionId: string;
  documentId: string;
  fileName: string;
  year: number;
  activity: Activity;
  lineCount: number;
  /** Rivien summat yhteensä (sis. alv). */
  totalGross: number;
  /** Sivut, joilla rivit ovat (järjestettynä, ilman toistoja). */
  pages: number[];
  createdAt: string;
}

export async function listClientPendingOverview(tx: Sql, clientId: string): Promise<PendingOverviewItem[]> {
  const rows = await tx.query<{ id: string; document_id: string; file_name: string; tax_year: number; activity: Activity; lines: unknown; created_at: string | Date }>(
    `select s.id, s.document_id, d.file_name, s.tax_year, s.activity, s.lines, s.created_at from sk_receipt_suggestions s
       join sk_documents d on d.id = s.document_id
      where s.client_id = $1 and s.status = 'pending' and d.transaction_id is null
      order by s.created_at desc, s.id`,
    [clientId],
  );
  return rows.flatMap((r) => {
    const lines = parseStoredLines(typeof r.lines === "string" ? JSON.parse(r.lines) : r.lines);
    if (!lines.length) return [];
    const total = lines.reduce((s, l) => s + l.amountGross, 0);
    return [
      {
        suggestionId: r.id,
        documentId: r.document_id,
        fileName: r.file_name,
        year: Number(r.tax_year),
        activity: r.activity,
        lineCount: lines.length,
        totalGross: Math.round(total * 100) / 100,
        pages: [...new Set(lines.flatMap((l) => l.pages))].sort((x, y) => x - y),
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      },
    ];
  });
}

/** Odottavia tositteita (eri tiedostoja) asiakkaalla; Tiedot-sivun ja asiakaslistan merkintään. */
export async function countClientPendingReceipts(tx: Sql, clientId: string): Promise<number> {
  const [r] = await tx.query<{ n: number }>(
    `select count(distinct s.document_id)::int as n from sk_receipt_suggestions s
       join sk_documents d on d.id = s.document_id
      where s.client_id = $1 and s.status = 'pending' and d.transaction_id is null`,
    [clientId],
  );
  return r?.n ?? 0;
}

/**
 * Kirjanpidon osoite, joka vie ehdotuksen vuoteen ja toimintoon ja sen rivien
 * kohdalle (ankkuri LedgerGridissä). Toimintoparametri vain, kun asiakkaalla on
 * molemmat toiminnot; muuten näkymä määräytyy asiakkaasta (ledgerView).
 */
export function pendingSuggestionHref(clientId: string, item: Pick<PendingOverviewItem, "year" | "activity" | "suggestionId">, both: boolean): string {
  const act = both && item.activity === "agriculture" ? `&toiminta=${ACTIVITY_PARAM.agriculture}` : "";
  return `/asiakkaat/${clientId}/kirjanpito?vuosi=${item.year}${act}#${suggestionAnchor(item.suggestionId)}`;
}
