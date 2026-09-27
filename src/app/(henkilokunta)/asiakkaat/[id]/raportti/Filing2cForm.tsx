"use client";

import { useState, type FormEvent } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { deliveryWorkTaxable } from "@/lib/filing/vsy02c";

interface WorkerRow {
  name: string;
  personalId: string;
  madeM3: string;
  transportedM3: string;
  value: string;
  /** Käyttäjän kirjoittama veronalainen arvo; tyhjä = lasketaan määrästä. */
  taxableValue: string;
}

const num = (v: string) => {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const fmt = (n: number) => (n ? String(n).replace(".", ",") : "");
const eur = (n: number) => n.toLocaleString("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Sähköisen 2C-ilmoituksen lomake. Henkilötunnukset ovat vain tämän lomakkeen
 * tilassa ja lähtevät POST-pyynnön rungossa; niitä ei tallenneta mihinkään,
 * ja kentät tyhjennetään, kun tiedosto on ladattu. Virhe näytetään tässä eikä
 * osoitteessa, koska lomakkeen tiedot eivät saa päätyä URL-osoitteeseen.
 */
export function Filing2cForm({
  clientId,
  year,
  businessId,
  deliveryWork,
  defaultWorkers,
  blocked,
}: {
  clientId: string;
  year: number;
  businessId: string | null;
  deliveryWork: number;
  defaultWorkers: { name: string; value: number; madeM3: number | null }[];
  blocked: boolean;
}) {
  const [idType, setIdType] = useState<"business_id" | "personal_id">(businessId ? "business_id" : "personal_id");
  const [filerPersonalId, setFilerPersonalId] = useState("");
  const [itemize, setItemize] = useState(deliveryWork > 0);
  const [workers, setWorkers] = useState<WorkerRow[]>(() =>
    (defaultWorkers.length ? defaultWorkers : deliveryWork > 0 ? [{ name: "", value: deliveryWork, madeM3: null }] : []).map((w) => ({
      name: w.name,
      personalId: "",
      madeM3: fmt(w.madeM3 ?? 0),
      transportedM3: "",
      value: fmt(w.value),
      taxableValue: "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const totalMade = workers.reduce((s, w) => s + num(w.madeM3), 0);
  const workersTotal = workers.reduce((s, w) => s + num(w.value), 0);
  const taxableOf = (w: WorkerRow) => (w.taxableValue.trim() ? num(w.taxableValue) : deliveryWorkTaxable(num(w.value), totalMade));
  const update = (i: number, patch: Partial<WorkerRow>) => setWorkers(workers.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    const fd = new FormData();
    fd.set("filerIdType", idType);
    if (idType === "personal_id") fd.set("filerPersonalId", filerPersonalId);
    fd.set("itemizeWorkers", itemize ? "1" : "0");
    fd.set("workerCount", String(itemize ? workers.length : 0));
    if (itemize)
      workers.forEach((w, i) => {
        fd.set(`w${i}_name`, w.name);
        fd.set(`w${i}_personalId`, w.personalId);
        fd.set(`w${i}_madeM3`, w.madeM3);
        fd.set(`w${i}_transportedM3`, w.transportedM3);
        fd.set(`w${i}_value`, w.value);
        fd.set(`w${i}_taxableValue`, String(taxableOf(w)));
      });
    try {
      const res = await fetch(`/asiakkaat/${clientId}/veroilmoitus/${year}`, { method: "POST", body: fd, cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Tiedoston muodostus ei onnistunut.");
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `2C_${year}.txt`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      // Henkilötunnukset pois näkyvistä heti latauksen jälkeen.
      setFilerPersonalId("");
      setWorkers((ws) => ws.map((w) => ({ ...w, personalId: "" })));
      setDone(name);
    } catch {
      setError("Yhteys palvelimeen katkesi. Yritä uudelleen.");
    } finally {
      setBusy(false);
    }
  }

  const radio = (value: "business_id" | "personal_id", label: string) => (
    <label className="flex items-center gap-2">
      <input type="radio" name="filerIdType" value={value} checked={idType === value} onChange={() => setIdType(value)} />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} className="grid gap-5" autoComplete="off">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Ilmoittajan tunnus</legend>
        {businessId ? (
          <div className="flex flex-wrap gap-4 text-sm">
            {radio("business_id", `Y-tunnus ${businessId}`)}
            {radio("personal_id", "Henkilötunnus")}
          </div>
        ) : (
          <p className="text-sm text-ink/70">Asiakkaalla ei ole Y-tunnusta, joten ilmoitus annetaan henkilötunnuksella.</p>
        )}
        {idType === "personal_id" ? (
          <div className="max-w-xs">
            <Input
              aria-label="Ilmoittajan henkilötunnus"
              placeholder="ppkkvv-nnnt"
              value={filerPersonalId}
              onChange={(e) => setFilerPersonalId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </div>
        ) : null}
      </fieldset>

      {deliveryWork > 0 || workers.length ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-semibold">Hankintatyön tekijät</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={itemize} onChange={(e) => setItemize(e.target.checked)} />
            Erittele tekijät ilmoitukselle (Tehty hankintatyö)
          </label>
          {itemize ? (
            <>
              <p className="text-sm text-ink/70">
                Ilmoita jokainen tekijä erikseen. Tekijät on haettu Hankintatyö-kirjausten selitteistä. Hankintatyö kirjanpidossa yhteensä {eur(deliveryWork)} €.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left text-sm">
                  <thead className="text-xs text-ink/60">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">Nimi</th>
                      <th className="py-1 pr-2 font-semibold">Henkilötunnus</th>
                      <th className="py-1 pr-2 font-semibold">Valmistettu m³</th>
                      <th className="py-1 pr-2 font-semibold">Kuljetettu m³</th>
                      <th className="py-1 pr-2 font-semibold">Arvo €</th>
                      <th className="py-1 pr-2 font-semibold">Veronalainen arvo €</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map((w, i) => (
                      <tr key={i}>
                        <td className="py-1 pr-2">
                          <Input aria-label={`Tekijän ${i + 1} nimi`} value={w.name} onChange={(e) => update(i, { name: e.target.value })} />
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            aria-label={`Tekijän ${i + 1} henkilötunnus`}
                            placeholder="ppkkvv-nnnt"
                            value={w.personalId}
                            onChange={(e) => update(i, { personalId: e.target.value })}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <Input aria-label={`Tekijän ${i + 1} valmistettu määrä`} inputMode="decimal" value={w.madeM3} onChange={(e) => update(i, { madeM3: e.target.value })} className="text-right" />
                        </td>
                        <td className="py-1 pr-2">
                          <Input aria-label={`Tekijän ${i + 1} kuljetettu määrä`} inputMode="decimal" value={w.transportedM3} onChange={(e) => update(i, { transportedM3: e.target.value })} className="text-right" />
                        </td>
                        <td className="py-1 pr-2">
                          <Input aria-label={`Tekijän ${i + 1} arvo`} inputMode="decimal" value={w.value} onChange={(e) => update(i, { value: e.target.value })} className="text-right" />
                        </td>
                        <td className="py-1 pr-2">
                          <Input
                            aria-label={`Tekijän ${i + 1} veronalainen arvo`}
                            inputMode="decimal"
                            placeholder={eur(taxableOf({ ...w, taxableValue: "" }))}
                            value={w.taxableValue}
                            onChange={(e) => update(i, { taxableValue: e.target.value })}
                            className="text-right"
                          />
                        </td>
                        <td className="py-1">
                          <Button type="button" variant="ghost" onClick={() => setWorkers(workers.filter((_, j) => j !== i))} aria-label={`Poista tekijä ${i + 1}`}>
                            Poista
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Button type="button" variant="secondary" onClick={() => setWorkers([...workers, { name: "", personalId: "", madeM3: "", transportedM3: "", value: "", taxableValue: "" }])}>
                  Lisää tekijä
                </Button>
                <span className={Math.abs(workersTotal - deliveryWork) > 0.004 ? "font-semibold text-amber" : "text-ink/60"}>
                  Tekijöiden arvot yhteensä {eur(workersTotal)} €
                  {Math.abs(workersTotal - deliveryWork) > 0.004 ? ", eri kuin kirjanpidon hankintatyö. Tarkista, onko osa työstä tehty toisena vuonna." : "."}
                </span>
              </div>
              <p className="text-xs text-ink/55">
                Veronalainen arvo lasketaan, jos puuta on yli 125 m³: arvo × (m³ − 125) / m³. Voit kirjoittaa oman luvun kenttään.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink/70">Hankintatyön arvo menee ilmoitukselle, mutta tekijöitä ei eritellä. Silloin henkilötunnuksia ei tarvita.</p>
          )}
        </fieldset>
      ) : null}

      <p className="text-xs text-ink/55">Henkilötunnusta ei tallenneta Skogiin. Se on vain ladattavassa tiedostossa, joten säilytä tiedosto huolellisesti ja poista se, kun olet lähettänyt sen.</p>

      {error ? (
        <Notice tone="alert" title="Tiedostoa ei muodostettu.">
          {error}
        </Notice>
      ) : null}
      {done ? (
        <Notice tone="ok" title={`Tiedosto ${done} on ladattu.`}>
          Lataa se seuraavaksi Ilmoitin.fi-palveluun. Ohje on alla.
        </Notice>
      ) : null}

      <div>
        <Button type="submit" disabled={busy || blocked}>
          {busy ? "Muodostetaan…" : "Lataa ilmoitustiedosto"}
        </Button>
      </div>
    </form>
  );
}
