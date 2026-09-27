import { Badge, Button, Field, Input, Notice, PageHeader, Panel, SectionTitle, Select, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireRole, ROLE_LABEL, type OrgRole } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { emailMode } from "@/lib/email";
import { addMemberAction, changeMemberRoleAction, deactivateMemberAction, inviteMemberAction, reactivateMemberAction, updateContactAction } from "./actions";

export const metadata = { title: "Asetukset" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ virhe?: string; ilmoitus?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireRole("owner");
  const orgId = ctx.org.organizationId;
  const data = await ctx.run(async (tx) => ({
    org: (
      await tx.query<{
        name: string; business_id: string | null;
        contact_email: string | null; contact_phone: string | null; postal_street: string | null; postal_code: string | null; postal_city: string | null;
      }>(
        `select name, business_id,
                contact_email, contact_phone, postal_street, postal_code, postal_city from sk_organizations where id = $1`,
        [orgId],
      )
    )[0],
    members: await tx.query<{
      id: string; name: string; email: string; role: OrgRole; pending: boolean;
      invited_at: string | null; deactivated_at: string | null; client_count: number;
    }>(
      `select u.id, coalesce(u.full_name, u.email) as name, u.email, m.role, u.auth_sub like 'pending|%' as pending,
              m.invited_at, m.deactivated_at,
              (select count(*)::int from sk_clients c
                where c.organization_id = m.organization_id and c.responsible_user_id = u.id and c.archived_at is null) as client_count
         from sk_org_members m join sk_users u on u.id = m.user_id
        where m.organization_id = $1 order by m.deactivated_at is not null, m.role, name`,
      [orgId],
    ),
    log: await tx.query<{ id: string; action: string; entity: string; created_at: string; user_name: string | null }>(
      `select l.id::text, l.action, l.entity, l.created_at, coalesce(u.full_name, u.email) as user_name
         from sk_audit_log l left join sk_users u on u.id = l.user_id
        where l.organization_id = $1 order by l.created_at desc limit 20`,
      [orgId],
    ),
  }));
  const { org } = data;
  const active = data.members.filter((m) => !m.deactivated_at);
  const testMode = emailMode() === "mock";

  return (
    <>
      <PageHeader title="Asetukset" subtitle={[org.name, org.business_id].filter(Boolean).join(" · ")} />
      <FormError message={sp.virhe} />
      {sp.ilmoitus === "tallennettu" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Asetukset tallennettu." />
        </div>
      ) : null}
      {sp.ilmoitus === "kayttaja" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Käyttäjä lisätty ja kutsu lähetetty.">
            {testMode
              ? "Sähköposti on testitilassa, joten viestiä ei lähetetty. Kerro käyttäjälle osoite skog.adepta.fi. Hän kirjautuu samalla sähköpostiosoitteella, jolla hänet lisättiin."
              : "Käyttäjä saa sähköpostiin ohjeen kirjautumiseen. Hän kirjautuu samalla sähköpostiosoitteella, jolla hänet lisättiin."}
          </Notice>
        </div>
      ) : null}
      {sp.ilmoitus === "kutsu" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Kutsu lähetetty.">
            {testMode ? "Sähköposti on testitilassa, joten viestiä ei lähetetty." : null}
          </Notice>
        </div>
      ) : null}
      {sp.ilmoitus === "poistettu" ? (
        <div className="mb-5">
          <Notice tone="ok" title="Käyttäjä poistettu käytöstä.">
            Hän ei pääse enää kirjautumaan tähän toimistoon. Tiedot ja loki säilyvät, ja voit ottaa hänet takaisin käyttöön.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="lg:col-span-2">
          <SectionTitle>Toimiston yhteystiedot</SectionTitle>
          <Panel>
            <form action={updateContactAction} className="grid gap-4">
              <p className="text-sm text-ink/70">
                Tulevat veroraportin kansilehdelle.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sähköposti" htmlFor="contactEmail">
                  <Input id="contactEmail" name="contactEmail" type="email" defaultValue={org.contact_email ?? ""} />
                </Field>
                <Field label="Puhelin" htmlFor="contactPhone">
                  <Input id="contactPhone" name="contactPhone" type="tel" defaultValue={org.contact_phone ?? ""} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_8rem_minmax(0,1fr)]">
                <Field label="Postiosoite" htmlFor="postalStreet">
                  <Input id="postalStreet" name="postalStreet" defaultValue={org.postal_street ?? ""} />
                </Field>
                <Field label="Postinumero" htmlFor="postalCode">
                  <Input id="postalCode" name="postalCode" inputMode="numeric" defaultValue={org.postal_code ?? ""} />
                </Field>
                <Field label="Postitoimipaikka" htmlFor="postalCity">
                  <Input id="postalCity" name="postalCity" defaultValue={org.postal_city ?? ""} />
                </Field>
              </div>
              <div>
                <Button variant="secondary">Tallenna yhteystiedot</Button>
              </div>
            </form>
          </Panel>
        </section>

      </div>

      <section className="mt-10">
        <SectionTitle>Käyttäjät</SectionTitle>
        <Table>
          <thead>
            <tr>
              <Th>Nimi</Th>
              <Th>Sähköposti</Th>
              <Th>Rooli</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => {
              const others = active.filter((o) => o.id !== m.id);
              return (
                <tr key={m.id} className={m.deactivated_at ? "text-ink/55" : undefined}>
                  <Td className="font-semibold">
                    {m.name}
                    {m.deactivated_at ? (
                      <span className="mt-1 block">
                        <Badge>Poistettu käytöstä {formatDate(m.deactivated_at)}</Badge>
                      </span>
                    ) : m.pending ? (
                      <span className="block text-xs font-normal text-ink/55">
                        Ei vielä kirjautunut{m.invited_at ? `, kutsu lähetetty ${formatDate(m.invited_at)}` : ""}
                      </span>
                    ) : null}
                    {!m.deactivated_at && m.client_count > 0 ? (
                      <span className="block text-xs font-normal text-ink/55">Vastuuasiakkaita {m.client_count}</span>
                    ) : null}
                  </Td>
                  <Td>{m.email}</Td>
                  <Td>
                    {m.id === ctx.user.id || m.deactivated_at ? (
                      ROLE_LABEL[m.role]
                    ) : (
                      <form action={changeMemberRoleAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={m.id} />
                        <label htmlFor={`role-${m.id}`} className="sr-only">
                          Rooli
                        </label>
                        <select id={`role-${m.id}`} name="role" defaultValue={m.role} className="rounded-lg border border-line bg-paper px-2 py-1 text-sm">
                          {(["owner", "staff"] as const).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <button className="text-sm font-semibold text-sky">Tallenna</button>
                      </form>
                    )}
                  </Td>
                  <Td className="text-right">
                    {m.id === ctx.user.id ? null : m.deactivated_at ? (
                      <form action={reactivateMemberAction}>
                        <input type="hidden" name="userId" value={m.id} />
                        <button className="text-sm font-semibold text-sky">Ota käyttöön</button>
                      </form>
                    ) : (
                      <div className="flex flex-col items-end gap-2">
                        {m.pending ? (
                          <form action={inviteMemberAction}>
                            <input type="hidden" name="userId" value={m.id} />
                            <button className="text-sm font-semibold text-sky">{m.invited_at ? "Lähetä kutsu uudelleen" : "Lähetä kutsu"}</button>
                          </form>
                        ) : null}
                        <form action={deactivateMemberAction} className="flex flex-wrap items-center justify-end gap-2">
                          <input type="hidden" name="userId" value={m.id} />
                          {m.client_count > 0 ? (
                            <>
                              <label htmlFor={`transfer-${m.id}`} className="text-xs text-ink/65">
                                Asiakkaat siirtyvät
                              </label>
                              <select id={`transfer-${m.id}`} name="transferTo" required defaultValue="" className="rounded-lg border border-line bg-paper px-2 py-1 text-sm">
                                <option value="" disabled>
                                  Valitse kirjanpitäjä
                                </option>
                                {others.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.name}
                                  </option>
                                ))}
                              </select>
                            </>
                          ) : null}
                          <button className="text-sm font-semibold text-coral">Poista käytöstä</button>
                        </form>
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="mt-2 text-xs text-ink/55">
          Käytöstä poistettu ei pääse kirjautumaan. Hänen tietonsa ja tekemänsä muutokset säilyvät. Jos hän on asiakkaiden vastuukirjanpitäjä, valitse
          ensin, kenelle asiakkaat siirtyvät.
        </p>
        <Panel className="mt-4 max-w-3xl">
          <h3 className="font-semibold">Lisää käyttäjä</h3>
          <p className="mt-1 text-sm text-ink/65">
            Käyttäjä saa sähköpostiin kutsun ja ohjeen kirjautumiseen. Jos hänellä ei vielä ole tunnusta, kutsussa on linkki salasanan asettamiseen.
            Vain lisätyt käyttäjät pääsevät sisään.
          </p>
          <form action={addMemberAction} className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Sähköposti" htmlFor="member-email">
              <Input id="member-email" name="email" type="email" required autoComplete="off" />
            </Field>
            <Field label="Nimi" htmlFor="member-name">
              <Input id="member-name" name="fullName" autoComplete="off" />
            </Field>
            <Field label="Rooli" htmlFor="member-role">
              <Select id="member-role" name="role" defaultValue="staff">
                <option value="staff">{ROLE_LABEL.staff}</option>
                <option value="owner">{ROLE_LABEL.owner}</option>
              </Select>
            </Field>
            <Button>Lisää</Button>
          </form>
          <p className="mt-3 text-xs text-ink/55">
            Pääkäyttäjä: kaikki asiakkaat, asetukset, käyttäjät ja verovuoden sulkeminen. Kirjanpitäjä: omat asiakkaat, kirjaukset ja raportit.
          </p>
        </Panel>
      </section>

      <section className="mt-10">
        <SectionTitle>Viimeisimmät tapahtumat</SectionTitle>
        {data.log.length === 0 ? (
          <p className="text-sm text-ink/65">Ei tapahtumia.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Aika</Th>
                <Th>Käyttäjä</Th>
                <Th>Tapahtuma</Th>
              </tr>
            </thead>
            <tbody>
              {data.log.map((l) => (
                <tr key={l.id}>
                  <Td className="tabular whitespace-nowrap">{formatDateTime(l.created_at)}</Td>
                  <Td>{l.user_name ?? "Järjestelmä"}</Td>
                  <Td className="font-mono text-xs">{l.action}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
