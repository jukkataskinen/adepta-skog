import { Button, Field, Input } from "@/components/ui";

export interface PropertyValues {
  id: string;
  name: string;
  property_code: string | null;
  area_ha: string | null;
  acquisition_price: string | null;
  acquired_on: string | null;
  forest_land_share_pct: string | null;
  deduction_used_before: string;
}

// Lomakkeella luvut näytetään suomalaisittain pilkulla.
const fi = (v: string | null) => (v === null ? "" : String(Number(v)).replace(".", ","));

export function PropertyForm({
  action,
  clientId,
  property,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  property?: PropertyValues;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="clientId" value={clientId} />
      {property ? <input type="hidden" name="propertyId" value={property.id} /> : null}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Tilan nimi" htmlFor="name">
          <Input id="name" name="name" defaultValue={property?.name} required />
        </Field>
        <Field label="Kiinteistötunnus" htmlFor="propertyCode" hint="Esimerkiksi 172-401-3-45.">
          <Input id="propertyCode" name="propertyCode" defaultValue={property?.property_code ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Pinta-ala (ha)" htmlFor="areaHa">
          <Input id="areaHa" name="areaHa" inputMode="decimal" defaultValue={fi(property?.area_ha ?? null)} />
        </Field>
        <Field label="Hankintahinta (€)" htmlFor="acquisitionPrice">
          <Input id="acquisitionPrice" name="acquisitionPrice" inputMode="decimal" defaultValue={fi(property?.acquisition_price ?? null)} />
        </Field>
        <Field label="Hankintapäivä" htmlFor="acquiredOn">
          <Input id="acquiredOn" name="acquiredOn" type="date" defaultValue={property?.acquired_on ?? ""} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Metsämaan osuus hankintahinnasta (%)" htmlFor="forestLandSharePct" hint="Metsävähennyksen pohja lasketaan tästä osuudesta.">
          <Input id="forestLandSharePct" name="forestLandSharePct" inputMode="decimal" defaultValue={fi(property?.forest_land_share_pct ?? null)} />
        </Field>
        <Field label="Metsävähennystä käytetty ennen Skogia (€)" htmlFor="deductionUsedBefore" hint="Aiemmin muualla tehdyt vähennykset.">
          <Input id="deductionUsedBefore" name="deductionUsedBefore" inputMode="decimal" defaultValue={fi(property?.deduction_used_before ?? "0")} />
        </Field>
      </div>
      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
