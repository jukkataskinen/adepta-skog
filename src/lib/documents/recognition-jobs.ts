import { z } from "zod";
import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import type { ChunkRange } from "@/lib/ai/receipts/chunks";
import { mergeChunkResults } from "@/lib/ai/receipts/merge";
import { chunkLineSchema, type ChunkLine, type SuggestionLine } from "@/lib/ai/receipts/schema";
import type { Activity } from "@/lib/tax/rules";
import { splitByActivity, SuggestionError, type Actor } from "./receipt-suggestions";

/**
 * Kesken oleva tunnistus osissa (migraatio 0012). Ehdotusrivi tilassa
 * 'processing' pitää palojen tilan ja tulokset, jotta tunnistusta voi jatkaa
 * keskeytyksen jälkeen. Kun palat on luettu, tulokset yhdistetään yhdeksi
 * odottavaksi ehdotukseksi (tila 'pending'), jota taulukko ja hyväksyntä
 * käsittelevät kuten ennenkin. Kaikki funktiot ajetaan käyttäjän RLS-transaktiossa.
 */

export type ChunkStatus = "waiting" | "done" | "failed";

export interface JobChunk {
  first: number;
  last: number;
  status: ChunkStatus;
  attempts: number;
}

export interface RecognitionJob {
  id: string;
  documentId: string;
  pageCount: number;
  chunks: JobChunk[];
  /** Oletustoiminto: näkymä, josta tunnistus aloitettiin (0016). */
  activity: Activity;
}

const storedChunkSchema = z.object({
  first: z.number().int(),
  last: z.number().int(),
  status: z.enum(["waiting", "done", "failed"]),
  attempts: z.number().int().default(0),
  lines: z.array(z.unknown()).default([]),
});

type StoredChunk = z.infer<typeof storedChunkSchema>;

function parseChunks(raw: unknown): StoredChunk[] {
  const v = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    const p = storedChunkSchema.safeParse(c);
    return p.success ? [p.data] : [];
  });
}

const publicChunks = (chunks: StoredChunk[]): JobChunk[] => chunks.map(({ first, last, status, attempts }) => ({ first, last, status, attempts }));

function chunkLines(c: StoredChunk): ChunkLine[] {
  return c.lines.flatMap((l) => {
    const p = chunkLineSchema.safeParse(l);
    return p.success ? [p.data] : [];
  });
}

interface JobRow {
  id: string;
  document_id: string;
  page_count: number | null;
  chunks: unknown;
  activity: Activity;
  tax_year: number;
  model: string;
}

const JOB_COLUMNS = "id, document_id, page_count, chunks, activity, tax_year, model";

async function loadJob(tx: Sql, clientId: string, jobId: string, lock = false): Promise<JobRow> {
  const [row] = await tx.query<JobRow>(
    `select ${JOB_COLUMNS} from sk_receipt_suggestions
      where id = $1 and client_id = $2 and status = 'processing'${lock ? " for update" : ""}`,
    [jobId, clientId],
  );
  if (!row) throw new SuggestionError("Tunnistus on jo valmis tai se aloitettiin uudelleen. Lataa sivu uudelleen.");
  return row;
}

const toJob = (row: JobRow): RecognitionJob => ({
  id: row.id, documentId: row.document_id, pageCount: row.page_count ?? 0, chunks: publicChunks(parseChunks(row.chunks)), activity: row.activity,
});

/** Tositteen kesken oleva tunnistus tai null. */
export async function findRecognitionJob(tx: Sql, clientId: string, documentId: string): Promise<RecognitionJob | null> {
  const [row] = await tx.query<JobRow>(
    `select ${JOB_COLUMNS} from sk_receipt_suggestions where client_id = $1 and document_id = $2 and status = 'processing'`,
    [clientId, documentId],
  );
  return row ? toJob(row) : null;
}

