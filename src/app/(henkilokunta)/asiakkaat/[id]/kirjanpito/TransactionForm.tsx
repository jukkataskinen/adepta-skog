import { Button, Field, Input, Select } from "@/components/ui";
import {
  ACTIVITY_LABEL,
  ACTIVITY_PARAM,
  agriAssetChoices,
  ASSET_CLASSES,
  isAssetPurchase,
  isAssetSale,
  isLivestockDeferral,
  viewCategories,
  withLivestockDeferral,
  type Activity,
} from "@/lib/tax/rules";
import type { AssetOption, PropertyOption, TransactionRow } from "@/lib/ledger/queries";
import { isPartialShare } from "@/lib/tax/share";
import { DeliveryWorkCalculator } from "./DeliveryWorkCalculator";

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
  farms = [],
  defaultDate,
  submitLabel,
  compact,
  vatRegistered,
  hasForestry = true,
  hasAgriculture = false,
  activity = null,
  prefill,
  expectedKey,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  transaction?: TransactionRow;
  assets: AssetOption[];
  properties: PropertyOption[];
  /** Asiakkaan maatilat (0018). Valinta näkyy, kun tiloja on useampi. */
  farms?: PropertyOption[];
  defaultDate: string;
  submitLabel: string;
  compact?: boolean;
  /** Oletusverokanta riippuu asiakkaan arvonlisäverorekisteröinnistä (rules.ts, defaultVatRate). */
  vatRegistered: boolean;
  /** Asiakkaan toiminnot (0015): maatalouden luokat näkyvät vain maatalousasiakkaalle. */
  hasForestry?: boolean;
  hasAgriculture?: boolean;
  /** Kirjanpidon näkymä: uusi kirjaus saa vain tämän toiminnon luokat. null = asiakkaan kaikki luokat. */
  activity?: Activity | null;
  /** Uuden kirjauksen esitäyttö (odotettu kirjaus). Ei tunnistetta: tallennus luo uuden kirjauksen. */
  prefill?: TransactionRow;
  /** Odotetun kirjauksen tunniste lokiin (0019). */
  expectedKey?: string;
}) {
  // Kenttien oletukset: muokattava kirjaus tai esitäyttö. Tunniste ja investointi vain muokattavalta.
  const values = transaction ?? prefill;
  const saleOptions = assets.filter((a) => (!a.disposed_on || a.id === transaction?.asset_id) && (!activity || a.activity === activity));
  const partial = values ? isPartialShare(values.business_share_pct) : false;
  const other = values && Number(values.other_share_pct) ? fi(values.other_share_pct) : "";
  const both = hasForestry && hasAgriculture;
  // Jaksotettavat kotieläinluokat valitaan Jaksota-valinnalla, joten niitä ei ole luettelossa.
  const categories = viewCategories({ hasForestry, hasAgriculture }, activity).filter((c) => !isLivestockDeferral(c.code));
  const deferred = values ? isLivestockDeferral(values.category) : false;
  const shownCategory = values ? withLivestockDeferral(values.category, false) : "";
  const forestryFields = activity ? activity === "forestry" : hasForestry || !hasAgriculture;
  const agriFields = activity ? activity === "agriculture" : hasAgriculture;
  const groups = [...new Set(categories.map((c) => c.group))];
  const year = Number((values?.booked_on ?? defaultDate).slice(0, 4));
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="clientId" value={clientId} />
      {transaction ? <input type="hidden" name="transactionId" value={transaction.id} /> : null}
      {!transaction && expectedKey ? <input type="hidden" name="odotettu" value={expectedKey} /> : null}
      {activity ? <input type="hidden" name="toiminta" value={ACTIVITY_PARAM[activity]} /> : null}
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1.3fr)_minmax(0,2fr)_8rem]">
        <Field label="Päivä" htmlFor="bookedOn">
          <Input id="bookedOn" name="bookedOn" type="date" required defaultValue={values?.booked_on ?? defaultDate} />
        </Field>
        <Field label="Luokka" htmlFor="category">
          <Select id="category" name="category" required defaultValue={shownCategory}>
            <option value="" disabled>
              Valitse
            </option>
            {groups.map((g) => (
              <optgroup key={g} label={both && !activity && !g.startsWith(ACTIVITY_LABEL.agriculture) ? `${ACTIVITY_LABEL.forestry}: ${g}` : g}>
                {categories.filter((c) => c.group === g).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Selite" htmlFor="description">
          <Input id="description" name="description" defaultValue={values?.description ?? ""} autoComplete="off" />
        </Field>
        <Field label="Summa (sis. alv) (€)" htmlFor="amountGross">
          <Input id="amountGross" name="amountGross" inputMode="decimal" required defaultValue={fi(values?.amount_gross)} className="text-right" />
        </Field>
      </div>
      <div className={`grid gap-4 ${properties.length ? "sm:grid-cols-[8rem_9rem_minmax(0,1fr)_minmax(0,1fr)]" : "sm:grid-cols-[8rem_9rem_minmax(0,1fr)]"}`}>
        <Field label="Alv %" htmlFor="vatRate" hint={compact ? undefined : vatRegistered ? "Tyhjä = luokan oletus." : "Tyhjä = 0 %, koska asiakas ei ole arvonlisäverorekisterissä."}>
          <Input id="vatRate" name="vatRate" inputMode="decimal" defaultValue={fi(values?.vat_rate)} placeholder="oletus" className="text-right" />
        </Field>
        <Field label="Ennakonpidätys (€)" htmlFor="withholding">
          <Input id="withholding" name="withholding" inputMode="decimal" defaultValue={fi(values?.withholding === "0.00" ? null : values?.withholding)} className="text-right" />
        </Field>
        <Field label="Viite tai tositenumero" htmlFor="reference">
          <Input id="reference" name="reference" defaultValue={values?.reference ?? ""} autoComplete="off" />
        </Field>
        {properties.length ? (
          <Field label="Metsätila" htmlFor="forestPropertyId">
            <Select id="forestPropertyId" name="forestPropertyId" defaultValue={values?.forest_property_id ?? ""}>
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
      {agriFields && farms.length > 1 ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Field label="Maatila" htmlFor="farmId" hint="Tasausvaraus lasketaan maatiloittain. Tyhjä = yhteinen kaikille tiloille.">
            <Select id="farmId" name="farmId" defaultValue={values?.farm_id ?? ""}>
              <option value="">Ei valittu</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      {agriFields ? (
        <label className="flex items-start gap-2 rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm">
          <input type="checkbox" name="livestockDeferral" value="1" defaultChecked={deferred} className="mt-0.5 size-4 accent-[var(--color-ink)]" />
          <span>
            <span className="font-semibold">Jaksota kolmelle vuodelle</span> (vain kotieläinten myynti ja hankinta). Summa jaetaan kolmeen yhtä suureen osaan: tälle
            vuodelle ja kahdelle seuraavalle. Jaksotus näkyy Lomake 2 -välilehdellä.
          </span>
        </label>
      ) : null}
      <details className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm" open={partial || Boolean(other)}>
        <summary className="cursor-pointer font-semibold">
          Lisätiedot: vain osa kuuluu {hasAgriculture ? "tälle toiminnolle" : "metsätaloudelle"}
          {partial ? ` (${fi(values?.business_share_pct)} %)` : ""}
        </summary>
        <div className={`mt-3 grid gap-4 ${both ? "sm:grid-cols-[10rem_10rem_minmax(0,1fr)]" : "sm:grid-cols-[10rem_minmax(0,1fr)]"}`}>
          <Field label={activity === "agriculture" ? "Maatalouden osuus %" : activity === "forestry" ? "Metsätalouden osuus %" : hasAgriculture ? "Oman toiminnon osuus %" : "Metsätalouden osuus %"} htmlFor="businessSharePct" hint="Tyhjä = 100 %.">
            <Input
              id="businessSharePct"
              name="businessSharePct"
              inputMode="decimal"
              defaultValue={partial ? fi(values?.business_share_pct) : ""}
              placeholder="100"
              className="text-right"
            />
          </Field>
          {both ? (
            <Field label="Toisen toiminnon osuus %" htmlFor="otherSharePct" hint="Vain menot. Tyhjä = 0 %.">
              <Input id="otherSharePct" name="otherSharePct" inputMode="decimal" defaultValue={other} placeholder="0" className="text-right" />
            </Field>
          ) : null}
          <p className="self-center text-ink/70">
            Kirjoita summa koko kuitin mukaan. Jos esimerkiksi tiemaksusta vain puolet kuuluu metsätaloudelle, kirjoita 50. Silloin tuloihin, menoihin ja
            vähennettävään arvonlisäveroon tulee vain puolet. Myynnin arvonlisävero on aina koko myynnistä.
            {both
              ? " Jos menosta osa kuuluu toiselle toiminnolle (esimerkiksi sähkölaskusta 20 % metsätaloudelle), kirjoita se toisen toiminnon osuuteen. Loppu on yksityistä."
              : ""}
          </p>
        </div>
      </details>
      {forestryFields ? <DeliveryWorkCalculator year={year} /> : null}
      <details className="rounded-xl border border-line bg-cloud/40 px-4 py-3 text-sm" open={Boolean(transaction?.asset_id)}>
        <summary className="cursor-pointer font-semibold">Investointi (hankinta tai myynti)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {transaction?.asset_id && isAssetPurchase(transaction.category) ? (
            <p className="text-ink/70 sm:col-span-2">Kirjaus on investoinnin {transaction.asset_description} hankinta. Summan ja päivän muutos päivittää investoinnin.</p>
          ) : (
            <>
              {forestryFields ? (
                <Field label="Hyödykkeen laji (metsätalouden hankinta)" htmlFor="assetRatePct" hint="Poisto enintään lajin prosentti joka vuosi.">
                  <Select id="assetRatePct" name="assetRatePct" defaultValue="">
                    <option value="">Ei valittu</option>
                    {ASSET_CLASSES.map((c) => (
                      <option key={c.pct} value={c.pct}>
                        {c.label} {c.pct} %
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              {agriFields ? (
                <Field label="Poistoryhmä (maatalouden investointi)" htmlFor="agriAssetChoice" hint="Lomakkeen 2 poistoryhmä. Uuden koneen korotettu poisto vain vuoteen 2025.">
                  <Select id="agriAssetChoice" name="agriAssetChoice" defaultValue="">
                    <option value="">Ei valittu</option>
                    {agriAssetChoices(year).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field label="Myytävä investointi (myynti)" htmlFor="saleAssetId">
                <Select id="saleAssetId" name="saleAssetId" defaultValue={transaction && isAssetSale(transaction.category) ? (transaction.asset_id ?? "") : ""}>
                  <option value="">Ei valittu</option>
                  {saleOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.description} ({a.acquired_on.slice(0, 4)}){both && !activity ? `, ${ACTIVITY_LABEL[a.activity].toLowerCase()}` : ""}
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
