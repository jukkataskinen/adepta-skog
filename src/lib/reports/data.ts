import type { Sql } from "@/lib/db/types";
import { activityRows, forestryShare } from "@/lib/tax/share";
import { category, type Activity, type TransactionKind } from "@/lib/tax/rules";
import { loadPlanData, type PlanData, type PriorOpening } from "@/lib/tax/load";
import { computePlan, type PlanResult } from "@/lib/tax/plan";
import { vatRowsFrom, vatSummary, type VatPeriod } from "@/lib/tax/vat";
import { pageLabel, parsePagesColumn } from "@/lib/ai/receipts/schema";
import { listAttachmentDocuments } from "./attachments";
import { loadAgriPlanData } from "@/lib/tax/agri-form-load";
import { combinedTax, computeAgriPlan, recordedChoices, type AgriPlanResult, type CombinedTax } from "@/lib/tax/agri-plan";
import type { IncomeSplitResult } from "@/lib/tax/income-split";
import type { Form2Result } from "@/lib/tax/agriculture";
import type { AgriDepreciationResult } from "@/lib/tax/agri-depreciation";

/**
 * Veroraportin tiedot yhdeltä asiakkaalta ja vuodelta. Raportti näyttää
 * vahvistetut poistot ja metsävähennyksen; jos suunnitelmaa ei ole
 * vahvistettu, poistot ja vähennys ovat nollia ja raportissa on huomautus.
 */

/** Luokkasummat ovat metsätalouden osuuksia (src/lib/tax/share.ts). */
export interface ReportCategoryRow {
  label: string;
  kind: TransactionKind;
  net: number;
  vat: number;
  gross: number;
}

export interface ReportTransaction {
  bookedOn: string;
  kind: TransactionKind;
  category: string;
  description: string;
  /** Koko tositteen summat. */
  net: number;
  vatRate: number;
  gross: number;
  withholding: number;
  /** Kirjauksen toiminto (0015). Puuttuva = metsätalous. Kirjausluettelo eritellään tämän mukaan. */
  activity?: Activity;
  /** Oman toiminnon osuus prosentteina ja sen veroton summa (metsäasiakkaalla metsätalouden osuus). */
  sharePct: number;
  shareNet: number;
  /** Viittaus raportin liitteeseen, esimerkiksi "3" tai "3, s. 2". null, jos tositetta ei ole tai liitteitä ei tulosteta. */
  attachment: string | null;
}

export interface ReportData {
  year: number;
  status: "open" | "closed";
  closedAt: string | null;
  generatedAt: string;
  office: { name: string; businessId: string | null; email: string | null; phone: string | null; address: string | null };
  client: {
    name: string; businessId: string | null; address: string | null; municipality: string | null; vatRegistered: boolean; taxAccountReference: string | null;
    /** Toiminnot (0015): maatalousasiakkaan raportissa on maatalousosa ja alv-erittely. */
    hasForestry: boolean; hasAgriculture: boolean;
  };
  categories: ReportCategoryRow[];
  transactions: ReportTransaction[];
  vat: { quarters: VatPeriod[]; year: VatPeriod };
  plan: PlanData;
  result: PlanResult;
  depreciation: {
    description: string; method: string; bookValueStart: number; amount: number; bookValueEnd: number; transferred: number; sold: boolean; salePrice: number; saleGain: number; saleLoss: number;
    /** Hankintahinta sekä kertynyt poisto ja menojäännös ennen Skogia (aiempi investointi tai tuonti). */
    acquisitionCost: number;
    opening: PriorOpening | null;
  }[];
  properties: { name: string; remainingBefore: number | null; deduction: number }[];
  confirmed: boolean;
  /** Maatalousosa (lomake 2), vain maatalousasiakkaalle. */
  agri: {
    form2: Form2Result; depreciation: AgriDepreciationResult; categories: ReportCategoryRow[];
    /** Yritystulon jako vahvistetuilla valinnoilla ja henkilön verot yhteensä (metsä + maatalous). */
    split: IncomeSplitResult; tax: CombinedTax;
  } | null;
}

