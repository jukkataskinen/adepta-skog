"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button, Notice } from "@/components/ui";
import { ASSET_CLASSES, category, deliveryWorkRates, DELIVERY_WORK_TAX_FREE_M3 } from "@/lib/tax/rules";
import { formatEur } from "@/lib/format";
import { parseAmount, parseClipboard } from "@/lib/ledger/transaction-input";
import {
  addButtonKeyAction,
  applyGridPaste,
  asksWithholding,
  CATEGORY_DIGIT_WINDOW_MS,
  categoryByNo,
  categoryDigit,
  changeCount,
  emptyGridRow,
  formatAmountInput,
  gridColumns,
  gridKeyAction,
  isBlankGridRow,
  MENU_CATEGORIES,
  menuIndexOfNo,
  offersDeliveryWork,
  pasteFields,
  planGridChanges,
  rowKind,
  rowNet,
  selectCategory,
  toggleKind,
  type GridField,
  type GridRow,
  type GridSaveState,
  type KeyAction,
  type PasteField,
  type RowErrors,
} from "@/lib/ledger/grid";
import type { AssetOption, PropertyOption } from "@/lib/ledger/queries";
import { GridDialog } from "./GridDialog";
import { DeliveryWorkInputs, useDeliveryWork } from "./DeliveryWorkCalculator";

let seq = 0;
const newKey = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;
const num2 = (n: number) => formatAmountInput(n);

const KIND_LABEL = { income: "TULO", expense: "MENO", investment: "INVEST" } as const;
const KIND_CLASS = {
  income: "bg-moss-soft text-moss",
  expense: "bg-amber-soft text-amber",
  investment: "bg-sky-soft text-sky",
} as const;

type Dialog =
  | { type: "ep"; key: string; phase: 1 | 2; value: string }
  | { type: "ht"; key: string }
  | { type: "asset"; key: string }
  | { type: "sale"; key: string };

/**
 * Kirjanpidon taulukko: koko verovuoden kirjaukset muokattavina ja uudet rivit,
 * vanhan sovelluksen näppäinkäytöllä (legacy/app/asiakas/asiakas.html, ck).
 * Logiikka on puhtaissa funktioissa (src/lib/ledger/grid.ts); tämä komponentti
 * pitää tilan, siirtää fokusta ja näyttää ikkunat. Tallennus lähettää kaikki
 * rivit ja poistetut, ja palvelin tallentaa muutokset yhdessä transaktiossa.
 */
