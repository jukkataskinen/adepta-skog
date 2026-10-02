import { round2 } from "./amounts";
import { travelRates } from "./rules";

/**
 * Lomakkeen 2 ajoneuvo- ja matkaselvitys (lomake 2, kohdat 7–9; tietuekuvaus
 * VSY002). Puhdas laskenta: syötetyt kilometrit, kulut ja matkapäivät sisään,
 * lomakkeen kentät ja siirrot ulos.
 *
 * - Maatalouden kalustoon kuuluva ajoneuvo: yksityisajojen (283) ja
 *   metsätalouden ajojen (284) osuus kokonaismenoista (282) kilometrien
 *   suhteessa. Molemmat tuloutetaan maataloudessa kohtaan 221 (lomakkeen
 *   alaviite 3), ja metsätalouden osuus vähennetään 2C:n kohdassa 630
 *   (toisesta tulolähteestä siirrettävät menot).
 * - Yksityistalouteen kuuluva auto maataloudessa: enimmäismäärä (518) on
 *   maatalouden ajot kertaa verovapaa kilometrikorvaus. Lisävähennys (285) on
 *   enimmäismäärä miinus muistiinpanoissa jo vähennetty (519), alaviite 5.
 * - Tilapäiset työmatkat: enimmäismäärä matkapäivältä on verovapaa päiväraha
 *   (402, 407); ulkomaan enimmäismäärä syötetään (423). Lisävähennykset
 *   (405, 410, 425) samoin kuin autolla, ja yhteensä 532, 533 ja 286.
 * - Lisävähennykset yhteensä (285 + 286) ovat maatalouden muita vähennyksiä
 *   (464), kuten OmaVero ne siirtää.
 */

export interface VehicleReportInput {
  vehicleBasis: 1 | 2 | null;
  vehicleTotalKm: number | null;
  vehiclePrivateKm: number | null;
  vehicleForestryKm: number | null;
  vehicleCosts: number | null;
  carBasis: 1 | 2 | null;
  carTotalKm: number | null;
  carAgriKm: number | null;
  carDeducted: number | null;
  tripsFullDays: number | null;
  tripsFullDeducted: number | null;
  tripsPartDays: number | null;
  tripsPartDeducted: number | null;
  tripsAbroadDays: number | null;
  tripsAbroadMax: number | null;
  tripsAbroadDeducted: number | null;
}

export const EMPTY_VEHICLE_REPORT: VehicleReportInput = {
  vehicleBasis: null, vehicleTotalKm: null, vehiclePrivateKm: null, vehicleForestryKm: null, vehicleCosts: null,
  carBasis: null, carTotalKm: null, carAgriKm: null, carDeducted: null,
  tripsFullDays: null, tripsFullDeducted: null, tripsPartDays: null, tripsPartDeducted: null, tripsAbroadDays: null, tripsAbroadMax: null, tripsAbroadDeducted: null,
};

/** Selvityksen kentät, jotka lasketaan tai annetaan selvityksestä. Muut harvinaiset kentät eivät kuulu tähän. */
export const VEHICLE_CODES = [
  "281", "516", "282", "283", "284", "534", "287", "288", "518", "519", "285",
  "401", "406", "411", "402", "403", "404", "405", "407", "408", "429", "410", "423", "424", "425", "532", "533", "286",
] as const;

export interface VehicleReportResult {
  fields: Record<string, number>;
  /** Maatalouden tuloutus yksityiskäytöstä (221): 283 + 284. */
  privateUseIncome: number;
  /** Maatalouden muut vähennykset (464): 285 + 286. */
  additionalDeduction: number;
  /** Metsätalouden ajot (284): 2C:n kohta 630. */
  forestryTransfer: number;
  errors: string[];
}

const n = (v: number | null) => v ?? 0;

