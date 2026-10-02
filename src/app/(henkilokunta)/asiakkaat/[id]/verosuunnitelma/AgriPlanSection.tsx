"use client";

import Link from "next/link";
import { Field, Input, Panel, SectionTitle } from "@/components/ui";
import { releasable, reserveDeadline, type AgriPlanData, type AgriPlanResult } from "@/lib/tax/agri-plan";
import type { AgriPool } from "@/lib/tax/agri-depreciation";
import { EQUALIZATION_RESERVE, type IncomeSplitClaim } from "@/lib/tax/rules";

const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const fi = (n: number) => String(n).replace(".", ",");
export const parseAmount = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Lomakkeen kenttien nimet: palvelin lukee samat nimet (actions.ts). */
export const agriField = {
  dep: (pool: AgriPool) => `agriDep_${pool}`,
  eq: "agriEq",
  eqFarm: (farmId: string) => `agriEqFarm_${farmId}`,
  release: (id: string) => `agriRelease_${id}`,
  claim: "agriClaim",
  loss: "agriLossToCapital",
};

/**
 * Verosuunnitelman maatalousosa: ryhmäpoistot, tasausvaraus, varausten
 * tuloutus ja yritystulon jakovaatimus. Arvot ovat PlanFormin tilassa, jotta
 * laskelma päivittyy heti. Tallennus menee samoihin tauluihin kuin Lomake 2.
 */
