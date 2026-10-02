"use client";

import { useState, type ReactNode } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { computeReplacementReserve, REPLACEMENT_EVENT_LABEL } from "@/lib/tax/replacement-reserve";

const eur = (n: number) => (n + 0).toLocaleString("fi-FI", { style: "currency", currency: "EUR" });
const parse = (v: string) => {
  const n = Number(v.replace(/[\s€]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Jälleenhankintavarauksen laskuri Lomake 2 -välilehdellä. Enimmäismäärä
 * lasketaan selaimessa samalla funktiolla kuin palvelimen tarkistus
 * (src/lib/tax/replacement-reserve.ts), jotta näkyvä raja ja tallennus täsmäävät.
 */
export function ReplacementReserveForm({
  action,
  hidden,
  year,
  farms,
}: {
  action: (formData: FormData) => Promise<void>;
  hidden: ReactNode;
  year: number;
  farms: { id: string; name: string }[];
}) {
  const [proceeds, setProceeds] = useState("");
  const [undepreciated, setUndepreciated] = useState("");
  const [madeYear, setMadeYear] = useState(String(year));
  const made = Number(madeYear) || year;
  const r = computeReplacementReserve({ proceeds: parse(proceeds), undepreciated: parse(undepreciated) }, made);
  const filled = parse(proceeds) > 0;

  return (
    <form action={action} className="mt-6 rounded-xl border border-line bg-cloud/40 p-4">
      {hidden}
      <p className="mb-1 font-semibold">Jälleenhankintavarauksen laskuri</p>
      <p className="mb-3 max-w-3xl text-sm text-ink/70">
        Kun rakennus tai rakennelma myydään tai se vahingoittuu, voit tehdä varauksen uutta rakennusta tai korjausta varten. Varaus on enintään se osa
        hinnasta tai korvauksesta, joka ylittää poistamatta olevan hankintamenon.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Rakennus tai rakennelma" htmlFor="rrTarget">
          <Input id="rrTarget" name="target" maxLength={120} className="w-56" />
        </Field>
        <Field label="Mitä tapahtui" htmlFor="rrEvent">
          <Select id="rrEvent" name="event" defaultValue="sale">
            {Object.entries(REPLACEMENT_EVENT_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vuosi" htmlFor="rrYear">
          <Input id="rrYear" name="madeYear" inputMode="numeric" value={madeYear} onChange={(e) => setMadeYear(e.currentTarget.value)} className="w-24" />
        </Field>
        <Field label="Hinta tai korvaus (€)" htmlFor="rrProceeds">
          <Input id="rrProceeds" name="proceeds" inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.currentTarget.value)} className="w-32 text-right" />
        </Field>
        <Field label="Poistamatta (€)" htmlFor="rrUndepreciated">
          <Input
            id="rrUndepreciated"
            name="undepreciated"
            inputMode="decimal"
            value={undepreciated}
            onChange={(e) => setUndepreciated(e.currentTarget.value)}
            className="w-32 text-right"
          />
        </Field>
        <Field label="Varaus (€)" htmlFor="rrAmount" hint="Tyhjä = enimmäismäärä">
          <Input id="rrAmount" name="amount" inputMode="decimal" placeholder={filled ? String(r.max).replace(".", ",") : ""} className="w-32 text-right" />
        </Field>
        {farms.length ? (
          <Field label="Maatila" htmlFor="rrFarm">
            <Select id="rrFarm" name="farmId" defaultValue={farms.length === 1 ? farms[0].id : ""}>
              <option value="">Ei valittu</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Button variant="secondary" disabled={!filled || r.max <= 0}>
          Tee jälleenhankintavaraus
        </Button>
      </div>
      {filled ? (
        <p className="mt-3 text-sm" aria-live="polite">
          {r.max > 0 ? (
            <>
              Varaus voi olla enintään <b>{eur(r.max)}</b>. Se on käytettävä uuteen rakennukseen tai korjaukseen tai tuloutettava viimeistään vuonna{" "}
              <b>{r.deadline}</b>.
            </>
          ) : (
            <span className="text-coral">Hinta tai korvaus ei ylitä poistamatta olevaa hankintamenoa. Varausta ei voi tehdä.</span>
          )}
        </p>
      ) : null}
    </form>
  );
}