export function computeVehicleReport(r: VehicleReportInput, year: number): VehicleReportResult {
  const rates = travelRates(year);
  const f: Record<string, number> = {};
  const set = (code: string, v: number) => {
    const x = round2(v);
    if (x !== 0) f[code] = x;
  };
  const errors: string[] = [];

  // 7. Kaluston ajoneuvo.
  const total = n(r.vehicleTotalKm);
  const costs = n(r.vehicleCosts);
  let privateUse = 0;
  let forestry = 0;
  const vehicleUsed = total > 0 || costs > 0 || n(r.vehiclePrivateKm) > 0 || n(r.vehicleForestryKm) > 0;
  if (vehicleUsed) {
    if (!r.vehicleBasis) errors.push("Kerro, perustuvatko ajoneuvon käyttötiedot ajopäiväkirjaan vai muuhun selvitykseen (281).");
    if (total <= 0) errors.push("Anna ajoneuvon kokonaiskilometrit verovuonna (516).");
    else if (n(r.vehiclePrivateKm) + n(r.vehicleForestryKm) > total) errors.push("Yksityisajot ja metsätalouden ajot ovat yhteensä enemmän kuin kokonaiskilometrit.");
    else {
      privateUse = round2((costs * n(r.vehiclePrivateKm)) / total);
      forestry = round2((costs * n(r.vehicleForestryKm)) / total);
    }
    if (r.vehicleBasis) f["281"] = r.vehicleBasis;
    set("516", total);
    set("282", costs);
    set("283", privateUse);
    set("284", forestry);
  }

  // 8. Oma auto maataloudessa.
  let carExtra = 0;
  const carUsed = n(r.carTotalKm) > 0 || n(r.carAgriKm) > 0 || n(r.carDeducted) > 0;
  if (carUsed) {
    if (!r.carBasis) errors.push("Kerro, perustuvatko oman auton käyttötiedot ajopäiväkirjaan vai muuhun selvitykseen (534).");
    if (n(r.carAgriKm) > n(r.carTotalKm)) errors.push("Oman auton maatalouden ajot ovat enemmän kuin kokonaiskilometrit.");
    const max = round2(n(r.carAgriKm) * rates.kmRate);
    carExtra = round2(Math.max(0, max - n(r.carDeducted)));
    if (r.carBasis) f["534"] = r.carBasis;
    set("287", n(r.carTotalKm));
    set("288", n(r.carAgriKm));
    set("518", max);
    set("519", n(r.carDeducted));
    set("285", carExtra);
  }

  // 9. Tilapäiset työmatkat.
  const fullMax = round2(n(r.tripsFullDays) * rates.fullDay);
  const partMax = round2(n(r.tripsPartDays) * rates.partDay);
  const abroadMax = n(r.tripsAbroadMax);
  const fullExtra = round2(Math.max(0, fullMax - n(r.tripsFullDeducted)));
  const partExtra = round2(Math.max(0, partMax - n(r.tripsPartDeducted)));
  const abroadExtra = round2(Math.max(0, abroadMax - n(r.tripsAbroadDeducted)));
  if (n(r.tripsFullDays) || n(r.tripsFullDeducted)) {
    set("401", n(r.tripsFullDays));
    set("402", rates.fullDay);
    set("403", fullMax);
    set("404", n(r.tripsFullDeducted));
    set("405", fullExtra);
  }
  if (n(r.tripsPartDays) || n(r.tripsPartDeducted)) {
    set("406", n(r.tripsPartDays));
    set("407", rates.partDay);
    set("408", partMax);
    set("429", n(r.tripsPartDeducted));
    set("410", partExtra);
  }
  if (n(r.tripsAbroadDays) || abroadMax || n(r.tripsAbroadDeducted)) {
    if (!n(r.tripsAbroadDays)) errors.push("Anna ulkomaan matkapäivien määrä (411).");
    set("411", n(r.tripsAbroadDays));
    set("423", abroadMax);
    set("424", n(r.tripsAbroadDeducted));
    set("425", abroadExtra);
  }
  const tripsExtra = round2(fullExtra + partExtra + abroadExtra);
  set("532", fullMax + partMax + abroadMax);
  set("533", n(r.tripsFullDeducted) + n(r.tripsPartDeducted) + n(r.tripsAbroadDeducted));
  set("286", tripsExtra);

  return {
    fields: f,
    privateUseIncome: round2(privateUse + forestry),
    additionalDeduction: round2(carExtra + tripsExtra),
    forestryTransfer: forestry,
    errors,
  };
}

/** Selvityksessä on jotain: tyhjä selvitys ei korvaa käsin annettuja kenttiä. */
export function hasVehicleReport(r: VehicleReportInput | null): r is VehicleReportInput {
  return !!r && Object.values(r).some((v) => v !== null && v !== 0);
}