export function LedgerGrid({
  action,
  clientId,
  year,
  initialRows,
  properties,
  assets,
  vatRegistered,
  defaultDate,
}: {
  action: (formData: FormData) => Promise<GridSaveState>;
  clientId: string;
  year: number;
  initialRows: GridRow[];
  properties: PropertyOption[];
  assets: AssetOption[];
  vatRegistered: boolean;
  /** p.k.vvvv */
  defaultDate: string;
}) {
  const client = useMemo(() => ({ vatRegistered }), [vatRegistered]);
  const columns = useMemo(() => gridColumns(properties.length > 0), [properties.length]);
  const col = (f: GridField) => columns.indexOf(f);

  const [original, setOriginal] = useState<GridRow[]>(initialRows);
  const [rows, setRows] = useState<GridRow[]>(() => (initialRows.length ? initialRows : [emptyGridRow(newKey(), defaultDate)]));
  const [deleted, setDeleted] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<{ index: number; row: GridRow }[]>([]);
  const [errors, setErrors] = useState<Record<string, RowErrors>>({});
  const [result, setResult] = useState<GridSaveState>({ status: "idle" });
  const [pending, startTransition] = useTransition();
  const [menu, setMenu] = useState<{ row: number; hi: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ row: number; col: number } | "add" | null>(null);

  const tableRef = useRef<HTMLTableElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Ennakonpidätys on kysytty (tallennetut rivit) ja hankintatyötä tarjottu: ei kysytä uudelleen samassa istunnossa.
  const htOffered = useRef(new Set<string>(initialRows.map((r) => r.key)));
  const amountAtFocus = useRef<string>("");
  const digits = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({ buffer: "", timer: null });
  const leaving = useRef(false);

  const changes = useMemo(() => planGridChanges(original, rows, deleted, year), [original, rows, deleted, year]);
  const dirty = changeCount(changes) > 0;

  // ---------------------------------------------------------------------------
  // Fokus
  // ---------------------------------------------------------------------------

  const focusCell = useCallback((row: number, c: number): boolean => {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}-${c}"]`);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    el.closest("tr")?.scrollIntoView({ block: "nearest" });
    return true;
  }, []);

  // Olemassa olevaan kenttään siirrytään heti, jotta nopeasti kirjoitetut merkit eivät jää
  // edelliseen kenttään. Uusi rivi ei ole vielä sivulla, joten siihen siirrytään renderöinnin jälkeen.
  const moveTo = useCallback(
    (row: number, c: number) => {
      if (!focusCell(row, c)) setPendingFocus({ row, col: c });
    },
    [focusCell],
  );
  useEffect(() => {
    if (!pendingFocus) return;
    if (pendingFocus === "add") addRef.current?.focus();
    else focusCell(pendingFocus.row, pendingFocus.col);
    setPendingFocus(null);
  }, [pendingFocus, focusCell]);

  const showToast = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------------------------------------------------------------------------
  // Rivit
  // ---------------------------------------------------------------------------

  const indexOf = (key: string) => rowsRef.current.findIndex((r) => r.key === key);

  function clearError(key: string) {
    if (!errors[key]) return;
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
  }

  function patchRow(key: string, patch: Partial<GridRow> | ((r: GridRow) => GridRow)) {
    setRows((rs) => rs.map((r) => (r.key === key ? (typeof patch === "function" ? patch(r) : { ...r, ...patch }) : r)));
    clearError(key);
  }

  /** Uusi rivi saa edellisen rivin päivän (vanha lastPvm): samana päivänä on usein monta kirjausta. */
  function addRow(after: number) {
    const rs = rowsRef.current;
    let date = rs[after]?.bookedOn ?? "";
    for (let i = rs.length - 1; !date && i >= 0; i--) date = rs[i].bookedOn;
    const row = emptyGridRow(newKey(), date || defaultDate);
    const index = Math.min(after + 1, rs.length);
    setRows([...rs.slice(0, index), row, ...rs.slice(index)]);
    setPendingFocus({ row: index, col: 0 });
  }

  function deleteRow(index: number) {
    const rs = rowsRef.current;
    const row = rs[index];
    if (!row) return;
    setUndoStack((u) => [...u, { index, row }]);
    if (row.id) setDeleted((d) => [...d, row.id!]);
    const next = rs.filter((_, i) => i !== index);
    setRows(next);
    setMenu(null);
    showToast("Rivi poistettu. Ctrl + Z palauttaa sen.");
    if (next.length) setPendingFocus({ row: Math.min(index, next.length - 1), col: 1 });
    else setPendingFocus("add");
  }

  function undo() {
    const op = undoStack[undoStack.length - 1];
    if (!op) return;
    setUndoStack((u) => u.slice(0, -1));
    if (op.row.id) setDeleted((d) => d.filter((id) => id !== op.row.id));
    const rs = rowsRef.current;
    const index = Math.min(op.index, rs.length);
    setRows([...rs.slice(0, index), op.row, ...rs.slice(index)]);
    setPendingFocus({ row: index, col: 1 });
    showToast("Rivi palautettu.");
  }

  /** Rivin loppu eteenpäin (vanha: htTarkistaRivi, sitten seuraava tai uusi rivi). */
  function rowEnd(index: number) {
    const rs = rowsRef.current;
    const r = rs[index];
    if (r && offersDeliveryWork(rs, index) && !htOffered.current.has(r.key)) {
      setDialog({ type: "ht", key: r.key });
      return;
    }
    nextRow(index);
  }

  function nextRow(index: number) {
    if (index < rowsRef.current.length - 1) moveTo(index + 1, 0);
    else addRow(index);
  }

  function run(a: KeyAction | { type: "add" } | null, index: number): boolean {
    if (!a) return false;
    switch (a.type) {
      case "focus":
        moveTo(a.row, a.col);
        break;
      case "rowEnd":
        rowEnd(a.row);
        break;
      case "addButton":
        addRef.current?.focus();
        break;
      case "add":
        addRow(rowsRef.current.length - 1);
        break;
      case "toggleKind":
        patchRow(rowsRef.current[a.row].key, toggleKind);
        break;
      case "deleteRow":
        deleteRow(a.row);
        break;
      case "menuMove":
        setMenu((m) => (m ? { ...m, hi: Math.max(0, Math.min(MENU_CATEGORIES.length - 1, m.hi + a.delta)) } : m));
        break;
      case "menuOpen":
        openMenu(index);
        break;
      case "menuSelect":
        if (menu) chooseCategory(index, MENU_CATEGORIES[menu.hi].code);
        break;
      case "menuClose":
        setMenu(null);
        if (a.then) run(a.then, index);
        break;
      case "none":
        break;
    }
    return true;
  }

  function onCellKeyDown(e: KeyboardEvent<HTMLElement>, index: number, c: number) {
    if (dialog) return;
    const field = columns[c];
    if (field === "category" && !e.ctrlKey && !e.altKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      onCategoryDigit(index, e.key);
      return;
    }
    const action = gridKeyAction({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey || e.altKey, row: index, col: c, rowCount: rowsRef.current.length, columns, menuOpen: menu?.row === index });
    if (run(action, index)) e.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Luokka
  // ---------------------------------------------------------------------------

  function openMenu(index: number) {
    const current = MENU_CATEGORIES.findIndex((c) => c.code === rowsRef.current[index]?.category);
    setMenu({ row: index, hi: Math.max(0, current) });
  }

  function onCategoryDigit(index: number, digit: string) {
    const d = digits.current;
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    const res = categoryDigit(d.buffer, digit);
    d.buffer = res.buffer;
    if (res.select !== null) {
      d.buffer = "";
      setMenu({ row: index, hi: menuIndexOfNo(res.select) });
      chooseCategory(index, categoryByNo(res.select)!.code);
      return;
    }
    if (res.highlight !== null) {
      setMenu({ row: index, hi: menuIndexOfNo(res.highlight) });
      // Toista numeroa odotetaan hetki (1 → 10, 11 tai 12); muuten valitaan korostettu.
      const no = res.highlight;
      d.timer = setTimeout(() => {
        d.buffer = "";
        d.timer = null;
        chooseCategory(index, categoryByNo(no)!.code);
      }, CATEGORY_DIGIT_WINDOW_MS);
    }
  }

  /** Luokan valinta (vanha katSelect): tyyppi ja verokanta luokasta, sitten summaan tai lisätietoihin. */
  function chooseCategory(index: number, code: string) {
    const r = rowsRef.current[index];
    if (!r) return;
    const next = selectCategory(r, code, year, client);
    patchRow(r.key, () => next);
    rowsRef.current = rowsRef.current.map((x) => (x.key === r.key ? next : x));
    setMenu(null);
    const amount = parseAmount(next.amountGross);
    const hasAmount = amount !== null && !Number.isNaN(amount) && amount !== 0;
    if (asksWithholding(next) && hasAmount) setDialog({ type: "ep", key: r.key, phase: 1, value: next.withholding });
    else if (code === "asset_purchase" && hasAmount && !next.assetId && !next.assetRatePct) setDialog({ type: "asset", key: r.key });
    else if (code === "asset_sale" && !next.assetId && !next.saleAssetId) setDialog({ type: "sale", key: r.key });
    else moveTo(index, col("amountGross"));
  }

  // Valikko on kiinteästi sijoitettu, jotta taulukon vierityslaatikko ei leikkaa sitä.
  useLayoutEffect(() => {
    if (!menu) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${menu.row}-${col("category")}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const up = window.innerHeight - rect.bottom < 330 && rect.top > 330;
      setMenuPos({ left: rect.left, top: up ? rect.top : rect.bottom, up });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu?.row]);

  useEffect(() => {
    if (!menu) return;
    document.querySelector(`[data-menu-item="${menu.hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [menu]);

  // ---------------------------------------------------------------------------
  // Summa ja ikkunat
  // ---------------------------------------------------------------------------

  /** Summan jälkeen (vanha fmtS): puukaupasta ennakonpidätys, investoinnista laji tai myytävä kohde. */
  function afterAmount(key: string) {
    const r = rowsRef.current.find((x) => x.key === key);
    if (!r) return;
    const amount = parseAmount(r.amountGross);
    if (amount === null || Number.isNaN(amount) || amount === 0) return;
    if (asksWithholding(r)) setDialog({ type: "ep", key, phase: 1, value: r.withholding });
    else if (r.category === "asset_purchase" && !r.assetId && !r.assetRatePct && (rowNet(r, year, client) ?? 0) > 600) setDialog({ type: "asset", key });
    else if (r.category === "asset_sale" && !r.assetId && !r.saleAssetId) setDialog({ type: "sale", key });
  }

  /** Ikkunan sulkeminen ilman valintaa: takaisin summan jälkeiseen kenttään. */
  function closeDialogBack(key: string) {
    setDialog(null);
    const i = indexOf(key);
    if (i >= 0) setPendingFocus({ row: i, col: col("amountGross") + 1 });
  }

  function saveWithholding(key: string, value: number) {
    const r = rowsRef.current.find((x) => x.key === key);
    if (!r) return;
    const next = { ...r, withholding: value > 0 ? num2(value) : "" };
    patchRow(key, () => next);
    rowsRef.current = rowsRef.current.map((x) => (x.key === key ? next : x));
    setDialog(null);
    showToast(value > 0 ? `Ennakonpidätys ${num2(value)} € tallennettu.` : "Ei ennakonpidätystä, kirjattu.");
    // Hankintakaupan jälkeen tarjotaan hankintatyötä (vanha epTallennaArvo → htTarkistaRivi).
    rowEnd(indexOf(key));
  }

  function addDeliveryWork(key: string, total: number, description: string) {
    const rs = rowsRef.current;
    const index = rs.findIndex((x) => x.key === key);
    htOffered.current.add(key);
    setDialog(null);
    if (index < 0) return;
    if (total <= 0) {
      nextRow(index);
      return;
    }
    const row: GridRow = {
      ...emptyGridRow(newKey(), rs[index].bookedOn),
      description,
      category: "delivery_work",
      kind: "expense",
      amountGross: num2(total),
      vatRate: "0",
      forestPropertyId: rs[index].forestPropertyId,
    };
    const next = [...rs.slice(0, index + 1), row, ...rs.slice(index + 1)];
    setRows(next);
    rowsRef.current = next;
    showToast(`Hankintatyö ${num2(total)} € lisätty uudelle riville.`);
    if (index + 2 < next.length) setPendingFocus({ row: index + 2, col: 0 });
    else addRow(index + 1);
  }

  function skipDeliveryWork(key: string) {
    htOffered.current.add(key);
    setDialog(null);
    const i = indexOf(key);
    if (i >= 0) nextRow(i);
  }

  // ---------------------------------------------------------------------------
  // Liittäminen
  // ---------------------------------------------------------------------------

  function onPaste(e: ClipboardEvent<HTMLElement>, index: number, field: GridField) {
    const text = e.clipboardData.getData("text/plain");
    // Yksittäinen arvo liitetään kenttään tavalliseen tapaan.
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
    if (!pasteFields(properties.length > 0).includes(field as PasteField)) return;
    e.preventDefault();
    setRows((rs) => applyGridPaste(rs, index, field as PasteField, parseClipboard(text), { year, properties, newKey }));
    setErrors({});
    setResult({ status: "idle" });
  }

  // ---------------------------------------------------------------------------
  // Tallennus
  // ---------------------------------------------------------------------------

  const save = useCallback(() => {
    if (pending) return;
    const fd = new FormData();
    fd.set("clientId", clientId);
    fd.set("year", String(year));
    const payload = rowsRef.current
      .filter((r) => r.id || !isBlankGridRow(r))
      .map((r) => ({
        key: r.key, id: r.id, bookedOn: r.bookedOn, description: r.description, category: r.category, amountGross: r.amountGross, vatRate: r.vatRate,
        withholding: r.withholding, forestPropertyId: r.forestPropertyId, kind: r.kind, reference: r.reference, assetRatePct: r.assetRatePct, saleAssetId: r.saleAssetId,
      }));
    fd.set("payload", JSON.stringify({ rows: payload, deletedIds: deleted }));
    startTransition(async () => {
      const res = await action(fd);
      setResult(res);
      if (res.status === "error") setErrors(res.rowErrors);
      if (res.status === "saved") {
        setErrors({});
        setOriginal(res.rows);
        setRows(res.rows.length ? res.rows : [emptyGridRow(newKey(), defaultDate)]);
        setDeleted([]);
        setUndoStack([]);
        htOffered.current = new Set(res.rows.map((r) => r.key));
      }
    });
  }, [action, clientId, year, deleted, defaultDate, pending]);

  function revert() {
    setRows(original.length ? original : [emptyGridRow(newKey(), defaultDate)]);
    setDeleted([]);
    setUndoStack([]);
    setErrors({});
    setResult({ status: "idle" });
  }

  // Pikanäppäimet koko sivulla (vanha document keydown): Ctrl+S, Ctrl+Z, Ctrl+N.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (dialog || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s" || e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (k === "z" && undoStack.length && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "n") {
        e.preventDefault();
        addRow(rowsRef.current.length - 1);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Varoitus poistuttaessa, jos muutoksia ei ole tallennettu. Sivun sisäiset linkit
  // eivät laukaise beforeunloadia, joten niihin kysytään erikseen.
  useEffect(() => {
    if (!dirty) return;
    const message = "Sinulla on tallentamattomia muutoksia. Poistutaanko silti?";
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (leaving.current) return;
      e.preventDefault();
      e.returnValue = message;
    }
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || e.defaultPrevented) return;
      const url = new URL(a.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (window.confirm(message)) {
        leaving.current = true;
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  // ---------------------------------------------------------------------------
  // Näkymä
  // ---------------------------------------------------------------------------

  const filled = rows.filter((r) => !isBlankGridRow(r));
  const totals = filled.reduce(
    (s, r) => {
      const g = parseAmount(r.amountGross);
      const n = rowNet(r, year, client);
      return { gross: s.gross + (g !== null && Number.isFinite(g) ? g : 0), net: s.net + (n ?? 0) };
    },
    { gross: 0, net: 0 },
  );
  const saleOptions = (r: GridRow) => {
    const taken = new Set(rows.filter((x) => x.key !== r.key && x.category === "asset_sale").map((x) => x.saleAssetId || x.assetId));
    return assets.filter((a) => (!a.disposed_on || a.id === r.assetId) && !taken.has(a.id));
  };
  const cellClass = (bad: boolean, extra = "") =>
    `h-9 w-full rounded-md border bg-paper px-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30 ${bad ? "border-coral" : "border-transparent hover:border-line"} ${extra}`;
  const dialogRow = dialog ? rows.find((r) => r.key === dialog.key) : undefined;
  const count = changeCount(changes);

  return (
    <div className="grid gap-4">
      {result.status === "saved" && !dirty ? (
        <Notice tone="ok" title="Muutokset tallennettu.">
          {[
            result.created ? `${result.created} uutta` : null,
            result.updated ? `${result.updated} muutettua` : null,
            result.deleted ? `${result.deleted} poistettua` : null,
          ]
            .filter(Boolean)
            .join(", ") || "Ei muutoksia."}
        </Notice>
      ) : null}
      {result.status === "error" ? <Notice tone="alert" title={result.message} /> : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-paper">
        <table ref={tableRef} className="w-full min-w-[68rem] border-collapse text-sm">
          <thead className="bg-cloud/60 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="w-8 px-2 py-2 text-right">#</th>
              <th className="px-2 py-2">Päivä</th>
              <th className="px-2 py-2">Selite</th>
              <th className="px-2 py-2">Luokka</th>
              <th className="px-2 py-2 text-right">Summa (sis. alv)</th>
              <th className="px-2 py-2 text-right">Alv %</th>
              <th className="px-2 py-2 text-right">Veroton</th>
              <th className="px-2 py-2">Ennakko</th>
              {properties.length ? <th className="px-2 py-2">Metsätila</th> : null}
              <th className="px-2 py-2">Tosite</th>
              <th className="px-2 py-2">Tyyppi</th>
              <th className="w-8 px-1 py-2">
                <span className="sr-only">Poista</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const err = errors[r.key] ?? {};
              const kind = rowKind(r);
              const net = rowNet(r, year, client);
              const cat = category(r.category);
              const withholding = parseAmount(r.withholding);
              const messages = [...new Set(Object.values(err))];
              const common = (f: GridField) => ({
                "data-cell": `${i}-${col(f)}`,
                "aria-invalid": err[f] ? true : undefined,
                onKeyDown: (e: KeyboardEvent<HTMLElement>) => onCellKeyDown(e, i, col(f)),
                onPaste: (e: ClipboardEvent<HTMLElement>) => onPaste(e, i, f),
              });
              const menuHere = menu?.row === i;
              return [
                <tr key={r.key} className={`border-t border-line align-top ${r.id ? "" : "bg-sky-soft/30"}`}>
                  <td className="px-2 py-2.5 text-right tabular text-ink/45">{i + 1}</td>
                  <td className="px-1 py-1 min-w-[7rem]">
                    <input
                      {...common("bookedOn")}
                      aria-label={`Päivä, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.bookedOn), "tabular")}
                      value={r.bookedOn}
                      placeholder={`p.k.${year}`}
                      autoComplete="off"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => patchRow(r.key, { bookedOn: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[13rem]">
                    <input
                      {...common("description")}
                      aria-label={`Selite, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.description))}
                      value={r.description}
                      autoComplete="off"
                      onChange={(e) => patchRow(r.key, { description: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[12rem]">
                    <button
                      type="button"
                      {...common("category")}
                      aria-label={`Luokka, rivi ${i + 1}: ${cat?.label ?? "valitse"}`}
                      aria-haspopup="listbox"
                      aria-expanded={menuHere}
                      className={cellClass(Boolean(err.category), `flex items-center justify-between gap-2 text-left ${cat ? "" : "text-ink/45"}`)}
                      onFocus={() => openMenu(i)}
                      onBlur={() => setMenu((m) => (m?.row === i ? null : m))}
                      onClick={() => (menuHere ? setMenu(null) : openMenu(i))}
                    >
                      <span className="truncate">{cat ? `${cat.no} ${cat.label}` : r.category ? `${r.category} (tuntematon)` : "Valitse"}</span>
                      <span aria-hidden className="text-xs text-ink/40">
                        ▾
                      </span>
                    </button>
                    {r.category === "asset_purchase" ? (
                      r.assetId ? (
                        <span className="block px-2 text-xs text-ink/55">Investointi: {r.assetDescription}</span>
                      ) : (
                        <button type="button" tabIndex={-1} className={`px-2 text-xs font-semibold ${r.assetRatePct ? "text-ink/60" : "text-coral"}`} onClick={() => setDialog({ type: "asset", key: r.key })}>
                          {r.assetRatePct ? `${ASSET_CLASSES.find((a) => String(a.pct) === r.assetRatePct)?.label} ${r.assetRatePct} %` : "Valitse hyödykkeen laji"}
                        </button>
                      )
                    ) : null}
                    {r.category === "asset_sale" ? (
                      <button type="button" tabIndex={-1} className={`px-2 text-xs font-semibold ${r.saleAssetId || r.assetId ? "text-ink/60" : "text-coral"}`} onClick={() => setDialog({ type: "sale", key: r.key })}>
                        {r.saleAssetId || r.assetId
                          ? `Myyty: ${assets.find((a) => a.id === (r.saleAssetId || r.assetId))?.description ?? r.assetDescription ?? "investointi"}`
                          : "Valitse myytävä investointi"}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-1 py-1 min-w-[8rem]">
                    <input
                      {...common("amountGross")}
                      aria-label={`Summa sis. alv, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.amountGross), "text-right tabular")}
                      value={r.amountGross}
                      inputMode="decimal"
                      placeholder="0,00"
                      autoComplete="off"
                      onFocus={(e) => {
                        amountAtFocus.current = e.currentTarget.value;
                        e.currentTarget.select();
                      }}
                      onBlur={(e) => {
                        const n = parseAmount(e.currentTarget.value);
                        const formatted = n !== null && Number.isFinite(n) ? num2(n) : e.currentTarget.value;
                        if (formatted !== r.amountGross) patchRow(r.key, { amountGross: formatted });
                        const before = parseAmount(amountAtFocus.current);
                        if (n !== null && Number.isFinite(n) && n !== before && !dialog) {
                          const next = { ...r, amountGross: formatted };
                          rowsRef.current = rowsRef.current.map((x) => (x.key === r.key ? next : x));
                          afterAmount(r.key);
                        }
                      }}
                      onChange={(e) => patchRow(r.key, { amountGross: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[4.5rem]">
                    <input
                      {...common("vatRate")}
                      aria-label={`Alv prosentti, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.vatRate), "text-right tabular")}
                      value={r.vatRate}
                      inputMode="decimal"
                      autoComplete="off"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => patchRow(r.key, { vatRate: e.target.value })}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular text-ink/70">{net === null ? "–" : num2(net)}</td>
                  <td className="px-1 py-1.5">
                    {withholding ? (
                      <button type="button" tabIndex={-1} className="rounded-full bg-sky-soft px-2 py-0.5 text-xs font-semibold text-sky" onClick={() => setDialog({ type: "ep", key: r.key, phase: 1, value: r.withholding })}>
                        EP {num2(withholding)} €
                      </button>
                    ) : asksWithholding(r) ? (
                      <button type="button" tabIndex={-1} className="px-2 text-xs text-ink/45 hover:text-sky" onClick={() => setDialog({ type: "ep", key: r.key, phase: 1, value: "" })}>
                        Ei EP
                      </button>
                    ) : (
                      <span className="px-2 text-ink/30">–</span>
                    )}
                  </td>
                  {properties.length ? (
                    <td className="px-1 py-1 min-w-[9rem]">
                      <select
                        {...common("forestPropertyId")}
                        aria-label={`Metsätila, rivi ${i + 1}`}
                        className={cellClass(Boolean(err.forestPropertyId))}
                        value={r.forestPropertyId}
                        onChange={(e) => patchRow(r.key, { forestPropertyId: e.target.value })}
                      >
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
                  ) : null}
                  <td className="whitespace-nowrap px-2 py-2.5">
                    {r.id ? (
                      // Tavallinen linkki: tallentamattomista muutoksista varoitetaan ennen siirtymistä.
                      <a href={`/asiakkaat/${clientId}/kirjanpito/${r.id}`} tabIndex={-1} className="text-xs font-semibold text-sky hover:underline">
                        {r.documentCount ? `${r.documentCount} kpl` : "Lisää"}
                      </a>
                    ) : (
                      <span className="text-xs text-ink/35" title="Tosite lisätään tallennuksen jälkeen.">
                        –
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      {...common("kind")}
                      aria-label={`Tyyppi, rivi ${i + 1}: ${kind ? KIND_LABEL[kind] : "ei valittu"}. T vaihtaa, Delete poistaa rivin.`}
                      className={`h-9 w-full min-w-[4.5rem] rounded-md px-2 text-xs font-bold tracking-wide outline-none focus:ring-2 focus:ring-sky/50 ${kind ? KIND_CLASS[kind] : "text-ink/35"}`}
                      onClick={() => patchRow(r.key, toggleKind)}
                    >
                      {kind ? KIND_LABEL[kind] : "–"}
                    </button>
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => deleteRow(i)}
                      className="h-9 rounded-md px-2 text-ink/40 hover:bg-coral/10 hover:text-coral"
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
                    <td colSpan={columns.length + 5} className="px-2 pb-2 text-xs text-coral">
                      {messages.join(" ")}
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            <tr className="border-t border-line">
              <td />
              <td colSpan={columns.length + 5} className="px-1 py-1.5">
                <button
                  ref={addRef}
                  type="button"
                  className="flex h-9 items-center gap-2 rounded-md px-2 text-sm font-semibold text-moss outline-none hover:bg-moss-soft focus:ring-2 focus:ring-sky/40"
                  onClick={() => addRow(rows.length - 1)}
                  onKeyDown={(e) => {
                    const a = addButtonKeyAction(e.key, e.shiftKey, rows.length, columns.length - 1);
                    if (run(a, rows.length - 1)) e.preventDefault();
                  }}
                >
                  <span aria-hidden className="text-lg leading-none">
                    +
                  </span>
                  Lisää rivi
                  <kbd className="rounded border border-line px-1.5 text-xs font-normal text-ink/50">Enter</kbd>
                </button>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <td />
              <td colSpan={3} className="px-2 py-2">
                {filled.length === 1 ? "1 rivi" : `${filled.length} riviä`}
              </td>
              <td className="px-2 py-2 text-right tabular">{formatEur(totals.gross)}</td>
              <td />
              <td className="px-2 py-2 text-right tabular">{formatEur(totals.net)}</td>
              <td colSpan={columns.length - 2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {menu && menuPos ? (
        <div
          role="listbox"
          aria-label="Luokka"
          className="fixed z-40 max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-paper py-1 text-sm shadow-lg"
          style={{ left: menuPos.left, ...(menuPos.up ? { bottom: window.innerHeight - menuPos.top + 2 } : { top: menuPos.top + 2 }) }}
        >
          {MENU_CATEGORIES.map((c, idx) => {
            const groupStart = idx === 0 || MENU_CATEGORIES[idx - 1].group !== c.group;
            return (
              <div key={c.code}>
                {groupStart ? <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink/45">{c.group}</div> : null}
                <div
                  role="option"
                  aria-selected={menu.hi === idx}
                  data-menu-item={idx}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 ${menu.hi === idx ? "bg-sky-soft" : "hover:bg-cloud"}`}
                  // Painallus ei vie fokusta luokkakentältä, jotta valikko ei sulkeudu ennen valintaa.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseCategory(menu.row, c.code)}
                >
                  <span>
                    <span className="inline-block w-6 font-semibold text-moss">{c.no}</span>
                    {c.label}
                  </span>
                  <span className={`rounded-full px-1.5 text-[10px] font-bold ${KIND_CLASS[c.kind]}`}>{KIND_LABEL[c.kind]}</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={pending || !dirty}>
          {pending ? "Tallennetaan..." : count ? `Tallenna ${count === 1 ? "1 muutos" : `${count} muutosta`}` : "Ei tallennettavaa"}
        </Button>
        {dirty ? (
          <Button type="button" variant="secondary" onClick={revert} disabled={pending}>
            Peru muutokset
          </Button>
        ) : null}
        {dirty ? <span className="text-sm text-amber">Muutokset on vielä tallentamatta.</span> : null}
      </div>

      <div className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-xs leading-relaxed text-ink/70">
        <p className="mb-1 font-semibold text-ink/80">Näppäimet</p>
        <p>
          <b>Enter</b> tai <b>Tab</b> seuraavaan kenttään, rivin lopussa seuraavalle tai uudelle riville. <b>Shift</b> takaisin. <b>Nuolet ylös ja alas</b> samaan
          sarakkeeseen toisella rivillä (ei selitteessä). Luokka: <b>numero</b> valitsee suoraan (1–12), nuolet ja Enter valikossa, Esc sulkee. <b>T</b> vaihtaa tulon
          ja menon. <b>Delete</b> tyyppisarakkeessa poistaa rivin, <b>Ctrl + Z</b> palauttaa sen. <b>Ctrl + S</b> tallentaa. <b>Ctrl + N</b> lisää rivin. Voit liittää
          rivejä Excelistä (summat arvonlisäveron kanssa).
        </p>
      </div>

      {dialog?.type === "ep" && dialogRow ? (
        <WithholdingDialog
          row={dialogRow}
          net={rowNet(dialogRow, year, client)}
          phase={dialog.phase}
          value={dialog.value}
          onChange={(value) => setDialog({ ...dialog, value })}
          onPhase={(phase) => setDialog({ ...dialog, phase })}
          onSave={(n) => saveWithholding(dialog.key, n)}
          onClose={() => closeDialogBack(dialog.key)}
        />
      ) : null}
      {dialog?.type === "ht" && dialogRow ? (
        <DeliveryWorkDialog year={year} onSave={(total, description) => addDeliveryWork(dialog.key, total, description)} onCancel={() => skipDeliveryWork(dialog.key)} />
      ) : null}
      {dialog?.type === "asset" && dialogRow ? (
        <ChoiceDialog
          title="Investoinnin laji"
          subtitle={`${dialogRow.description || "Käyttöomaisuuden hankinta"} · ${dialogRow.amountGross} € (sis. alv). Poisto on enintään lajin prosentti joka vuosi.`}
          options={ASSET_CLASSES.map((a) => ({ id: String(a.pct), label: `${a.label} ${a.pct} %` }))}
          selected={dialogRow.assetRatePct}
          empty=""
          onSelect={(id) => {
            patchRow(dialog.key, { assetRatePct: id });
            closeDialogBack(dialog.key);
          }}
          onClose={() => closeDialogBack(dialog.key)}
        />
      ) : null}
      {dialog?.type === "sale" && dialogRow ? (
        <ChoiceDialog
          title="Myytävä investointi"
          subtitle="Valitse, mikä investointi myytiin. Myyntivoitto lasketaan verosuunnitelmassa."
          options={saleOptions(dialogRow).map((a) => ({ id: a.id, label: `${a.description} (${a.acquired_on.slice(0, 4)})` }))}
          selected={dialogRow.saleAssetId || dialogRow.assetId || ""}
          empty="Asiakkaalla ei ole myymättömiä investointeja."
          onSelect={(id) => {
            patchRow(dialog.key, { saleAssetId: id });
            closeDialogBack(dialog.key);
          }}
          onClose={() => closeDialogBack(dialog.key)}
        />
      ) : null}

      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
        {toast ? <div className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-lg">{toast}</div> : null}
      </div>
    </div>
  );
}

/** Puukaupan ennakonpidätys (vanha avaaEP, epKey, epConfirmKey). */
function WithholdingDialog({
  row,
  net,
  phase,
  value,
  onChange,
  onPhase,
  onSave,
  onClose,
}: {
  row: GridRow;
  net: number | null;
  phase: 1 | 2;
  value: string;
  onChange: (v: string) => void;
  onPhase: (p: 1 | 2) => void;
  onSave: (n: number) => void;
  onClose: () => void;
}) {
  const amount = () => {
    const n = parseAmount(value);
    return n !== null && Number.isFinite(n) && n > 0 ? n : 0;
  };
  const gross = parseAmount(row.amountGross);
  const subtitle = [
    category(row.category)?.label ?? "Puukauppa",
    row.description || "–",
    `${gross !== null && Number.isFinite(gross) ? num2(gross) : "–"} € (sis. alv)`,
    `veroton ${net === null ? "–" : num2(net)} €`,
  ].join(" · ");
  return (
    <GridDialog key={phase} title="Puukaupan ennakonpidätys" subtitle={subtitle} onEscape={onClose}>
      {phase === 1 ? (
        <>
          <label className="grid gap-1">
            <span className="font-semibold">Ennakonpidätys (€)</span>
            <input
              data-autofocus
              inputMode="decimal"
              className="h-11 rounded-lg border border-line px-3 text-right text-base tabular outline-none focus:border-sky focus:ring-2 focus:ring-sky/30"
              value={value}
              placeholder="0,00"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const n = amount();
                if (n > 0) onSave(n);
                else onPhase(2);
              }}
            />
          </label>
          <p className="text-ink/65">Ennakonpidätys vähennetään maksettavasta verosta. Metsätaloudessa se on yleensä 26–30 % puukaupan arvosta.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onPhase(2)}>
              Ei ennakonpidätystä
            </Button>
            <Button
              type="button"
              onClick={() => {
                const n = amount();
                if (n > 0) onSave(n);
                else onPhase(2);
              }}
            >
              Tallenna
            </Button>
          </div>
        </>
      ) : (
        <>
          <p>Syötit 0 €. Haluatko varmistaa, että tähän puukauppaan ei ole tehty ennakonpidätystä?</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => onPhase(1)}>
              ← Muuta summaa
            </Button>
            <Button type="button" data-autofocus onClick={() => onSave(0)}>
              Ei ennakonpidätystä
            </Button>
          </div>
        </>
      )}
    </GridDialog>
  );
}