const joinAddress = (street: string | null, postal: string | null, city: string | null) =>
  [street, [postal, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

export async function loadReportData(
  tx: Sql,
  orgId: string,
  clientId: string,
  year: number,
  opts: { attachmentRefs?: boolean } = {},
): Promise<ReportData | null> {
  const [org] = await tx.query<{ name: string; business_id: string | null; contact_email: string | null; contact_phone: string | null; postal_street: string | null; postal_code: string | null; postal_city: string | null }>(
    "select name, business_id, contact_email, contact_phone, postal_street, postal_code, postal_city from sk_organizations where id = $1",
    [orgId],
  );
  const [c] = await tx.query<{
    first_name: string; last_name: string; business_id: string | null; street: string | null; postal_code: string | null; city: string | null; municipality: string | null;
    vat_registered: boolean; tax_account_reference: string | null; has_forestry: boolean; has_agriculture: boolean;
  }>(
    `select first_name, last_name, business_id, street, postal_code, city, municipality, vat_registered, tax_account_reference, has_forestry, has_agriculture
       from sk_clients where id = $1 and organization_id = $2`,
    [clientId, orgId],
  );
  const [y] = await tx.query<{ status: "open" | "closed"; closed_at: string | null }>("select status, closed_at::text from sk_tax_years where client_id = $1 and year = $2", [
    clientId,
    year,
  ]);
  if (!org || !c || !y) return null;

  const rows = await tx.query<{
    booked_on: string; kind: TransactionKind; category: string; description: string; amount_net: string; amount_gross: string; vat_rate: string; withholding: string;
    business_share_pct: string; other_share_pct: string; activity: Activity; own_document_id: string | null; source_document_id: string | null; source_pages: string | null;
  }>(
    `select t.booked_on::text, t.kind, t.category, t.description, t.amount_net, t.amount_gross, t.vat_rate, t.withholding, t.business_share_pct,
            t.other_share_pct, t.activity,
            (select d.id from sk_documents d where d.transaction_id = t.id and d.kind = 'receipt' order by d.created_at, d.id limit 1) as own_document_id,
            t.source_document_id, t.source_pages::text as source_pages
       from sk_transactions t where t.client_id = $1 and t.tax_year = $2 order by t.booked_on, t.created_at`,
    [clientId, year],
  );
  // Liitteiden numerot samassa järjestyksessä kuin liiteluettelossa (reports/attachments.ts).
  const attachmentNo = new Map<string, number>();
  if (opts.attachmentRefs) (await listAttachmentDocuments(tx, clientId, year)).forEach((d, i) => attachmentNo.set(d.id, i + 1));
  const attachmentRef = (r: (typeof rows)[number]): string | null => {
    if (r.own_document_id && attachmentNo.has(r.own_document_id)) return String(attachmentNo.get(r.own_document_id));
    if (r.source_document_id && attachmentNo.has(r.source_document_id)) {
      const pages = pageLabel(parsePagesColumn(r.source_pages));
      return `${attachmentNo.get(r.source_document_id)}${pages ? `, ${pages}` : ""}`;
    }
    return null;
  };
  const shareOf = (r: (typeof rows)[number]) =>
    forestryShare({ kind: r.kind, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), businessSharePct: Number(r.business_share_pct) });
  const transactions: ReportTransaction[] = rows.map((r) => {
    const net = Number(r.amount_net);
    const rate = Number(r.vat_rate);
    const share = shareOf(r);
    return {
      bookedOn: r.booked_on, kind: r.kind, activity: r.activity, category: category(r.category)?.label ?? r.category, description: r.description, net, vatRate: rate,
      gross: Number(r.amount_gross), withholding: Number(r.withholding), sharePct: share.sharePct, shareNet: share.net, attachment: attachmentRef(r),
    };
  });
  // Luokkasummiin vain metsätalouden osuus: loppu kuuluu muulle toiminnalle (src/lib/tax/share.ts, activityRows).
  const forestryParts = activityRows(
    rows.map((r) => ({
      ...r, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), businessSharePct: Number(r.business_share_pct), otherSharePct: Number(r.other_share_pct),
    })),
    "forestry",
  );
  const byCat = new Map<string, ReportCategoryRow>();
  for (const r of forestryParts) {
    const label = category(r.category)?.label ?? r.category;
    const e = byCat.get(label) ?? { label, kind: r.kind, net: 0, vat: 0, gross: 0 };
    const s = forestryShare(r);
    e.net = Math.round((e.net + s.net) * 100) / 100;
    e.vat = Math.round((e.vat + s.vat) * 100) / 100;
    e.gross = Math.round((e.gross + s.gross) * 100) / 100;
    byCat.set(label, e);
  }

  const plan = await loadPlanData(tx, clientId, year);
  // Maatalouden luokkasummat maatalouden osuuksina (activityRows), lomake 2 ja ryhmäpoistot.
  let agriCalc: (AgriPlanResult & { categories: ReportCategoryRow[] }) | null = null;
  if (c.has_agriculture) {
    const byAgriCat = new Map<string, ReportCategoryRow>();
    for (const r of activityRows(
      rows.map((x) => ({
        ...x, amountNet: Number(x.amount_net), amountGross: Number(x.amount_gross), businessSharePct: Number(x.business_share_pct), otherSharePct: Number(x.other_share_pct),
      })),
      "agriculture",
    )) {
      const label = category(r.category)?.label ?? r.category;
      const e = byAgriCat.get(label) ?? { label, kind: r.kind, net: 0, vat: 0, gross: 0 };
      const s = forestryShare(r);
      e.net = Math.round((e.net + s.net) * 100) / 100;
      e.vat = Math.round((e.vat + s.vat) * 100) / 100;
      e.gross = Math.round((e.gross + s.gross) * 100) / 100;
      byAgriCat.set(label, e);
    }
    const agriPlan = await loadAgriPlanData(tx, clientId, year);
    if (agriPlan) {
      // Vahvistetut valinnat: sama laskenta kuin verosuunnitelmassa ja Lomake 2 -välilehdellä.
      const a = computeAgriPlan(agriPlan, recordedChoices(agriPlan));
      agriCalc = { ...a, categories: [...byAgriCat.values()] };
    }
  }
  // Raportissa käytetään vahvistettuja lukuja, ei laskurin oletuksia.
  const depreciation = plan.assets.map((a) => {
    const amount = a.year.sold ? 0 : (a.recorded ?? 0);
    return {
      description: a.description,
      method: a.method === "declining_balance" ? `Menojäännös ${a.decliningRatePct ?? ""} %`.replace("  ", " ") : "Tasapoisto (vanha)",
      bookValueStart: a.year.bookValueStart,
      amount,
      bookValueEnd: a.year.sold ? 0 : Math.max(0, Math.round((a.year.bookValueBase - amount) * 100) / 100),
      transferred: a.year.transferred,
      sold: a.year.sold,
      salePrice: a.year.salePrice,
      saleGain: a.year.saleGain,
      saleLoss: a.year.saleLoss,
      acquisitionCost: a.acquisitionCost,
      opening: a.opening,
    };
  });
  const result = computePlan({
    year,
    income: plan.income,
    expense: plan.expense,
    depreciation: depreciation.reduce((s, d) => s + d.amount, 0),
    saleGain: depreciation.reduce((s, d) => s + d.saleGain, 0) + plan.forestSales.reduce((s, f) => s + Math.max(0, f.gain), 0),
    saleLoss: depreciation.reduce((s, d) => s + d.saleLoss, 0) + plan.forestSales.reduce((s, f) => s + Math.max(0, -f.gain), 0),
    salePrices: depreciation.reduce((s, d) => s + d.salePrice, 0) + plan.forestSales.reduce((s, f) => s + f.salePrice, 0),
    forestDeduction: plan.recordedDeduction,
  });

  // Henkilön verot yhteensä: metsätalouden ja maatalouden pääomatulo samaan 30/34 %:n rajaan.
  const agri: ReportData["agri"] = agriCalc
    ? { form2: agriCalc.form2, depreciation: agriCalc.depreciation, categories: agriCalc.categories, split: agriCalc.split, tax: combinedTax(year, result, agriCalc.split) }
    : null;

  return {
    year,
    status: y.status,
    closedAt: y.closed_at,
    generatedAt: new Date().toISOString(),
    office: {
      name: org.name, businessId: org.business_id, email: org.contact_email, phone: org.contact_phone,
      address: joinAddress(org.postal_street, org.postal_code, org.postal_city),
    },
    client: {
      name: `${c.first_name} ${c.last_name}`.trim(), businessId: c.business_id, address: joinAddress(c.street, c.postal_code, c.city),
      municipality: c.municipality, vatRegistered: c.vat_registered, taxAccountReference: c.tax_account_reference,
      hasForestry: c.has_forestry, hasAgriculture: c.has_agriculture,
    },
    categories: [...byCat.values()],
    transactions,
    vat: vatSummary(vatRowsFrom(rows)),
    plan,
    result,
    depreciation,
    properties: plan.properties.map((p) => ({ name: p.name, remainingBefore: p.remaining, deduction: p.recordedThisYear })),
    confirmed: plan.confirmed,
    agri,
  };
}
