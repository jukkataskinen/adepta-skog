"use client";

import { useEffect, useRef, useState } from "react";
import { isLivestockDeferral, withLivestockDeferral, type Activity } from "@/lib/tax/rules";
import { hintKeyAction } from "@/lib/ledger/grid";
import type { EntrySuggestion } from "@/lib/ledger/posting-memory-load";
import { usePostingSuggestions } from "./usePostingSuggestions";

const fi = (n: number) => n.toLocaleString("fi-FI", { maximumFractionDigits: 2, useGrouping: false });

/**
 * Lomakkeen tiliöintiehdotukset (DECISIONS 6.10.2026). Kun selite muuttuu,
 * ehdotukset haetaan palvelimelta viiveellä ja näytetään selitteen alla.
 * Valinta (napsautus, tai nuoli alas ja Enter) täyttää luokan, alv:n, osuudet ja
 * maatilan. Päivä ja summa jäävät käyttäjälle, eikä mitään tallenneta ennen
 * Lisää kirjaus -painiketta. Ilman valintaa Enter lähettää lomakkeen kuten ennen.
 */
export function FormPostingHint({ clientId, activity, vatRegistered }: { clientId: string; activity: Activity | null; vatRegistered: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { hint, request, clear } = usePostingSuggestions(clientId, activity);
  const [hi, setHi] = useState<number | null>(null);
  const hiRef = useRef(hi);
  hiRef.current = hi;
  const hintRef = useRef(hint);
  hintRef.current = hint;

  function field<T extends Element>(name: string): T | null {
    return (ref.current?.closest("form")?.elements.namedItem(name) as T | null) ?? null;
  }

  function apply(item: EntrySuggestion) {
    const set = (name: string, value: string) => {
      const el = field<HTMLInputElement | HTMLSelectElement>(name);
      if (el) el.value = value;
    };
    set("category", withLivestockDeferral(item.category, false));
    const deferral = field<HTMLInputElement>("livestockDeferral");
    if (deferral) deferral.checked = isLivestockDeferral(item.category);
    set("vatRate", vatRegistered ? fi(item.vatRate) : "");
    set("businessSharePct", item.businessSharePct === 100 ? "" : fi(item.businessSharePct));
    set("otherSharePct", item.otherSharePct ? fi(item.otherSharePct) : "");
    if (field("farmId")) set("farmId", item.farmId ?? "");
    // Osuus näkyviin, jos ehdotuksessa on osuus: muuten kenttä jäisi piiloon lisätietoihin.
    if (item.businessSharePct !== 100 || item.otherSharePct) field<HTMLInputElement>("businessSharePct")?.closest("details")?.setAttribute("open", "");
    clear();
    setHi(null);
    field<HTMLInputElement>("amountGross")?.focus();
  }
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const desc = field<HTMLInputElement>("description");
    if (!desc) return;
    const onInput = () => {
      setHi(null);
      const amount = Number((field<HTMLInputElement>("amountGross")?.value ?? "").replace(/\s/g, "").replace(",", "."));
      const date = field<HTMLInputElement>("bookedOn")?.value || new Date().toISOString().slice(0, 10);
      request("lomake", desc.value, date, Number.isFinite(amount) && amount ? amount : null);
    };
    const onKey = (e: KeyboardEvent) => {
      const h = hintRef.current;
      if (!h) return;
      const a = hintKeyAction(e.key, { count: h.items.length, highlighted: hiRef.current, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey || e.altKey });
      if (!a) return;
      e.preventDefault();
      if (a.type === "highlight") setHi(a.index);
      else if (a.type === "close") {
        clear();
        setHi(null);
      } else applyRef.current(h.items[a.index]);
    };
    const onBlur = () => {
      clear();
      setHi(null);
    };
    desc.addEventListener("input", onInput);
    desc.addEventListener("keydown", onKey);
    desc.addEventListener("blur", onBlur);
    return () => {
      desc.removeEventListener("input", onInput);
      desc.removeEventListener("keydown", onKey);
      desc.removeEventListener("blur", onBlur);
    };
  }, [request, clear]);

  return (
    // Ilman ehdotusta piilossa, jotta lomakkeen väli ei kasva.
    <div ref={ref} aria-live="polite" className={hint ? undefined : "hidden"}>
      {hint ? (
        <div role="listbox" aria-label="Tiliöintiehdotukset" className="rounded-xl border border-line bg-paper py-1 text-sm shadow-sm">
          <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/45">Ehdotus aiemmista tiliöinneistä</div>
          {hint.items.map((it, idx) => (
            <div
              key={`${it.category}-${idx}`}
              role="option"
              aria-selected={hi === idx}
              className={`cursor-pointer px-3 py-1.5 ${hi === idx ? "bg-sky-soft" : "hover:bg-cloud"}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(it)}
            >
              <span className="font-semibold">{it.label}</span>
              {it.source === "office" ? <span className="ml-2 rounded-full bg-amber-soft px-1.5 text-[10px] font-bold text-amber">toimisto</span> : null}
              <span className="block text-xs text-ink/60">{it.basis}</span>
            </div>
          ))}
          <div className="px-3 pb-1.5 pt-1 text-xs text-ink/55">Ehdotus. Napsauta tai valitse nuolella ja paina Enter. Summa ja päivä jäävät sinulle.</div>
        </div>
      ) : null}
    </div>
  );
}
