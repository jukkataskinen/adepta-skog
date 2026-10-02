"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { agriAssetChoices, ASSET_CLASSES } from "@/lib/tax/rules";

export interface PriorAssetValues {
  id: string;
  description: string;
  /** Metsätalouden prosentti ("15") tai maatalouden poistoryhmä ("agri_machinery"). */
  kind: string;
  balanceYear: number;
  acquired: string;
  acquisitionCost: string;
  accumulatedDepreciation: string;
  forestPropertyId: string | null;
}

const parse = (v: string) => {
  const n = Number(v.replace(/[\s€]/g, "").replace(",", "."));
  return v.trim() && Number.isFinite(n) ? n : null;
};
const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });

/**
 * Aiemman investoinnin lomake. Menojäännös lasketaan hankintahinnasta ja
 * kertyneestä poistosta näytölle heti; palvelin laskee sen uudelleen samalla
 * säännöllä (src/lib/assets/prior.ts).
 */
export function PriorAssetForm({
  action,
  clientId,
  asset,
  defaultBalanceYear,
  properties,
  submitLabel,
  hasForestry = true,
  hasAgriculture = false,
}: {
  action: (formData: FormData) => Promise<void>;
  clientId: string;
  asset?: PriorAssetValues;
  defaultBalanceYear: number;
  properties: { id: string; name: string }[];
  submitLabel: string;
  hasForestry?: boolean;
  hasAgriculture?: boolean;
}) {
  const [cost, setCost] = useState(asset?.acquisitionCost ?? "");
  const [accumulated, setAccumulated] = useState(asset?.accumulatedDepreciation ?? "");
  const [year, setYear] = useState(String(asset?.balanceYear ?? defaultBalanceYear));
  const [rate, setRate] = useState(asset?.kind ?? (hasForestry || !hasAgriculture ? "15" : "agri_machinery"));
  const agri = rate.startsWith("agri_");

  const c = parse(cost);
  const a = parse(accumulated);
  const balance = c !== null && a !== null ? Math.round((c - a) * 100) / 100 : null;
  const y = /^\d{4}$/.test(year) ? Number(year) : null;
  const end = y ? `31.12.${y}` : "vuoden lopussa";

  return (
    <form action={action} className="grid gap-5">
      <input type="hidden" name="clientId" value={clientId} />
      {asset ? <input type="hidden" name="assetId" value={asset.id} /> : null}
      <div className="grid gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Field label="Kuvaus" htmlFor="description" hint={hasAgriculture ? "Esimerkiksi Metsäautotie, Navetta tai Koneet ja kalusto yhteensä." : "Esimerkiksi Metsäautotie tai Metsäperävaunu."}>
          <Input id="description" name="description" defaultValue={asset?.description} required maxLength={200} />
        </Field>
        <Field label="Laji" htmlFor="assetKind" hint="Laji ratkaisee, paljonko vuodessa saa poistaa.">
          <Select id="assetKind" name="assetKind" value={rate} onChange={(e) => setRate(e.target.value)}>
            {hasForestry || !hasAgriculture || !agri ? (
              <optgroup label="Metsätalous">
                {ASSET_CLASSES.map((k) => (
                  <option key={k.pct} value={k.pct}>
                    {k.label}, enintään {k.pct} %
                  </option>
                ))}
              </optgroup>
            ) : null}
            {hasAgriculture || agri ? (
              <optgroup label="Maatalous">
                {agriAssetChoices(y ? y + 1 : 2025).map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Menojäännöksen vuosi" htmlFor="balanceYear" hint="Vuosi, jonka lopun luvut annat. Poistot jatkuvat seuraavana vuonna.">
          <Input id="balanceYear" name="balanceYear" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} required />
        </Field>
        <Field label="Hankintavuosi tai -päivä" htmlFor="acquired" hint="Vapaaehtoinen, esimerkiksi 2019 tai 1.5.2019.">
          <Input id="acquired" name="acquired" defaultValue={asset?.acquired ?? ""} placeholder={y ? String(y) : ""} />
        </Field>
        <Field label="Metsätila" htmlFor="forestPropertyId" hint={agri ? "Maatalouden investointia ei liitetä metsätilaan." : "Tie ja oja kannattaa liittää tilaan."}>
          <Select id="forestPropertyId" name="forestPropertyId" defaultValue={asset?.forestPropertyId ?? ""} disabled={agri}>
            <option value="">Ei tilaa</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Hankintahinta (€)" htmlFor="acquisitionCost" hint="Alkuperäinen hankintameno ilman arvonlisäveroa, jos asiakas on alv-velvollinen.">
          <Input id="acquisitionCost" name="acquisitionCost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} required />
        </Field>
        <Field label={`Kertynyt poisto ${end} (€)`} htmlFor="accumulatedDepreciation" hint="Kaikki tähän mennessä tehdyt poistot. Jos poistoja ei ole tehty, kirjoita 0.">
          <Input
            id="accumulatedDepreciation"
            name="accumulatedDepreciation"
            inputMode="decimal"
            value={accumulated}
            onChange={(e) => setAccumulated(e.target.value)}
            required
          />
        </Field>
        <div>
          <p className="text-sm font-semibold">Menojäännös {end}</p>
          <p className={`tabular mt-2 text-xl font-bold ${balance !== null && balance < 0 ? "text-coral" : ""}`}>{balance === null ? "–" : eur(balance)}</p>
          <p className="mt-1 text-xs text-ink/55">
            {balance !== null && balance < 0 ? "Kertynyt poisto voi olla enintään hankintahinta." : "Hankintahinta miinus kertynyt poisto."}
          </p>
        </div>
      </div>
      <p className="text-sm text-ink/65">
        {agri
          ? `Menojäännös siirtyy maatalouden poistoryhmään vuoden ${y ? y + 1 : "seuraavan"} alkuun. Ryhmän poiston valitset Lomake 2 -välilehdellä.`
          : `Poisto lasketaan menojäännöksestä vuodesta ${y ? y + 1 : "seuraavasta"} alkaen, enintään ${rate} % vuodessa. Poiston määrän valitset verosuunnitelmassa.`}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button>{submitLabel}</Button>
        <Link href={`/asiakkaat/${clientId}/investoinnit`} className="text-sm font-semibold text-sky">
          Peruuta
        </Link>
      </div>
    </form>
  );
}
