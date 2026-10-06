import Link from "next/link";
import { documentHref, pageLabel, suggestionAnchor } from "@/lib/ai/receipts/schema";
import { pendingSuggestionHref, type PendingOverviewItem } from "@/lib/documents/pending-overview";
import { formatDateTime, formatEur } from "@/lib/format";
import { ACTIVITY_LABEL, type Activity } from "@/lib/tax/rules";

/**
 * Tulkitut tositteet, jotka odottavat hyväksyntää: asiakkaan kaikki odottavat
 * ehdotukset kaikilta vuosilta ja kummastakin toiminnosta (DECISIONS 6.10.2026).
 * Näkyy Vuoden tositteet -paneelin yläosassa, jotta tulkinnat löytyvät, vaikka
 * kirjanpito olisi auki toisessa vuodessa tai toiminnossa. Ei näy, kun odottavia ei ole.
 */
export function PendingReceipts({
  clientId,
  items,
  year,
  view,
  both,
  gridShown,
}: {
  clientId: string;
  items: PendingOverviewItem[];
  year: number;
  view: Activity | null;
  /** Asiakkaalla on metsä- ja maataloutta: toiminto näytetään ja linkki vie oikeaan näkymään. */
  both: boolean;
  /** Ehdotusrivit ovat tämän sivun taulukossa (avoin vuosi, taulukkosyöttö). */
  gridShown: boolean;
}) {
  if (!items.length) return null;
  const here = (i: PendingOverviewItem) => gridShown && i.year === year && (!view || i.activity === view);
  const docs = new Set(items.map((i) => i.documentId)).size;
  return (
    <div id="odottavat" className="scroll-mt-6 border-b border-line bg-amber-soft px-5 py-4">
      <h3 className="font-bold">Tulkitut tositteet odottavat hyväksyntää</h3>
      <p className="mt-0.5 text-sm text-ink/70">
        {docs === 1 ? "Yhdestä tositteesta" : `${docs} tositteesta`} on ehdotus, jota ei ole vielä tallennettu kirjauksiksi. Ehdotukset pysyvät tallessa,
        vaikka lähtisit sivulta. Avaa ehdotus, tarkista rivit taulukossa ja tallenna.
      </p>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {items.map((i) => (
          <li key={i.suggestionId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-line bg-paper px-3 py-2">
            <span className="grid gap-0.5">
              <a href={documentHref(clientId, i.documentId, i.pages)} target="_blank" rel="noreferrer" className="font-semibold text-sky hover:underline">
                {i.fileName}
                {i.pages.length ? <span className="font-normal text-ink/60">, {pageLabel(i.pages)}</span> : null}
              </a>
              <span className="text-xs text-ink/65">
                Vuosi {i.year}
                {both ? `, ${ACTIVITY_LABEL[i.activity].toLowerCase()}` : ""}. {i.lineCount === 1 ? "1 rivi" : `${i.lineCount} riviä`}, yhteensä{" "}
                {formatEur(i.totalGross)}. Tunnistettu {formatDateTime(i.createdAt)}.
              </span>
            </span>
            {here(i) ? (
              <a href={`#${suggestionAnchor(i.suggestionId)}`} className="text-sm font-semibold text-sky hover:underline">
                Näkyy alla taulukossa
              </a>
            ) : (
              <Link href={pendingSuggestionHref(clientId, i, both)} className="text-sm font-semibold text-sky hover:underline">
                Avaa ehdotus
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