export function AgriPlanSection({
  clientId,
  year,
  data,
  result,
  values,
  setValue,
  claim,
  setClaim,
  lossToCapital,
  setLossToCapital,
}: {
  clientId: string;
  year: number;
  data: AgriPlanData;
  result: AgriPlanResult;
  values: Record<string, string>;
  setValue: (name: string, value: string) => void;
  claim: IncomeSplitClaim;
  setClaim: (c: IncomeSplitClaim) => void;
  lossToCapital: boolean;
  setLossToCapital: (v: boolean) => void;
}) {
  const pools = result.depreciation.pools.filter((p) => p.base > 0);
  const eqMax = result.equalization.max;
  const releasables = data.reserves.filter((r) => r.madeYear < year && (releasable(r) > 0 || r.incomeThisYear > 0));
  const s = result.split;
  const form2Link = `/asiakkaat/${clientId}/maatalous?vuosi=${year}`;

  const slider = (name: string, label: string, max: number, step: number) => (
    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <input
        type="range"
        aria-label={label}
        min={0}
        max={max}
        step={step}
        value={Math.min(parseAmount(values[name] ?? "0"), max)}
        onChange={(e) => setValue(name, fi(Number(e.target.value)))}
        className="mb-3 w-full accent-[var(--color-ink)]"
      />
      <Field label={`${label} (€)`} htmlFor={name}>
        <Input id={name} name={name} inputMode="decimal" className="text-right" value={values[name] ?? "0"} onChange={(e) => setValue(name, e.target.value)} />
      </Field>
    </div>
  );

  return (
    <>
      <section>
        <SectionTitle>Maatalouden poistot</SectionTitle>
        <Panel>
          {pools.length === 0 ? (
            <p className="text-sm text-ink/65">
              Maatalouden investointeja ei ole tälle vuodelle. Lisää investointi kirjanpidossa tai aiempi investointi{" "}
              <Link href={`/asiakkaat/${clientId}/investoinnit/uusi`} className="font-semibold text-sky">
                Investoinnit-sivulla
              </Link>
              .
            </p>
          ) : (
            <ul className="grid gap-5">
              {pools.map((p) => (
                <li key={p.pool} className="grid gap-3">
                  <div>
                    <p className="font-semibold">{p.label}</p>
                    <p className="text-sm text-ink/65">
                      {p.smallBalance
                        ? `Menojäännös ${eur(p.base)} on pieni, joten sen saa poistaa kerralla.`
                        : `Poisto 0–${eur(p.max)} (enintään ${p.pct} % menojäännöksestä ${eur(p.base)}).`}
                    </p>
                  </div>
                  {slider(agriField.dep(p.pool), `${p.label}: poisto`, p.max, Math.max(1, Math.round(p.max / 200)))}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink/55">Samat poistot näkyvät Lomake 2 -välilehdellä. Voit muuttaa niitä kummassa tahansa.</p>
        </Panel>
      </section>

      <section>
        <SectionTitle>Tasausvaraus</SectionTitle>
        <Panel className="grid gap-4">
          {result.equalization.farms ? (
            <>
              <p className="text-sm text-ink/75">
                Tasausvaraus tehdään maatiloittain. Kunkin tilan varaus on enintään {EQUALIZATION_RESERVE.pct} % tilan puhtaasta tulosta ennen korkoja ja enintään{" "}
                {eur(EQUALIZATION_RESERVE.max)}, täysinä satoina euroina. Tilan tuloon lasketaan sen omat kirjaukset. Yhteiset erät (kirjaukset ilman tilaa ja poistot)
                jaetaan tiloille niiden tulojen suhteessa.
              </p>
              <ul className="grid gap-5">
                {result.equalization.farms.map((f) => (
                  <li key={f.farmId} className="grid gap-2">
                    <p className="text-sm">
                      <span className="font-semibold">{f.farmName}</span>: puhdas tulo {eur(f.base)}.{" "}
                      {f.max ? `Varaus ${eur(EQUALIZATION_RESERVE.min)}–${eur(f.max)} tai ei lainkaan.` : `Varausta ei voi tehdä, koska enimmäismäärä jää alle ${eur(EQUALIZATION_RESERVE.min)}.`}
                    </p>
                    {f.editable ? (
                      f.max || parseAmount(values[agriField.eqFarm(f.farmId)] ?? "0") ? (
                        slider(agriField.eqFarm(f.farmId), `${f.farmName}: tasausvaraus`, Math.max(f.max, parseAmount(values[agriField.eqFarm(f.farmId)] ?? "0")), EQUALIZATION_RESERVE.round)
                      ) : (
                        <input type="hidden" name={agriField.eqFarm(f.farmId)} value="0" />
                      )
                    ) : (
                      <p className="text-sm text-ink/75">
                        Tilalle on tehty vuodelle useampi varaus ({eur(f.amount)}). Muuta niitä{" "}
                        <Link href={`${form2Link}#varaukset`} className="font-semibold text-sky">
                          Lomake 2 -välilehdellä
                        </Link>
                        .
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {data.equalizationThisYear.amount ? (
                <p className="text-sm text-ink/75">Lisäksi vuodelle on tasausvaraus ilman maatilaa ({eur(data.equalizationThisYear.amount)}). Se on mukana laskelmassa, mutta ei minkään tilan enimmäismäärässä. Poista se Lomake 2 -välilehdellä ja tee varaus tiloittain.</p>
              ) : null}
            </>
          ) : (
          <>
          <ul className="grid gap-1 text-sm text-ink/75">
            <li>
              Puhdas tulos ennen korkoja ja tämän vuoden varausta on {eur(result.equalization.base)}. Varaus on enintään {EQUALIZATION_RESERVE.pct} % siitä ja enintään{" "}
              {eur(EQUALIZATION_RESERVE.max)}, täysinä satoina euroina.
            </li>
            <li>
              {eqMax
                ? `Voit tehdä varauksen ${eur(EQUALIZATION_RESERVE.min)}–${eur(eqMax)} tai jättää tekemättä.`
                : `Tänä vuonna varausta ei voi tehdä, koska enimmäismäärä jää alle ${eur(EQUALIZATION_RESERVE.min)}.`}
            </li>
          </ul>
          {data.equalizationThisYear.editable ? (
            eqMax || parseAmount(values[agriField.eq] ?? "0") ? (
              slider(agriField.eq, "Tasausvaraus", Math.max(eqMax, parseAmount(values[agriField.eq] ?? "0")), EQUALIZATION_RESERVE.round)
            ) : (
              <input type="hidden" name={agriField.eq} value="0" />
            )
          ) : (
            <p className="text-sm text-ink/75">
              Vuodelle on tehty varaus usealle maatilalle ({eur(data.equalizationThisYear.amount)}). Muuta niitä{" "}
              <Link href={`${form2Link}#varaukset`} className="font-semibold text-sky">
                Lomake 2 -välilehdellä
              </Link>
              .
            </p>
          )}
          </>
          )}
          {releasables.length ? (
            <div className="grid gap-4 border-t border-line pt-4">
              <p className="text-sm font-semibold">Aiempien varausten tuloutus tänä vuonna</p>
              {releasables.map((r) => (
                <div key={r.id} className="grid gap-2">
                  <p className="text-sm text-ink/75">
                    {r.kind === "equalization" ? "Tasausvaraus" : "Jälleenhankintavaraus"} {r.madeYear}
                    {r.farmName ? `, ${r.farmName}` : ""}: purkamatta {eur(releasable(r))}. Käytettävä tai tuloutettava viimeistään {reserveDeadline(r)}.
                  </p>
                  {slider(agriField.release(r.id), "Tuloutus", releasable(r), 100)}
                </div>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-ink/55">
            Varauksen käyttö investointiin kirjataan{" "}
            <Link href={`${form2Link}#varaukset`} className="font-semibold text-sky">
              Lomake 2 -välilehdellä
            </Link>
            . Tuloutus lisää tämän vuoden tulosta.
          </p>
        </Panel>
      </section>

      <section>
        <SectionTitle>Yritystulon jako</SectionTitle>
        <Panel className="grid gap-4 text-sm">
          <ul className="grid gap-1 text-ink/75">
            <li>
              {data.priorWealth.source === "computed"
                ? `Nettovarallisuus ${year - 1} lopussa (Skogin lomake 2): ${eur(data.priorWealth.netWealth ?? 0)}${data.priorWealth.wages ? `, ja siihen lisätään 30 % palkoista ${eur(data.priorWealth.wages)}` : ""}.`
                : data.priorWealth.source === "manual"
                  ? `Edellisen vuoden nettovarallisuus (syötetty): ${eur(data.priorWealth.netWealth ?? 0)}.`
                  : "Edellisen vuoden nettovarallisuus puuttuu. Anna se Lomake 2 -välilehden vuoden tiedoissa."}
            </li>
            {data.confirmedLosses ? <li>Aiempien vuosien vahvistettuja tappioita {eur(data.confirmedLosses)}. Ne vähennetään tuloksesta ennen jakoa.</li> : null}
          </ul>
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-semibold">Pääomatulo-osuus nettovarallisuudesta</legend>
            {(
              [
                [null, "20 % (oletus)", ""],
                ["ten", "10 % (vaatimus)", "ten"],
                ["earned", "0 %, kaikki ansiotuloa (vaatimus)", "earned"],
              ] as [IncomeSplitClaim, string, string][]
            ).map(([c, label, value]) => (
              <label key={label} className="flex items-center gap-2">
                <input type="radio" name={agriField.claim} value={value} checked={claim === c} onChange={() => setClaim(c)} className="size-4 accent-[var(--color-ink)]" />
                {label}
              </label>
            ))}
          </fieldset>
          {result.form2.result < 0 ? (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name={agriField.loss}
                value="1"
                checked={lossToCapital}
                onChange={(e) => setLossToCapital(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--color-ink)]"
              />
              <span>Vähennä maatalouden tappio tämän vuoden pääomatuloista (kohta 420). Muuten tappio vahvistetaan seuraaville vuosille.</span>
            </label>
          ) : null}
          <dl className="grid gap-1 rounded-xl bg-cloud px-4 py-3">
            {(
              [
                ["Maatalouden tulos", result.form2.result],
                ...(s.lossesUsed ? [["Aiempien vuosien tappiot", -s.lossesUsed]] : []),
                [`Yrittäjävähennys 5 %`, -s.entrepreneurDeduction],
                ["Jaettava yritystulo", s.splitBase],
                [`Pääomatulo-osuus (${s.capitalPct} % × ${eur(s.wealthBase)}, enintään jaettava)`, s.capital],
                ["Ansiotulo-osuus", s.earned],
                ...(s.spouse
                  ? [
                      ["Asiakkaan pääomatulo / ansiotulo", `${eur(s.owner.capital)} / ${eur(s.owner.earned)}`],
                      ["Puolison pääomatulo / ansiotulo", `${eur(s.spouse.capital)} / ${eur(s.spouse.earned)}`],
                    ]
                  : []),
              ] as [string, number | string][]
            ).map(([label, v]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt>{label}</dt>
                <dd className="tabular">{typeof v === "number" ? eur(v) : v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-ink/55">
            Vaatimus tallentuu lomakkeen 2 kohtaan 418. Puolisoiden osuudet ja nettovarallisuuden tiedot muutetaan Lomake 2 -välilehdellä.
          </p>
        </Panel>
      </section>
    </>
  );
}
