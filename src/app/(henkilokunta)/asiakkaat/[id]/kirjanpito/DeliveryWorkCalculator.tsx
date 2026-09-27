"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { deliveryWorkValue } from "@/lib/tax/delivery-work";
import { DELIVERY_WORK_TAX_FREE_M3, deliveryWorkRates } from "@/lib/tax/rules";

const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const num2 = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Hankintatyön laskurin tila. Laskenta on puhdas funktio (src/lib/tax/delivery-work.ts);
 * tätä käyttävät sekä kirjauslomake että taulukon hankintatyöikkuna, joten
 * toteutuksia on yksi. Kuten vanhassa sovelluksessa: kuutiot puutavaralajeittain
 * ja valinta, sisältyykö kuljetus (kyllä: kuljetettu = valmistettu, ei: vain valmistus).
 */
export function useDeliveryWork(year: number) {
  const { year: ratesYear, rates } = deliveryWorkRates(year);
  const [made, setMade] = useState<Record<string, string>>({});
  const [transport, setTransport] = useState(true);
  const [name, setName] = useState("");
  const result = deliveryWorkValue(
    year,
    rates.map((r) => ({ code: r.code, made: parse(made[r.code] ?? ""), transported: transport ? parse(made[r.code] ?? "") : 0 })),
  );
  const description = name.trim() ? `Hankintatyö — ${name.trim()}` : `Hankintatyö ${result.made.toLocaleString("fi-FI")} m³, taksat ${ratesYear}`;
  return { year, ratesYear, rates, made, setMade, transport, setTransport, name, setName, result, description };
}

export type DeliveryWork = ReturnType<typeof useDeliveryWork>;

/**
 * Kuutiokentät, kuljetusvalinta ja tulos. Enter siirtää seuraavan lajin
 * määrään kuten vanhassa sovelluksessa; viimeisestä kentästä Enter tai Tab
 * kutsuu onLastEnter (taulukon ikkunassa Kirjaa-painike).
 */
export function DeliveryWorkInputs({ dw, onLastEnter }: { dw: DeliveryWork; onLastEnter?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    const last = i === dw.rates.length - 1;
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey && last && onLastEnter)) {
      e.preventDefault();
      if (!last) ref.current?.querySelector<HTMLInputElement>(`input[data-m3="${i + 1}"]`)?.focus();
      else onLastEnter?.();
    }
  }
  const { rates, made, transport, result } = dw;
  const over = result.made - DELIVERY_WORK_TAX_FREE_M3;
  const toggle = (value: boolean) =>
    `rounded-lg border px-3 py-1 text-sm font-semibold ${dw.transport === value ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink/70"}`;
  return (
    <div ref={ref} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span>Sisältyykö hankintatyöhön myös kuljetus?</span>
        <button type="button" className={toggle(true)} aria-pressed={transport} onClick={() => dw.setTransport(true)}>
          Kyllä
        </button>
        <button type="button" className={toggle(false)} aria-pressed={!transport} onClick={() => dw.setTransport(false)}>
          Ei
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left">
          <thead className="text-xs text-ink/60">
            <tr>
              <th className="py-1 pr-3 font-semibold">Puutavaralaji</th>
              <th className="py-1 pr-3 text-right font-semibold">Valmistus €/m³</th>
              <th className="py-1 pr-3 text-right font-semibold">Kuljetus €/m³</th>
              <th className="py-1 pr-3 font-semibold">Määrä m³</th>
              <th className="py-1 text-right font-semibold">Arvo €</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r, i) => {
              const line = result.lines.find((l) => l.code === r.code);
              return (
                <tr key={r.code}>
                  <td className="py-1 pr-3">{r.label}</td>
                  <td className="tabular py-1 pr-3 text-right">{num2(r.making)}</td>
                  <td className={`tabular py-1 pr-3 text-right ${transport ? "" : "text-ink/35"}`}>{num2(r.transport)}</td>
                  <td className="py-1 pr-3">
                    <input
                      data-m3={i}
                      aria-label={`${r.label}, määrä m³`}
                      inputMode="decimal"
                      placeholder="0"
                      className="w-24 rounded-lg border border-line bg-white px-2 py-1 text-right"
                      value={made[r.code] ?? ""}
                      onKeyDown={(e) => onKey(e, i)}
                      onChange={(e) => dw.setMade({ ...made, [r.code]: e.target.value })}
                    />
                  </td>
                  <td className="tabular py-1 text-right">{line ? num2(line.makingValue + line.transportValue) : "–"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <td className="py-1.5 pr-3" colSpan={3}>
                Yhteensä
              </td>
              <td className="tabular py-1.5 pr-3 text-right">{result.made.toLocaleString("fi-FI")} m³</td>
              <td className="tabular py-1.5 text-right">{eur(result.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {result.made > 0 ? (
        over > 0 ? (
          <p className="font-semibold text-amber">
            Ylittää verovapaan {DELIVERY_WORK_TAX_FREE_M3} m³:n rajan, {Math.round(over).toLocaleString("fi-FI")} m³ on ansiotuloa ({eur(result.taxable)}).
          </p>
        ) : (
          <p className="font-semibold text-moss">Alle {DELIVERY_WORK_TAX_FREE_M3} m³, koko arvo verovapaata.</p>
        )
      ) : null}
    </div>
  );
}

/**
 * Hankintatyön laskuri kirjauslomakkeella. Laskee työn arvon Verohallinnon
 * ohjetaksoilla ja täyttää lomakkeelle luokan Hankintatyö, summan ja selitteen.
 * Tekijän henkilötunnusta ei kysytä: ohjelma ei käsittele henkilötunnuksia, ja
 * ansiotulon ilmoittaa tekijä itse.
 */
export function DeliveryWorkCalculator({ year }: { year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const dw = useDeliveryWork(year);

  function apply() {
    const form = ref.current?.closest("form");
    if (!form) return;
    const set = (name: string, value: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (el) el.value = value;
    };
    set("category", "delivery_work");
    // Hankintatyössä ei ole arvonlisäveroa, joten summa on sama bruttona.
    set("amountGross", String(dw.result.total).replace(".", ","));
    set("vatRate", "0");
    set("description", dw.description);
  }

  return (
    <details className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">Hankintatyön laskuri</summary>
      <div ref={ref} className="mt-3 grid gap-3">
        <p className="text-ink/70">
          Verohallinnon ohjetaksat {dw.ratesYear}
          {dw.ratesYear !== year ? `, koska vuoden ${year} taksoja ei ole vielä julkaistu` : ""}. Verovapaa raja on {DELIVERY_WORK_TAX_FREE_M3} m³ maatilaa
          kohden vuodessa, ja ylittävä osa on tekijän ansiotuloa.
        </p>
        <DeliveryWorkInputs dw={dw} />
        <div>
          <button type="button" className="text-sm font-semibold text-sky disabled:text-ink/40" disabled={!dw.result.total} onClick={apply}>
            Käytä kirjauksessa
          </button>
        </div>
      </div>
    </details>
  );
}
