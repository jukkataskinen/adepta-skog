"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import type { Sql } from "@/lib/db/types";
import { AGRI_POOLS, type AgriPool } from "@/lib/tax/agri-depreciation";
import {
  addDeferral,
  addFarm,
  addGrant,
  addReserve,
  addReserveUse,
  AgriError,
  deleteDeferral,
  deleteExtra,
  deleteFarm,
  deleteGrant,
  deleteReserve,
  deleteReserveUse,
  saveAgriDepreciations,
  saveAgriYear,
  setExtra,
} from "@/lib/agriculture/year";
import { saveVehicleReport } from "@/lib/agriculture/vehicle";
import { REPLACEMENT_EVENT_LABEL, replacementReserveMax, validateReplacementReserve } from "@/lib/tax/replacement-reserve";
import { formatEur } from "@/lib/format";

/**
 * Maatalous-välilehden lomakkeet. Jokainen lomake lähettää asiakkaan ja
 * vuoden, ja virhe palaa sivulle ?virhe=-parametrilla. Luvut hyväksytään
 * suomalaisittain (pilkku, välilyönnit). Lukujen sisältöä ei kirjoiteta
 * URL-osoitteeseen eikä lokiin.
 */

const uuid = z.string().uuid();
const yearSchema = z.coerce.number().int().min(2000).max(2100);

const parseNum = (v: unknown) => {
  const e = emptyToNull(v);
  return e === null ? null : Number(String(e).replace(/[\s€%]/g, "").replace(",", "."));
};
const optionalAmount = (message: string) => z.preprocess(parseNum, z.number({ message }).min(0, message).max(1e11, message).nullable());
const amount = (message: string) => z.preprocess(parseNum, z.number({ message }).min(0, message).max(1e11, message));
const positive = (message: string) => z.preprocess(parseNum, z.number({ message }).gt(0, message).max(1e11, message));
const pct = (message: string) => z.preprocess(parseNum, z.number({ message }).min(0, message).max(100, message).nullable());
const text = (max: number) => z.preprocess(emptyToNull, z.string().max(max).nullable());

const base = z.object({ clientId: uuid, year: yearSchema });

/** Kantavirhe ymmärrettäväksi: suljettu vuosi, puuttuva oikeus tai toisen asiakkaan rivi. */
function friendly(err: unknown): string | null {
  if (err instanceof AgriError) return err.message;
  const msg = err instanceof Error ? err.message : "";
  const closed = /Verovuosi (\d+) on suljettu/.exec(msg);
  if (closed) return `Verovuosi ${closed[1]} on suljettu. Pääkäyttäjä voi avata vuoden.`;
  if (/row-level security|toisen asiakkaan|toisen organisaation/.test(msg)) return "Sinulla ei ole oikeutta tähän asiakkaaseen.";
  return null;
}

/** Yhteinen runko: tarkistus, transaktio, virheet ja paluu sivulle. */
async function run<S extends z.ZodTypeAny>(
  formData: FormData,
  schema: S,
  section: string,
  fn: (tx: Sql, actor: { organizationId: string; userId: string }, input: z.infer<S>) => Promise<unknown>,
) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const year = yearSchema.parse(formData.get("year"));
  const back = `/asiakkaat/${clientId}/maatalous?vuosi=${year}`;
  const input = parseForm(schema, formData, back);
  try {
    await ctx.run((tx) => fn(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id }, input));
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`, "layout");
  redirect(`${back}&tallennettu=1#${section}`);
}

