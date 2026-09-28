"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireStaff } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { deletePriorAsset, parseAcquired, PriorAssetError, savePriorAsset } from "@/lib/assets/prior";

const uuid = z.string().uuid();
// Suomalainen desimaalipilkku ja välilyönnit tuhaterottimina hyväksytään.
const amount = (message: string) =>
  z.preprocess((v) => {
    const e = emptyToNull(v);
    return e === null ? undefined : Number(String(e).replace(/[\s€]/g, "").replace(",", "."));
  }, z.number({ message }).min(0, message).max(1e10, message));

const schema = z.object({
  clientId: uuid,
  assetId: z.preprocess(emptyToNull, uuid.nullable()),
  description: z.string().min(1, "Anna investoinnin kuvaus.").max(200),
  ratePct: z.coerce.number({ message: "Valitse investoinnin laji." }),
  balanceYear: z.coerce.number({ message: "Tarkista menojäännöksen vuosi." }).int("Tarkista menojäännöksen vuosi."),
  acquired: z.string().max(20).optional(),
  acquisitionCost: amount("Anna hankintahinta."),
  accumulatedDepreciation: amount("Anna kertynyt poisto. Jos poistoja ei ole tehty, kirjoita 0."),
  forestPropertyId: z.preprocess(emptyToNull, uuid.nullable()),
});

/** Kantavirhe suljetusta vuodesta tai oikeudesta käyttäjälle ymmärrettäväksi. */
function friendly(err: unknown): string | null {
  if (err instanceof PriorAssetError) return err.message;
  const msg = err instanceof Error ? err.message : "";
  if (/Verovuosi \d+ on suljettu/.test(msg)) return msg.replace(/^.*(Verovuosi \d+ on suljettu).*$/, "$1. Pääkäyttäjä voi avata vuoden.");
  if (/row-level security|toisen asiakkaan/.test(msg)) return "Sinulla ei ole oikeutta tähän asiakkaaseen.";
  return null;
}

export async function savePriorAssetAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const assetIdRaw = formData.get("assetId");
  const assetId = typeof assetIdRaw === "string" && assetIdRaw ? uuid.parse(assetIdRaw) : null;
  const back = `/asiakkaat/${clientId}/investoinnit/${assetId ?? "uusi"}`;
  const input = parseForm(schema, formData, back);
  const acquiredOn = parseAcquired(input.acquired);
  if (acquiredOn === undefined) fail(back, "Hankintavuosi on muotoa 2019 tai 1.5.2019.");
  let removed = false;
  try {
    await ctx.run(async (tx) => {
      const saved = await savePriorAsset(
        tx,
        { organizationId: ctx.org.organizationId, userId: ctx.user.id },
        clientId,
        {
          description: input.description, ratePct: input.ratePct, balanceYear: input.balanceYear, acquiredOn,
          acquisitionCost: input.acquisitionCost, accumulatedDepreciation: input.accumulatedDepreciation, forestPropertyId: input.forestPropertyId,
        },
        assetId,
      );
      removed = saved.removedDepreciations > 0;
    });
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`, "layout");
  redirect(`/asiakkaat/${clientId}/investoinnit?tallennettu=${removed ? "poistot" : "1"}`);
}

export async function deletePriorAssetAction(formData: FormData) {
  const ctx = await requireStaff();
  const clientId = uuid.parse(formData.get("clientId"));
  const assetId = uuid.parse(formData.get("assetId"));
  const back = `/asiakkaat/${clientId}/investoinnit/${assetId}`;
  try {
    await ctx.run((tx) => deletePriorAsset(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id }, clientId, assetId));
  } catch (err) {
    const f = friendly(err);
    if (f) fail(back, f);
    throw err;
  }
  revalidatePath(`/asiakkaat/${clientId}`, "layout");
  redirect(`/asiakkaat/${clientId}/investoinnit?poistettu=1`);
}
