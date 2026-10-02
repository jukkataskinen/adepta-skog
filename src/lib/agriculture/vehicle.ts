import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { hasVehicleReport, type VehicleReportInput } from "@/lib/tax/vehicle";
import { AgriError, type Actor } from "./year";

/**
 * Ajoneuvo- ja matkaselvitys vuodelle (0018). Syötetyt tiedot tallennetaan,
 * ja lomakkeen 2 kentät lasketaan niistä (src/lib/tax/vehicle.ts).
 * Käyttäjän RLS-transaktiossa; suljetun vuoden lukitus on kannassa.
 */

const COLUMNS: [keyof VehicleReportInput, string][] = [
  ["vehicleBasis", "vehicle_basis"], ["vehicleTotalKm", "vehicle_total_km"], ["vehiclePrivateKm", "vehicle_private_km"],
  ["vehicleForestryKm", "vehicle_forestry_km"], ["vehicleCosts", "vehicle_costs"],
  ["carBasis", "car_basis"], ["carTotalKm", "car_total_km"], ["carAgriKm", "car_agri_km"], ["carDeducted", "car_deducted"],
  ["tripsFullDays", "trips_full_days"], ["tripsFullDeducted", "trips_full_deducted"], ["tripsPartDays", "trips_part_days"],
  ["tripsPartDeducted", "trips_part_deducted"], ["tripsAbroadDays", "trips_abroad_days"], ["tripsAbroadMax", "trips_abroad_max"],
  ["tripsAbroadDeducted", "trips_abroad_deducted"],
];

export async function getVehicleReport(tx: Sql, clientId: string, year: number): Promise<VehicleReportInput | null> {
  const [row] = await tx.query<Record<string, string | number | null>>(
    `select ${COLUMNS.map(([, c]) => c).join(", ")} from sk_agri_vehicle_reports where client_id = $1 and tax_year = $2`,
    [clientId, year],
  );
  if (!row) return null;
  return Object.fromEntries(COLUMNS.map(([k, c]) => [k, row[c] === null ? null : Number(row[c])])) as unknown as VehicleReportInput;
}

/** Tallentaa selvityksen. Tyhjä selvitys poistaa rivin, jolloin käsin annetut kentät ovat taas käytössä. */
export async function saveVehicleReport(tx: Sql, actor: Actor, clientId: string, year: number, r: VehicleReportInput): Promise<void> {
  if ((r.vehiclePrivateKm ?? 0) + (r.vehicleForestryKm ?? 0) > (r.vehicleTotalKm ?? 0)) {
    throw new AgriError("Yksityisajot ja metsätalouden ajot ovat yhteensä enemmän kuin ajoneuvon kokonaiskilometrit.");
  }
  if ((r.carAgriKm ?? 0) > (r.carTotalKm ?? 0)) throw new AgriError("Oman auton maatalouden ajot ovat enemmän kuin kokonaiskilometrit.");
  if (!hasVehicleReport(r)) {
    await tx.query("delete from sk_agri_vehicle_reports where client_id = $1 and tax_year = $2", [clientId, year]);
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.vehicle.delete", entity: "sk_agri_vehicle_reports", details: { clientId, year } });
    return;
  }
  const cols = COLUMNS.map(([, c]) => c);
  const values = COLUMNS.map(([k]) => r[k]);
  await tx.query(
    `insert into sk_agri_vehicle_reports (organization_id, client_id, tax_year, ${cols.join(", ")})
     values ($1, $2, $3, ${cols.map((_, i) => `$${i + 4}`).join(", ")})
     on conflict (client_id, tax_year) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
    [actor.organizationId, clientId, year, ...values],
  );
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "agri.vehicle.save", entity: "sk_agri_vehicle_reports", details: { clientId, year } });
}