export async function saveAgriYearAction(formData: FormData) {
  const schema = base.extend({
    spouseWealthSharePct: pct("Tarkista puolison osuus nettovarallisuudesta."),
    spouseWorkSharePct: pct("Tarkista puolison osuus työskentelystä."),
    incomeSplitClaim: z.enum(["", "ten", "earned"]).default(""),
    lossToCapitalIncome: optionalAmount("Tarkista pääomatuloista vähennettävä tappio."),
    wagesSubjectToWithholding: optionalAmount("Tarkista maksetut palkat."),
    landValue: optionalAmount("Tarkista maatalousmaan arvo."),
    rentalDwellingsValue: optionalAmount("Tarkista vuokrattavien asuinrakennusten arvo."),
    sharesValue: optionalAmount("Tarkista osakkeiden ja osuuksien arvo."),
    otherAssetsValue: optionalAmount("Tarkista muiden varojen arvo."),
    liabilities: optionalAmount("Tarkista velat."),
    otherFarmAssets: optionalAmount("Tarkista maatilan muut varat."),
    priorNetWealth: z.preprocess(parseNum, z.number({ message: "Tarkista edellisen vuoden nettovarallisuus." }).min(-1e11).max(1e11).nullable()),
    confirmedLossesCarried: optionalAmount("Tarkista vahvistetut tappiot."),
  });
  await run(formData, schema, "vuoden-tiedot", (tx, actor, i) =>
    saveAgriYear(tx, actor, i.clientId, i.year, {
      spouseWealthSharePct: i.spouseWealthSharePct, spouseWorkSharePct: i.spouseWorkSharePct, incomeSplitClaim: i.incomeSplitClaim || null,
      lossToCapitalIncome: i.lossToCapitalIncome, wagesSubjectToWithholding: i.wagesSubjectToWithholding ?? 0, landValue: i.landValue,
      rentalDwellingsValue: i.rentalDwellingsValue, sharesValue: i.sharesValue, otherAssetsValue: i.otherAssetsValue, liabilities: i.liabilities,
      otherFarmAssets: i.otherFarmAssets, priorNetWealth: i.priorNetWealth, confirmedLossesCarried: i.confirmedLossesCarried ?? 0,
    }),
  );
}

export async function saveAgriDepreciationAction(formData: FormData) {
  // Kentät ovat muotoa pool_<ryhmä>. Tyhjä = 0.
  const chosen: Partial<Record<AgriPool, number>> = {};
  for (const pool of AGRI_POOLS) {
    const raw = formData.get(`pool_${pool}`);
    if (raw === null) continue;
    const n = parseNum(raw);
    if (n !== null && !Number.isFinite(n)) {
      const clientId = uuid.parse(formData.get("clientId"));
      fail(`/asiakkaat/${clientId}/maatalous?vuosi=${yearSchema.parse(formData.get("year"))}`, "Tarkista poistojen määrät.");
    }
    chosen[pool] = n ?? 0;
  }
  await run(formData, base, "poistot", (tx, actor, i) => saveAgriDepreciations(tx, actor, i.clientId, i.year, chosen));
}

export async function addFarmAction(formData: FormData) {
  const schema = base.extend({ name: z.string().min(1, "Anna maatilan nimi.").max(200), farmCode: text(40) });
  await run(formData, schema, "maatilat", (tx, actor, i) => addFarm(tx, actor, i.clientId, i.name, i.farmCode));
}

export async function deleteFarmAction(formData: FormData) {
  await run(formData, base.extend({ id: uuid }), "maatilat", (tx, actor, i) => deleteFarm(tx, actor, i.clientId, i.id));
}

export async function addReserveAction(formData: FormData) {
  const schema = base.extend({
    kind: z.enum(["equalization", "replacement"], { message: "Valitse varauksen laji." }),
    madeYear: z.coerce.number({ message: "Tarkista varauksen vuosi." }).int().min(2000).max(2100),
    amount: positive("Anna varauksen määrä."),
    farmId: z.preprocess(emptyToNull, uuid.nullable()),
    note: text(500),
  });
  await run(formData, schema, "varaukset", (tx, actor, i) =>
    addReserve(tx, actor, i.clientId, { kind: i.kind, madeYear: i.madeYear, amount: i.amount, farmId: i.farmId, note: i.note }),
  );
}

