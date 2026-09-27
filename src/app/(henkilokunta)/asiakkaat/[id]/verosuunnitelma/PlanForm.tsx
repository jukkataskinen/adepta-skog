"use client";

import { useMemo, useState } from "react";
import { Button, Field, Input, Panel, SectionTitle, Stat } from "@/components/ui";
import { planTotals, type PlanData } from "@/lib/tax/load";
import { computePlan, forestDeductionIncome, forestDeductionLimits, validateForestDeduction } from "@/lib/tax/plan";
import { assetClassLabel, ENTREPRENEUR_DEDUCTION_PCT } from "@/lib/tax/rules";
import { forestSaleLines } from "@/lib/tax/forest-sale";
import { formatDate } from "@/lib/format";

// + 0 muuttaa miinusnollan nollaksi, ettei näytölle tule "−0,00 €".
const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
// Tie tai oja: tilan osan myynnissä osa arvosta siirtyy metsän hankintamenoon, ja poisto lasketaan loppuosasta.
const transferNote = (n: number) => (n ? ` Tilan myynnissä siirtyi hankintamenoon ${eur(n)}.` : "");
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

  // Vertailuluvut: tulos ennen vähennyksiä, vero ilman vähennyksiä ja todellinen veroaste.
  const resultBefore = Math.round((data.income - data.expense) * 100) / 100;
  const rate = (tax: number) => (resultBefore > 0 ? (tax / resultBefore) * 100 : 0);
  const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString("fi-FI")} %`;
  const depMax = data.assets.filter((a) => !a.year.sold).reduce((s, a) => s + a.year.max, 0);
  const depUnused = Math.max(0, Math.round((depMax - totals.depreciation) * 100) / 100);
  const barWidth = plan.taxWithoutDeductions.total > 0 ? Math.round((plan.tax.total / plan.taxWithoutDeductions.total) * 100) : 100;
  const setAllDepsMax = () => setDeps(Object.fromEntries(data.assets.map((a) => [a.id, String(a.year.max).replace(".", ",")])));

  // Huomiot ja suositukset lasketaan samoilla funktioilla kuin laskelma.
  const tips: { tone: "warn" | "info" | "ok"; text: string }[] = [];
  if (!readOnly && ded === 0 && limits.max >= limits.min) {
    const withMax = computePlan({ year, income: data.income, expense: data.expense, ...totals, forestDeduction: limits.max });
    tips.push({ tone: "ok", text: `Metsävähennystä voisi käyttää ${eur(limits.max)}. Enimmäismäärä pienentäisi tämän vuoden veroa ${eur(plan.tax.total - withMax.tax.total)}.` });
  }
  if (!readOnly && depUnused > 0) {
    const withMax = computePlan({ year, income: data.income, expense: data.expense, ...totals, depreciation: depMax, forestDeduction: ded });
    tips.push({
      tone: "info",
      text: `Poistoja jää tekemättä ${eur(depUnused)}. Täysi poisto pienentäisi tämän vuoden veroa ${eur(plan.tax.total - withMax.tax.total)}. Tekemätön poisto ei katoa: se jää poistamattomaan arvoon ja voidaan tehdä myöhempinä vuosina.`,
    });
  }
  if (plan.taxable > 30000) {
    tips.push({ tone: "info", text: `Verotettava pääomatulo ${eur(plan.taxable)} ylittää 30 000 euroa. Ylittävästä osasta vero on 34 %, joten vähennykset säästävät siinä eniten.` });
  }
  if (plan.netBeforeDeduction < 0) {
    tips.push({ tone: "warn", text: "Metsätalouden tulos on tappiollinen. Tarkista kirjanpitäjän kanssa, miten alijäämä vähennetään." });
  }
  if (limits.available > 0) {
    tips.push({ tone: "info", text: "Metsävähennyksen pohja on rajallinen. Se kannattaa yleensä käyttää vuosina, joina puukaupan tulo on suuri, eikä kerralla." });
  }
  tips.push({ tone: "info", text: `Yrittäjävähennys ${ENTREPRENEUR_DEDUCTION_PCT} % lasketaan metsätalouden tuloksesta metsävähennyksen jälkeen. Laskelma tekee sen itse.` });

  return (
    <form action={action} className="grid gap-8">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="year" value={year} />

      <section className="grid gap-4 rounded-[var(--radius-panel)] bg-ink p-6 text-paper sm:grid-cols-2">
        <div>
          <p className="text-sm text-paper/60">Verosäästö vähennyksillä</p>
          <p className="tabular mt-1 text-4xl font-bold">{eur(plan.saving)}</p>
          <p className="mt-1 text-sm text-paper/60">
            {plan.saving > 0 ? `Ilman vähennyksiä vero olisi ${eur(plan.taxWithoutDeductions.total)}.` : "Valitse poistot ja metsävähennys, niin näet säästön."}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-sm text-paper/60">Arvioitu pääomatulon vero</p>
          <p className="tabular mt-1 text-3xl font-bold">{eur(plan.tax.total)}</p>
          <p className="mt-1 text-sm text-paper/60">{pct(rate(plan.tax.total))} tuloksesta ennen vähennyksiä</p>
        </div>
      </section>

      <section>
        <SectionTitle>Lähtötiedot</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Tulot ilman alv" value={eur(data.income)} />
          <Stat label={data.deliveryWork ? `Menot, joista hankintatyö ${eur(data.deliveryWork)}` : "Menot ennen poistoja"} value={eur(data.expense)} />
          <Stat label="Tulos ennen vähennyksiä" value={eur(resultBefore)} tone={resultBefore < 0 ? "alert" : undefined} />
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <fieldset disabled={readOnly} className="grid min-w-0 gap-8">
        <section>
          <SectionTitle
            actions={
              !readOnly && depUnused > 0 ? (
                <button type="button" className="text-sm font-semibold text-sky" onClick={setAllDepsMax}>
                  Aseta kaikki enimmäismäärään
                </button>
              ) : null
            }
          >
            Poistot
          </SectionTitle>
          <Panel>
            {data.assets.length === 0 ? <p className="text-sm text-ink/65">Ei investointeja tälle vuodelle.</p> : null}
            <ul className="grid gap-5">
              {data.assets.map((a) => (
                <li key={a.id} className="grid gap-3">
                  <div>
                    <p className="font-semibold">{a.description}</p>
                    <p className="text-sm text-ink/65">
                      {a.year.sold
                        ? `Myyty tänä vuonna, joten poistoa ei tehdä. ${a.year.saleGain ? `Luovutusvoitto ${eur(a.year.saleGain)}.` : `Luovutustappio ${eur(a.year.saleLoss)}.`}`
                        : a.year.smallBalance
                          ? `Arvo vuoden alussa ${eur(a.year.bookValueStart)}.${transferNote(a.year.transferred)} Enintään 600 euron arvon saa poistaa kerralla.`
                          : a.method === "straight_line"
                            ? `Vanha tasapoisto, nyt vapaaehtoinen: 0–${eur(a.year.max)}. Arvo vuoden alussa ${eur(a.year.bookValueStart)}.${transferNote(a.year.transferred)}`
                            : `${assetClassLabel(a.decliningRatePct)}: poisto 0–${eur(a.year.max)} (enintään ${a.decliningRatePct ?? 0} %). Arvo vuoden alussa ${eur(a.year.bookValueStart)}.${transferNote(a.year.transferred)}`}
                    </p>
                  </div>
                  {!a.year.sold ? (
                    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                      <input
                        type="range"
                        aria-label={`${a.description}: poisto`}
                        min={0}
                        max={a.year.max}
                        step={Math.max(1, Math.round(a.year.max / 200))}
                        value={Math.min(parse(deps[a.id] ?? "0"), a.year.max)}
                        onChange={(e) => setDeps({ ...deps, [a.id]: e.target.value.replace(".", ",") })}
                        className="mb-3 w-full accent-[var(--color-ink)]"
                      />
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
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-xl bg-cloud px-4 py-3 text-sm text-ink/75">
              <p className="font-semibold text-ink">Poistojen säännöt</p>
              <ul className="mt-1 grid list-disc gap-1 pl-5">
                <li>Poisto tehdään poistamattomasta arvosta: kone enintään 25 %, metsätie ja ojitus 15 %, rakennus 10 %.</li>
                <li>Poisto on vapaaehtoinen. Tekemätön osa jää poistamattomaan arvoon, ja sen voi poistaa myöhemmin.</li>
                <li>Poisto pienentää ensi vuoden poistopohjaa. Enintään 600 euron arvon saa poistaa kerralla.</li>
              </ul>
            </div>
          </Panel>
        </section>

        {data.forestSales.length ? (
          <section>
            <SectionTitle>Metsätilan myynti</SectionTitle>
            <Panel className="grid gap-5 text-sm">
              {data.forestSales.map((f) => {
                const { lines, result, note } = forestSaleLines(f);
                return (
                  <div key={f.id} className="grid gap-1">
                    <p className="font-semibold">
                      {f.name}, {f.sharePct < 100 ? "osan myynti" : "myynti"} {formatDate(f.disposedOn)}
                    </p>
                    <dl className="grid gap-1">
                      {lines.map(([label, amount]) => (
                        <div key={label} className="flex justify-between gap-4">
                          <dt className="text-ink/75">{label}</dt>
                          <dd className="tabular">{eur(amount)}</dd>
                        </div>
                      ))}
                      <div className="flex justify-between gap-4 border-t border-line pt-1 font-semibold">
                        <dt>{result[0]}</dt>
                        <dd className="tabular">{eur(result[1])}</dd>
                      </div>
                    </dl>
                    {note ? <p className="text-xs text-ink/55">{note}</p> : null}
                  </div>
                );
              })}
              <p className="text-xs text-ink/55">Luovutusvoitto tai -tappio ilmoitetaan lomakkeella 9. Muuta luovutuksia metsätilan sivulla.</p>
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
            {limits.max ? (
              <input
                type="range"
                aria-label="Metsävähennys"
                min={0}
                max={limits.max}
                step={100}
                value={Math.min(ded, limits.max)}
                onChange={(e) => setDeduction(e.target.value)}
                className="mb-3 w-full accent-[var(--color-ink)]"
              />
            ) : null}
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
            <div className="mt-5 rounded-xl bg-cloud px-4 py-3 text-sm text-ink/75">
              <p className="font-semibold text-ink">Metsävähennyksen säännöt</p>
              <ul className="mt-1 grid list-disc gap-1 pl-5">
                <li>Pohja on {limits.annualPct} % metsän hankintamenosta. Kaikkien metsien pohja on yhteinen.</li>
                <li>Vuodessa enintään {limits.annualPct} % metsätalouden tuloista ennen kuluja ja poistoja.</li>
                <li>Vähennys on vähintään 1 500 euroa tai ei lainkaan.</li>
                <li>Käytetty vähennys kuluu pohjasta pysyvästi, ja metsää myytäessä se lisätään luovutusvoittoon.</li>
              </ul>
            </div>
          </Panel>
        </section>
      </fieldset>

      <aside className="grid content-start gap-6">
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
          <div className="flex justify-between gap-3 text-ink/65">
            <span>Vero ilman vähennyksiä</span>
            <span className="tabular">{eur(plan.taxWithoutDeductions.total)}</span>
          </div>
          <div className="flex justify-between gap-3 font-semibold text-moss">
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
        <Panel className="grid gap-3 text-sm">
          <div className="flex justify-between gap-3">
            <span>Veroaste vähennyksillä</span>
            <span className="tabular font-semibold">{pct(rate(plan.tax.total))}</span>
          </div>
          <div className="flex justify-between gap-3 text-ink/65">
            <span>Ilman vähennyksiä</span>
            <span className="tabular">{pct(rate(plan.taxWithoutDeductions.total))}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full rounded-full bg-ink" style={{ width: `${barWidth}%` }} />
          </div>
          <p className="text-xs text-ink/55">Palkki näyttää veron vähennyksillä verrattuna veroon ilman vähennyksiä.</p>
        </Panel>
        {!readOnly ? (
          <div className="grid gap-3">
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
      </div>

      <section>
        <SectionTitle>Huomiot ja suositukset</SectionTitle>
        <Panel>
          <ul className="grid gap-2 text-sm">
            {tips.map((t) => (
              <li key={t.text} className="flex gap-2">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${t.tone === "warn" ? "bg-coral" : t.tone === "ok" ? "bg-moss" : "bg-sky"}`}
                  aria-hidden="true"
                />
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink/55">Laskelma on suuntaa antava. Tarkista veroilmoitus aina kirjanpitäjän kanssa.</p>
        </Panel>
      </section>
    </form>
  );
}
