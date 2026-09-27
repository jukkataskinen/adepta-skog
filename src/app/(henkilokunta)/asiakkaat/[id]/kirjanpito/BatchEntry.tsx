"use client";

import { useEffect, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button, Notice } from "@/components/ui";
import { CATEGORIES, CATEGORY_GROUPS, category } from "@/lib/tax/rules";
import { formatEur } from "@/lib/format";
import {
  BATCH_FIELDS,
  INVESTMENT_HINT,
  TABLE_EXCLUDED_CATEGORIES,
  applyPaste,
  emptyBatchRow,
  isBlankRow,
  parseAmount,
  parseClipboard,
  previewRow,
  type BatchField,
  type BatchRowInput,
  type BatchState,
  type RowErrors,
} from "@/lib/ledger/transaction-input";

const LABELS: Record<BatchField, string> = {
  bookedOn: "Päivä",
  category: "Luokka",
  description: "Selite",
  amountNet: "Ilman alv (€)",
  vatRate: "Alv %",
  withholding: "Ennakonpidätys",
  reference: "Viite",
  forestPropertyId: "Metsätila",
};

let seq = 0;
const newKey = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Taulukkosyöttö: monta kirjausta kerralla näppäimistöllä tai Excelistä
 * liittämällä. Tarkistus ja laskenta ovat puhtaissa funktioissa
 * (src/lib/ledger/transaction-input.ts); tämä komponentti vain näyttää ne.
 */