/**
 * Jälleenhankintavaraus laskurilla: enimmäismäärä lasketaan samalla säännöllä
 * kuin laskurissa, ja tyhjä määrä tarkoittaa enimmäismäärää. Laskun pohja
 * tallentuu varauksen lisätietoon, jotta varauksen peruste näkyy myöhemmin.
 */
export async function addReplacementReserveAction(formData: FormData) {
  const schema = base.extend({
    madeYear: z.coerce.number({ message: "Tarkista varauksen vuosi." }).int().min(2000).max(2100),
    event: z.enum(["sale", "damage"], { message: "Valitse, myytiinkö rakennus vai vahingoittuiko se." }),
    target: z.preprocess(emptyToNull, z.string({ message: "Kirjoita rakennuksen tai rakennelman nimi." }).min(1).max(120)),
    proceeds: positive("Anna luovutushinta tai korvaus."),
    undepreciated: amount("Tarkista poistamatta oleva hankintameno."),
    amount: optionalAmount("Tarkista varauksen määrä."),
    farmId: z.preprocess(emptyToNull, uuid.nullable()),
  });
  const back = `/asiakkaat/${uuid.parse(formData.get("clientId"))}/maatalous?vuosi=${yearSchema.parse(formData.get("year"))}`;
  const i = parseForm(schema, formData, back);
  const basis = { proceeds: i.proceeds, undepreciated: i.undepreciated };
  const reserve = i.amount ?? replacementReserveMax(basis);
  const error = validateReplacementReserve(reserve, basis);
  if (error) fail(back, error);
  const note = `${i.target}: ${REPLACEMENT_EVENT_LABEL[i.event].toLowerCase()} ${formatEur(i.proceeds)}, poistamatta ${formatEur(i.undepreciated)}`.slice(0, 500);
  await run(formData, base, "varaukset", (tx, actor, x) =>
    addReserve(tx, actor, x.clientId, { kind: "replacement", madeYear: i.madeYear, amount: reserve, farmId: i.farmId, note }),
  );
}

export async function deleteReserveAction(formData: FormData) {
  await run(formData, base.extend({ id: uuid }), "varaukset", (tx, actor, i) => deleteReserve(tx, actor, i.clientId, i.id));
}

export async function addReserveUseAction(formData: FormData) {
  const schema = base.extend({
    reserveId: uuid,
    useKind: z.enum(["asset", "income"], { message: "Valitse käyttötapa." }),
    assetId: z.preprocess(emptyToNull, uuid.nullable()),
    amount: positive("Anna käytetty määrä."),
  });
  await run(formData, schema, "varaukset", (tx, actor, i) =>
    addReserveUse(tx, actor, i.clientId, { reserveId: i.reserveId, year: i.year, useKind: i.useKind, assetId: i.assetId, amount: i.amount }),
  );
}

export async function deleteReserveUseAction(formData: FormData) {
  await run(formData, base.extend({ id: uuid }), "varaukset", (tx, actor, i) => deleteReserveUse(tx, actor, i.clientId, i.id));
}

export async function addDeferralAction(formData: FormData) {
  const schema = base.extend({
    originYear: z.coerce.number({ message: "Tarkista jaksotuksen vuosi." }).int().min(2000).max(2100),
    kind: z.enum(["livestock_sale", "livestock_purchase"], { message: "Valitse jaksotuksen laji." }),
    amount: positive("Anna jaksotettava määrä."),
    year1: optionalAmount("Tarkista ensimmäisen vuoden osa."),
    year2: optionalAmount("Tarkista toisen vuoden osa."),
    year3: optionalAmount("Tarkista kolmannen vuoden osa."),
    note: text(500),
  });
  await run(formData, schema, "jaksotukset", (tx, actor, i) => {
    // Tyhjät vuodet = tasaerät. Jos osa annetaan, kaikki kolme annetaan.
    const parts = [i.year1, i.year2, i.year3];
    const split = parts.every((p) => p === null) ? null : (parts.map((p) => p ?? 0) as [number, number, number]);
    return addDeferral(tx, actor, i.clientId, { year: i.originYear, kind: i.kind, amount: i.amount, split, note: i.note });
  });
}

