"use client";

import { useRef, useState } from "react";
import { deliveryWorkValue } from "@/lib/tax/delivery-work";
import { DELIVERY_WORK_TAX_FREE_M3, deliveryWorkRates } from "@/lib/tax/rules";

const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const parse = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Hankintatyön laskuri kirjauslomakkeella. Laskee työn arvon Verohallinnon
 * ohjetaksoilla ja täyttää lomakkeelle luokan Hankintatyö, summan ja selitteen.
 * Tekijän tietoja ei kysytä: ohjelma ei käsittele henkilötunnuksia, ja
 * ansiotulon ilmoittaa tekijä itse.
 */
export function DeliveryWorkCalculator({ year }: { year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { year: ratesYear, rates } = deliveryWorkRates(year);
  const [made, setMade] = useState<Record<string, string>>({});
  const [transported, setTransported] = useState<Record<string, string>>({});
  const [sameTransport, setSameTransport] = useState(true);

  const result = deliveryWorkValue(
    year,
    rates.map((r) => ({ code: r.code, made: parse(made[r.code] ?? ""), transported: parse((sameTransport ? made : transported)[r.code] ?? "") })),
  );

  function apply() {
    const form = ref.current?.closest("form");
    if (!form) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = value;
    };
    set("category", "delivery_work");
    set("amountNet", String(result.total).replace(".", ","));
    set("vatRate", "");
    set("description", `Hankintatyö ${result.made.toLocaleString("fi-FI")} m³, taksat ${ratesYear}`);
  }

  return (
    <details className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">Hankintatyön laskuri</summary>
      <div ref={ref} className="mt-3 grid gap-3">
        <p className="text-ink/70">
          Kirjoita itse valmistetut ja kuljetetut kuutiot. Työn arvo lasketaan Verohallinnon ohjetaksoilla ({ratesYear})
          {ratesYear !== year ? `, koska vuoden ${year} taksoja ei ole vielä julkaistu` : ""}.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={sameTransport} onChange={(e) => setSameTransport(e.target.checked)} />
          Sama määrä myös kuljetettu
        </label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left">
            <thead className="text-xs text-ink/60">
              <tr>
                <th className="py-1 pr-3 font-semibold">Puutavaralaji</th>
                <th className="py-1 pr-3 text-right font-semibold">Valmistus €/m³</th>
                <th className="py-1 pr-3 text-right font-semibold">Kuljetus €/m³</th>
                <th className="py-1 pr-3 font-semibold">Valmistettu m³</th>
                {!sameTransport ? <th className="py-1 pr-3 font-semibold">Kuljetettu m³</th> : null}
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.code}>
                  <td className="py-1 pr-3">{r.label}</td>
                  <td className="tabular py-1 pr-3 text-right">{r.making.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                  <td className="tabular py-1 pr-3 text-right">{r.transport.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                  <td className="py-1 pr-3">
                    <input
                      aria-label={`${r.label} valmistettu m³`}
                      inputMode="decimal"
                      className="w-24 rounded-lg border border-line bg-white px-2 py-1 text-right"
                      value={made[r.code] ?? ""}
                      onChange={(e) => setMade({ ...made, [r.code]: e.target.value })}
                    />
                  </td>
                  {!sameTransport ? (
                    <td className="py-1 pr-3">
                      <input
                        aria-label={`${r.label} kuljetettu m³`}
                        inputMode="decimal"
                        className="w-24 rounded-lg border border-line bg-white px-2 py-1 text-right"
                        value={transported[r.code] ?? ""}
                        onChange={(e) => setTransported({ ...transported, [r.code]: e.target.value })}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-1">
          <p className="font-semibold">Hankintatyön arvo {eur(result.total)}</p>
          <p className="text-ink/70">
            Valmistettu {result.made.toLocaleString("fi-FI")} m³, kuljetettu {result.transported.toLocaleString("fi-FI")} m³.
            {result.taxable
              ? ` Yli ${DELIVERY_WORK_TAX_FREE_M3} m³:n osuus ${eur(result.taxable)} on tekijöiden ansiotuloa.`
              : ` Alle ${DELIVERY_WORK_TAX_FREE_M3} m³, joten tekijöille verovapaata.`}
          </p>
        </div>
        <div>
          <button type="button" className="text-sm font-semibold text-sky disabled:text-ink/40" disabled={!result.total} onClick={apply}>
            Käytä kirjauksessa
          </button>
        </div>
      </div>
    </details>
  );
}
