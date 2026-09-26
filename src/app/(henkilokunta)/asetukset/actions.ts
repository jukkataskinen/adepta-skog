"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { addMember, changeMemberRole, MemberError, removeMember } from "@/lib/members";

const BACK = "/asetukset";

const roleSchema = z.enum(["owner", "staff"]);

export async function addMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(
    z.object({
      email: z.string().email("Tarkista sähköpostiosoite.").max(200),
      fullName: z.preprocess((v) => (v === "" ? null : v), z.string().max(200).nullable()),
      role: roleSchema,
    }),
    formData,
    BACK,
  );
  try {
    await addMember(ctx.db, ctx.user.sub, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input });
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ilmoitus=kayttaja`);
}

export async function changeMemberRoleAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ userId: z.string().uuid(), role: roleSchema }), formData, BACK);
  try {
    await ctx.run((tx) => changeMemberRole(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ userId: z.string().uuid() }), formData, BACK);
  try {
    await ctx.run((tx) => removeMember(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(BACK);
}

export async function updateContactAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const text = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
  const input = parseForm(
    z.object({
      contactEmail: z.preprocess(emptyToNull, z.string().trim().email("Tarkista sähköpostiosoite.").max(200).nullable()),
      contactPhone: text(40),
      postalStreet: text(200),
      postalCode: z.preprocess(emptyToNull, z.string().regex(/^\d{5}$/, "Postinumero on viisi numeroa.").nullable()),
      postalCity: text(100),
    }),
    formData,
    BACK,
  );
  await ctx.run(async (tx) => {
    await tx.query(
      "update sk_organizations set contact_email = $2, contact_phone = $3, postal_street = $4, postal_code = $5, postal_city = $6, updated_at = now() where id = $1",
      [ctx.org.organizationId, input.contactEmail, input.contactPhone, input.postalStreet, input.postalCode, input.postalCity],
    );
    await audit(tx, { organizationId: ctx.org.organizationId, userId: ctx.user.id, action: "organization.contact", entity: "sk_organizations", entityId: ctx.org.organizationId });
  });
  revalidatePath(BACK);
  redirect(`${BACK}?ilmoitus=tallennettu`);
}
