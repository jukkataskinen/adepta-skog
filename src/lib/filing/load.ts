import type { Sql } from "@/lib/db/types";
import { loadPlanData } from "@/lib/tax/load";
import { forestryShare } from "@/lib/tax/share";
import type { TransactionKind } from "@/lib/tax/rules";
import type { Filing2cData } from "./vsy02c";

/**
 * 2C-ilmoituksen lähtötiedot yhdeltä asiakkaalta ja vuodelta käyttäjän
 * RLS-transaktiossa. Samat luvut kuin veroraportissa: vahvistetut poistot ja
 * metsävähennys verosuunnitelmasta. Toimii myös suljetulle vuodelle, koska
 * mitään ei kirjoiteta.
 */

export interface WorkerDefault {
  name: string;
  value: number;
  madeM3: number | null;
}

export interface FilingSource {
  data: Filing2cData;
  client: { name: string; lastName: string; businessId: string | null };
  office: { email: string | null; phone: string | null };
  /** Hankintatyön tekijät kirjausten selitteistä ("Hankintatyö — nimi"). */
  workers: WorkerDefault[];
}

/**
 * Hankintatyön tekijä ja määrä selitteestä. Laskuri kirjoittaa selitteeksi
 * "Hankintatyö — nimi" tai "Hankintatyö 150 m³, taksat 2025". Nimetön rivi
 * jää tekijää vaille, jolloin nimi kysytään lomakkeella.
 */
export function parseDeliveryWorkDescription(description: string): { name: string | null; madeM3: number | null } {
  const named = /^Hankintatyö\s*[—–-]\s*(.+)$/u.exec(description.trim());
  if (named) return { name: named[1].trim(), madeM3: null };
  const m3 = /(\d[\d\s]*(?:,\d+)?)\s*m³/u.exec(description);
  return { name: null, madeM3: m3 ? Number(m3[1].replace(/\s/g, "").replace(",", ".")) : null };
}

/** Oletustekijät: sama nimi yhdistetään, nimettömät rivit yhdeksi tekijäksi. */
export function defaultWorkers(rows: { description: string; amount: number }[]): WorkerDefault[] {
  const out: WorkerDefault[] = [];
  for (const r of rows) {
    const p = parseDeliveryWorkDescription(r.description);
    const name = p.name ?? "";
    const e = out.find((w) => w.name === name);
    if (e) {
      e.value = Math.round((e.value + r.amount) * 100) / 100;
      if (p.madeM3 !== null) e.madeM3 = (e.madeM3 ?? 0) + p.madeM3;
    } else out.push({ name, value: Math.round(r.amount * 100) / 100, madeM3: p.madeM3 });
  }
  return out;
}

export async function loadFilingSource(tx: Sql, orgId: string, clientId: string, year: number): Promise<FilingSource | null> {
  const [c] = await tx.query<{ first_name: string; last_name: string; business_id: string | null; vat_registered: boolean }>(
    "select first_name, last_name, business_id, vat_registered from sk_clients where id = $1 and organization_id = $2",
    [clientId, orgId],
  );
  const [y] = await tx.query<{ status: "open" | "closed" }>("select status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
  const [org] = await tx.query<{ contact_email: string | null; contact_phone: string | null }>("select contact_email, contact_phone from sk_organizations where id = $1", [orgId]);
  if (!c || !y || !org) return null;

  const stored = await tx.query<{
    kind: TransactionKind; category: string; asset_id: string | null; description: string; amount_net: string; amount_gross: string; business_share_pct: string;
  }>(
    `select kind, category, asset_id, description, amount_net, amount_gross, business_share_pct from sk_transactions
      where client_id = $1 and tax_year = $2 order by booked_on, created_at`,
    [clientId, year],
  );
  // 2C:hen vain metsätalouden osuus (src/lib/tax/share.ts): loppu kuuluu muulle toiminnalle.
  const rows = stored.map((r) => ({
    ...r,
    share: forestryShare({ kind: r.kind, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), businessSharePct: Number(r.business_share_pct) }),
  }));
  const categories: Filing2cData["categories"] = {};
  for (const r of rows) {
    // Investointiin liitetty myynti on luovutusvoittoa (lomake 9), ei metsätalouden tuloa.
    if (r.category === "asset_sale" && r.asset_id) continue;
    const e = categories[r.category] ?? { net: 0, gross: 0 };
    e.net = Math.round((e.net + r.share.net) * 100) / 100;
    e.gross = Math.round((e.gross + r.share.gross) * 100) / 100;
    categories[r.category] = e;
  }

  const plan = await loadPlanData(tx, clientId, year);
  const data: Filing2cData = {
    year,
    vatRegistered: c.vat_registered,
    categories,
    assets: plan.assets.map((a) => ({
      method: a.method,
      decliningRatePct: a.decliningRatePct,
      acquiredOn: a.acquiredOn,
      bookValueStart: a.year.bookValueStart,
      sold: a.year.sold,
      transferred: a.year.transferred,
      depreciation: a.year.sold ? 0 : (a.recorded ?? 0),
    })),
    transfersOut: plan.transfersOut,
    forestDeduction: plan.recordedDeduction,
    tracking: plan.deductionTracking,
    planConfirmed: plan.confirmed,
    yearOpen: y.status === "open",
    hasDisposals: plan.assets.some((a) => a.year.sold) || plan.forestSales.length > 0,
  };
  return {
    data,
    client: { name: `${c.first_name} ${c.last_name}`.trim(), lastName: c.last_name, businessId: c.business_id },
    office: { email: org.contact_email, phone: org.contact_phone },
    workers: defaultWorkers(rows.filter((r) => r.category === "delivery_work").map((r) => ({ description: r.description, amount: r.share.net }))),
  };
}