/**
 * Aloittaa tunnistuksen tai jatkaa kesken jäänyttä. Jatkaminen edellyttää, että
 * palasuunnitelma on sama (sama tiedosto ja samat palat); muuten ja pyydettäessä
 * (restart) kesken jäänyt poistetaan ja aloitetaan alusta. Tarkistukset
 * (oikeus, avoin vuosi, tosite) tehdään ennen tätä: recognizableDocument.
 */
export async function startRecognitionJob(
  tx: Sql,
  input: {
    actor: Actor; clientId: string; year: number; documentId: string; pageCount: number; chunks: ChunkRange[]; model: string; restart?: boolean;
    /** Oletustoiminto. Puuttuva = metsätalous kuten ennen. */
    activity?: Activity;
  },
): Promise<{ job: RecognitionJob; resumed: boolean }> {
  const existing = await findRecognitionJob(tx, input.clientId, input.documentId);
  const samePlan =
    existing &&
    existing.pageCount === input.pageCount &&
    existing.chunks.length === input.chunks.length &&
    existing.chunks.every((c, i) => c.first === input.chunks[i].first && c.last === input.chunks[i].last);
  if (existing && samePlan && !input.restart) return { job: existing, resumed: true };
  if (existing) await tx.query("delete from sk_receipt_suggestions where id = $1 and status = 'processing'", [existing.id]);
  const chunks: StoredChunk[] = input.chunks.map((c) => ({ first: c.first, last: c.last, status: "waiting", attempts: 0, lines: [] }));
  const [row] = await tx.query<JobRow>(
    `insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, status, model, page_count, chunks, created_by, activity)
     values ($1,$2,$3,$4,'[]'::jsonb,'processing',$5,$6,$7::jsonb,$8,$9) returning ${JOB_COLUMNS}`,
    [input.actor.organizationId, input.clientId, input.documentId, input.year, input.model.slice(0, 100), input.pageCount, JSON.stringify(chunks), input.actor.userId,
      input.activity ?? "forestry"],
  );
  // Lokiin vain tunnisteet ja määrät.
  await audit(tx, {
    organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_recognition.start", entity: "sk_receipt_suggestions",
    entityId: row.id, details: { document: input.documentId, pages: input.pageCount, chunks: input.chunks.length, model: input.model },
  });
  return { job: toJob(row), resumed: false };
}

/** Palan tiedot tunnistusta varten: sivualue ja koko tiedoston sivumäärä. */
export async function jobChunk(
  tx: Sql,
  input: { clientId: string; jobId: string; index: number },
): Promise<{ documentId: string; chunk: ChunkRange; status: ChunkStatus; attempts: number; activity: Activity }> {
  const row = await loadJob(tx, input.clientId, input.jobId);
  const c = parseChunks(row.chunks)[input.index];
  if (!c) throw new SuggestionError("Tunnistuksen osaa ei löytynyt. Lataa sivu uudelleen.");
  return {
    documentId: row.document_id, chunk: { first: c.first, last: c.last, total: row.page_count ?? 0 }, status: c.status, attempts: c.attempts, activity: row.activity,
  };
}

/** Kesken olevan tunnistuksen peruutus. Palauttaa false, jos se oli jo valmis tai poistettu. */
export async function cancelRecognitionJob(tx: Sql, input: { clientId: string; jobId: string }): Promise<boolean> {
  const rows = await tx.query("delete from sk_receipt_suggestions where id = $1 and client_id = $2 and status = 'processing' returning id", [input.jobId, input.clientId]);
  return rows.length > 0;
}

/**
 * Tallentaa palan tuloksen. Päivitys tehdään yhdellä lauseella (jsonb_set),
 * jotta kaksi rinnakkain luettua palaa eivät kirjoita toistensa tuloksia yli.
 * Valmista palaa ei korvata epäonnistumisella.
 */
