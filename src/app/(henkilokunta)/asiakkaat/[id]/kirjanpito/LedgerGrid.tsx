"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button, Notice } from "@/components/ui";
import {
  ACTIVITY_PARAM,
  agriAssetChoices,
  allowsLivestockDeferral,
  allowsOtherShare,
  ASSET_CLASSES,
  category,
  deliveryWorkRates,
  DELIVERY_WORK_TAX_FREE_M3,
  isAssetPurchase,
  isAssetSale,
  isLivestockDeferral,
  smallAssetLimit,
  withLivestockDeferral,
  type Activity,
} from "@/lib/tax/rules";
import { formatEur } from "@/lib/format";
import { normalizeDate, parseAmount, parseClipboard, toFinnishDate } from "@/lib/ledger/transaction-input";
import {
  addButtonKeyAction,
  applyGridPaste,
  applyPostingChoice,
  choosePostingOption,
  hintKeyAction,
  asksWithholding,
  CATEGORY_DIGIT_WINDOW_MS,
  categoryByNo,
  categoryDigit,
  changeCount,
  deferredSuggestionLines,
  EMPTY_FILTER,
  emptyGridRow,
  formatAmountInput,
  gridColumns,
  gridKeyAction,
  gridRowVisible,
  isBlankGridRow,
  isFilterActive,
  menuCategories,
  menuGroupLabel,
  menuIndexOfNo,
  MONTH_NAMES,
  nextVisibleRow,
  offersDeliveryWork,
  pasteFields,
  planGridChanges,
  rowKind,
  rowLivestockDeferral,
  rowNet,
  rowOtherSharePct,
  rowShare,
  rowSharePct,
  sameRow,
  selectCategory,
  shareNote,
  suggestionDateWarning,
  suggestionGroups,
  toggleKind,
  type SuggestionGroup,
  type GridField,
  type GridRow,
  type GridSaveState,
  type KeyAction,
  type LedgerFilter,
  type PasteField,
  type RowErrors,
} from "@/lib/ledger/grid";
import type { AssetOption, PropertyOption } from "@/lib/ledger/queries";
import { formatSharePct } from "@/lib/tax/share";
import { GridDialog } from "./GridDialog";
import { DeliveryWorkInputs, useDeliveryWork } from "./DeliveryWorkCalculator";
import { dismissSuggestionAction } from "./receipt-actions";
import { DOCUMENT_TYPE_LABEL, documentHref, pageLabel, sourceDocumentLabel } from "@/lib/ai/receipts/schema";
import { usePostingSuggestions } from "./usePostingSuggestions";

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
  /** toAmount: ikkuna avattiin luokan valinnasta ennen summaa, joten sen jälkeen summaan. */
  | { type: "asset"; key: string; toAmount?: boolean }
  | { type: "sale"; key: string; toAmount?: boolean };

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
  suggestionRows = [],
  properties,
  farms = [],
  initialFilter = EMPTY_FILTER,
  assets,
  vatRegistered,
  defaultDate,
  hasForestry = true,
  hasAgriculture = false,
  activity = null,
}: {
  action: (formData: FormData) => Promise<GridSaveState>;
  clientId: string;
  year: number;
  initialRows: GridRow[];
  /** Tositteiden tunnistuksen ehdotukset uusina riveinä (rowsFromSuggestion). */
  suggestionRows?: GridRow[];
  properties: PropertyOption[];
  /** Maatalouden näkymässä asiakkaan maatilat (0018). Sarake näkyy, kun tiloja on useampi. */
  farms?: PropertyOption[];
  /** Suodatin osoitteesta (?luokka=&kk=&haku=). */
  initialFilter?: LedgerFilter;
  assets: AssetOption[];
  vatRegistered: boolean;
  /** p.k.vvvv */
  defaultDate: string;
  /** Asiakkaan toiminnot (0015): maatalousasiakas näkee maatalouden luokat ja toisen toiminnon osuuden. */
  hasForestry?: boolean;
  hasAgriculture?: boolean;
  /**
   * Kirjanpidon näkymä (metsätalous tai maatalous): taulukossa ovat vain sen
   * kirjaukset, ja valikko tarjoaa vain sen luokat, joten uusi rivi saa näkymän
   * toiminnon. null = pelkkä metsäasiakas, kaikki kuten ennen.
   */
  activity?: Activity | null;
}) {
  const client = useMemo(() => ({ vatRegistered }), [vatRegistered]);
  const both = hasForestry && hasAgriculture;
  const menuList = useMemo(() => menuCategories({ hasForestry, hasAgriculture }, activity), [hasForestry, hasAgriculture, activity]);
  const menuNumbers = useMemo(() => menuList.map((c) => c.no), [menuList]);
  const hasFarms = farms.length > 1;
  const columns = useMemo(() => gridColumns(properties.length > 0, both, hasFarms), [properties.length, both, hasFarms]);
  const col = (f: GridField) => columns.indexOf(f);

  const [original, setOriginal] = useState<GridRow[]>(initialRows);
  const [rows, setRows] = useState<GridRow[]>(() =>
    initialRows.length || suggestionRows.length ? [...initialRows, ...suggestionRows] : [emptyGridRow(newKey(), defaultDate)],
  );
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
  const [filter, setFilter] = useState<LedgerFilter>(initialFilter);
  // Tiliöintiehdotukset selitteelle (DECISIONS 6.10.2026): lista näkyy selitteen alla,
  // mutta mikään ei muutu ennen kuin käyttäjä valitsee ehdotuksen nuolella ja Enterillä tai napsauttaa sitä.
  const posting = usePostingSuggestions(clientId, activity);
  const [hintHi, setHintHi] = useState<number | null>(null);
  const [hintPos, setHintPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const tableRef = useRef<HTMLTableElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // Suodatin piilottaa tallennettuja rivejä; uudet rivit näkyvät aina (grid.ts gridRowVisible).
  const filtering = isFilterActive(filter);
  const visible = useMemo(() => rows.map((r) => gridRowVisible(r, filter, year)), [rows, filter, year]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // Ennakonpidätys on kysytty (tallennetut rivit) ja hankintatyötä tarjottu: ei kysytä uudelleen samassa istunnossa.
  const htOffered = useRef(new Set<string>(initialRows.map((r) => r.key)));
  const amountAtFocus = useRef<string>("");
  const digits = useRef<{ buffer: string; timer: ReturnType<typeof setTimeout> | null }>({ buffer: "", timer: null });
  const leaving = useRef(false);

  // Ehdotukset: taulukossa olevat ehdotukset ja niiden alkuperäiset rivit. Koskematon
  // ehdotusrivi ei ole tallentamaton muutos poistumisvaroitusta varten, koska ehdotus
  // on tallessa kannassa ja palaa taulukkoon.
  const suggestionSnapshot = useRef(new Map<string, GridRow>(suggestionRows.map((r) => [r.key, r])));
  const knownSuggestions = useRef(new Set<string>(suggestionRows.map((r) => r.suggestionId!).filter(Boolean)));
  const suggestionKey = suggestionRows.map((r) => r.key).join("|");
  useEffect(() => {
    const incoming = new Set(suggestionRows.map((r) => r.suggestionId!));
    const added = suggestionRows.filter((r) => !knownSuggestions.current.has(r.suggestionId!));
    const removed = [...knownSuggestions.current].filter((id) => !incoming.has(id));
    if (!added.length && !removed.length) return;
    for (const r of added) {
      knownSuggestions.current.add(r.suggestionId!);
      suggestionSnapshot.current.set(r.key, r);
    }
    for (const id of removed) knownSuggestions.current.delete(id);
    setRows((rs) => {
      let next = rs.filter((r) => !r.suggestionId || !removed.includes(r.suggestionId));
      // Uudet ehdotukset loppuun, mutta ennen lopun tyhjää riviä.
      const tail = next.length && isBlankGridRow(next[next.length - 1]) ? next.length - 1 : next.length;
      next = [...next.slice(0, tail), ...added, ...next.slice(tail)];
      return next.length ? next : [emptyGridRow(newKey(), defaultDate)];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionKey]);

  const changes = useMemo(() => planGridChanges(original, rows, deleted, year), [original, rows, deleted, year]);
  const dirty = changeCount(changes) > 0;
  const untouchedSuggestion = (r: GridRow) => {
    const o = r.suggestionId ? suggestionSnapshot.current.get(r.key) : undefined;
    return Boolean(o && sameRow(o, r, year));
  };
  const pendingSuggestions = rows.filter((r) => r.suggestionId && !r.deferred).length;
  const deferredSuggestions = rows.filter((r) => r.suggestionId && r.deferred).length;
  // Monikirjauksiset tositteet ryhminä ja niiden täsmäytys (taulukon nykyisistä riveistä).
  const groups = useMemo(() => suggestionGroups(rows), [rows]);
  const groupOf = useMemo(() => {
    const m = new Map<string, SuggestionGroup>();
    for (const g of groups.values()) for (const k of g.rowKeys) m.set(k, g);
    return m;
  }, [groups]);
  const warnDirty = changes.updated.length + changes.deleted.length + changes.created.filter((r) => !untouchedSuggestion(r)).length > 0;

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
    const next = nextVisibleRow(visibleRef.current, index, index + 1);
    if (next !== null) moveTo(next, 0);
    else addRow(rowsRef.current.length - 1);
  }

  function run(a: KeyAction | { type: "add" } | null, index: number): boolean {
    if (!a) return false;
    switch (a.type) {
      case "focus": {
        // Suodatuksen piilottamat rivit ohitetaan; jos alempana ei ole näkyvää riviä, Lisää rivi -painikkeeseen.
        const target = nextVisibleRow(visibleRef.current, index, a.row);
        if (target !== null) moveTo(target, a.col);
        else if (a.row > index) addRef.current?.focus();
        break;
      }
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
        setMenu((m) => (m ? { ...m, hi: Math.max(0, Math.min(menuList.length - 1, m.hi + a.delta)) } : m));
        break;
      case "menuOpen":
        openMenu(index);
        break;
      case "menuSelect":
        if (menu) chooseCategory(index, menuList[menu.hi].code);
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

  function closeHint() {
    posting.clear();
    setHintHi(null);
  }

  /** Ehdotuksen käyttö: luokka, alv, osuudet ja maatila. Summa ja päivä jäävät käyttäjälle, joten fokus siirtyy summaan. */
  function acceptHint(index: number, i: number) {
    const r = rowsRef.current[index];
    const item = posting.hint?.items[i];
    if (!r || !item) return;
    const next = applyPostingChoice(r, item, year, client);
    patchRow(r.key, () => next);
    rowsRef.current = rowsRef.current.map((x) => (x.key === r.key ? next : x));
    closeHint();
    moveTo(index, col("amountGross"));
  }

  function onCellKeyDown(e: KeyboardEvent<HTMLElement>, index: number, c: number) {
    if (dialog) return;
    const field = columns[c];
    // Ehdotuslista ottaa vain nuolet, Escin sekä Enterin ja Tabin valitun ehdotuksen kohdalla (grid.ts hintKeyAction).
    if (field === "description" && posting.hint && posting.hint.key === rowsRef.current[index]?.key) {
      const h = hintKeyAction(e.key, { count: posting.hint.items.length, highlighted: hintHi, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey || e.altKey });
      if (h) {
        e.preventDefault();
        if (h.type === "highlight") setHintHi(h.index);
        else if (h.type === "close") closeHint();
        else acceptHint(index, h.index);
        return;
      }
    }
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
    const current = menuList.findIndex((c) => c.code === rowsRef.current[index]?.category);
    setMenu({ row: index, hi: Math.max(0, current) });
  }

  function onCategoryDigit(index: number, digit: string) {
    const d = digits.current;
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    // Numerot asiakkaan luokista: pelkällä metsäasiakkaalla 3–9 valitaan heti kuten ennen.
    const res = categoryDigit(d.buffer, digit, menuNumbers);
    d.buffer = res.buffer;
    if (res.select !== null) {
      d.buffer = "";
      setMenu({ row: index, hi: menuIndexOfNo(res.select, menuList) });
      chooseCategory(index, categoryByNo(res.select)!.code);
      return;
    }
    if (res.highlight !== null) {
      setMenu({ row: index, hi: menuIndexOfNo(res.highlight, menuList) });
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
    else if (isAssetPurchase(code) && hasAmount && !next.assetId && !next.assetRatePct) setDialog({ type: "asset", key: r.key });
    else if (isAssetSale(code) && !next.assetId && !next.saleAssetId) setDialog({ type: "sale", key: r.key, toAmount: true });
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

  // Ehdotuslista kiinteästi selitteen alle kuten luokkavalikko, jotta vierityslaatikko ei leikkaa sitä.
  const hintKey = posting.hint?.key ?? null;
  useLayoutEffect(() => {
    if (!hintKey) {
      setHintPos(null);
      return;
    }
    const place = () => {
      const row = rowsRef.current.findIndex((r) => r.key === hintKey);
      const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}-${col("description")}"]`);
      if (!el) return setHintPos(null);
      const rect = el.getBoundingClientRect();
      setHintPos({ left: rect.left, top: rect.bottom, width: Math.max(rect.width, 360) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintKey]);

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
    else if (isAssetPurchase(r.category) && !r.assetId && !r.assetRatePct && (rowNet(r, year, client) ?? 0) > smallAssetLimit(category(r.category)!.activity)) {
      setDialog({ type: "asset", key });
    } else if (isAssetSale(r.category) && !r.assetId && !r.saleAssetId) setDialog({ type: "sale", key });
  }

  /** Ikkunan sulkeminen: takaisin summan jälkeiseen kenttään, tai summaan, jos sitä ei vielä ole kirjoitettu. */
  function closeDialogBack(key: string, toAmount = false) {
    setDialog(null);
    const i = indexOf(key);
    if (i >= 0) setPendingFocus({ row: i, col: col("amountGross") + (toAmount ? 0 : 1) });
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
    if (!pasteFields(properties.length > 0, hasFarms).includes(field as PasteField)) return;
    e.preventDefault();
    setRows((rs) => applyGridPaste(rs, index, field as PasteField, parseClipboard(text), { year, properties, farms, newKey }));
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
    if (activity) fd.set("toiminta", ACTIVITY_PARAM[activity]);
    // Odottamaan jätetyt ehdotusrivit eivät tallennu; ne palaavat ehdotukseksi.
    const keepPending = deferredSuggestionLines(rowsRef.current);
    const payload = rowsRef.current
      .filter((r) => r.id || (!isBlankGridRow(r) && !(r.suggestionId && r.deferred)))
      .map((r) => ({
        key: r.key, id: r.id, bookedOn: r.bookedOn, description: r.description, category: r.category, amountGross: r.amountGross, vatRate: r.vatRate,
        businessSharePct: r.businessSharePct, otherSharePct: r.otherSharePct ?? "", withholding: r.withholding, forestPropertyId: r.forestPropertyId, farmId: r.farmId ?? "", kind: r.kind, reference: r.reference, assetRatePct: r.assetRatePct, saleAssetId: r.saleAssetId,
        suggestionId: r.id ? null : (r.suggestionId ?? null),
        suggestionLine: r.id || !r.suggestionId ? null : (r.suggestionLine ?? null),
      }));
    // Ehdotus, jonka kaikki rivit on poistettu taulukosta, hylätään tallennuksessa.
    const present = new Set(rowsRef.current.map((r) => r.suggestionId).filter(Boolean));
    const dismissedSuggestionIds = [...knownSuggestions.current].filter((id) => !present.has(id));
    fd.set("payload", JSON.stringify({ rows: payload, deletedIds: deleted, dismissedSuggestionIds, keepPending }));
    startTransition(async () => {
      const res = await action(fd);
      setResult(res);
      if (res.status === "error") setErrors(res.rowErrors);
      if (res.status === "saved") {
        setErrors({});
        setOriginal(res.rows);
        // Odottavat ehdotukset (myös odottamaan jätetyt rivit) tulevat palvelimelta uusina.
        const waiting = res.suggestionRows ?? [];
        const next = [...res.rows, ...waiting];
        setRows(next.length ? next : [emptyGridRow(newKey(), defaultDate)]);
        setDeleted([]);
        setUndoStack([]);
        htOffered.current = new Set(res.rows.map((r) => r.key));
        // Tallennetut ehdotukset on hyväksytty ja tyhjennetyt hylätty; jäljellä ovat palvelimen odottavat.
        knownSuggestions.current = new Set(waiting.map((r) => r.suggestionId!).filter(Boolean));
        suggestionSnapshot.current = new Map(waiting.map((r) => [r.key, r]));
      }
    });
  }, [action, clientId, year, deleted, defaultDate, pending, activity]);

  function revert() {
    const sugg = [...suggestionSnapshot.current.values()].filter((r) => knownSuggestions.current.has(r.suggestionId!));
    setRows(original.length || sugg.length ? [...original, ...sugg] : [emptyGridRow(newKey(), defaultDate)]);
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

  /** Ehdotuksen hylkäys heti kantaan: tosite jää vuoden tositteeksi, ja rivit poistuvat taulukosta. */
  async function dismissSuggestion(suggestionId: string) {
    if (!window.confirm("Hylätäänkö ehdotus? Tosite jää vuoden tositteisiin, ja voit tunnistaa sen uudelleen.")) return;
    const res = await dismissSuggestionAction({ clientId, suggestionId });
    if (!res.ok) {
      showToast(res.error);
      return;
    }
    knownSuggestions.current.delete(suggestionId);
    setRows((rs) => {
      const next = rs.filter((r) => r.suggestionId !== suggestionId);
      return next.length ? next : [emptyGridRow(newKey(), defaultDate)];
    });
    setUndoStack((u) => u.filter((op) => op.row.suggestionId !== suggestionId));
    showToast("Ehdotus hylätty.");
  }

  // Varoitus poistuttaessa, jos muutoksia ei ole tallennettu. Sivun sisäiset linkit
  // eivät laukaise beforeunloadia, joten niihin kysytään erikseen.
  useEffect(() => {
    if (!warnDirty) return;
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
  }, [warnDirty]);

  // ---------------------------------------------------------------------------
  // Näkymä
  // ---------------------------------------------------------------------------

  // Odottamaan jätetyt ehdotusrivit eivät ole mukana summissa, koska ne eivät tallennu.
  const filled = rows.filter((r, i) => visible[i] && !isBlankGridRow(r) && !(r.suggestionId && r.deferred));
  const filledAll = filtering ? rows.filter((r) => !isBlankGridRow(r) && !(r.suggestionId && r.deferred)).length : filled.length;

  /** Ehdotusrivin hyväksyntä: odottamaan jätetty rivi ei tallennu tällä kertaa. */
  function setDeferred(keys: string[], deferred: boolean) {
    const set = new Set(keys);
    setRows((rs) => rs.map((r) => (set.has(r.key) && r.suggestionId && !r.id ? { ...r, deferred } : r)));
  }
  const totals = filled.reduce(
    (s, r) => {
      const g = parseAmount(r.amountGross);
      const n = rowNet(r, year, client);
      return { gross: s.gross + (g !== null && Number.isFinite(g) ? g : 0), net: s.net + (n ?? 0) };
    },
    { gross: 0, net: 0 },
  );
  const saleOptions = (r: GridRow) => {
    const taken = new Set(rows.filter((x) => x.key !== r.key && isAssetSale(x.category)).map((x) => x.saleAssetId || x.assetId));
    // Myynnin luokka ratkaisee toiminnon: metsän myynnistä metsän investoinnit, maatalouden myynnistä maatalouden.
    const activity = category(r.category)?.activity ?? "forestry";
    return assets.filter((a) => (!a.disposed_on || a.id === r.assetId) && !taken.has(a.id) && (a.activity ?? "forestry") === activity);
  };
  const assetOptions = (r: GridRow) =>
    r.category === "agri_asset_purchase" ? agriAssetChoices(year) : ASSET_CLASSES.map((a) => ({ id: String(a.pct), label: `${a.label} ${a.pct} %` }));
  const assetChoiceLabel = (r: GridRow) => assetOptions(r).find((o) => o.id === r.assetRatePct)?.label ?? r.assetRatePct;
  const cellClass = (bad: boolean, extra = "") =>
    `h-9 w-full rounded-md border bg-paper px-2 outline-none focus:border-sky focus:ring-2 focus:ring-sky/30 ${bad ? "border-coral" : "border-transparent hover:border-line"} ${extra}`;
  const dialogRow = dialog ? rows.find((r) => r.key === dialog.key) : undefined;
  const suggestionWarning = (r: GridRow) => suggestionDateWarning(r, year, suggestionSnapshot.current.get(r.key)?.bookedOn);
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

      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Suodata kirjauksia">
        <label className="grid gap-1 text-xs font-semibold text-ink/70">
          Luokka
          <select
            className="h-9 rounded-md border border-line bg-paper px-2 text-sm font-normal text-ink"
            value={filter.category}
            onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}
          >
            <option value="">Kaikki luokat</option>
            {menuList.map((c) => (
              <option key={c.code} value={c.code}>
                {c.no} {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink/70">
          Kuukausi
          <select
            className="h-9 rounded-md border border-line bg-paper px-2 text-sm font-normal text-ink"
            value={filter.month ?? ""}
            onChange={(e) => setFilter((f) => ({ ...f, month: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">Koko vuosi</option>
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-ink/70">
          Haku
          <input
            type="search"
            className="h-9 w-56 rounded-md border border-line bg-paper px-2 text-sm font-normal text-ink"
            value={filter.text}
            placeholder="Selite, viite tai summa"
            autoComplete="off"
            onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
          />
        </label>
        {filtering ? (
          <button type="button" className="h-9 px-2 text-sm font-semibold text-sky hover:underline" onClick={() => setFilter(EMPTY_FILTER)}>
            Näytä kaikki
          </button>
        ) : null}
        {filtering ? <span className="pb-2 text-xs text-ink/60">Uudet ja tallentamattomat rivit näkyvät aina. Tallennus koskee kaikkia rivejä.</span> : null}
      </div>

      {/* relative: näkymättömät otsikot pysyvät vierityslaatikon sisällä eivätkä levennä sivua. */}
      <div className="relative overflow-x-auto rounded-xl border border-line bg-paper">
        <table ref={tableRef} className="w-full min-w-[62rem] border-collapse text-sm">
          <thead className="bg-cloud/60 text-left text-xs font-semibold uppercase tracking-wide text-ink/60">
            <tr>
              <th className="w-8 px-2 py-2 text-right">#</th>
              <th className="px-2 py-2">Päivä</th>
              <th className="px-2 py-2">Selite</th>
              <th className="px-2 py-2">Luokka</th>
              <th className="px-2 py-2 text-right">Summa (sis. alv)</th>
              <th className="px-2 py-2 text-right">Alv %</th>
              <th className="px-2 py-2 text-right" title="Oman toiminnon osuus prosentteina. Tyhjä = 100 %. Enter ohittaa sarakkeen, Tab vie siihen.">
                Osuus %
              </th>
              {both ? (
                <th className="px-2 py-2 text-right" title="Toisen toiminnon osuus menosta (metsä tai maatalous). Loppu on yksityistä. Enter ohittaa sarakkeen.">
                  Toinen %
                </th>
              ) : null}
              <th className="px-2 py-2 text-right">Veroton</th>
              <th className="px-2 py-2">Ennakko</th>
              {properties.length ? <th className="px-2 py-2">Metsätila</th> : null}
              {hasFarms ? <th className="px-2 py-2" title="Tasausvaraus lasketaan maatiloittain. Yhteinen = kaikille tiloille yhteinen kirjaus.">Maatila</th> : null}
              <th className="px-2 py-2">Tosite</th>
              <th className="px-2 py-2">Tyyppi</th>
              <th className="w-8 px-1 py-2">
                <span className="sr-only">Poista</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              if (!visible[i]) return null;
              const err = errors[r.key] ?? {};
              const livestock = rowLivestockDeferral(r, year, client);
              const kind = rowKind(r);
              const net = rowNet(r, year, client);
              // Osuus alle 100 % tai toisen toiminnon osuus: rivin alle näytetään, paljonko kuuluu kullekin.
              const sharePct = rowSharePct(r);
              const otherPct = rowOtherSharePct(r);
              const share = sharePct !== null && (sharePct < 100 || (otherPct && allowsOtherShare(r.category))) ? rowShare(r, year, client) : null;
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
              const sg = r.suggestion && r.suggestionId && !r.id ? r.suggestion : null;
              const dateWarning = sg ? suggestionWarning(r) : null;
              const confidencePct = sg ? Math.round(sg.confidence * 100) : 0;
              const group = sg ? groupOf.get(r.key) : undefined;
              const header = group && group.firstKey === r.key && group.rowKeys.length > 1 ? group : null;
              // Yksirivisen tositteen ero näytetään rivin alla; ryhmän ero otsikossa.
              const singleMismatch = group && group.rowKeys.length === 1 && group.balance.status === "mismatch" ? group : null;
              return [
                header ? (
                  <tr key={`${r.key}-g`} className="border-t-2 border-sky/40 bg-sky-soft">
                    <td className="border-l-4 border-sky" />
                    <td colSpan={columns.length + 5} className="px-2 py-2 text-xs text-ink/80">
                      <GroupHeader group={header} clientId={clientId} onDefer={setDeferred} />
                    </td>
                  </tr>
                ) : null,
                <tr
                  key={r.key}
                  className={`border-t align-top ${sg ? `border-sky/30 bg-sky-soft${r.deferred ? " opacity-60" : ""}` : r.id ? "border-line" : "border-line bg-sky-soft/30"}`}
                  title={sg ? `Ehdotus: ${sg.reasoning}` : undefined}
                >
                  <td className={`px-2 py-2.5 text-right tabular ${sg ? "border-l-4 border-sky font-semibold text-sky" : "text-ink/45"}`}>{i + 1}</td>
                  <td className="px-1 py-1 min-w-[6.5rem]">
                    <input
                      {...common("bookedOn")}
                      aria-label={`Päivä, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.bookedOn), "tabular")}
                      value={r.bookedOn}
                      placeholder={`p.k.${year}`}
                      autoComplete="off"
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        // Lyhyt päivä (5.9.) täydennetään vuodella näkyviin, jotta kirjanpitäjä näkee tulkinnan.
                        const iso = normalizeDate(e.currentTarget.value, year);
                        if (iso && toFinnishDate(iso) !== r.bookedOn) patchRow(r.key, { bookedOn: toFinnishDate(iso) });
                      }}
                      onChange={(e) => patchRow(r.key, { bookedOn: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[11rem]">
                    <input
                      {...common("description")}
                      aria-label={`Selite, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.description))}
                      value={r.description}
                      autoComplete="off"
                      onChange={(e) => {
                        const value = e.target.value;
                        patchRow(r.key, { description: value });
                        // Ehdotukset vain uudelle, käsin kirjoitettavalle riville. Tallennettu kirjaus ja tositteen ehdotus pitävät tiliöintinsä.
                        if (!r.id && !r.suggestionId) {
                          setHintHi(null);
                          const amount = parseAmount(r.amountGross);
                          posting.request(r.key, value, normalizeDate(r.bookedOn, year) ?? `${year}-12-31`, amount !== null && Number.isFinite(amount) ? amount : null);
                        }
                      }}
                      // Fokus pois selitteestä: lista ja kesken oleva haku pois. Napsautus listassa ei vie fokusta.
                      onBlur={closeHint}
                    />
                  </td>
                  <td className="px-1 py-1 min-w-[11rem]">
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
                    {isAssetPurchase(r.category) ? (
                      r.assetId ? (
                        <span className="block px-2 text-xs text-ink/55">Investointi: {r.assetDescription}</span>
                      ) : (
                        <button type="button" tabIndex={-1} className={`px-2 text-xs font-semibold ${r.assetRatePct ? "text-ink/60" : "text-coral"}`} onClick={() => setDialog({ type: "asset", key: r.key })}>
                          {r.assetRatePct ? assetChoiceLabel(r) : "Valitse hyödykkeen laji"}
                        </button>
                      )
                    ) : null}
                    {allowsLivestockDeferral(r.category) ? (
                      <label className="flex items-center gap-1.5 px-2 text-xs font-semibold text-ink/70">
                        <input
                          type="checkbox"
                          tabIndex={-1}
                          checked={isLivestockDeferral(r.category)}
                          onChange={(e) => {
                            const checked = e.currentTarget.checked;
                            patchRow(r.key, (x) => ({ ...x, category: withLivestockDeferral(x.category, checked) }));
                          }}
                        />
                        Jaksota 3 vuodelle
                      </label>
                    ) : null}
                    {isAssetSale(r.category) ? (
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
                  <td className="px-1 py-1 min-w-[4.5rem]">
                    <input
                      {...common("businessSharePct")}
                      aria-label={`Metsätalouden osuus prosentteina, rivi ${i + 1}`}
                      className={cellClass(Boolean(err.businessSharePct), "text-right tabular")}
                      value={r.businessSharePct}
                      inputMode="decimal"
                      placeholder="100"
                      autoComplete="off"
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => {
                        // 100 % näytetään tyhjänä, jotta poikkeava osuus erottuu taulukossa.
                        const n = parseAmount(e.currentTarget.value);
                        const shown = n === 100 ? "" : n !== null && Number.isFinite(n) && n > 0 && n <= 100 ? formatSharePct(n) : e.currentTarget.value;
                        if (shown !== r.businessSharePct) patchRow(r.key, { businessSharePct: shown });
                      }}
                      onChange={(e) => patchRow(r.key, { businessSharePct: e.target.value })}
                    />
                  </td>
                  {both ? (
                    <td className="px-1 py-1 min-w-[4.5rem]">
                      <input
                        {...common("otherSharePct")}
                        aria-label={`Toisen toiminnon osuus prosentteina, rivi ${i + 1}`}
                        className={cellClass(Boolean(err.otherSharePct), "text-right tabular")}
                        value={r.otherSharePct ?? ""}
                        inputMode="decimal"
                        placeholder={allowsOtherShare(r.category) ? "0" : ""}
                        autoComplete="off"
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => {
                          // 0 % näytetään tyhjänä kuten 100 % osuudessa.
                          const n = parseAmount(e.currentTarget.value);
                          const shown = n === 0 ? "" : n !== null && Number.isFinite(n) && n > 0 && n < 100 ? formatSharePct(n) : e.currentTarget.value;
                          if (shown !== (r.otherSharePct ?? "")) patchRow(r.key, { otherSharePct: shown });
                        }}
                        onChange={(e) => patchRow(r.key, { otherSharePct: e.target.value })}
                      />
                    </td>
                  ) : null}
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
                  {hasFarms ? (
                    <td className="px-1 py-1 min-w-[9rem]">
                      <select
                        {...common("farmId")}
                        aria-label={`Maatila, rivi ${i + 1}`}
                        className={cellClass(Boolean(err.farmId))}
                        value={r.farmId ?? ""}
                        onChange={(e) => patchRow(r.key, { farmId: e.target.value })}
                      >
                        <option value="">Yhteinen</option>
                        {r.farmId && !farms.some((f) => f.id === r.farmId) ? <option value={r.farmId}>{r.farmId} (tuntematon)</option> : null}
                        {farms.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap px-2 py-2.5">
                    {sg ? (
                      <a
                        href={documentHref(clientId, sg.documentId, sg.pages)}
                        target="_blank"
                        rel="noreferrer"
                        tabIndex={-1}
                        className="rounded-full bg-sky px-2 py-0.5 text-xs font-bold text-paper hover:bg-sky/85"
                        title={`Avaa tosite ${sg.documentName}${sg.pages.length ? `, ${pageLabel(sg.pages)}` : ""}`}
                      >
                        {sg.pages.length ? `Ehdotus, ${pageLabel(sg.pages)}` : "Ehdotus"}
                      </a>
                    ) : r.id ? (
                      <span className="grid gap-0.5">
                        {r.sourceDocumentId ? (
                          <a href={documentHref(clientId, r.sourceDocumentId, r.sourcePages)} target="_blank" rel="noreferrer" tabIndex={-1} className="text-xs font-semibold text-sky hover:underline">
                            {sourceDocumentLabel(r.sourcePages)}
                          </a>
                        ) : null}
                        {/* Tavallinen linkki: tallentamattomista muutoksista varoitetaan ennen siirtymistä. */}
                        <a href={`/asiakkaat/${clientId}/kirjanpito/${r.id}`} tabIndex={-1} className="text-xs font-semibold text-sky hover:underline">
                          {r.documentCount ? `${r.documentCount} kpl` : "Lisää"}
                        </a>
                      </span>
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
                sg ? (
                  <tr key={`${r.key}-s`} className="bg-sky-soft">
                    <td className="border-l-4 border-sky" />
                    <td colSpan={columns.length + 5} className="px-2 pb-2 text-xs text-ink/70">
                      <span className="font-semibold text-sky">Tekoälyn ehdotus</span>
                      {" · "}
                      {sg.sourceDocument ? <span className="font-semibold">{sg.sourceDocument}</span> : null}
                      {sg.sourceDocument ? " · " : null}
                      <span>{DOCUMENT_TYPE_LABEL[sg.documentType]}</span>
                      {" · "}
                      <a href={documentHref(clientId, sg.documentId, sg.pages)} target="_blank" rel="noreferrer" tabIndex={-1} className="font-semibold text-sky hover:underline">
                        {sg.pages.length ? `${sourceDocumentLabel(sg.pages)} ${sg.documentName}` : sg.documentName}
                      </a>
                      {" · "}
                      <span className={confidencePct < 60 ? "font-semibold text-amber" : ""}>Varmuus {confidencePct} %</span>
                      {sg.reasoning ? ` · ${sg.reasoning}` : ""}
                      {sg.documentType === "timber_annual_summary" ? (
                        <span className="block text-ink/70">
                          Rivi on vuosi-ilmoituksesta eli koko vuoden yhteenvedosta. Jos kauppa on jo kirjattu tilityksestä, poista tämä rivi.
                        </span>
                      ) : null}
                      {sg.posting ? (
                        <span className="block">
                          {sg.posting.applied === "memory" ? (
                            <>
                              <span className="font-semibold text-moss">Tiliöintiehdotus aiemmista kirjauksista</span> (ehdotus, ohittaa tekoälyn luokan): {sg.posting.basis}
                            </>
                          ) : sg.posting.basis ? (
                            <>
                              <span className="font-semibold text-moss">Tiliöinti</span> (ehdotus): {sg.posting.basis}
                            </>
                          ) : null}
                          {sg.posting.note ? <span className="block font-semibold text-amber">{sg.posting.note}</span> : null}
                          {sg.posting.options.map((o, oi) => (
                            <span key={`${o.source}-${o.category}-${oi}`} className="block" title={o.basis}>
                              {o.source === "ai" ? "Tekoäly ehdotti" : o.source === "office" ? "Toimiston muilta asiakkailta" : "Aiemmin myös"}: {o.label}.{" "}
                              <button
                                type="button"
                                tabIndex={-1}
                                className="font-semibold text-sky hover:underline"
                                onClick={() => patchRow(r.key, (x) => choosePostingOption(x, oi, year, client))}
                              >
                                Käytä tätä
                              </button>
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {sg.note ? <span className="block font-semibold text-amber">{sg.note}</span> : null}
                      {singleMismatch ? <span className="block font-semibold text-coral">{balanceText(singleMismatch)}</span> : null}
                      {sg.duplicateWarning ? <span className="block font-semibold text-coral">{sg.duplicateWarning}</span> : null}
                      <label className="mt-1 flex w-fit items-center gap-2 font-semibold text-ink/80">
                        <input type="checkbox" tabIndex={-1} checked={!r.deferred} onChange={(e) => setDeferred([r.key], !e.currentTarget.checked)} />
                        {r.deferred ? "Odottaa: ei tallennu nyt, palaa ehdotukseksi" : "Hyväksy tallennettaessa"}
                      </label>
                      {dateWarning ? <span className="block font-semibold text-amber">{dateWarning}</span> : null}
                      {sg.first ? (
                        <span className="block">
                          {sg.compilation
                            ? "Tiedostossa on useita asiakirjoja. Se jää vuoden tositteeksi, ja jokaiseen kirjaukseen tulee linkki oikealle sivulle. Tarkista ja muokkaa rivit, ja tallenna. "
                            : "Tarkista ja muokkaa rivit, ja tallenna. Tosite liitetään ensimmäiseen kirjaukseen. "}
                          <button type="button" tabIndex={-1} className="font-semibold text-coral hover:underline" onClick={() => void dismissSuggestion(r.suggestionId!)}>
                            Hylkää ehdotus
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ) : null,
                share ? (
                  <tr key={`${r.key}-o`}>
                    <td />
                    <td colSpan={columns.length + 5} className="px-2 pb-2 text-xs text-ink/70">
                      {shareNote(r, share, formatEur)}
                    </td>
                  </tr>
                ) : null,
                livestock ? (
                  <tr key={`${r.key}-j`}>
                    <td />
                    <td colSpan={columns.length + 5} className="px-2 pb-2 text-xs text-ink/70">
                      Jaksotus: {livestock.map((x) => `${x.year} ${formatEur(x.amount)}`).join(", ")}.
                    </td>
                  </tr>
                ) : null,
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
                {filtering ? `${filled.length} / ${filledAll} riviä näkyvissä` : filled.length === 1 ? "1 rivi" : `${filled.length} riviä`}
              </td>
              <td className="px-2 py-2 text-right tabular">{formatEur(totals.gross)}</td>
              <td />
              <td />
              {both ? <td /> : null}
              <td className="px-2 py-2 text-right tabular">{formatEur(totals.net)}</td>
              <td colSpan={columns.length - 3 - (both ? 1 : 0)} />
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
          {menuList.map((c, idx) => {
            const groupStart = idx === 0 || menuList[idx - 1].group !== c.group;
            return (
              <div key={c.code}>
                {groupStart ? <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink/45">{menuGroupLabel(c, both && !activity)}</div> : null}
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

      {posting.hint && hintPos ? (
        <div
          role="listbox"
          aria-label="Tiliöintiehdotukset"
          className="fixed z-40 rounded-xl border border-line bg-paper py-1 text-sm shadow-lg"
          style={{ left: hintPos.left, top: hintPos.top + 2, width: hintPos.width }}
        >
          <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/45">Ehdotus aiemmista tiliöinneistä</div>
          {posting.hint.items.map((it, idx) => (
            <div
              key={`${it.category}-${idx}`}
              role="option"
              aria-selected={hintHi === idx}
              className={`cursor-pointer px-3 py-1.5 ${hintHi === idx ? "bg-sky-soft" : "hover:bg-cloud"}`}
              // Painallus ei vie fokusta selitteestä, jotta lista ei sulkeudu ennen valintaa.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => acceptHint(rows.findIndex((x) => x.key === posting.hint?.key), idx)}
            >
              <span className="font-semibold">{it.label}</span>
              {it.source === "office" ? <span className="ml-2 rounded-full bg-amber-soft px-1.5 text-[10px] font-bold text-amber">toimisto</span> : null}
              <span className="block text-xs text-ink/60">{it.basis}</span>
            </div>
          ))}
          <div className="px-3 pb-1.5 pt-1 text-xs text-ink/55">Ehdotus. Nuoli alas valitsee, Enter tai Tab käyttää, Esc sulkee. Ilman valintaa Enter jatkaa kuten ennen.</div>
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
        {warnDirty ? <span className="text-sm text-amber">Muutokset on vielä tallentamatta.</span> : null}
        {pendingSuggestions ? (
          <span className="text-sm text-sky">
            {pendingSuggestions === 1
              ? "1 ehdotusrivi odottaa tarkistusta. Se tallentuu kirjaukseksi, kun tallennat."
              : `${pendingSuggestions} ehdotusriviä odottaa tarkistusta. Ne tallentuvat kirjauksiksi, kun tallennat.`}
          </span>
        ) : null}
        {deferredSuggestions ? (
          <span className="text-sm text-ink/60">
            {deferredSuggestions === 1 ? "1 ehdotusrivi jää odottamaan." : `${deferredSuggestions} ehdotusriviä jää odottamaan.`}
          </span>
        ) : null}
      </div>

      <div className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-xs leading-relaxed text-ink/70">
        <p className="mb-1 font-semibold text-ink/80">Näppäimet</p>
        <p>
          <b>Enter</b> tai <b>Tab</b> seuraavaan kenttään, rivin lopussa seuraavalle tai uudelle riville. Enter ohittaa osuussarakkeet, Tab vie niihin. <b>Shift</b> takaisin. <b>Nuolet ylös ja alas</b> samaan
          sarakkeeseen toisella rivillä (ei selitteessä). Luokka: <b>numero</b> valitsee suoraan ({activity === "agriculture" ? "21–59" : activity === "forestry" ? "1–12" : hasAgriculture ? "metsä 1–12, maatalous 21–59" : "1–12"}), nuolet ja Enter valikossa, Esc sulkee. <b>T</b> vaihtaa tulon
          ja menon. <b>Delete</b> tyyppisarakkeessa poistaa rivin, <b>Ctrl + Z</b> palauttaa sen. <b>Ctrl + S</b> tallentaa. <b>Ctrl + N</b> tai Lisää rivi lisää rivin. Voit liittää
          rivejä Excelistä (summat arvonlisäveron kanssa).
        </p>
        <p className="mt-1">
          Selitteen alle voi tulla <b>ehdotus aiemmista tiliöinneistä</b>. Se ei täytä mitään itse: <b>nuoli alas</b> valitsee ehdotuksen, <b>Enter</b> tai <b>Tab</b> käyttää
          sitä, <b>Esc</b> sulkee. Ilman valintaa Enter ja Tab toimivat kuten ennen.
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
          options={assetOptions(dialogRow)}
          selected={dialogRow.assetRatePct}
          empty=""
          onSelect={(id) => {
            patchRow(dialog.key, { assetRatePct: id });
            closeDialogBack(dialog.key, dialog.toAmount);
          }}
          onClose={() => closeDialogBack(dialog.key, dialog.toAmount)}
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
            closeDialogBack(dialog.key, dialog.toAmount);
          }}
          onClose={() => closeDialogBack(dialog.key, dialog.toAmount)}
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
    `${gross !== null && Number.isFinite(gross) ? num2(gross) : "–"} € (sis. alv)`,
    `veroton ${net === null ? "–" : num2(net)} €`,
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
          <p className="text-ink/65">Ennakonpidätys vähennetään maksettavasta verosta. Metsätaloudessa se on yleensä 26–30 % puukaupan arvosta.</p>
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

/** Täsmäytyksen teksti: tulot − vähennykset = netto, ja vertailu tositteen summaan. */
function balanceText(g: SuggestionGroup): string {
  const b = g.balance;
  const parts: string[] = [];
  if (b.income) parts.push(`Tulot ${formatEur(b.income)}`);
  if (b.withholding) parts.push(`ennakonpidätys ${formatEur(b.withholding)}`);
  if (b.costs) parts.push(`${b.income ? "vähennykset" : "menot"} ${formatEur(b.costs)}`);
  const sum = `${parts.join(", ")}. ${b.income && b.costs ? `Erotus ${formatEur(Math.abs(b.net))}.` : ""}`.trim();
  if (b.status === "no_total") return `${sum} Tositteen loppusummaa ei tunnistettu, joten täsmäytystä ei tehty.`;
  if (b.status === "ok") return `${sum} Täsmää tositteen summaan ${formatEur(b.total ?? 0)}.`;
  return `${sum} Tositteen summa on ${formatEur(b.total ?? 0)}: ero ${formatEur(Math.abs(b.difference ?? 0))}. Tarkista rivit ennen tallennusta.`;
}

/**
 * Monikirjauksisen tositteen otsikko: asiakirja, rivien määrä, täsmäytys ja
 * hyväksyntä kerralla. Rivit hyväksytään tallennettaessa; odottamaan jätetyt
 * palaavat ehdotukseksi.
 */
function GroupHeader({ group, clientId, onDefer }: { group: SuggestionGroup; clientId: string; onDefer: (keys: string[], deferred: boolean) => void }) {
  const b = group.balance;
  const allDeferred = group.deferredKeys.length === group.rowKeys.length;
  const tone = b.status === "ok" ? "text-moss" : b.status === "mismatch" ? "text-coral" : "text-ink/70";
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-sky">{DOCUMENT_TYPE_LABEL[group.documentType]}</span>
        {group.sourceDocument ? <span className="font-semibold">{group.sourceDocument}</span> : null}
        <span>· {group.rowKeys.length} riviä</span>
        <a href={documentHref(clientId, group.documentId, group.pages)} target="_blank" rel="noreferrer" tabIndex={-1} className="font-semibold text-sky hover:underline">
          {group.pages.length ? sourceDocumentLabel(group.pages) : "Tosite"}
        </a>
        <button
          type="button"
          tabIndex={-1}
          className="ml-auto rounded-full border border-sky/40 px-2 py-0.5 font-semibold text-sky hover:bg-sky/10"
          onClick={() => onDefer(group.rowKeys, !allDeferred)}
        >
          {allDeferred ? "Hyväksy kaikki rivit" : group.deferredKeys.length ? "Jätä kaikki odottamaan" : "Jätä tosite odottamaan"}
        </button>
      </div>
      <span className={`font-semibold ${tone}`}>{balanceText(group)}</span>
    </div>
  );
}
