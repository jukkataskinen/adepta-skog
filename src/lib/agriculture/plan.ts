import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { computeAgriPlan, releasable, type AgriChoices, type AgriPlanData, type AgriPlanResult } from "@/lib/tax/agri-plan";
import { validateEqualizationReserve } from "@/lib/tax/income-split";
import { AgriError, getAgriYear, saveAgriDepreciations, saveAgriYear, type Actor } from "./year";

/**
 * Verosuunnitelman maatalousvalintojen tallennus. Valinnat tallentuvat samoihin
 * tauluihin kuin Lomake 2 -välilehdellä (ryhmäpoistot, tasausvaraus ja sen
 * tuloutus, vuoden tiedot), jotta totuuksia on vain yksi ja välilehti näyttää
 * samat luvut. Palvelin laskee rajat uudelleen samalla funktiolla kuin
 * selaimen laskuri, eikä selaimen lukuihin luoteta.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function saveAgriPlanChoices(tx: Sql, actor: Actor, clientId: string, data: AgriPlanData, choices: AgriChoices): Promise<AgriPlanResult> {
  const { year } = data;
  const result = computeAgriPlan(data, choices);

  // 1. Ryhmäpoistot: sama tallennus ja enimmäismäärän tarkistus kuin Lomake 2 -välilehdellä.
  await saveAgriDepreciations(tx, actor, clientId, year, choices.depreciation);

  // 2. Verovuodelta tehty tasausvaraus.
  const eq = data.equalizationThisYear;
  if (eq.editable) {
    const amount = round2(choices.equalization);
    const error = validateEqualizationReserve(amount, result.equalization.max);
    if (error) throw new AgriError(error);
    if (amount > 0 && amount < eq.usedThisYear) throw new AgriError("Tasausvaraus ei voi olla pienempi kuin siitä jo käytetty määrä.");
    if (eq.id && amount === 0) {
      if (eq.usedThisYear > 0) throw new AgriError("Tasausvarauksesta on jo käytetty osa. Poista käyttö ensin Lomake 2 -välilehdellä.");
      await tx.query("delete from sk_agri_reserves where id = $1 and client_id = $2", [eq.id, clientId]);
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.delete", entity: "sk_agri_reserves", entityId: eq.id });
    } else if (eq.id && amount !== eq.amount) {
      await tx.query("update sk_agri_reserves set amount = $3 where id = $1 and client_id = $2", [eq.id, clientId, amount]);
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.update", entity: "sk_agri_reserves", entityId: eq.id, details: { madeYear: year } });
    } else if (!eq.id && amount > 0) {
      // Varaus on tilakohtainen: jos asiakkaalla on yksi maatila, varaus liitetään siihen.
      const farms = await tx.query<{ id: string }>("select id from sk_farms where client_id = $1", [clientId]);
      const [row] = await tx.query<{ id: string }>(
        "insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount, note) values ($1,$2,$3,'equalization',$4,$5,$6) returning id",
        [actor.organizationId, clientId, farms.length === 1 ? farms[0].id : null, year, amount, "Verosuunnitelma"],
      );
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.create", entity: "sk_agri_reserves", entityId: row.id, details: { kind: "equalization", madeYear: year } });
    }
  }

  // 2 b. Usean tilan asiakas: verovuoden tasausvaraus tiloittain, kukin oman enimmäismääränsä mukaan.
  for (const f of data.equalizationFarms ?? []) {
    if (!f.editable) continue;
    const amount = round2(choices.farmEqualization ? (choices.farmEqualization[f.farmId] ?? 0) : f.amount);
    const max = result.equalization.farms?.find((x) => x.farmId === f.farmId)?.max ?? 0;
    const error = validateEqualizationReserve(amount, max);
    if (error) throw new AgriError(`${f.farmName}: ${error}`);
    if (amount > 0 && amount < f.usedThisYear) throw new AgriError(`${f.farmName}: tasausvaraus ei voi olla pienempi kuin siitä jo käytetty määrä.`);
    if (f.id && amount === 0) {
      if (f.usedThisYear > 0) throw new AgriError(`${f.farmName}: tasausvarauksesta on jo käytetty osa. Poista käyttö ensin Lomake 2 -välilehdellä.`);
      await tx.query("delete from sk_agri_reserves where id = $1 and client_id = $2", [f.id, clientId]);
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.delete", entity: "sk_agri_reserves", entityId: f.id });
    } else if (f.id && amount !== f.amount) {
      await tx.query("update sk_agri_reserves set amount = $3 where id = $1 and client_id = $2", [f.id, clientId, amount]);
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.update", entity: "sk_agri_reserves", entityId: f.id, details: { madeYear: year } });
    } else if (!f.id && amount > 0) {
      const [row] = await tx.query<{ id: string }>(
        "insert into sk_agri_reserves (organization_id, client_id, farm_id, kind, made_year, amount, note) values ($1,$2,$3,'equalization',$4,$5,$6) returning id",
        [actor.organizationId, clientId, f.farmId, year, amount, "Verosuunnitelma"],
      );
      await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.create", entity: "sk_agri_reserves", entityId: row.id, details: { kind: "equalization", madeYear: year } });
    }
  }

  // 3. Aiempien varausten tuloutus verovuonna: vuoden tuloutukset korvataan valinnalla.
  for (const r of data.reserves.filter((x) => x.madeYear < year)) {
    const wanted = round2(choices.releases[r.id] ?? r.incomeThisYear);
    if (wanted < 0 || wanted > releasable(r) + 0.004) {
      throw new AgriError(`Varauksesta vuodelta ${r.madeYear} voi tulouttaa enintään ${releasable(r).toLocaleString("fi-FI", { minimumFractionDigits: 2 })} €.`);
    }
    if (wanted === round2(r.incomeThisYear)) continue;
    await tx.query("delete from sk_agri_reserve_uses where reserve_id = $1 and client_id = $2 and tax_year = $3 and use_kind = 'income'", [r.id, clientId, year]);
    if (wanted > 0) {
      await tx.query(
        "insert into sk_agri_reserve_uses (organization_id, client_id, reserve_id, tax_year, use_kind, amount) values ($1,$2,$3,$4,'income',$5)",
        [actor.organizationId, clientId, r.id, year, wanted],
      );
    }
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.reserve.use", entity: "sk_agri_reserves", entityId: r.id, details: { year, useKind: "income" } });
  }

  // 4. Jakovaatimus (418) ja tappion vähentäminen pääomatuloista (420) vuoden tietoihin.
  const y = await getAgriYear(tx, clientId, year);
  const lossToCapitalIncome = choices.lossToCapital && result.form2.result < 0 ? round2(-result.form2.result) : null;
  if (y.incomeSplitClaim !== choices.claim || (y.lossToCapitalIncome ?? null) !== lossToCapitalIncome) {
    await saveAgriYear(tx, actor, clientId, year, { ...y, incomeSplitClaim: choices.claim, lossToCapitalIncome });
  }
  return result;
}
