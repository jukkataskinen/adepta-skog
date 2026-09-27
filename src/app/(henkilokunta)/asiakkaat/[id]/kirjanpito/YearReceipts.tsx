"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { YearReceipt } from "@/lib/documents/year-receipts";
import { confirmYearReceiptsAction, deleteYearReceiptAction, planYearReceiptsAction, recognizeReceiptAction } from "./receipt-actions";

const size = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} Mt` : `${Math.max(1, Math.round(b / 1024))} kt`;

/**
 * Vuoden tositteet kirjanpidon sivulla: lisäys (useita tiedostoja kerralla,
 * myös vetämällä) ja lista. Tiedostot ladataan suoraan tallennukseen
 * palvelimen antamilla osoitteilla, joten isokin skannaus onnistuu.
 */
export function YearReceipts({
  clientId,
  year,
  receipts,
  readOnly,
  testMode = false,
  gridMode = true,
  gridHref,
}: {
  clientId: string;
  year: number;
  receipts: YearReceipt[];
  readOnly: boolean;
  /** Tunnistus on testitilassa (ei avainta): ehdotus tehdään tiedostonimestä. */
  testMode?: boolean;
  /** Taulukko on näkyvissä: ehdotukset näkyvät siinä. */
  gridMode?: boolean;
  gridHref?: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<{ tone: "info" | "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  // Tunnistus tosite kerrallaan, jotta yksi hidas tai epäonnistunut ei pysäytä muita.
  const [recognizing, setRecognizing] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  async function recognize(docs: YearReceipt[]) {
    if (!docs.length || busy) return;
    setBusy(true);
    setFailed({});
    let ok = 0;
    const errors: Record<string, string> = {};
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      setRecognizing(d.id);
      setStatus({ tone: "info", text: docs.length === 1 ? `Tunnistetaan ${d.file_name}…` : `Tunnistetaan ${i + 1}/${docs.length}: ${d.file_name}` });
      const res = await recognizeReceiptAction({ clientId, year, documentId: d.id });
      if (res.ok) ok++;
      else errors[d.id] = res.error;
    }
    setRecognizing(null);
    setFailed(errors);
    setBusy(false);
    const failCount = Object.keys(errors).length;
    const where = gridMode ? "Ehdotukset ovat taulukossa sinisellä. Tarkista ne ja tallenna." : "Ehdotukset näkyvät taulukossa.";
    if (ok && !failCount) setStatus({ tone: "ok", text: `${ok === 1 ? "Tosite tunnistettu." : `${ok} tositetta tunnistettu.`} ${where}` });
    else if (ok) setStatus({ tone: "error", text: `${ok} tunnistettu, ${failCount} ei voitu tunnistaa. ${where}` });
    else setStatus({ tone: "error", text: docs.length === 1 ? Object.values(errors)[0] : "Tositteita ei voitu tunnistaa. Voit kirjata ne käsin taulukkoon." });
    router.refresh();
  }

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setStatus({ tone: "info", text: files.length === 1 ? "Ladataan tositetta…" : `Ladataan ${files.length} tositetta…` });
    const plan = await planYearReceiptsAction({ clientId, year, files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })) });
    if (!plan.ok) {
      setStatus({ tone: "error", text: plan.error });
      setBusy(false);
      return;
    }
    const done: { id: string; fileName: string; contentType: string }[] = [];
    for (let i = 0; i < plan.value.length; i++) {
      const p = plan.value[i];
      const file = files[i];
      setStatus({ tone: "info", text: `Ladataan ${i + 1}/${plan.value.length}: ${p.fileName}` });
      let body: BodyInit = file;
      if (p.form) {
        // Supabasen allekirjoitettu latausosoite ottaa tiedoston FormDatana, kuten supabase-js lähettää sen.
        const fd = new FormData();
        fd.append("cacheControl", "3600");
        fd.append("", file);
        body = fd;
      }
      const res = await fetch(p.url, { method: "PUT", body, headers: p.form ? { "x-upsert": "false" } : { "Content-Type": p.contentType } });
      if (!res.ok) {
        setStatus({ tone: "error", text: `${p.fileName}: lataus epäonnistui. Yritä uudelleen.` });
        setBusy(false);
        return;
      }
      done.push({ id: p.id, fileName: p.fileName, contentType: p.contentType });
    }
    const confirmed = await confirmYearReceiptsAction({ clientId, year, uploads: done });
    setBusy(false);
    if (!confirmed.ok) {
      setStatus({ tone: "error", text: confirmed.error });
      return;
    }
    setStatus({ tone: "ok", text: confirmed.value === 1 ? "Tosite tallennettu." : `${confirmed.value} tositetta tallennettu.` });
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <section id="tositteet" className="mb-6 scroll-mt-6 rounded-[var(--radius-panel)] border border-line bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="font-bold">Vuoden tositteet</h2>
          <p className="text-sm text-ink/65">
            {receipts.length === 1 ? "1 tiedosto. " : receipts.length ? `${receipts.length} tiedostoa. ` : "Ei vielä tositteita. "}
            Tositteet liitetään lopullisen veroraportin loppuun, kun vuosi suljetaan.
            {!readOnly && receipts.length ? " Tunnista-painike tekee tositteesta kirjausehdotuksen taulukkoon." : ""}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-10 items-center rounded-xl bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink/85"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {readOnly ? "Näytä tositteet" : "Lisää tositteet"}
        </button>
      </div>
      {open ? (
        <div className="grid gap-4 border-t border-line px-5 py-4">
          {!readOnly ? (
            <label
              className={`grid cursor-pointer place-items-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm ${drag ? "border-sky bg-sky-soft" : "border-line bg-cloud/50"}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void upload(Array.from(e.dataTransfer.files));
              }}
            >
              <span className="font-semibold">Vedä tiedostot tähän tai valitse ne</span>
              <span className="text-ink/60">PDF, JPG tai PNG, enintään 25 Mt tiedostoa kohden. Voit valita useita kerralla.</span>
              <input
                ref={input}
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png"
                className="sr-only"
                disabled={busy}
                onChange={(e) => void upload(Array.from(e.target.files ?? []))}
              />
            </label>
          ) : null}
          {!readOnly && receipts.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sky-soft/50 px-4 py-3 text-sm">
              <p className="text-ink/75">
                Tekoäly lukee tositteen ja ehdottaa kirjauksia. Sinä tarkistat ne taulukossa ennen tallennusta. Tosite lähetetään tunnistuspalveluun.
                {testMode ? " Tunnistus on nyt testitilassa: ehdotus tehdään tiedostonimestä, eikä tositetta lähetetä minnekään." : ""}
                {!gridMode && gridHref ? (
                  <>
                    {" "}
                    <a href={gridHref} className="font-semibold text-sky">
                      Avaa taulukko
                    </a>
                    , niin näet ehdotukset.
                  </>
                ) : null}
              </p>
              <button
                type="button"
                className="inline-flex min-h-9 items-center rounded-xl border border-sky px-3 text-sm font-semibold text-sky hover:bg-sky-soft disabled:opacity-50"
                disabled={busy || receipts.every((r) => r.pending_suggestion)}
                onClick={() => void recognize(receipts.filter((r) => !r.pending_suggestion))}
              >
                Tunnista kaikki
              </button>
            </div>
          ) : null}
          {status ? (
            <p role="status" className={`text-sm ${status.tone === "error" ? "text-coral" : status.tone === "ok" ? "text-moss" : "text-ink/70"}`}>
              {status.text}
            </p>
          ) : null}
          {receipts.length ? (
            <ul className="grid gap-2 text-sm">
              {receipts.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                  <span className="grid gap-0.5">
                    <a href={`/asiakkaat/${clientId}/tositteet/${r.id}`} target="_blank" rel="noreferrer" className="font-semibold text-sky">
                      {r.file_name}
                    </a>
                    {recognizing === r.id ? <span className="text-xs text-ink/60">Tunnistetaan…</span> : null}
                    {failed[r.id] ? <span className="text-xs text-coral">{failed[r.id]}</span> : null}
                    {r.pending_suggestion && recognizing !== r.id ? <span className="text-xs font-semibold text-sky">Ehdotus taulukossa</span> : null}
                  </span>
                  <span className="flex items-center gap-3 text-ink/60">
                    {size(r.size_bytes)}
                    {!readOnly ? (
                      <button
                        type="button"
                        className="font-semibold text-sky disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          if (r.pending_suggestion && !window.confirm("Tositteesta on jo ehdotus. Uusi tunnistus korvaa sen. Jatketaanko?")) return;
                          void recognize([r]);
                        }}
                      >
                        {r.pending_suggestion ? "Tunnista uudelleen" : "Tunnista"}
                      </button>
                    ) : null}
                    {!readOnly ? (
                      <form
                        action={deleteYearReceiptAction}
                        onSubmit={(e) => {
                          if (!window.confirm("Poistetaanko tosite?")) e.preventDefault();
                        }}
                      >
                        <input type="hidden" name="clientId" value={clientId} />
                        <input type="hidden" name="documentId" value={r.id} />
                        <input type="hidden" name="year" value={year} />
                        <button className="text-coral">Poista</button>
                      </form>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
