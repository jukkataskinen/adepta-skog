import type { YearInfo } from "@/lib/ledger/queries";
import { isoDateHelsinki } from "@/lib/format";

/**
 * Menojäännöksen oletusvuosi: vanhinta avointa verovuotta edeltävä vuosi,
 * koska Skogin poistot alkavat siitä. Ilman verovuosia edellinen vuosi.
 */
export function defaultBalanceYear(years: YearInfo[]): number {
  const open = years.filter((y) => y.status === "open").map((y) => y.year);
  return (open.length ? Math.min(...open) : Number(isoDateHelsinki().slice(0, 4))) - 1;
}
