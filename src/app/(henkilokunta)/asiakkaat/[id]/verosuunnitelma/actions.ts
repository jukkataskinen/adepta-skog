"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { fail } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { loadPlanData, planTotals } from "@/lib/tax/load";
import { archiveReport } from "@/lib/reports/archive";
import { allocateForestDeduction, computePlan, forestDeductionIncome, forestDeductionLimits, validateForestDeduction } from "@/lib/tax/plan";

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Vahvistaa verosuunnitelman: tallentaa vuoden poistot ja metsävähennyksen.
 * Luvut lasketaan palvelimella uudelleen samoilla funktioilla kuin näkymässä,
 * joten lomakkeen arvoihin ei luoteta sellaisenaan. Pääkäyttäjä voi samalla
 * sulkea vuoden.
 */
export async function confirmPlanAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = z.string().uuid().parse(formData.get("clientId"));
  const year = z.coerce.number().int().min(2000).max(2100).parse(formData.get("year"));
  const back = `/asiakkaat/${clientId}/verosuunnitelma?vuosi=${year}`;
  const close = formData.get("close") === "1";
  if (close && !ctx.can("owner")) fail(back, "Vain pääkäyttäjä voi sulkea vuoden.");

  const deduction = num(formData.get("forestDeduction"));
  if (Number.isNaN(deduction) || deduction < 0) fail(back, "Tarkista metsävähennys.");

  await ctx.run(async (tx) => {
    const [y] = await tx.query<{ id: string; status: string }>("select id, status from sk_tax_years where client_id = $1 and year = $2", [clientId, year]);
    if (!y) fail(back, `Verovuotta ${year} ei ole avattu.`);
    if (y.status === "closed") fail(back, `Verovuosi ${year} on suljettu.`);

    const data = await loadPlanData(tx, clientId, year);
    const chosen: Record<string, number> = {};
    for (const a of data.assets) {
      const v = num(formData.get(`dep_${a.id}`));
      if (!a.year.sold && (Number.isNaN(v) || v < 0 || v > a.year.max)) fail(back, `Tarkista investoinnin ${a.description} poisto.`);
      chosen[a.id] = Number.isNaN(v) ? 0 : v;
    }
    const totals = planTotals(data, chosen);
    const plan = computePlan({ year, income: data.income, expense: data.expense, ...totals, forestDeduction: deduction });
    const limits = forestDeductionLimits(data.properties, forestDeductionIncome(data.income, data.deliveryWork), year, data.deductionPool);
    const error = validateForestDeduction(deduction, limits);
    if (error) fail(back, error);

    // Vuoden aiempi vahvistus korvataan kokonaan.
    await tx.query("delete from sk_depreciations where tax_year = $2 and asset_id in (select id from sk_assets where client_id = $1)", [clientId, year]);
    for (const a of data.assets) {
      if (a.year.sold) continue;
      const amount = Math.round(chosen[a.id] * 100) / 100;
      await tx.query("insert into sk_depreciations (organization_id, asset_id, tax_year, amount, book_value_end) values ($1,$2,$3,$4,$5)", [
        ctx.org.organizationId, a.id, year, amount, Math.max(0, Math.round((a.year.bookValueStart - amount) * 100) / 100),
      ]);
    }
    await tx.query(
      "delete from sk_forest_deductions where tax_year = $2 and forest_property_id in (select id from sk_forest_properties where client_id = $1)",
      [clientId, year],
    );
    for (const part of allocateForestDeduction(data.properties, deduction)) {
      await tx.query("insert into sk_forest_deductions (organization_id, forest_property_id, tax_year, amount) values ($1,$2,$3,$4)", [
        ctx.org.organizationId, part.id, year, part.amount,
      ]);
    }
    await audit(tx, {
      organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "tax_plan.confirm", entity: "sk_tax_years", entityId: y.id,
      details: { year, depreciation: totals.depreciation, forestDeduction: deduction, taxable: plan.taxable },
    });
    if (close) {
      await tx.query("update sk_tax_years set status = 'closed', closed_at = now(), closed_by = $2 where id = $1", [y.id, ctx.user.id]);
      await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "tax_year.close", entity: "sk_tax_years", entityId: y.id, details: { year } });
      await archiveReport(tx, { organizationId: ctx.org.organizationId, clientId, year, userId: ctx.user.id });
    }
  });
  revalidatePath(`/asiakkaat/${clientId}`, "layout");
  redirect(`${back}&vahvistettu=${close ? "suljettu" : "1"}`);
}
