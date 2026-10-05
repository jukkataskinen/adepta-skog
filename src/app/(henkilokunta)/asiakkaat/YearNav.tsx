"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import type { YearInfo } from "@/lib/ledger/queries";

/**
 * Verovuoden valinta asiakkaan välilehdillä. Pudotusvalikko, koska Tilitukista tuoduilla
 * asiakkailla vuosia on parikymmentä. query säilyy vuotta vaihdettaessa (esimerkiksi toiminta=maatalous).
 * Ilman JavaScriptiä lomake lähetetään Näytä-napilla.
 */
export function YearNav({ years, year, basePath, query }: { years: YearInfo[]; year: number; basePath: string; query?: string }) {
  const router = useRouter();
  const extra = new URLSearchParams(query ?? "");
  return (
    <form action={basePath} method="get" className="mb-5 flex items-center gap-2" aria-label="Verovuosi">
      <label htmlFor="vuosi" className="text-sm font-semibold">
        Verovuosi
      </label>
      <Select
        id="vuosi"
        name="vuosi"
        key={year}
        defaultValue={String(year)}
        className="w-auto"
        onChange={(e) => {
          const p = new URLSearchParams(extra);
          p.set("vuosi", e.target.value);
          router.push(`${basePath}?${p.toString()}`);
        }}
      >
        {years.map((y) => (
          <option key={y.year} value={y.year}>
            {y.year}
            {y.status === "closed" ? " (suljettu)" : ""}
          </option>
        ))}
      </Select>
      {[...extra.entries()].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <noscript>
        <button type="submit" className="text-sm font-semibold text-sky">
          Näytä
        </button>
      </noscript>
    </form>
  );
}
