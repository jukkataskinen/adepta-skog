import Link from "next/link";
import type { YearInfo } from "@/lib/ledger/queries";

/** Verovuoden valinta asiakkaan välilehdillä. */
export function YearNav({ years, year, basePath }: { years: YearInfo[]; year: number; basePath: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-2" aria-label="Verovuosi">
      {years.map((y) => (
        <Link
          key={y.year}
          href={`${basePath}?vuosi=${y.year}`}
          aria-current={y.year === year ? "page" : undefined}
          className={`rounded-full border px-3 py-1 text-sm font-semibold ${y.year === year ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink/70 hover:text-ink"}`}
        >
          {y.year}
          {y.status === "closed" ? " · suljettu" : ""}
        </Link>
      ))}
    </nav>
  );
}