/** Hankintatyön kirjaus hankintakaupan jälkeen (vanha htAvaa, htTallenna). Tekijän henkilötunnusta ei kysytä. */
function DeliveryWorkDialog({ year, onSave, onCancel }: { year: number; onSave: (total: number, description: string) => void; onCancel: () => void }) {
  const dw = useDeliveryWork(year);
  const okRef = useRef<HTMLButtonElement>(null);
  const firstM3 = () => okRef.current?.closest("[role=dialog]")?.querySelector<HTMLInputElement>('input[data-m3="0"]')?.focus();
  const ratesYear = deliveryWorkRates(year).year;
  return (
    <GridDialog
      title="Hankintatyön kirjaus"
      subtitle={`Verohallinnon ohjetaksat ${ratesYear}${ratesYear !== year ? `, koska vuoden ${year} taksoja ei ole vielä julkaistu` : ""}.`}
      onEscape={onCancel}
    >
      <label className="grid gap-1">
        <span className="font-semibold">Tekijän nimi (valinnainen)</span>
        <input
          data-autofocus
          className="h-10 rounded-lg border border-line px-3 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30"
          value={dw.name}
          autoComplete="off"
          onChange={(e) => dw.setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              firstM3();
            }
          }}
        />
      </label>
      <p className="text-ink/65">
        Verovapaa raja on {DELIVERY_WORK_TAX_FREE_M3} m³ maatilaa kohden vuodessa. Ylittävä osa on tekijän ansiotuloa, ja tekijä ilmoittaa sen itse.
      </p>
      <DeliveryWorkInputs dw={dw} onLastEnter={() => okRef.current?.focus()} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Peruuta
        </Button>
        <Button ref={okRef} type="button" onClick={() => onSave(dw.result.total, dw.description)}>
          Kirjaa hankintatyö
        </Button>
      </div>
    </GridDialog>
  );
}

