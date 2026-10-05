import Link from "next/link";
import { Badge, Button, LinkButton, Table, Td, Th } from "@/components/ui";
import { formatEur } from "@/lib/format";
import { MONTH_NAMES } from "@/lib/ledger/grid";
import type { ExpectedState, ExpectedSummary } from "@/lib/ledger/expected";
import { category } from "@/lib/tax/rules";
import { skipExpectedAction } from "./actions";

/**
 * Odotetut kirjaukset kirjanpidon sivulla: aiempien vuosien toistuvat
 * kirjaukset ja niiden tila tänä vuonna (src/lib/ledger/expected.ts).
 * Lisää kirjaukseksi avaa lomakkeen esitäytettynä, jotta kirjanpitäjä
 * tarkistaa summan ennen tallennusta. Suljettu vuosi on vain luettavana.
 */
export function ExpectedEntries({
  clientId,
  year,
  viewQuery,
  toiminta,
  states,
  summary,
  historyYears,
  readOnly,
  open,
}: {
  clientId: string;
  year: number;
  /** Näkymän osoiteosa, esim. "&toiminta=maatalous" tai "". */
  viewQuery: string;
  /** Näkymän parametri lomakkeelle (tyhjä = oletus). */
  toiminta: string;
  states: ExpectedState[];
  summary: ExpectedSummary;
  historyYears: number;
  readOnly: boolean;
  open: boolean;
}) {
  const base = `/asiakkaat/${clientId}/kirjanpito?vuosi=${year}${viewQuery}`;
  const missing = summary.late;
  return (
    <details id="odotetut" className="mb-6 rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4" open={open}>
      <summary className="cursor-pointer">
        <span className="font-semibold">Odotetut kirjaukset</span>
        <span className="ml-2 text-sm text-ink/70">
          {states.length ? (
            <>
              {summary.expected} odotettua, {summary.booked} kirjattu,{" "}
              <span className={missing ? "font-semibold text-coral" : undefined}>{missing} puuttuu</span>
              {summary.skipped ? `, ${summary.skipped} ohitettu` : ""}
            </>
          ) : historyYears ? (
            "Ei toistuvia kirjauksia"
          ) : (
            "Ennuste alkaa toisesta vuodesta"
          )}
        </span>
      </summary>
      <div className="mt-4">
        {!historyYears ? (
          <p className="text-sm text-ink/70">
            Odotetut kirjaukset lasketaan asiakkaan aiempien vuosien kirjauksista. Tällä asiakkaalla ei ole kirjauksia edellisiltä vuosilta. Ennuste alkaa
            toisesta vuodesta: kun tämän vuoden kirjaukset on tehty, ohjelma ehdottaa niistä ensi vuoden odotetut kirjaukset.
          </p>
        ) : !states.length ? (
          <p className="text-sm text-ink/70">
            Aiemmilta vuosilta ei löytynyt kirjauksia, jotka toistuvat vuodesta toiseen. Kirjaus on toistuva, kun se on ollut ainakin kahtena kolmesta
            edellisestä vuodesta.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink/70">
              Kirjaukset, jotka ovat toistuneet edellisinä vuosina. Kirjattu tarkoittaa, että tältä vuodelta löytyy saman luokan kirjaus, jonka selite on
              samanlainen tai summa lähellä arviota.{readOnly ? " Vuosi on suljettu, joten voit vain katsoa listaa." : ""}
            </p>
            <Table>
              <thead>
                <tr>
                  <Th>Milloin</Th>
                  <Th>Kirjaus</Th>
                  <Th numeric>Arvio (sis. alv)</Th>
                  <Th>Aiemmin</Th>
                  <Th>Tila</Th>
                  {readOnly ? null : <Th />}
                </tr>
              </thead>
              <tbody>
                {states.map((s) => {
                  const bookedId = s.states.find((x) => x.transactionId)?.transactionId;
                  return (
                    <tr key={s.key} className={s.skipped ? "text-ink/55" : undefined}>
                      <Td className="whitespace-nowrap">{whenLabel(s)}</Td>
                      <Td>
                        {s.description || <span className="text-ink/55">Ei selitettä</span>}
                        <span className="block text-xs text-ink/55">{category(s.category)?.label ?? s.category}</span>
                      </Td>
                      <Td numeric className="whitespace-nowrap">
                        <span className="font-semibold">{formatEur(s.estimate)}</span>
                        {s.min !== s.max ? (
                          <span className="block text-xs text-ink/55">
                            {formatEur(s.min)} – {formatEur(s.max)}
                          </span>
                        ) : null}
                      </Td>
                      <Td className="whitespace-nowrap text-sm">
                        {s.recentYears}/{s.lookbackYears} vuotta
                        <span className="block text-xs text-ink/55">{s.confidence === "high" ? "Joka vuosi" : s.confidence === "low" ? "Vain edellinen vuosi" : "Useimpina vuosina"}</span>
                      </Td>
                      <Td>
                        <StatusBadge s={s} />
                        {bookedId ? (
                          <Link href={`/asiakkaat/${clientId}/kirjanpito/${bookedId}`} className="mt-1 block text-xs font-semibold text-sky hover:underline">
                            Avaa kirjaus
                          </Link>
                        ) : null}
                      </Td>
                      {readOnly ? null : (
                        <Td>
                          <div className="flex flex-wrap items-center gap-2">
                            {s.next && !s.skipped ? (
                              <LinkButton variant="secondary" href={`${base}&syotto=lomake&odotettu=${s.key}#uusi`} className="min-h-9 px-3">
                                Lisää kirjaukseksi
                              </LinkButton>
                            ) : null}
                            {s.skipped || s.next ? (
                              <form action={skipExpectedAction}>
                                <input type="hidden" name="clientId" value={clientId} />
                                <input type="hidden" name="year" value={year} />
                                <input type="hidden" name="key" value={s.key} />
                                <input type="hidden" name="skip" value={s.skipped ? "0" : "1"} />
                                {toiminta ? <input type="hidden" name="toiminta" value={toiminta} /> : null}
                                <Button variant="ghost" className="min-h-9 px-3">
                                  {s.skipped ? "Palauta" : "Ei tule tänä vuonna"}
                                </Button>
                              </form>
                            ) : null}
                          </div>
                        </Td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </details>
  );
}

function whenLabel(s: ExpectedState): string {
  if (s.perYear >= 12) return "Kuukausittain";
  const months = [...new Set(s.instances.map((i) => i.month))].map((m) => MONTH_NAMES[m - 1].toLowerCase());
  const text = months.join(", ") + (s.perYear > months.length ? ` (${s.perYear} kertaa)` : "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function StatusBadge({ s }: { s: ExpectedState }) {
  const total = s.states.length;
  const part = total > 1 ? ` ${s.booked}/${total}` : "";
  if (s.skipped && s.booked < total) return <Badge tone="neutral">Ohitettu</Badge>;
  if (s.booked === total) return <Badge tone="ok">Kirjattu</Badge>;
  if (s.late) return <Badge tone="alert">Myöhässä{part}</Badge>;
  return <Badge tone="warn">Tulossa{part}</Badge>;
}
