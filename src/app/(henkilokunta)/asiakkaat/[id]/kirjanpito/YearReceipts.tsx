"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { YearReceipt } from "@/lib/documents/year-receipts";
import type { Activity } from "@/lib/tax/rules";
import { CHUNK_PARALLEL } from "@/lib/ai/receipts/config";
import { estimateText, failedPagesText, pageRangeText } from "@/lib/ai/receipts/chunks";
import {
  cancelRecognitionAction,
  confirmYearReceiptsAction,
  deleteYearReceiptAction,
  finishRecognitionAction,
  planYearReceiptsAction,
  recognizeChunkAction,
  startRecognitionAction,
  type StartedRecognition,
} from "./receipt-actions";

/** Toiminnon kirjanpidon nimi genetiivissä: "maatalouden kirjanpitoon". */
const VIEW_NAME: Record<Activity, string> = { forestry: "metsätalouden", agriculture: "maatalouden" };

const size = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("fi-FI", { maximumFractionDigits: 1 })} Mt` : `${Math.max(1, Math.round(b / 1024))} kt`;

/**
 * Vuoden tositteet kirjanpidon sivulla: lisäys (useita tiedostoja kerralla,
 * myös vetämällä) ja lista. Tiedostot ladataan suoraan tallennukseen
 * palvelimen antamilla osoitteilla, joten isokin skannaus onnistuu.
 *
 * Tositteet ovat asiakkaan ja vuoden yhteisiä: metsä- ja maatalouden
 * kirjanpito näyttävät saman listan (DECISIONS 2.10.2026). Tunnistus
 * aloitetaan näkymän toiminnolla, ja toisen toiminnon rivit menevät sen
 * näkymän taulukkoon, mikä kerrotaan tositteen kohdalla.
 */
export function YearReceipts({
  clientId,
  year,
  receipts,
  readOnly,
  testMode = false,
  gridMode = true,
  gridHref,
  view = null,
  otherViewHref = null,
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
  /** Kirjanpidon näkymä (toiminto). null = pelkkä metsäasiakas. */
  view?: Activity | null;
  /** Toisen toiminnon kirjanpito, kun asiakkaalla on molemmat. */
  otherViewHref?: string | null;
}) {
  const otherView: Activity | null = view && otherViewHref ? (view === "agriculture" ? "forestry" : "agriculture") : null;
  const pendingHere = (r: YearReceipt) => (view ? r.pending_activities.includes(view) : r.pending_suggestion);
  const pendingOther = (r: YearReceipt) => (otherView ? r.pending_activities.includes(otherView) : false);
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(() => receipts.some((r) => r.recognition));
  const [status, setStatus] = useState<{ tone: "info" | "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  // Tunnistus tosite kerrallaan, jotta yksi hidas tai epäonnistunut ei pysäytä muita.
  const [recognizing, setRecognizing] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  /**
   * Yhden tiedoston palat: selain kutsuu palat järjestyksessä, CHUNK_PARALLEL
   * kerrallaan, ja yrittää epäonnistunutta palaa kerran uudelleen. Palvelin
   * tallentaa jokaisen palan tuloksen, joten keskeytyksen jälkeen jatketaan
   * siitä, mihin jäätiin. Lopuksi palat yhdistetään yhdeksi ehdotukseksi.
   */
  async function runJob(
    job: StartedRecognition,
    name: string,
    many: string,
    allowPartial = false,
  ): Promise<{ ok: true; lines: number; other: number } | { ok: false; error: string }> {
    // Luetuista sivuista tehtäessä epäonnistuneita paloja ei yritetä enää.
    const todo = job.chunks.map((c, index) => ({ ...c, index })).filter((c) => (allowPartial ? c.status === "waiting" : c.status !== "done"));
    const total = job.chunks.length;
    let done = total - todo.length;
    const active = new Map<number, string>();
    let fatal: string | null = null;
    const show = () => {
      const ranges = [...active.values()].join(" ja ");
      const text =
        total === 1
          ? `Luetaan ${name}…`
          : active.size
            ? `Luetaan sivuja ${ranges} / ${job.pageCount || "?"} (${done}/${total} osaa valmiina)`
            : `Kootaan ehdotusta (${done}/${total} osaa luettu)…`;
      setProgress(text);
      setStatus({ tone: "info", text: `${many}${text}` });
    };
    const worker = async () => {
      for (let c = todo.shift(); c && !fatal; c = todo.shift()) {
        active.set(c.index, pageRangeText(c.first, c.last));
        show();
        let res = await recognizeChunkAction({ clientId, year, jobId: job.jobId, index: c.index });
        if (res.ok && res.value.status !== "done") res = await recognizeChunkAction({ clientId, year, jobId: job.jobId, index: c.index });
        active.delete(c.index);
        if (!res.ok) fatal = res.error;
        else if (res.value.status === "done") done++;
        show();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CHUNK_PARALLEL, Math.max(1, todo.length)) }, worker));
    if (fatal) return { ok: false, error: fatal };
    const fin = await finishRecognitionAction({ clientId, jobId: job.jobId, allowPartial });
    if (!fin.ok) return fin;
    if (fin.value.status === "incomplete") return { ok: false, error: `${fin.value.message ?? "Kaikkia sivuja ei voitu lukea."} Voit yrittää uudelleen tai tehdä ehdotuksen luetuista sivuista.` };
    return { ok: true, lines: fin.value.lines, other: otherView ? (fin.value.byActivity[otherView] ?? 0) : 0 };
  }

  async function recognize(docs: YearReceipt[], opts: { restart?: boolean; allowPartial?: boolean } = {}) {
    if (!docs.length || busy) return;
    setBusy(true);
    setFailed({});
    const errors: Record<string, string> = {};
    // 1. Palasuunnitelmat (ja kesken jääneet jatkoon).
    setStatus({ tone: "info", text: docs.length === 1 ? `Valmistellaan ${docs[0].file_name}…` : `Valmistellaan ${docs.length} tositetta…` });
    const jobs: { doc: YearReceipt; job: StartedRecognition }[] = [];
    for (const d of docs) {
      const res = await startRecognitionAction({ clientId, year, documentId: d.id, restart: opts.restart, activity: view });
      if (res.ok) jobs.push({ doc: d, job: res.value });
      else errors[d.id] = res.error;
    }
    // 2. Pitkästä tiedostosta aika-arvio ja vahvistus ennen aloitusta.
    const fresh = jobs.filter((j) => !j.job.resumed);
    const freshChunks = fresh.reduce((s, j) => s + j.job.chunks.length, 0);
    if (fresh.length && freshChunks > fresh.length) {
      const pages = fresh.reduce((s, j) => s + j.job.pageCount, 0);
      const summary = fresh.length === 1 ? fresh[0].job.estimate : `${fresh.length} tiedostoa: ${estimateText(pages, freshChunks)}`;
      if (!window.confirm(`${summary}. Tiedosto luetaan osissa. Voit jatkaa myöhemmin, jos sivu suljetaan kesken. Aloitetaanko?`)) {
        for (const j of fresh) await cancelRecognitionAction({ clientId, jobId: j.job.jobId });
        setBusy(false);
        setStatus(null);
        router.refresh();
        return;
      }
    }
    // 3. Palat tiedosto kerrallaan.
    let ok = 0;
    let other = 0;
    for (let i = 0; i < jobs.length; i++) {
      const { doc, job } = jobs[i];
      setRecognizing(doc.id);
      const res = await runJob(job, doc.file_name, jobs.length > 1 ? `${i + 1}/${jobs.length}: ` : "", opts.allowPartial);
      if (res.ok) {
        ok++;
        other += res.other;
      } else errors[doc.id] = res.error;
    }
    setRecognizing(null);
    setProgress(null);
    setFailed(errors);
    setBusy(false);
    const failCount = Object.keys(errors).length;
    const otherText =
      other && otherView
        ? ` ${other === 1 ? "Yksi rivi on" : `${other} riviä on`} ${VIEW_NAME[otherView]} tositteita, ja ne odottavat ${VIEW_NAME[otherView]} kirjanpidossa.`
        : "";
    const where = (gridMode ? "Ehdotukset ovat taulukossa sinisellä. Tarkista ne ja tallenna." : "Ehdotukset näkyvät taulukossa.") + otherText;
    if (ok && !failCount) setStatus({ tone: "ok", text: `${ok === 1 ? "Tosite tunnistettu." : `${ok} tositetta tunnistettu.`} ${where}` });
    else if (ok) setStatus({ tone: "error", text: `${ok} tunnistettu, ${failCount} ei voitu tunnistaa kokonaan. ${where}` });
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
            {otherView ? " Tositteet ovat yhteiset metsä- ja maataloudelle: sama lista näkyy kummassakin kirjanpidossa." : ""}
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
                Tekoäly lukee tositteen ja ehdottaa kirjauksia. Sinä tarkistat ne taulukossa ennen tallennusta. Tosite lähetetään tunnistuspalveluun. Pitkä skannaus luetaan osissa, ja voit jatkaa, jos sivu suljetaan kesken.
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
                disabled={busy || receipts.every((r) => r.pending_suggestion || r.booked_count > 0)}
                onClick={() => void recognize(receipts.filter((r) => !r.pending_suggestion && !r.booked_count))}
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
                    {recognizing === r.id ? <span className="text-xs text-ink/60">{progress ?? "Tunnistetaan…"}</span> : null}
                    {failed[r.id] ? <span className="text-xs text-coral">{failed[r.id]}</span> : null}
                    {r.recognition && recognizing !== r.id && !failed[r.id] ? <RecognitionState recognition={r.recognition} /> : null}
                    {pendingHere(r) && recognizing !== r.id ? <span className="text-xs font-semibold text-sky">Ehdotus taulukossa</span> : null}
                    {pendingOther(r) && otherView && otherViewHref && recognizing !== r.id ? (
                      <a href={otherViewHref} className="text-xs font-semibold text-sky hover:underline">
                        Ehdotus odottaa {VIEW_NAME[otherView]} kirjanpidossa
                      </a>
                    ) : null}
                    {r.booked_count ? (
                      <span className="text-xs font-semibold text-moss">
                        Kirjattu: {r.booked_count === 1 ? "yksi kirjaus" : `${r.booked_count} kirjausta`}. Tiedosto on vuoden tositeaineistona raportin liitteissä.
                      </span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3 text-ink/60">
                    {size(r.size_bytes)}
                    {!readOnly && r.recognition ? (
                      <RecognitionButtons
                        recognition={r.recognition}
                        disabled={busy}
                        onContinue={() => void recognize([r])}
                        onPartial={() => void recognize([r], { allowPartial: true })}
                        onRestart={() => {
                          if (window.confirm("Aloitetaanko tunnistus alusta? Jo luetut sivut luetaan uudelleen.")) void recognize([r], { restart: true });
                        }}
                      />
                    ) : null}
                    {!readOnly && !r.recognition ? (
                      <button
                        type="button"
                        className="font-semibold text-sky disabled:opacity-50"
                        disabled={busy}
                        onClick={() => {
                          if (r.pending_suggestion && !window.confirm("Tositteesta on jo ehdotus. Uusi tunnistus korvaa sen. Jatketaanko?")) return;
                          if (r.booked_count && !window.confirm("Tiedostosta on jo tehty kirjauksia. Uusi tunnistus ehdottaa samat rivit uudelleen. Jatketaanko?")) return;
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

type Recognition = NonNullable<YearReceipt["recognition"]>;

/** Kesken olevan tunnistuksen tila: "Tunnistus kesken: 3/6 osaa luettu" tai "Sivuja 17–24 ei voitu lukea." */
function RecognitionState({ recognition }: { recognition: Recognition }) {
  const done = recognition.chunks.filter((c) => c.status === "done").length;
  const waiting = recognition.chunks.some((c) => c.status === "waiting");
  const failedText = failedPagesText(recognition.chunks);
  if (!waiting && failedText) return <span className="text-xs text-coral">{failedText} Voit yrittää uudelleen tai tehdä ehdotuksen luetuista sivuista.</span>;
  return (
    <span className="text-xs font-semibold text-amber">
      Tunnistus kesken: {done}/{recognition.chunks.length} osaa luettu{recognition.pageCount ? ` (${recognition.pageCount} sivua)` : ""}.{failedText ? ` ${failedText}` : ""}
    </span>
  );
}

function RecognitionButtons({
  recognition,
  disabled,
  onContinue,
  onPartial,
  onRestart,
}: {
  recognition: Recognition;
  disabled: boolean;
  onContinue: () => void;
  onPartial: () => void;
  onRestart: () => void;
}) {
  const waiting = recognition.chunks.some((c) => c.status === "waiting");
  const failed = recognition.chunks.some((c) => c.status === "failed");
  const done = recognition.chunks.some((c) => c.status === "done");
  const cls = "font-semibold text-sky disabled:opacity-50";
  return (
    <>
      <button type="button" className={cls} disabled={disabled} onClick={onContinue}>
        {waiting ? "Jatka tunnistusta" : "Yritä uudelleen"}
      </button>
      {failed && done && !waiting ? (
        <button type="button" className={cls} disabled={disabled} onClick={onPartial}>
          Tee ehdotus luetuista sivuista
        </button>
      ) : null}
      <button type="button" className="text-ink/60 disabled:opacity-50" disabled={disabled} onClick={onRestart}>
        Aloita alusta
      </button>
    </>
  );
}