export async function deleteDeferralAction(formData: FormData) {
  await run(formData, base.extend({ id: uuid }), "jaksotukset", (tx, actor, i) => deleteDeferral(tx, actor, i.clientId, i.id));
}

export async function addGrantAction(formData: FormData) {
  const schema = base.extend({ assetId: uuid, amount: positive("Anna tuen määrä."), note: text(500) });
  await run(formData, schema, "tuet", (tx, actor, i) => addGrant(tx, actor, i.clientId, { assetId: i.assetId, year: i.year, amount: i.amount, note: i.note }));
}

export async function deleteGrantAction(formData: FormData) {
  await run(formData, base.extend({ id: uuid }), "tuet", (tx, actor, i) => deleteGrant(tx, actor, i.clientId, i.id));
}

export async function setExtraAction(formData: FormData) {
  const schema = base.extend({ code: z.string().regex(/^\d{3}$/, "Valitse kenttä."), value: amount("Anna kentän arvo.") });
  await run(formData, schema, "muut-kentat", (tx, actor, i) => setExtra(tx, actor, i.clientId, i.year, i.code, i.value));
}

export async function deleteExtraAction(formData: FormData) {
  const schema = base.extend({ code: z.string().regex(/^\d{3}$/) });
  await run(formData, schema, "muut-kentat", (tx, actor, i) => deleteExtra(tx, actor, i.clientId, i.year, i.code));
}

/** Ajoneuvo- ja matkaselvitys (0018). Tyhjät kentät = ei tietoa; kokonaan tyhjä selvitys poistetaan. */
export async function saveVehicleReportAction(formData: FormData) {
  const km = (message: string) => z.preprocess(parseNum, z.number({ message }).int(message).min(0, message).max(99_999_999, message).nullable());
  const days = (message: string) => z.preprocess(parseNum, z.number({ message }).int(message).min(0, message).max(999, message).nullable());
  const basis = z.preprocess(emptyToNull, z.coerce.number().refine((v) => v === 1 || v === 2, "Valitse käyttötietojen peruste.").nullable());
  const schema = base.extend({
    vehicleBasis: basis,
    vehicleTotalKm: km("Tarkista ajoneuvon kokonaiskilometrit."),
    vehiclePrivateKm: km("Tarkista yksityisajot."),
    vehicleForestryKm: km("Tarkista metsätalouden ajot."),
    vehicleCosts: optionalAmount("Tarkista ajoneuvon kokonaismenot."),
    carBasis: basis,
    carTotalKm: km("Tarkista oman auton kokonaiskilometrit."),
    carAgriKm: km("Tarkista oman auton maatalouden ajot."),
    carDeducted: optionalAmount("Tarkista kirjanpidossa jo vähennetyt autokulut."),
    tripsFullDays: days("Tarkista yli 10 tunnin matkapäivät."),
    tripsFullDeducted: optionalAmount("Tarkista yli 10 tunnin matkojen vähennetyt kulut."),
    tripsPartDays: days("Tarkista yli 6 tunnin matkapäivät."),
    tripsPartDeducted: optionalAmount("Tarkista yli 6 tunnin matkojen vähennetyt kulut."),
    tripsAbroadDays: days("Tarkista ulkomaan matkapäivät."),
    tripsAbroadMax: optionalAmount("Tarkista ulkomaan päivärahojen yhteismäärä."),
    tripsAbroadDeducted: optionalAmount("Tarkista ulkomaan matkojen vähennetyt kulut."),
  });
  await run(formData, schema, "ajoneuvot", (tx, actor, i) => {
    const { clientId, year, ...report } = i;
    return saveVehicleReport(tx, actor, clientId, year, { ...report, vehicleBasis: report.vehicleBasis as 1 | 2 | null, carBasis: report.carBasis as 1 | 2 | null });
  });
}
