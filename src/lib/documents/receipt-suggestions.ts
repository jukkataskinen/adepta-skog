import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { isCompilation, lineActivity, parseStoredLines, type SuggestionLine } from "@/lib/ai/receipts/schema";
import type { Activity } from "@/lib/tax/rules";

/**
 * Tositteiden tunnistuksen ehdotukset kannassa (migraatio 0010). Tunnistus
 * itse (tekoäly) on src/lib/ai/receipts; tämä moduuli tarkistaa oikeudet ja
 * vuoden, tallentaa ehdotukset ja käsittelee hyväksynnän ja hylkäyksen.
 * Kaikki funktiot ajetaan käyttäjän RLS-transaktiossa.
 */

export class SuggestionError extends Error {}

export interface Actor {
  organizationId: string;
  userId: string;
}

export interface RecognizableDocument {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
}

async function requireOpenYear(tx: Sql, clientId: string, year: number) {
  const [y] = await tx.query<{ status: string }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  if (!y) throw new SuggestionError(`Verovuotta ${year} ei ole avattu.`);
  if (y.status === "closed") throw new SuggestionError(`Verovuosi ${year} on suljettu, joten tositteita ei tunnisteta.`);
}

/**
 * Tunnistettava tosite: vuoden tosite (ei vielä kirjauksella), avoin vuosi.
 * Tarkistus tehdään ennen kuin tiedosto haetaan ja lähetetään tunnistukseen.
 */
export async function recognizableDocument(tx: Sql, input: { clientId: string; year: number; documentId: string }): Promise<RecognizableDocument> {
  await requireOpenYear(tx, input.clientId, input.year);
  const [d] = await tx.query<RecognizableDocument>(
    `select id, file_name, content_type, size_bytes, storage_path from sk_documents
      where id = $1 and client_id = $2 and tax_year = $3 and kind = 'receipt' and transaction_id is null`,
    [input.documentId, input.clientId, input.year],
  );
  if (!d) throw new SuggestionError("Tositetta ei löytynyt, tai se on jo liitetty kirjaukseen.");
  return d;
}

/**
 * Ehdotuksen rivit toiminnoittain (0016): rivin toiminto tulee sen luokasta.
 * Oletustoiminnon ryhmä on ensin, jos siinä on rivejä. Rivien järjestys säilyy
 * ryhmän sisällä. Tyhjiä ryhmiä ei palauteta.
 */
export function splitByActivity(lines: SuggestionLine[], first: Activity = "forestry"): { activity: Activity; lines: SuggestionLine[] }[] {
  const order: Activity[] = first === "agriculture" ? ["agriculture", "forestry"] : ["forestry", "agriculture"];
  return order.map((activity) => ({ activity, lines: lines.filter((l) => lineActivity(l) === activity) })).filter((g) => g.lines.length > 0);
}

/**
 * Tallentaa ehdotuksen. Tositteen edellinen odottava ehdotus hylätään, koska uusi korvaa sen.
 * Rivit jaetaan toiminnoittain omiksi ehdotuksiksi kuten osissa luetussa tunnistuksessa.
 * Palauttaa ensimmäisen (oletustoiminnon) ehdotuksen tunnisteen.
 */
