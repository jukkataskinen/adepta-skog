import { DELIVERY_WORK_TAX_FREE_M3, deliveryWorkRates } from "./rules";

/**
 * Hankintatyön arvo ohjetaksoilla. Puhdas laskenta, ei kantakutsuja.
 * Lähde: Verohallinnon ohje Hankintatyö verotuksessa (luvut 3.2 ja 4) ja
 * yhtenäistämisohjeen taksat (rules.ts).
 *
 * - Arvo vähennetään hankintakaupan tulosta metsätalouden pääomatulossa
 *   (Skogissa menona luokalla Hankintatyö).
 * - Tekijälle arvo on ansiotuloa vain siltä osin kuin puumäärä ylittää 125 m³
 *   maatilaa ja vuotta kohden. Veronalainen osuus lasketaan kertoimella
 *   (määrä − 125) / määrä erikseen valmistukselle ja kuljetukselle, eikä
 *   verovapautta voi kohdistaa kalleimmille puutavaralajeille.
 */

export interface DeliveryWorkItem {
  code: string;
  /** Valmistettu määrä m³. */
  made: number;
  /** Kuljetettu määrä m³. */
  transported: number;
}

export interface DeliveryWorkLine {
  code: string;
  label: string;
  made: number;
  transported: number;
  makingValue: number;
  transportValue: number;
}

export interface DeliveryWorkResult {
  /** Vuosi, jonka taksoja käytettiin. */
  ratesYear: number;
  lines: DeliveryWorkLine[];
  made: number;
  transported: number;
  /** Hankintatyön arvo yhteensä: vähennetään hankintakaupan tulosta. */
  total: number;
  /** Tekijöiden ansiotulona verotettava osa (yli 125 m³). */
  taxable: number;
  taxFree: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const share = (m3: number) => (m3 > DELIVERY_WORK_TAX_FREE_M3 ? (m3 - DELIVERY_WORK_TAX_FREE_M3) / m3 : 0);

export function deliveryWorkValue(year: number, items: DeliveryWorkItem[]): DeliveryWorkResult {
  const { year: ratesYear, rates } = deliveryWorkRates(year);
  const lines: DeliveryWorkLine[] = [];
  for (const item of items) {
    const rate = rates.find((r) => r.code === item.code);
    const made = Math.max(0, item.made || 0);
    const transported = Math.max(0, item.transported || 0);
    if (!rate || (!made && !transported)) continue;
    lines.push({
      code: rate.code, label: rate.label, made, transported,
      makingValue: round2(made * rate.making), transportValue: round2(transported * rate.transport),
    });
  }
  const made = round2(lines.reduce((s, l) => s + l.made, 0));
  const transported = round2(lines.reduce((s, l) => s + l.transported, 0));
  const makingTotal = lines.reduce((s, l) => s + l.makingValue, 0);
  const transportTotal = lines.reduce((s, l) => s + l.transportValue, 0);
  const total = round2(makingTotal + transportTotal);
  const taxable = round2(makingTotal * share(made) + transportTotal * share(transported));
  return { ratesYear, lines, made, transported, total, taxable, taxFree: round2(total - taxable) };
}