export function BatchEntry({
  action,
  clientId,
  year,
  defaultDate,
  properties,
}: {
  action: (formData: FormData) => Promise<BatchState>;
  clientId: string;
  year: number;
  defaultDate: string;
  properties: { id: string; name: string }[];
}) {
  // Metsätilasarake vain, jos asiakkaalla on tiloja. Liitetyt sarakkeet tulkitaan silti samassa järjestyksessä.
  const fields = properties.length ? BATCH_FIELDS : BATCH_FIELDS.filter((f) => f !== "forestPropertyId");
  const [rows, setRows] = useState<BatchRowInput[]>(() => [emptyBatchRow(newKey(), defaultDate)]);
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [result, setResult] = useState<BatchState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [focus, setFocus] = useState<{ row: number; col: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  function focusCell(row: number, col: number): boolean {
    const el = tableRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-cell="${row}-${col}"]`);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    return true;
  }

  // Olemassa olevaan kenttään siirrytään heti, jotta nopeasti kirjoitetut merkit eivät jää edelliseen
  // kenttään. Uusi rivi ei ole vielä sivulla, joten siihen siirrytään renderöinnin jälkeen.
  function moveTo(row: number, col: number) {
    if (!focusCell(row, col)) setFocus({ row, col });
  }
  useEffect(() => {
    if (focus) focusCell(focus.row, focus.col);
  }, [focus]);

  const filled = rows.filter((r) => !isBlankRow(r));

  function update(index: number, field: BatchField, value: string) {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
    const key = rows[index]?.key;
    if (key && errors[key]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
    }
  }

  function addRow(after: number, col = 0) {
    // Uusi rivi saa edellisen rivin päivän: samana päivänä on usein monta kirjausta.
    const prev = rows[after];
    setRows((rs) => [...rs.slice(0, after + 1), emptyBatchRow(newKey(), prev?.bookedOn ?? defaultDate), ...rs.slice(after + 1)]);
    setFocus({ row: after + 1, col });
  }

  function removeRow(index: number) {
    setRows((rs) => (rs.length === 1 ? [emptyBatchRow(newKey(), defaultDate)] : rs.filter((_, i) => i !== index)));
    setFocus({ row: Math.max(0, Math.min(index, rows.length - 2)), col: 0 });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, row: number, col: number) {
    const last = fields.length - 1;
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      if (col < last) moveTo(row, col + 1);
      else if (row < rows.length - 1) moveTo(row + 1, 0);
      else addRow(row);
    } else if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Tab" && !e.shiftKey && col === last && row === rows.length - 1) {
      e.preventDefault();
      addRow(row);
    } else if (e.currentTarget instanceof HTMLInputElement && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      // Valintalistoissa nuolet vaihtavat arvoa, joten rivien välillä liikutaan nuolilla vain tekstikentissä.
      e.preventDefault();
      const next = e.key === "ArrowDown" ? row + 1 : row - 1;
      if (next >= 0 && next < rows.length) moveTo(next, col);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement | HTMLSelectElement>, row: number, col: number) {
    const text = e.clipboardData.getData("text/plain");
    // Yksittäinen arvo liitetään kenttään tavalliseen tapaan.
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
    e.preventDefault();
    const grid = parseClipboard(text);
    setRows((rs) => applyPaste(rs, row, col, grid, { year, properties, fields, newKey }));
    setErrors({});
    setResult({ status: "idle" });
  }

  function save() {
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("year", String(year));
    fd.set("rows", JSON.stringify(rows));
    startTransition(async () => {
      const res = await action(fd);
      setResult(res);
      if (res.status === "error") setErrors(res.rowErrors);
      if (res.status === "saved") {
        setErrors({});
        setRows([emptyBatchRow(newKey(), defaultDate)]);
        setFocus({ row: 0, col: 0 });
      }
    });
  }

  const totalNet = filled.reduce((s, r) => {
    const n = parseAmount(r.amountNet);
    return n !== null && Number.isFinite(n) ? s + n : s;
  }, 0);

  return (
    <div className="grid gap-4">
      {result.status === "saved" ? (
        <Notice tone="ok" title={result.count === 1 ? "Yksi kirjaus tallennettu." : `${result.count} kirjausta tallennettu.`} />
      ) : null}
      {result.status === "error" ? <Notice tone="alert" title={result.message} /> : null}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table ref={tableRef} className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-cloud/60 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="w-8 px-2 py-2 text-right">#</th>
              {fields.map((f) => (
                <th key={f} className={`px-2 py-2 ${["amountNet", "vatRate", "withholding"].includes(f) ? "text-right" : ""}`}>
                  {LABELS[f]}
                </th>
              ))}
              <th className="px-2 py-2 text-right">Yhteensä</th>
              <th className="w-10 px-2 py-2">
                <span className="sr-only">Poista</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowErr = errors[r.key] ?? {};
              const preview = previewRow(r, year);
              const investment = TABLE_EXCLUDED_CATEGORIES.includes(r.category);
              const messages = [...new Set(Object.values(rowErr))];
              if (investment && !messages.includes(INVESTMENT_HINT)) messages.unshift(INVESTMENT_HINT);
              const cell = (f: BatchField) =>
                `w-full rounded-md border bg-paper px-2 py-1.5 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30 ${
                  rowErr[f] || (f === "category" && investment) ? "border-coral" : "border-line"
                } ${["amountNet", "vatRate", "withholding"].includes(f) ? "text-right tabular" : ""}`;
              return [
                <tr key={r.key} className="border-t border-line align-top">
                  <td className="px-2 py-2 text-right tabular text-ink/45">{i + 1}</td>
                  {fields.map((f, c) => {
                    const common = {
                      "data-cell": `${i}-${c}`,
                      "aria-label": `${LABELS[f]}, rivi ${i + 1}`,
                      "aria-invalid": rowErr[f] ? true : undefined,
                      value: r[f],
                      className: cell(f),
                      onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => onKeyDown(e, i, c),
                      onPaste: (e: ClipboardEvent<HTMLInputElement | HTMLSelectElement>) => onPaste(e, i, c),
                    };
                    if (f === "category") {
                      return (
                        <td key={f} className="px-1 py-1.5">
                          <select {...common} onChange={(e) => update(i, f, e.target.value)} className={`${cell(f)} min-w-[11rem]`}>
                            <option value="">Valitse</option>
                            {r.category && !category(r.category) ? <option value={r.category}>{r.category} (tuntematon)</option> : null}
                            {CATEGORY_GROUPS.map((g) => (
                              <optgroup key={g} label={g}>
                                {CATEGORIES.filter((k) => k.group === g).map((k) => (
                                  <option key={k.code} value={k.code}>
                                    {k.label}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    if (f === "forestPropertyId") {
                      return (
                        <td key={f} className="px-1 py-1.5">
                          <select {...common} onChange={(e) => update(i, f, e.target.value)} className={`${cell(f)} min-w-[9rem]`}>
                            <option value="">Ei valittu</option>
                            {r.forestPropertyId && !properties.some((p) => p.id === r.forestPropertyId) ? (
                              <option value={r.forestPropertyId}>{r.forestPropertyId} (tuntematon)</option>
                            ) : null}
                            {properties.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    const width =
                      f === "description" ? "min-w-[12rem]" : f === "bookedOn" ? "min-w-[7rem]" : f === "vatRate" ? "min-w-[4.5rem]" : "min-w-[7rem]";
                    return (
                      <td key={f} className={`px-1 py-1.5 ${width}`}>
                        <input
                          {...common}
                          type="text"
                          autoComplete="off"
                          inputMode={["amountNet", "vatRate", "withholding"].includes(f) ? "decimal" : undefined}
                          placeholder={
                            f === "bookedOn"
                              ? `p.k.${year}`
                              : f === "vatRate" && preview.defaultVat !== null
                                ? preview.defaultVat.toLocaleString("fi-FI")
                                : undefined
                          }
                          onChange={(e) => update(i, f, e.target.value)}
                        />
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular font-semibold">{preview.gross === null ? "–" : formatEur(preview.gross)}</td>
                  <td className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => removeRow(i)}
                      className="rounded-md px-2 py-1 text-ink/45 hover:bg-coral/10 hover:text-coral"
                      aria-label={`Poista rivi ${i + 1}`}
                      title="Poista rivi"
                    >
                      ×
                    </button>
                  </td>
                </tr>,
                messages.length ? (
                  <tr key={`${r.key}-e`}>
                    <td />
                    <td colSpan={fields.length + 2} className="px-2 pb-2 text-xs text-coral">
                      {messages.join(" ")}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <td />
              <td colSpan={3} className="px-2 py-2">
                {filled.length === 1 ? "1 rivi" : `${filled.length} riviä`}
              </td>
              <td className="px-2 py-2 text-right tabular">{formatEur(totalNet)}</td>
              <td colSpan={fields.length - 2} />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || filled.length === 0}>
          {pending ? "Tallennetaan..." : filled.length > 1 ? `Tallenna ${filled.length} kirjausta` : "Tallenna kirjaus"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => addRow(rows.length - 1)}>
          Lisää rivi
        </Button>
        <p className="text-xs text-ink/60">
          Enter siirtää seuraavaan kenttään ja rivin lopussa uudelle riville. Ctrl + Enter tallentaa. Voit liittää rivejä Excelistä.
        </p>
      </div>
    </div>
  );
}