export async function storeSuggestion(
  tx: Sql,
  input: { actor: Actor; clientId: string; year: number; documentId: string; lines: SuggestionLine[]; model: string; activity?: Activity },
): Promise<string> {
  await requireOpenYear(tx, input.clientId, input.year);
  await tx.query(
    "update sk_receipt_suggestions set status = 'dismissed', decided_by = $2, decided_at = now() where document_id = $1 and status = 'pending'",
    [input.documentId, input.actor.userId],
  );
  // Tyhjä rivilista menee kantaan sellaisenaan, jotta kannan tarkistus hylkää sen kuten ennen.
  const groups = input.lines.length ? splitByActivity(input.lines, input.activity) : [{ activity: input.activity ?? "forestry", lines: [] }];
  const ids: string[] = [];
  for (const g of groups) {
    const [row] = await tx.query<{ id: string }>(
      `insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model, created_by, activity)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [input.actor.organizationId, input.clientId, input.documentId, input.year, JSON.stringify(g.lines), input.model.slice(0, 100), input.actor.userId, g.activity],
    );
    // Lokiin vain tunnisteet ja määrä, ei summia eikä selitteitä.
    await audit(tx, {
      organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_suggestion.create", entity: "sk_receipt_suggestions",
      entityId: row.id, details: { document: input.documentId, lines: g.lines.length, model: input.model, activity: g.activity },
    });
    ids.push(row.id);
  }
  return ids[0];
}

export interface PendingSuggestion {
  id: string;
  document_id: string;
  file_name: string;
  model: string;
  /** Ehdotuksen toiminto (0016): kaikki rivit ovat tämän toiminnon. */
  activity: Activity;
  lines: SuggestionLine[];
}

/** Vuoden odottavat ehdotukset. Näkymä (activity) rajaa ne yhteen toimintoon; null = kaikki. */
export async function listPendingSuggestions(tx: Sql, clientId: string, year: number, activity: Activity | null = null): Promise<PendingSuggestion[]> {
  const rows = await tx.query<Omit<PendingSuggestion, "lines"> & { lines: unknown }>(
    `select s.id, s.document_id, d.file_name, s.model, s.activity, s.lines from sk_receipt_suggestions s
       join sk_documents d on d.id = s.document_id
      where s.client_id = $1 and s.tax_year = $2 and s.status = 'pending' and d.transaction_id is null
        and ($3::text is null or s.activity = $3::text)
      order by s.created_at, s.id`,
    [clientId, year, activity],
  );
  return rows
    .map((r) => ({ ...r, lines: parseStoredLines(typeof r.lines === "string" ? JSON.parse(r.lines) : r.lines) }))
    .filter((r) => r.lines.length > 0);
}

/** Hylkää ehdotuksen. Palauttaa false, jos ehdotus oli jo käsitelty. */
export async function dismissSuggestion(tx: Sql, input: { actor: Actor; clientId: string; suggestionId: string; details?: Record<string, unknown> }): Promise<boolean> {
  const rows = await tx.query(
    "update sk_receipt_suggestions set status = 'dismissed', decided_by = $3, decided_at = now() where id = $1 and client_id = $2 and status = 'pending' returning id",
    [input.suggestionId, input.clientId, input.actor.userId],
  );
  if (!rows.length) return false;
  await audit(tx, {
    organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_suggestion.dismiss", entity: "sk_receipt_suggestions",
    entityId: input.suggestionId, details: input.details,
  });
  return true;
}

export interface LockedSuggestion {
  documentId: string;
  lines: SuggestionLine[];
}

/**
 * Taulukon tallennuksen osa: ehdotukset, joiden rivejä tallennetaan. Kaikkien on
 * oltava vielä odottavia ja samalta asiakkaalta ja vuodelta; muuten joku on
 * käsitellyt ne toisaalla, ja tallennus perutaan, jotta kirjauksia ei synny kahdesti.
 * Rivit luetaan kannasta, jotta sivut ja lähdeasiakirja tulevat tallennetusta
 * ehdotuksesta eivätkä selaimelta.
 */
export async function lockPendingSuggestions(tx: Sql, clientId: string, year: number, ids: string[]): Promise<Map<string, LockedSuggestion>> {
  const out = new Map<string, LockedSuggestion>();
  if (!ids.length) return out;
  const rows = await tx.query<{ id: string; document_id: string; lines: unknown }>(
    "select id, document_id, lines from sk_receipt_suggestions where id = any($1::uuid[]) and client_id = $2 and tax_year = $3 and status = 'pending' for update",
    [ids, clientId, year],
  );
  for (const r of rows) out.set(r.id, { documentId: r.document_id, lines: parseStoredLines(typeof r.lines === "string" ? JSON.parse(r.lines) : r.lines) });
  if (out.size !== new Set(ids).size) throw new SuggestionError("Ehdotus on jo käsitelty toisaalla. Lataa sivu uudelleen.");
  return out;
}

/** Ehdotuksesta syntynyt kirjaus ja ehdotuksen rivi, josta se tehtiin (null, jos tuntematon). */
export interface CreatedFromSuggestion {
  transactionId: string;
  line: number | null;
}

/**
 * Hyväksyy ehdotuksen.
 *
 * Yhden asiakirjan tiedosto liitetään ensimmäiseen ehdotuksesta syntyneeseen
 * kirjaukseen kuten ennenkin, jolloin se on kirjauksen tosite eikä enää vuoden
 * tosite. Saman tiedoston muut kirjaukset (esimerkiksi puukaupan mittauskulut)
 * saavat viittauksen tiedostoon ja sivuihin, koska sama tiedosto voi kuulua
 * vain yhteen kirjaukseen.
 *
 * Kokoomatiedosto (rivit useasta eri asiakirjasta) jää vuoden tositteeksi, eikä
 * sitä liitetä mihinkään kirjaukseen: jokainen kirjaus saa viittauksen
 * tiedostoon ja omiin sivuihinsa. Näin raportin liitteissä tiedosto on kerran
 * vuoden aineistona, ja kirjauksesta pääsee oikealle sivulle.
 */
export async function acceptSuggestion(
  tx: Sql,
  input: {
    actor: Actor;
    clientId: string;
    suggestionId: string;
    documentId: string;
    lines: SuggestionLine[];
    created: CreatedFromSuggestion[];
    /** Osa riveistä jää odottamaan (requeueSuggestionLines): tiedosto jää vuoden tositteeksi. */
    partial?: boolean;
  },
): Promise<{ compilation: boolean }> {
  // Tiedosto, jonka rivit jaettiin toiminnoittain kahdeksi ehdotukseksi, käsitellään kuten
  // kokoomatiedosto: se jää vuoden tositteeksi, ja kummankin toiminnon kirjaukset viittaavat siihen.
  // Samoin tiedosto, jonka ehdotuksesta osa on jo hyväksytty (hyväksyntä riveittäin).
  const [sibling] = await tx.query(
    `select 1 from sk_receipt_suggestions where document_id = $1 and id <> $2
        and (status = 'accepted' or (status = 'pending' and activity <> (select activity from sk_receipt_suggestions where id = $2))) limit 1`,
    [input.documentId, input.suggestionId],
  );
  // Osittain hyväksytty ehdotus käsitellään kuten kokoomatiedosto, jotta odottamaan
  // jääneet rivit näkyvät yhä (vuoden tosite, ei kirjauksen liite).
  const compilation = isCompilation(input.lines) || Boolean(sibling) || input.partial === true;
  const [first, ...rest] = input.created;
  if (first && !compilation) {
    await tx.query("update sk_documents set transaction_id = $1 where id = $2 and client_id = $3 and transaction_id is null", [
      first.transactionId, input.documentId, input.clientId,
    ]);
  }
  for (const c of compilation ? input.created : rest) {
    const pages = c.line !== null ? (input.lines[c.line]?.pages ?? []) : [];
    await tx.query("update sk_transactions set source_document_id = $1, source_pages = $2::smallint[] where id = $3 and client_id = $4", [
      input.documentId, pages.length ? pages : null, c.transactionId, input.clientId,
    ]);
  }
  await tx.query("update sk_receipt_suggestions set status = 'accepted', decided_by = $2, decided_at = now() where id = $1", [
    input.suggestionId, input.actor.userId,
  ]);
  await audit(tx, {
    organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_suggestion.accept", entity: "sk_receipt_suggestions",
    entityId: input.suggestionId, details: { document: input.documentId, transactions: input.created.map((c) => c.transactionId), compilation, partial: input.partial === true },
  });
  return { compilation };
}

/**
 * Hyväksyntä riveittäin (DECISIONS 2.10.2026, maatalouden tositteiden
 * tunnistus): odottamaan jätetyt rivit tallennetaan uudeksi odottavaksi
 * ehdotukseksi samalle tositteelle ja toiminnolle. Rivit otetaan hyväksytystä
 * ehdotuksesta kannasta (ei selaimelta), joten taulukossa tehdyt muutokset
 * odottaviin riveihin eivät säily. Kutsutaan acceptSuggestion-funktion jälkeen,
 * kun alkuperäinen ehdotus ei enää ole odottava. Palauttaa uuden ehdotuksen tunnisteen.
 */
export async function requeueSuggestionLines(
  tx: Sql,
  input: { actor: Actor; clientId: string; suggestionId: string; lines: SuggestionLine[] },
): Promise<string | null> {
  if (!input.lines.length) return null;
  const [row] = await tx.query<{ id: string }>(
    `insert into sk_receipt_suggestions (organization_id, client_id, document_id, tax_year, lines, model, created_by, activity)
     select organization_id, client_id, document_id, tax_year, $3, model, $4, activity from sk_receipt_suggestions
      where id = $1 and client_id = $2 and status = 'accepted'
     returning id`,
    [input.suggestionId, input.clientId, JSON.stringify(input.lines), input.actor.userId],
  );
  if (!row) throw new SuggestionError("Ehdotusta ei voitu jättää odottamaan. Lataa sivu uudelleen.");
  // Lokiin vain tunnisteet ja määrä.
  await audit(tx, {
    organizationId: input.actor.organizationId, userId: input.actor.userId, action: "receipt_suggestion.requeue", entity: "sk_receipt_suggestions",
    entityId: row.id, details: { from: input.suggestionId, lines: input.lines.length },
  });
  return row.id;
}
