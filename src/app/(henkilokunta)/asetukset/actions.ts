"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/current-user";
import { emptyToNull, fail, parseForm } from "@/lib/forms";
import { audit } from "@/lib/audit";
import { addMember, changeMemberRole, deactivateMember, inviteMember, MemberError, reactivateMember } from "@/lib/members";
import { emailSender } from "@/lib/email";
import { accountProvisioner } from "@/lib/accounts";
import type { StaffContext } from "@/lib/auth/current-user";

const BACK = "/asetukset";

const roleSchema = z.enum(["owner", "staff"]);

const APP_URL = () => process.env.APP_BASE_URL ?? "https://skog.adepta.fi";

async function sendInvite(ctx: StaffContext, userId: string): Promise<void> {
  await inviteMember(ctx.db, ctx.user.sub, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, userId }, {
    email: emailSender(),
    accounts: accountProvisioner(),
    appUrl: APP_URL(),
  });
}

export async function addMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(
    z.object({
      email: z.string().trim().email("Tarkista sähköpostiosoite.").max(200),
      fullName: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
      role: roleSchema,
    }),
    formData,
    BACK,
  );
  let userId: string;
  try {
    ({ userId } = await addMember(ctx.db, ctx.user.sub, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  try {
    await sendInvite(ctx, userId);
  } catch (err) {
    // Käyttäjä on jo lisätty, joten kutsun voi lähettää uudelleen listasta.
    if (err instanceof MemberError) fail(BACK, `Käyttäjä lisättiin, mutta kutsu ei lähtenyt. Lähetä kutsu uudelleen listasta. ${err.message}`);
    throw err;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ilmoitus=kayttaja`);
}

export async function inviteMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ userId: z.string().uuid() }), formData, BACK);
  try {
    await sendInvite(ctx, input.userId);
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ilmoitus=kutsu`);
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

export async function deactivateMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(
    z.object({ userId: z.string().uuid(), transferTo: z.preprocess(emptyToNull, z.string().uuid().nullable()) }),
    formData,
    BACK,
  );
  try {
    await ctx.run((tx) => deactivateMember(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
  } catch (err) {
    if (err instanceof MemberError) fail(BACK, err.message);
    throw err;
  }
  revalidatePath(BACK);
  redirect(`${BACK}?ilmoitus=poistettu`);
}

export async function reactivateMemberAction(formData: FormData) {
  const ctx = await requireRole("owner");
  const input = parseForm(z.object({ userId: z.string().uuid() }), formData, BACK);
  try {
    await ctx.run((tx) => reactivateMember(tx, { organizationId: ctx.org.organizationId, actorId: ctx.user.id, ...input }));
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
