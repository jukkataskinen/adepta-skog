import type { Sql } from "@/lib/db/types";
import { activitiesOf, type Activity, type TransactionKind } from "@/lib/tax/rules";
import {
  buildPostingMemory,
  normalizeDescription,
  postingHints,
  postingLabel,
  suggestPosting,
  type PostingEntry,
  type PostingMemory,
  type PostingSuggestion,
} from "@/lib/ledger/posting-memory";

/**
 * Tiliöintimuistin kantahaku (DECISIONS 6.10.2026). Aina käyttäjän
 * RLS-transaktiossa, ja jokainen kysely rajataan lisäksi organisaatioon:
 * toisen toimiston kirjauksia ei voi tulla muistiin, vaikka kutsuja
 * erehtyisi asiakkaasta. Muisti rakennetaan pyynnön ajaksi; uutta taulua ei ole.
 */

interface Row {
  client_id: string;
  booked_on: string;
  category: string;
  kind: TransactionKind;
  description: string | null;
  reference: string | null;
  amount_gross: string;
  vat_rate: string;
  business_share_pct: string;
  other_share_pct: string;
  farm_id: string | null;
}

const COLUMNS = `client_id, booked_on::text, category, kind, description, reference, amount_gross, vat_rate, business_share_pct, other_share_pct, farm_id`;

const toEntry = (r: Row): PostingEntry => ({
  clientId: r.client_id,
  bookedOn: r.booked_on,
  category: r.category,
  kind: r.kind,
  description: r.description ?? "",
  reference: r.reference,
  amountGross: Number(r.amount_gross),
  vatRate: Number(r.vat_rate),
  businessSharePct: Number(r.business_share_pct),
  otherSharePct: Number(r.other_share_pct),
  farmId: r.farm_id,
});

export interface MemoryScope {
  organizationId: string;
  clientId: string;
}

/**
 * Asiakkaan koko historia yhdellä kyselyllä (indeksi sk_transactions_client_year
 * alkaa asiakkaasta). 25 vuoden asiakkaalla rivejä on muutamia tuhansia.
 */
export async function loadClientMemory(tx: Sql, scope: MemoryScope): Promise<PostingMemory> {
  const rows = await tx.query<Row>(`select ${COLUMNS} from sk_transactions where client_id = $1 and organization_id = $2`, [scope.clientId, scope.organizationId]);
  return buildPostingMemory(rows.map(toEntry), "client");
}

/** Toimiston muistin enimmäisrivit: haku on vain varalla, eikä se saa hidastaa syöttöä. */
const OFFICE_LIMIT = 5000;

/**
 * Toimiston (saman organisaation) muiden asiakkaiden kirjaukset, joiden
 * selitteessä on jokin annetuista sanoista. RLS rajaa lisäksi asiakkaisiin,
 * jotka käyttäjä saa nähdä: kirjanpitäjä näkee vain omat asiakkaansa.
 * Selitteitä ei näytetä käyttäjälle, vain tiliöinti (posting-memory.ts).
 */
export async function loadOfficeMemory(tx: Sql, scope: MemoryScope, descriptions: string[]): Promise<PostingMemory | null> {
  const words = [...new Set(descriptions.flatMap((d) => normalizeDescription(d)).filter((w) => w.length >= 3))];
  if (!words.length) return null;
  // Sanoissa on vain kirjaimia (normalizeDescription), mutta erikoismerkit suojataan silti.
  const pattern = words.map((w) => w.slice(0, 6).replace(/[^\p{L}]/gu, "")).filter(Boolean).join("|");
  if (!pattern) return null;
  const rows = await tx.query<Row>(
    `select ${COLUMNS} from sk_transactions
      where organization_id = $1 and client_id <> $2 and lower(description) ~ $3
      order by booked_on desc limit ${OFFICE_LIMIT}`,
    [scope.organizationId, scope.clientId, pattern],
  );
  return rows.length ? buildPostingMemory(rows.map(toEntry), "office") : null;
}

/**
 * Tekoälyn vihje: asiakkaan tavallisimmat tiliöinnit (enintään 30). Vain
 * asiakkaan omasta historiasta, ei toimiston muilta asiakkailta.
 */
export async function loadPostingHints(tx: Sql, scope: MemoryScope, date: string, activities?: Activity[]): Promise<string[]> {
  const memory = await loadClientMemory(tx, scope);
  return postingHints(memory, date, 30, activities);
}

// ---------------------------------------------------------------------------
// Syötön ehdotukset (taulukko ja lomake)
// ---------------------------------------------------------------------------

export interface EntrySuggestionInput {
  clientId: string;
  description: string;
  amountGross?: number | null;
  /** vvvv-kk-pp */
  date: string;
  /** Kirjanpidon näkymä; null = asiakkaan kaikki toiminnot. */
  activity: Activity | null;
}

/** Selaimelle palautettava ehdotus: tiliöinti, peruste ja merkintä ehdotukseksi. Ei selitteitä eikä summia. */
export interface EntrySuggestion {
  source: "client" | "office";
  strong: boolean;
  category: string;
  kind: TransactionKind;
  vatRate: number;
  businessSharePct: number;
  otherSharePct: number;
  farmId: string | null;
  label: string;
  basis: string;
}

/**
 * Ehdotukset kirjoitettavalle selitteelle: paras ja enintään kaksi vaihtoehtoa.
 * null = asiakasta ei löydy tai käyttäjällä ei ole siihen oikeutta (RLS).
 */
export async function suggestForEntry(tx: Sql, organizationId: string, input: EntrySuggestionInput): Promise<EntrySuggestion[] | null> {
  const [client] = await tx.query<{ has_forestry: boolean; has_agriculture: boolean }>(
    "select has_forestry, has_agriculture from sk_clients where id = $1 and organization_id = $2",
    [input.clientId, organizationId],
  );
  if (!client) return null;
  const all = activitiesOf({ hasForestry: client.has_forestry, hasAgriculture: client.has_agriculture });
  const activities = input.activity && all.includes(input.activity) ? [input.activity] : all;
  const scope = { organizationId, clientId: input.clientId };
  const query = { description: input.description, amountGross: input.amountGross ?? null, date: input.date, activities };
  let res = suggestPosting(await loadClientMemory(tx, scope), query);
  if (!res.best) {
    const office = await loadOfficeMemory(tx, scope, [input.description]);
    if (office) res = suggestPosting(office, query);
  }
  return [res.best, ...res.alternatives]
    .filter((s): s is PostingSuggestion => Boolean(s))
    .map((s) => ({
      source: s.source, strong: s.strong, category: s.category, kind: s.kind, vatRate: s.vatRate, businessSharePct: s.businessSharePct,
      otherSharePct: s.otherSharePct, farmId: s.farmId, label: postingLabel(s), basis: s.basis,
    }));
}