/** Valinta listasta näppäimillä: nuolet ja Enter, tai numero. */
function ChoiceDialog({
  title,
  subtitle,
  options,
  selected,
  empty,
  onSelect,
  onClose,
}: {
  title: string;
  subtitle: string;
  options: { id: string; label: string }[];
  selected: string;
  empty: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [hi, setHi] = useState(() => Math.max(0, options.findIndex((o) => o.id === selected)));
  return (
    <GridDialog title={title} subtitle={subtitle} onEscape={onClose}>
      {options.length === 0 ? (
        <p className="text-ink/70">{empty}</p>
      ) : (
        <div
          role="listbox"
          tabIndex={0}
          data-autofocus
          aria-label={title}
          aria-activedescendant={`choice-${hi}`}
          className="grid gap-1 rounded-xl border border-line p-1 outline-none focus:ring-2 focus:ring-sky/40"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(0, Math.min(options.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Enter") {
              e.preventDefault();
              onSelect(options[hi].id);
            } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= options.length) {
              e.preventDefault();
              onSelect(options[Number(e.key) - 1].id);
            }
          }}
        >
          {options.map((o, i) => (
            <div
              key={o.id}
              id={`choice-${i}`}
              role="option"
              aria-selected={hi === i}
              className={`flex cursor-pointer gap-3 rounded-lg px-3 py-2 ${hi === i ? "bg-sky-soft" : "hover:bg-cloud"}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(o.id)}
            >
              <span className="w-4 font-semibold text-moss">{i + 1}</span>
              {o.label}
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Sulje
        </Button>
      </div>
    </GridDialog>
  );
}
