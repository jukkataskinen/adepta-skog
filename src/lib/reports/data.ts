import type { Sql } from "@/lib/db/types";
import { vatOf } from "@/lib/tax/amounts";
import { category, type TransactionKind } from "@/lib/tax/rules";
import { loadPlanData, type PlanData } from "@/lib/tax/load";
import { computePlan, type PlanResult } from "@/lib/tax/plan";
import { vatSummary, type VatPeriod } from "@/lib/tax/vat";

/**
 * Veroraportin tiedot yhdeltä asiakkaalta ja vuodelta. Raportti näyttää
 * vahvistetut poistot ja metsävähennyksen; jos suunnitelmaa ei ole
 * vahvistettu, poistot ja vähennys ovat nollia ja raportissa on huomautus.
 */

export interface ReportCategoryRow {
  label: string;
  kind: TransactionKind;
  net: number;
  vat: number;
  gross: number;
}

export interface ReportTransaction {
  bookedOn: string;
  category: string;
  description: string;
  net: number;
  vatRate: number;
  gross: number;
  withholding: number;
}

export interface ReportData {
  year: number;
  status: "open" | "closed";
  closedAt: string | null;
  generatedAt: string;
  office: { name: string; businessId: string | null; email: string | null; phone: string | null; address: string | null };
  client: { name: string; businessId: string | null; address: string | null; municipality: string | null; vatRegistered: boolean };
  categories: ReportCategoryRow[];
  transactions: ReportTransaction[];
  vat: { quarters: VatPeriod[]; year: VatPeriod };
  plan: PlanData;
  result: PlanResult;
  depreciation: {
    description: string; method: string; bookValueStart: number; amount: number; bookValueEnd: number; transferred: number; sold: boolean; salePrice: number; saleGain: number; saleLoss: number;
  }[];
  properties: { name: string; remainingBefore: number | null; deduction: number }[];
  confirmed: boolean;
}

const joinAddress = (street: string | null, postal: string | null, city: string | null) =>
  [street, [postal, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

export async function loadReportData(tx: Sql, orgId: string, clientId: string, year: number): Promise<ReportData | null> {
  const [org] = await tx.query<{ name: string; business_id: string | null; contact_email: string | null; contact_phone: string | null; postal_street: string | null; postal_code: string | null; postal_city: string | null }>(
    "select name, business_id, contact_email, contact_phone, postal_street, postal_code, postal_city from sk_organizations where id = $1",
    [orgId],
  );
  const [c] = await tx.query<{ first_name: string; last_name: string; business_id: string | null; street: string | null; postal_code: string | null; city: string | null; municipality: string | null; vat_registered: boolean }>(
    "select first_name, last_name, business_id, street, postal_code, city, municipality, vat_registered from sk_clients where id = $1 and organization_id = $2",
    [clientId, orgId],
  );
  const [y] = await tx.query<{ status: "open" | "closed"; closed_at: string | null }>("select status, closed_at::text from sk_tax_years where client_id = $1 and year = $2", [
    clientId,
    year,
  ]);
  if (!org || !c || !y) return null;

  const rows = await tx.query<{ booked_on: string; kind: TransactionKind; category: string; description: string; amount_net: string; amount_gross: string; vat_rate: string; withholding: string }>(
    "select booked_on::text, kind, category, description, amount_net, amount_gross, vat_rate, withholding from sk_transactions where client_id = $1 and tax_year = $2 order by booked_on, created_at",
    [clientId, year],
  );
  const transactions: ReportTransaction[] = rows.map((r) => {
    const net = Number(r.amount_net);
    const rate = Number(r.vat_rate);
    return {
      bookedOn: r.booked_on, category: category(r.category)?.label ?? r.category, description: r.description, net, vatRate: rate,
      gross: Number(r.amount_gross), withholding: Number(r.withholding),
    };
  });
  const byCat = new Map<string, ReportCategoryRow>();
  for (const r of rows) {
    const label = category(r.category)?.label ?? r.category;
    const e = byCat.get(label) ?? { label, kind: r.kind, net: 0, vat: 0, gross: 0 };
    const net = Number(r.amount_net);
    const gross = Number(r.amount_gross);
    e.net += net;
    e.vat += vatOf(net, gross);
    e.gross += gross;
    byCat.set(label, e);
  }

  const plan = await loadPlanData(tx, clientId, year);
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
      municipality: c.municipality, vatRegistered: c.vat_registered,
    },
    categories: [...byCat.values()],
    transactions,
    vat: vatSummary(rows.map((r) => ({ bookedOn: r.booked_on, kind: r.kind, amountNet: Number(r.amount_net), amountGross: Number(r.amount_gross), vatRate: Number(r.vat_rate) }))),
    plan,
    result,
    depreciation,
    properties: plan.properties.map((p) => ({ name: p.name, remainingBefore: p.remaining, deduction: p.recordedThisYear })),
    confirmed: plan.confirmed,
  };
}
