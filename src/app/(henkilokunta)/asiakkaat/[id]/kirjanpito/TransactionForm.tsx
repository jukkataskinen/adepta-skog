import { Button, Field, Input, Select } from "@/components/ui";
import { ASSET_CLASSES, CATEGORIES, CATEGORY_GROUPS } from "@/lib/tax/rules";
import type { AssetOption, PropertyOption, TransactionRow } from "@/lib/ledger/queries";

const fi = (v: string | null | undefined) => (v === null || v === undefined ? "" : String(Number(v)).replace(".", ","));

/**
 * Kirjauksen lomake. Sama lomake lisää ja muokkaa. Investoinnin kentät
 * koskevat vain luokkia Käyttöomaisuuden hankinta ja myynti.
 */
export function TransactionForm({
  action,
  clientId,
  transaction,
  assets,
  properties,
  defaultDate,
  submitLabel,
  compact,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  transaction?: TransactionRow;
  assets: AssetOption[];
  properties: PropertyOption[];
  defaultDate: string;
  submitLabel: string;
  compact?: boolean;
}) {
  const saleOptions = assets.filter((a) => !a.disposed_on || a.id === transaction?.asset_id);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      {transaction ? <input type="hidden" name="transactionId" value={transaction.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1.3fr)_minmax(0,2fr)_8rem]">
        <Field label="Päivä" htmlFor="bookedOn">
          <Input id="bookedOn" name="bookedOn" type="date" required defaultValue={transaction?.booked_on ?? defaultDate} />
        </Field>
        <Field label="Luokka" htmlFor="category">
          <Select id="category" name="category" required defaultValue={transaction?.category ?? ""}>
            <option value="" disabled>
              Valitse
            </option>
            {CATEGORY_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {CATEGORIES.filter((c) => c.group === g).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Selite" htmlFor="description">
          <Input id="description" name="description" defaultValue={transaction?.description ?? ""} autoComplete="off" />
        </Field>
        <Field label="Summa ilman alv (€)" htmlFor="amountNet">
          <Input id="amountNet" name="amountNet" inputMode="decimal" required defaultValue={fi(transaction?.amount_net)} className="text-right" />
        </Field>
      </div>
      <div className={`grid gap-4 ${properties.length ? "sm:grid-cols-[8rem_9rem_minmax(0,1fr)_minmax(0,1fr)]" : "sm:grid-cols-[8rem_9rem_minmax(0,1fr)]"}`}>
        <Field label="Alv %" htmlFor="vatRate" hint={compact ? undefined : "Tyhjä = luokan oletus."}>
          <Input id="vatRate" name="vatRate" inputMode="decimal" defaultValue={fi(transaction?.vat_rate)} placeholder="oletus" className="text-right" />
        </Field>
        <Field label="Ennakonpidätys (€)" htmlFor="withholding">
          <Input id="withholding" name="withholding" inputMode="decimal" defaultValue={fi(transaction?.withholding === "0.00" ? null : transaction?.withholding)} className="text-right" />
        </Field>
        <Field label="Viite tai tositenumero" htmlFor="reference">
          <Input id="reference" name="reference" defaultValue={transaction?.reference ?? ""} autoComplete="off" />
        </Field>
        {properties.length ? (
          <Field label="Metsätila" htmlFor="forestPropertyId">
            <Select id="forestPropertyId" name="forestPropertyId" defaultValue={transaction?.forest_property_id ?? ""}>
              <option value="">Ei valittu</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <details className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm" open={Boolean(transaction?.asset_id)}>
        <summary className="cursor-pointer font-semibold">Investointi (hankinta tai myynti)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {transaction?.asset_id && transaction.category === "asset_purchase" ? (
            <p className="text-ink/70 sm:col-span-2">Kirjaus on investoinnin {transaction.asset_description} hankinta. Summan ja päivän muutos päivittää investoinnin.</p>
          ) : (
            <>
              <Field label="Hyödykkeen laji (hankinta)" htmlFor="assetRatePct" hint="Poisto enintään lajin prosentti joka vuosi.">
                <Select id="assetRatePct" name="assetRatePct" defaultValue="">
                  <option value="">Ei valittu</option>
                  {ASSET_CLASSES.map((c) => (
                    <option key={c.pct} value={c.pct}>
                      {c.label} {c.pct} %
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Myytävä investointi (myynti)" htmlFor="saleAssetId">
                <Select id="saleAssetId" name="saleAssetId" defaultValue={transaction?.category === "asset_sale" ? (transaction.asset_id ?? "") : ""}>
                  <option value="">Ei valittu</option>
                  {saleOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.description} ({a.acquired_on.slice(0, 4)})
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
        </div>
      </details>
      <div>
        <Button>{submitLabel}</Button>
      </div>
    </form>
  );
}
