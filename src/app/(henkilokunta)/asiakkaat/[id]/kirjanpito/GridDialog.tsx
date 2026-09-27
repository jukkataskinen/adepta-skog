"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Taulukon ponnahdusikkuna (ennakonpidätys, hankintatyö, investointi). Fokus
 * pysyy ikkunan sisällä, Esc sulkee, ja taulukko palauttaa fokuksen itse, koska
 * se tietää, mihin kenttään kirjaus jatkuu. Puhelimella ikkuna on näytön levyinen.
 */
export function GridDialog({ title, subtitle, children, onEscape }: { title: string; subtitle?: ReactNode; children: ReactNode; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-paper p-5 text-sm shadow-xl sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        {subtitle ? <p className="mt-1 text-ink/65">{subtitle}</p> : null}
        <div className="mt-4 grid gap-4">{children}</div>
      </div>
    </div>
  );
}