export async function storeChunkResult(
  tx: Sql,
  input: { clientId: string; jobId: string; index: number; result: { ok: true; lines: SuggestionLine[] } | { ok: false } },
): Promise<JobChunk> {
  const row = await loadJob(tx, input.clientId, input.jobId, true);
  const c = parseChunks(row.chunks)[input.index];
  if (!c) throw new SuggestionError("Tunnistuksen osaa ei löytynyt. Lataa sivu uudelleen.");
  if (c.status === "done" && !input.result.ok) return publicChunks([c])[0];
  const next: StoredChunk = {
    ...c,
    attempts: c.attempts + 1,
    status: input.result.ok ? "done" : "failed",
    lines: input.result.ok ? input.result.lines : [],
  };
  await tx.query("update sk_receipt_suggestions set chunks = jsonb_set(chunks, $2::text[], $3::jsonb) where id = $1", [
    input.jobId, [String(input.index)], JSON.stringify(next),
  ]);
  return publicChunks([next])[0];
}

export type FinishOutcome =
  | { status: "done"; suggestionId: string; lines: number; byActivity: Partial<Record<Activity, number>> }
  | { status: "incomplete"; chunks: JobChunk[] }
  | { status: "empty" };

/**
 * Yhdistää palojen tulokset yhdeksi ehdotukseksi. Jos jokin pala on vielä
 * lukematta tai epäonnistui, palautetaan palojen tila (käyttäjä voi yrittää
 * uudelleen), ellei allowPartial ole annettu: silloin ehdotus tehdään luetuista
 * sivuista. Tositteen edellinen odottava ehdotus hylätään kuten storeSuggestion.
 *
 * Rivit jaetaan toiminnoittain (0016): oletustoiminnon rivit jäävät tähän
 * ehdotukseen, ja toisen toiminnon riveistä tulee oma odottava ehdotus samalle
 * tositteelle. Kumpikin kirjanpidon näkymä käsittelee omansa.
 */
export async function finishRecognitionJob(
  tx: Sql,
  input: { actor: Actor; clientId: string; jobId: string; allowPartial?: boolean },
): Promise<FinishOutcome> {
  const row = await loadJob(tx, input.clientId, input.jobId, true);
  const chunks = parseChunks(row.chunks);
  const waiting = chunks.some((c) => c.status === "waiting");
  const failed = chunks.some((c) => c.status === "failed");
  if (waiting || (failed && !input.allowPartial)) return { status: "incomplete", chunks: publicChunks(chunks) };
  const total = row.page_count ?? 0;
  const lines = mergeChunkResults(chunks.filter((c) => c.status === "done").map((c) => ({ first: c.first, last: c.last, total, lines: chunkLines(c) })));
  if (!lines.length) {
    await tx.query("delete from sk_receipt_suggestions where id = $1 and status = 'processing'", [row.id]);
    return { status: "empty" };
  }
  await tx.query(
    "update sk_receipt_suggestions set status = 'dismissed', decided_by = $2, decided_at = now() where document_id = $1 and status = 'pending'",
    [row.document_id, input.actor.userId],
  );
  const groups = splitByActivity(lines, row.activity);
  const [own, ...others] = groups;
  await tx.query("update sk_receipt_suggestions set status = 'pending', lines = $2::jsonb, chunks = null, activity = $3 where id = $1", [
    row.id, JSON.stringify(own.lines), own.activity,
  ]);
  const skipped = chunks.filter((c) => c.status === "failed").length;
  await audit(tx, {
    organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_suggestion.create", entity: "sk_receipt_suggestions",
    entityId: row.id, details: { document: row.document_id, lines: own.lines.length, pages: total, chunks: chunks.length, skippedChunks: skipped, activity: own.activity },
  });
  for (const g of others) {
    const [created] = await tx.query<{ id: string }>(
      `insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model, created_by, page_count, activity)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) returning id`,
      [input.actor.organizationId, input.clientId, row.document_id, row.tax_year, JSON.stringify(g.lines), row.model, input.actor.userId, row.page_count, g.activity],
    );
    await audit(tx, {
      organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_suggestion.create", entity: "sk_receipt_suggestions",
      entityId: created.id, details: { document: row.document_id, lines: g.lines.length, activity: g.activity },
    });
  }
  return { status: "done", suggestionId: row.id, lines: lines.length, byActivity: Object.fromEntries(groups.map((g) => [g.activity, g.lines.length])) };
}
