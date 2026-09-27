"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Panel, SectionTitle } from "@/components/ui";
import { planTotals, type PlanData } from "@/lib/tax/load";
import { computePlan, forestDeductionIncome, forestDeductionLimits, validateForestDeduction } from "@/lib/tax/plan";
import { assetClassLabel, ENTREPRENEUR_DEDUCTION_PCT } from "@/lib/tax/rules";

// + 0 muuttaa miinusnollan nollaksi, ettei näytölle tule "−0,00 €".
const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const parse = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Verosuunnitelman laskuri. Laskee samoilla funktioilla kuin palvelin
 * (src/lib/tax), joten näkymän luvut ja vahvistettu tulos ovat samat.
 */
export function PlanForm({
  action,
  clientId,
  year,
  data,
  readOnly,
  canClose,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  year: number;
  data: PlanData;
  readOnly: boolean;
  canClose: boolean;
}) {
  const [deps, setDeps] = useState<Record<string, string>>(() =>
    Object.fromEntries(data.assets.map((a) => [a.id, String(a.recorded ?? a.year.max).replace(".", ",")])),
  );
  const [deduction, setDeduction] = useState(String(data.recordedDeduction || 0).replace(".", ","));

  const chosen = Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, parse(v)]));
  const totals = planTotals(data, chosen);
  const ded = parse(deduction);
  const plan = computePlan({ year, income: data.income, expense: data.expense, ...totals, forestDeduction: ded });
  const limits = useMemo(
    () => forestDeductionLimits(data.properties, forestDeductionIncome(data.income, data.deliveryWork), year, data.deductionPool),
    [data.properties, data.income, data.deliveryWork, year, data.deductionPool],
  );
  const error = validateForestDeduction(ded, limits);

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="year" value={year} />
      <fieldset disabled={readOnly} className="grid gap-8">
        <section>
          <SectionTitle>Poistot</SectionTitle>
          <Panel>
            {data.assets.length === 0 ? <p className="text-sm text-ink/65">Ei investointeja tälle vuodelle.</p> : null}
            <ul className="grid gap-4">
              {data.assets.map((a) => (
                <li key={a.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-end">
                  <div>
                    <p className="font-semibold">{a.description}</p>
                    <p className="text-sm text-ink/65">
                      {a.year.sold
                        ? `Myyty tänä vuonna, joten poistoa ei tehdä. ${a.year.saleGain ? `Luovutusvoitto ${eur(a.year.saleGain)}.` : `Luovutustappio ${eur(a.year.saleLoss)}.`}`
                        : a.year.smallBalance
                          ? `Arvo vuoden alussa ${eur(a.year.bookValueStart)}. Enintään 600 euron arvon saa poistaa kerralla.`
                          : a.method === "straight_line"
                            ? `Vanha tasapoisto, nyt vapaaehtoinen: 0–${eur(a.year.max)}. Arvo vuoden alussa ${eur(a.year.bookValueStart)}.`
                            : `${assetClassLabel(a.decliningRatePct)}: poisto 0–${eur(a.year.max)} (enintään ${a.decliningRatePct ?? 0} %). Arvo vuoden alussa ${eur(a.year.bookValueStart)}.`}
                    </p>
                  </div>
                  {!a.year.sold ? (
                    <Field label="Poisto (€)" htmlFor={`dep_${a.id}`}>
                      <Input
                        id={`dep_${a.id}`}
                        name={`dep_${a.id}`}
                        inputMode="decimal"
                        className="text-right"
                        value={deps[a.id]}
                        onChange={(e) => setDeps({ ...deps, [a.id]: e.target.value })}
                      />
                    </Field>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
        </section>

        {data.forestSales.length ? (
          <section>
            <SectionTitle>Metsätilan myynti</SectionTitle>
            <Panel className="grid gap-3 text-sm">
              {data.forestSales.map((f) => (
                <div key={f.id} className="grid gap-1">
                  <p className="font-semibold">{f.name}</p>
                  <p>Kauppahinta {eur(f.salePrice)}, {f.deemedCost ? "hankintameno-olettama" : "hankintameno"} {eur(f.cost)}.</p>
                  <p>Luovutusvoittoon lisätään käytettyä metsävähennystä {eur(f.addition)}.</p>
                  <p className="font-semibold">{f.gain >= 0 ? `Luovutusvoitto ${eur(f.gain)}` : `Luovutustappio ${eur(-f.gain)}`}</p>
                </div>
              ))}
              <p className="text-xs text-ink/55">Voitto ilmoitetaan lomakkeella 9. Myyntikulut ja poistamattomat tie- ja ojamenot eivät ole laskelmassa.</p>
            </Panel>
          </section>
        ) : null}

        <section>
          <SectionTitle>Metsävähennys</SectionTitle>
          <Panel>
            <ul className="mb-4 grid gap-1 text-sm text-ink/75">
              <li>Käyttämätöntä pohjaa kaikista metsistä yhteensä {eur(limits.available)}.</li>
              <li>
                Vuoden enimmäismäärä on {limits.annualPct} % metsätalouden tuloista ennen kuluja ja poistoja
                {data.deliveryWork ? " (oman hankintatyön arvo vähennetty)" : ""}: {eur(limits.annualMax)}.
              </li>
              <li>{limits.max ? `Voit vähentää ${eur(limits.min)}–${eur(limits.max)} tai jättää vähentämättä.` : "Tänä vuonna vähennystä ei voi tehdä, koska enimmäismäärä jää alle 1 500 euron."}</li>
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Metsävähennys (€)" htmlFor="forestDeduction" error={error}>
                <Input id="forestDeduction" name="forestDeduction" inputMode="decimal" className="w-40 text-right" value={deduction} onChange={(e) => setDeduction(e.target.value)} />
              </Field>
              {limits.max ? (
                <button type="button" className="mb-2 text-sm font-semibold text-sky" onClick={() => setDeduction(String(limits.max).replace(".", ","))}>
                  Käytä enimmäismäärä
                </button>
              ) : null}
            </div>
          </Panel>
        </section>
      </fieldset>

      <aside>
        <SectionTitle>Laskelma {year}</SectionTitle>
        <Panel className="grid gap-2 text-sm">
          {(
            [
              ["Tulot ilman alv ja koneiden myyntejä", data.income],
              ["Menot", -data.expense],
              ["Poistot", -totals.depreciation],
              ["Metsätalouden puhdas pääomatulo", plan.netBeforeDeduction],
              ["Metsävähennys", -ded],
              [`Yrittäjävähennys ${ENTREPRENEUR_DEDUCTION_PCT} %`, -plan.entrepreneurDeduction],
              ["Metsätalouden verotettava tulo", plan.forestryTaxable],
              ...(totals.salePrices
                ? [[plan.saleExempt ? "Myynnit, verovapaa (enintään 1 000 €)" : "Luovutusvoitot ja -tappiot (lomake 9)", plan.saleResult]]
                : []),
            ] as [string, number][]
          ).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <span className={label.startsWith("Metsätalouden") ? "font-semibold" : ""}>{label}</span>
              <span className="tabular">{eur(value)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between gap-3 border-t border-line pt-2 font-bold">
            <span>Verotettava pääomatulo</span>
            <span className="tabular">{eur(plan.taxable)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span>Vero 30 %</span>
            <span className="tabular">{eur(plan.tax.low)}</span>
          </div>
          {plan.tax.high ? (
            <div className="flex justify-between gap-3">
              <span>Vero 34 %</span>
              <span className="tabular">{eur(plan.tax.high)}</span>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 font-bold">
            <span>Arvioitu vero</span>
            <span className="tabular">{eur(plan.tax.total)}</span>
          </div>
          <div className="flex justify-between gap-3 text-moss">
            <span>Säästö vähennyksillä</span>
            <span className="tabular">{eur(plan.saving)}</span>
          </div>
          {data.withholding ? (
            <div className="flex justify-between gap-3 text-ink/65">
              <span>Ennakonpidätykset</span>
              <span className="tabular">{eur(data.withholding)}</span>
            </div>
          ) : null}
        </Panel>
        {!readOnly ? (
          <div className="mt-4 grid gap-3">
            <Button disabled={Boolean(error)}>Vahvista suunnitelma</Button>
            {canClose ? (
              <Button variant="secondary" name="close" value="1" disabled={Boolean(error)}>
                Vahvista ja sulje vuosi
              </Button>
            ) : null}
            <p className="text-xs text-ink/55">Vahvistus tallentaa vuoden poistot ja metsävähennyksen. Voit vahvistaa uudelleen, kunnes vuosi suljetaan.</p>
            <p className="text-xs text-ink/55">Vero on arvio. Se ei ota huomioon asiakkaan muita pääomatuloja eikä aiempien vuosien tappioita.</p>
          </div>
        ) : null}
      </aside>
    </form>
  );
}
