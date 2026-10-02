import { Button, Field, Input, Select } from "@/components/ui";
import type { ClientDetail } from "@/lib/clients/queries";

export function ClientForm({
  action,
  client,
  submitLabel,
  responsibleOptions,
}: {
  action: (formData: FormData) => Promise<void>;
  client?: ClientDetail;
  submitLabel: string;
  /** Vain pääkäyttäjälle uutta asiakasta luotaessa. Kirjanpitäjän asiakas on aina hänen omansa. */
  responsibleOptions?: { id: string; name: string }[];
}) {
  return (
    <form action={action} className="grid gap-5">
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Etunimi" htmlFor="firstName">
          <Input id="firstName" name="firstName" defaultValue={client?.first_name} autoComplete="off" />
        </Field>
        <Field label="Sukunimi tai yrityksen nimi" htmlFor="lastName">
          <Input id="lastName" name="lastName" defaultValue={client?.last_name} required autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Y-tunnus" htmlFor="businessId" hint="Jos asiakkaalla on yritys, tai kuolinpesän tunnus.">
          <Input id="businessId" name="businessId" defaultValue={client?.business_id ?? ""} />
        </Field>
        <Field label="Kotikunta" htmlFor="municipality">
          <Input id="municipality" name="municipality" defaultValue={client?.municipality ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Sähköposti" htmlFor="email">
          <Input id="email" name="email" type="email" defaultValue={client?.email ?? ""} />
        </Field>
        <Field label="Puhelin" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={client?.phone ?? ""} />
        </Field>
      </div>
      <Field label="Osoite" htmlFor="street">
        <Input id="street" name="street" defaultValue={client?.street ?? ""} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Postinumero" htmlFor="postalCode">
          <Input id="postalCode" name="postalCode" inputMode="numeric" defaultValue={client?.postal_code ?? ""} />
        </Field>
        <Field label="Postitoimipaikka" htmlFor="city">
          <Input id="city" name="city" defaultValue={client?.city ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Verotilin viite" htmlFor="taxAccountReference">
          <Input id="taxAccountReference" name="taxAccountReference" defaultValue={client?.tax_account_reference ?? ""} />
        </Field>
        {responsibleOptions ? (
          <Field label="Vastuukirjanpitäjä" htmlFor="responsibleUserId">
            <Select id="responsibleUserId" name="responsibleUserId" defaultValue={client?.responsible_user_id ?? ""}>
              <option value="">Ei valittu, vain pääkäyttäjät näkevät</option>
              {responsibleOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Toiminnot</legend>
        <input type="hidden" name="activitiesSent" value="1" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hasForestry" defaultChecked={client?.has_forestry ?? true} className="size-4" />
          Harjoittaa metsätaloutta (2C)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="hasAgriculture" defaultChecked={client?.has_agriculture ?? false} className="size-4" />
          Harjoittaa maataloutta (lomake 2)
        </label>
        <p className="text-xs text-ink/55">Maatalouden kirjanpito ja Lomake 2 -välilehti näkyvät vain, kun maatalous on valittu.</p>
      </fieldset>
      <div className="grid items-end gap-5 sm:grid-cols-2">
        <label className="flex items-center gap-2 pb-3 text-sm">
          <input type="checkbox" name="vatRegistered" defaultChecked={client?.vat_registered ?? false} className="size-4" />
          Arvonlisäverorekisterissä
        </label>
        <Field label="ALV-numero" htmlFor="vatNumber" hint="Esimerkiksi FI12345678. Jos ei ole, jätä tyhjäksi.">
          <Input id="vatNumber" name="vatNumber" defaultValue={client?.vat_number ?? ""} autoComplete="off" />
        </Field>
      </div>
      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
