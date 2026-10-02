import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, EmptyState, Field, Input, LinkButton, Notice, PageHeader, Panel, SectionTitle, Select, Stat, Table, Td, Th } from "@/components/ui";
import { FormError } from "@/components/FormError";
import { requireStaff } from "@/lib/auth/current-user";
import { getClient } from "@/lib/clients/queries";
import { defaultYear, listYears } from "@/lib/ledger/queries";
import { formatEur } from "@/lib/format";
import { loadAgriDepreciation } from "@/lib/tax/agri-load";
import { getAgriYear, listDeferrals, listExtras, listFarms, listGrants, listReserves } from "@/lib/agriculture/year";
import { AGRI_EXTRA_FIELDS, extraField, FORM2_ORDER, form2Label } from "@/lib/filing/vsy002-fields";
import { loadForm2 } from "@/lib/tax/agri-form-load";
import { getVehicleReport } from "@/lib/agriculture/vehicle";
import { computeVehicleReport, EMPTY_VEHICLE_REPORT, hasVehicleReport, VEHICLE_CODES } from "@/lib/tax/vehicle";
import { travelRates } from "@/lib/tax/rules";
import { ClientTabs } from "../../ClientTabs";
import { YearNav } from "../../YearNav";
import { ReplacementReserveForm } from "./ReplacementReserveForm";
import {
  addDeferralAction,
  addFarmAction,
  addGrantAction,
  addReserveAction,
  addReplacementReserveAction,
  addReserveUseAction,
  deleteDeferralAction,
  deleteExtraAction,
  deleteFarmAction,
  deleteGrantAction,
  deleteReserveAction,
  deleteReserveUseAction,
  saveAgriDepreciationAction,
  saveAgriYearAction,
  saveVehicleReportAction,
  setExtraAction,
} from "./actions";

export const metadata = { title: "Lomake 2" };

/** Luku lomakkeen kenttään suomalaisittain; tyhjä, jos arvoa ei ole. */
const fi = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const KIND_LABEL = { equalization: "Tasausvaraus", replacement: "Jälleenhankintavaraus" } as const;
const DEFERRAL_LABEL = { livestock_sale: "Kotieläinten myynti", livestock_purchase: "Kotieläinten hankinta" } as const;

export default async function AgriculturePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ vuosi?: string; virhe?: string; tallennettu?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ctx = await requireStaff();
  const data = await ctx.run(async (tx) => {
    const client = await getClient(tx, ctx.org.organizationId, id);
    if (!client) return null;
    const years = await listYears(tx, id);
    const requested = Number(sp.vuosi);
    const year = years.some((y) => y.year === requested) ? requested : defaultYear(years);
    if (!year || !client.has_agriculture) return { client, years, year, details: null };
    const assets = await tx.query<{ id: string; description: string; disposed_on: string | null }>(
      "select id, description, disposed_on::text from sk_assets where client_id = $1 and activity = 'agriculture' order by description",
      [id],
    );
    return {
      client,
      years,
      year,
      details: {
        depreciation: await loadAgriDepreciation(tx, id, year),
        agriYear: await getAgriYear(tx, id, year),
        farms: await listFarms(tx, id),
        reserves: await listReserves(tx, id, year),
        deferrals: await listDeferrals(tx, id, year),
        grants: await listGrants(tx, id, year),
        extras: await listExtras(tx, id, year),
        vehicle: await getVehicleReport(tx, id, year),
        form2: await loadForm2(tx, id, year),
        assets,
      },
    };
  });
  if (!data) notFound();
  const { client: c, years, year, details: d } = data;
  const closed = years.find((y) => y.year === year)?.status === "closed";
  // Ajoneuvo- ja matkaselvitys: tallennetut tiedot ja niistä lasketut kentät (src/lib/tax/vehicle.ts).
  const vehicle = d?.vehicle ?? EMPTY_VEHICLE_REPORT;
  const vehicleResult = d && year && hasVehicleReport(d.vehicle) ? computeVehicleReport(d.vehicle, year) : null;
  const rates = travelRates(year ?? new Date().getFullYear());
  const vehicleCodes = new Set<string>(VEHICLE_CODES);
  const hidden = (
    <>
      <input type="hidden" name="clientId" value={id} />
      <input type="hidden" name="year" value={year ?? ""} />
    </>
  );

  return (
    <>
      <PageHeader title={`${c.first_name} ${c.last_name}`.trim()} subtitle="Lomake 2 (maatalouden veroilmoitus)" back={{ href: "/asiakkaat", label: "Asiakkaat" }} />
      <ClientTabs clientId={id} active="maatalous" year={year} agriculture={c.has_agriculture} forestry={c.has_forestry} />
      <FormError message={sp.virhe} />
      {!c.has_agriculture ? (
        <EmptyState title="Asiakas ei harjoita maataloutta" action={<LinkButton href={`/asiakkaat/${id}/muokkaa`}>Muokkaa asiakasta</LinkButton>}>
          Jos asiakkaalla on maatila, rastita asiakkaan tiedoissa Harjoittaa maataloutta. Sen jälkeen maatalouden luokat ja tämä sivu ovat käytössä.
        </EmptyState>
      ) : year === null || !d ? (
        <EmptyState title="Ei verovuosia">Avaa verovuosi asiakkaan tiedoissa.</EmptyState>
      ) : (
        <>
          <YearNav years={years} year={year} basePath={`/asiakkaat/${id}/maatalous`} />
          {sp.tallennettu ? (
            <div className="mb-5">
              <Notice tone="ok" title="Tallennettu." />
            </div>
          ) : null}
          {closed ? (
            <div className="mb-5">
              <Notice tone="warn" title={`Verovuosi ${year} on suljettu.`}>
                Tietoja ei voi muuttaa. Pääkäyttäjä voi avata vuoden asiakkaan tiedoissa.
              </Notice>
            </div>
          ) : null}
          <p className="mb-6 max-w-3xl text-sm text-ink/70">
            Tällä sivulla ovat maatalouden veroilmoituksen (lomake 2) tiedot, joita ei saa kirjauksista: poistot, varaukset, kotieläinten jaksotukset,
            varallisuus ja puolison osuudet. Tulot ja menot tulevat kirjanpidosta.
          </p>

          {d.form2 ? (
            <section id="lomake2" className="mb-10 scroll-mt-6">
              <SectionTitle>Maatalouden tulos (lomake 2)</SectionTitle>
              <div className="mb-4 grid gap-4 sm:grid-cols-3">
                <Stat label="Tulot yhteensä" value={formatEur(d.form2.income)} />
                <Stat label="Menot ja poistot yhteensä" value={formatEur(d.form2.expense)} />
                <Stat label={d.form2.result < 0 ? "Maatalouden tappio" : "Maatalouden tulos"} value={formatEur(Math.abs(d.form2.result))} tone={d.form2.result < 0 ? "alert" : undefined} />
              </div>
              {d.form2.errors.length ? (
                <div className="mb-3">
                  <Notice tone="alert" title="Korjaa ennen veroilmoitusta">
                    {d.form2.errors.join(" ")}
                  </Notice>
                </div>
              ) : null}
              {d.form2.warnings.length ? (
                <div className="mb-3">
                  <Notice tone="warn" title="Tarkista">
                    {d.form2.warnings.join(" ")}
                  </Notice>
                </div>
              ) : null}
              <details className="rounded-xl border border-line bg-paper px-4 py-3 text-sm">
                <summary className="cursor-pointer font-semibold">Lomakkeen 2 kentät</summary>
                <Table className="mt-3">
                  <tbody>
                    {FORM2_ORDER.filter((code) => d.form2!.fields[code] !== undefined).map((code) => (
                      <tr key={code}>
                        <Td className="w-16 tabular text-ink/55">{code}</Td>
                        <Td>{form2Label(code, year)}</Td>
                        <Td numeric>
                          {["413", "414", "415", "416"].includes(code)
                            ? `${d.form2!.fields[code].toLocaleString("fi-FI")} %`
                            : ["418", "281", "534", "516", "287", "288", "401", "406", "411"].includes(code)
                              ? d.form2!.fields[code].toLocaleString("fi-FI")
                              : formatEur(d.form2!.fields[code])}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </details>
              <p className="mt-2 text-xs text-ink/55">
                Tulot ja menot tulevat kirjanpidosta maatalouden osuuksina. Poistot tulevat alla tallennetuista ryhmäpoistoista.
              </p>
            </section>
          ) : null}

          <section id="poistot" className="mb-10 scroll-mt-6">
            <SectionTitle>Poistot ryhmittäin</SectionTitle>
            {d.depreciation.pools.length === 0 ? (
              <EmptyState
                title="Ei maatalouden investointeja"
                action={<LinkButton href={`/asiakkaat/${id}/investoinnit/uusi`} variant="secondary">Lisää aiempi investointi</LinkButton>}
              >
                Kirjaa uusi investointi kirjanpitoon luokalla Maatalouden investointi. Ennen Skogia hankittujen koneiden ja rakennusten menojäännökset lisäät
                Investoinnit-sivulla.
              </EmptyState>
            ) : (
              <form action={saveAgriDepreciationAction}>
                {hidden}
                <Table>
                  <thead>
                    <tr>
                      <Th>Ryhmä</Th>
                      <Th numeric>Alussa</Th>
                      <Th numeric>Hankinnat</Th>
                      <Th numeric>Myynnit, tuet ja varaus</Th>
                      <Th numeric>Poistopohja</Th>
                      <Th numeric>Enintään</Th>
                      <Th numeric>Poisto</Th>
                      <Th numeric>Lopussa</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.depreciation.pools.map((p) => (
                      <tr key={p.pool}>
                        <Td>
                          <p className="font-semibold">{p.label}</p>
                          <p className="text-xs text-ink/55">
                            enintään {p.pct} %{p.smallBalance ? ", pieni menojäännös: koko pohja kerralla" : ""}
                            {p.excess ? `. Myyntihinnoista ${formatEur(p.excess)} ylittää menojäännöksen ja on tuloa.` : ""}
                          </p>
                        </Td>
                        <Td numeric>{formatEur(p.start)}</Td>
                        <Td numeric>{formatEur(p.additions)}</Td>
                        <Td numeric>{formatEur(-(p.sales + p.grants + p.equalization))}</Td>
                        <Td numeric>{formatEur(p.base)}</Td>
                        <Td numeric>{formatEur(p.max)}</Td>
                        <Td numeric>
                          {p.base > 0 ? (
                            <Input
                              name={`pool_${p.pool}`}
                              aria-label={`Poisto, ${p.label}`}
                              inputMode="decimal"
                              defaultValue={fi(p.recorded ?? undefined)}
                              placeholder={fi(p.max)}
                              className="w-32 text-right"
                              disabled={closed}
                            />
                          ) : (
                            "–"
                          )}
                        </Td>
                        <Td numeric>{formatEur(p.end)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {!closed ? <Button>Tallenna poistot</Button> : null}
                  <p className="text-sm text-ink/65">
                    {d.depreciation.pools.some((p) => p.recorded !== null)
                      ? `Tallennetut poistot yhteensä ${formatEur(d.depreciation.total)}.`
                      : "Poistoja ei ole vielä tallennettu tälle vuodelle. Ehdotus kentässä on enimmäismäärä; tyhjä kenttä tallentuu nollana."}
                  </p>
                </div>
              </form>
            )}
          </section>

          <section id="vuoden-tiedot" className="mb-10 scroll-mt-6">
            <SectionTitle>Vuoden tiedot</SectionTitle>
            <Panel>
              <form action={saveAgriYearAction} className="grid gap-5">
                {hidden}
                <fieldset disabled={closed} className="grid gap-5">
                  <p className="text-sm font-semibold">Varallisuuslaskelma (kaikki maatilat yhteensä)</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Maatalousmaa ja rakennuspaikat (432)" htmlFor="landValue" hint="Verohallinto laskee kiinteistöverotuksesta. Voit jättää tyhjäksi.">
                      <Input id="landValue" name="landValue" inputMode="decimal" defaultValue={fi(d.agriYear.landValue)} className="text-right" />
                    </Field>
                    <Field label="Vuokrattavat asuinrakennukset (431)" htmlFor="rentalDwellingsValue">
                      <Input id="rentalDwellingsValue" name="rentalDwellingsValue" inputMode="decimal" defaultValue={fi(d.agriYear.rentalDwellingsValue)} className="text-right" />
                    </Field>
                    <Field label="Osakkeet ja osuudet (468)" htmlFor="sharesValue" hint="Esimerkiksi meijeri- ja teurastamo-osuudet.">
                      <Input id="sharesValue" name="sharesValue" inputMode="decimal" defaultValue={fi(d.agriYear.sharesValue)} className="text-right" />
                    </Field>
                    <Field label="Muut maatalouden varat (469)" htmlFor="otherAssetsValue" hint="Lisäys siltojen ja salaojien menojäännökseen, esimerkiksi tuotanto-oikeudet.">
                      <Input id="otherAssetsValue" name="otherAssetsValue" inputMode="decimal" defaultValue={fi(d.agriYear.otherAssetsValue)} className="text-right" />
                    </Field>
                    <Field label="Maatalouden velat (732)" htmlFor="liabilities" hint="Vain maatalouden velat, ei yksityistalouden.">
                      <Input id="liabilities" name="liabilities" inputMode="decimal" defaultValue={fi(d.agriYear.liabilities)} className="text-right" />
                    </Field>
                    <Field label="Maatilan muut varat (470)" htmlFor="otherFarmAssets" hint="Kiven-, soran- ja turpeenottopaikat.">
                      <Input id="otherFarmAssets" name="otherFarmAssets" inputMode="decimal" defaultValue={fi(d.agriYear.otherFarmAssets)} className="text-right" />
                    </Field>
                  </div>
                  <p className="text-sm font-semibold">Yritystulon jako ja tappio</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Puolison osuus nettovarallisuudesta % (414)" htmlFor="spouseWealthSharePct" hint="Vain jos puolisot harjoittavat maataloutta yhdessä.">
                      <Input id="spouseWealthSharePct" name="spouseWealthSharePct" inputMode="decimal" defaultValue={fi(d.agriYear.spouseWealthSharePct)} className="text-right" />
                    </Field>
                    <Field label="Puolison osuus työskentelystä % (416)" htmlFor="spouseWorkSharePct" hint="Yrittäjän osuus on loppu.">
                      <Input id="spouseWorkSharePct" name="spouseWorkSharePct" inputMode="decimal" defaultValue={fi(d.agriYear.spouseWorkSharePct)} className="text-right" />
                    </Field>
                    <Field label="Vaatimus yritystulon jaosta (418)" htmlFor="incomeSplitClaim">
                      <Select id="incomeSplitClaim" name="incomeSplitClaim" defaultValue={d.agriYear.incomeSplitClaim ?? ""}>
                        <option value="">Ei vaatimusta (pääomatuloa 20 %)</option>
                        <option value="ten">Pääomatuloa enintään 10 %</option>
                        <option value="earned">Kokonaan ansiotuloa</option>
                      </Select>
                    </Field>
                    <Field label="Tappio pääomatuloista (420)" htmlFor="lossToCapitalIncome" hint="Vain jos maatalous on tappiollinen ja asiakas vaatii vähennystä.">
                      <Input id="lossToCapitalIncome" name="lossToCapitalIncome" inputMode="decimal" defaultValue={fi(d.agriYear.lossToCapitalIncome)} className="text-right" />
                    </Field>
                    <Field label="Maksetut ennakonpidätyksen alaiset palkat (437)" htmlFor="wagesSubjectToWithholding" hint="Ilman sivukuluja.">
                      <Input id="wagesSubjectToWithholding" name="wagesSubjectToWithholding" inputMode="decimal" defaultValue={fi(d.agriYear.wagesSubjectToWithholding || null)} className="text-right" />
                    </Field>
                  </div>
                  <p className="text-sm font-semibold">Seurantaan (ei veroilmoitukselle)</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Edellisen vuoden nettovarallisuus" htmlFor="priorNetWealth" hint="Pääomatulo-osuuden pohja.">
                      <Input id="priorNetWealth" name="priorNetWealth" inputMode="decimal" defaultValue={fi(d.agriYear.priorNetWealth)} className="text-right" />
                    </Field>
                    <Field label="Vahvistetut tappiot aiemmilta vuosilta" htmlFor="confirmedLossesCarried">
                      <Input id="confirmedLossesCarried" name="confirmedLossesCarried" inputMode="decimal" defaultValue={fi(d.agriYear.confirmedLossesCarried || null)} className="text-right" />
                    </Field>
                  </div>
                </fieldset>
                {!closed ? (
                  <div>
                    <Button>Tallenna vuoden tiedot</Button>
                  </div>
                ) : null}
              </form>
            </Panel>
          </section>

          <section id="varaukset" className="mb-10 scroll-mt-6">
            <SectionTitle>Tasausvaraus ja jälleenhankintavaraus</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">
              Kirjoita varaukset käsin. Purkamaton määrä näkyy veroilmoituksella vuosittain. Käyttö investointiin pienentää poistopohjaa, ja tuloutus on tuloa.
            </p>
            {d.reserves.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Varaus</Th>
                    <Th numeric>Tehty</Th>
                    <Th>Käyttö</Th>
                    <Th numeric>Purkamatta {year} lopussa</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {d.reserves.map((r) => (
                    <tr key={r.id} className="align-top">
                      <Td>
                        <p className="font-semibold">
                          {KIND_LABEL[r.kind]} {r.made_year}
                        </p>
                        <p className="text-xs text-ink/55">{[r.farm_name, r.note].filter(Boolean).join(" · ")}</p>
                      </Td>
                      <Td numeric>{formatEur(r.amount)}</Td>
                      <Td>
                        {r.uses.map((u) => (
                          <form key={u.id} action={deleteReserveUseAction} className="flex items-center gap-2 text-sm">
                            {hidden}
                            <input type="hidden" name="id" value={u.id} />
                            <span>
                              {u.tax_year}: {u.use_kind === "asset" ? `investointiin ${u.asset_description ?? ""}` : "tuloutettu"} {formatEur(u.amount)}
                            </span>
                            {!closed && u.tax_year === year ? <button className="text-xs font-semibold text-coral">Poista</button> : null}
                          </form>
                        ))}
                        {!closed && r.remaining > 0 ? (
                          <form action={addReserveUseAction} className="mt-2 flex flex-wrap items-end gap-2">
                            {hidden}
                            <input type="hidden" name="reserveId" value={r.id} />
                            <Select name="useKind" aria-label="Käyttötapa" defaultValue="asset" className="w-40">
                              <option value="asset">Investointiin</option>
                              <option value="income">Tuloutus</option>
                            </Select>
                            <Select name="assetId" aria-label="Investointi" defaultValue="" className="w-48">
                              <option value="">Investointi (vain käyttöön)</option>
                              {d.assets.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.description}
                                </option>
                              ))}
                            </Select>
                            <Input name="amount" aria-label="Määrä" inputMode="decimal" placeholder="Määrä €" className="w-28 text-right" />
                            <Button variant="secondary">Lisää {year}</Button>
                          </form>
                        ) : null}
                      </Td>
                      <Td numeric className="font-semibold">
                        {formatEur(r.remaining)}
                      </Td>
                      <Td className="text-right">
                        {!closed && r.made_year === year ? (
                          <form action={deleteReserveAction}>
                            {hidden}
                            <input type="hidden" name="id" value={r.id} />
                            <button className="text-sm font-semibold text-coral">Poista</button>
                          </form>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-ink/65">Ei varauksia.</p>
            )}
            {!closed ? (
              <form action={addReserveAction} className="mt-4 flex flex-wrap items-end gap-3">
                {hidden}
                <Field label="Laji" htmlFor="reserveKind">
                  <Select id="reserveKind" name="kind" defaultValue="equalization">
                    <option value="equalization">Tasausvaraus</option>
                    <option value="replacement">Jälleenhankintavaraus</option>
                  </Select>
                </Field>
                <Field label="Vuosi" htmlFor="madeYear">
                  <Input id="madeYear" name="madeYear" inputMode="numeric" defaultValue={year} className="w-24" />
                </Field>
                <Field label="Määrä (€)" htmlFor="reserveAmount">
                  <Input id="reserveAmount" name="amount" inputMode="decimal" className="w-32 text-right" />
                </Field>
                {d.farms.length ? (
                  <Field label="Maatila" htmlFor="reserveFarm">
                    <Select id="reserveFarm" name="farmId" defaultValue="">
                      <option value="">Ei valittu</option>
                      {d.farms.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Lisätieto" htmlFor="reserveNote">
                  <Input id="reserveNote" name="note" maxLength={500} />
                </Field>
                <Button variant="secondary">Lisää varaus</Button>
              </form>
            ) : null}
            {!closed ? (
              <ReplacementReserveForm action={addReplacementReserveAction} hidden={hidden} year={year} farms={d.farms.map((f) => ({ id: f.id, name: f.name }))} />
            ) : null}
          </section>

          <section id="jaksotukset" className="mb-10 scroll-mt-6">
            <SectionTitle>Kotieläinten jaksotukset</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">
              Jaksotus syntyy kirjanpidossa, kun kotieläinten myynnille tai hankinnalle valitaan Jaksota (luokat 22 ja 50). Summa jaetaan kolmeen yhtä
              suureen osaan: kirjauksen vuodelle ja kahdelle seuraavalle. Kirjoita tähän vain aiempien vuosien jaksotukset, joita ei ole kirjattu Skogiin.
            </p>
            {d.deferrals.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Jaksotus</Th>
                    <Th numeric>Määrä</Th>
                    <Th numeric>1. vuosi</Th>
                    <Th numeric>2. vuosi</Th>
                    <Th numeric>3. vuosi</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {d.deferrals.map((x) => (
                    <tr key={x.id}>
                      <Td>
                        {DEFERRAL_LABEL[x.kind]} {x.tax_year}
                        {x.transaction_id ? (
                          <Link href={`/asiakkaat/${id}/kirjanpito/${x.transaction_id}`} className="block text-xs font-semibold text-sky hover:underline">
                            Kirjauksesta: {x.transaction_label}
                          </Link>
                        ) : null}
                        {x.note ? <span className="block text-xs text-ink/55">{x.note}</span> : null}
                      </Td>
                      <Td numeric>{formatEur(x.amount)}</Td>
                      <Td numeric>{formatEur(x.year1)}</Td>
                      <Td numeric>{formatEur(x.year2)}</Td>
                      <Td numeric>{formatEur(x.year3)}</Td>
                      <Td className="text-right">
                        {!closed && !x.transaction_id ? (
                          <form action={deleteDeferralAction}>
                            {hidden}
                            <input type="hidden" name="id" value={x.id} />
                            <button className="text-sm font-semibold text-coral">Poista</button>
                          </form>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-ink/65">Ei aiempien vuosien jaksotuksia.</p>
            )}
            {!closed ? (
              <form action={addDeferralAction} className="mt-4 flex flex-wrap items-end gap-3">
                {hidden}
                <Field label="Laji" htmlFor="deferralKind">
                  <Select id="deferralKind" name="kind" defaultValue="livestock_sale">
                    <option value="livestock_sale">Kotieläinten myynti</option>
                    <option value="livestock_purchase">Kotieläinten hankinta</option>
                  </Select>
                </Field>
                <Field label="Jaksotuksen vuosi" htmlFor="originYear">
                  <Input id="originYear" name="originYear" inputMode="numeric" defaultValue={year - 1} className="w-24" />
                </Field>
                <Field label="Määrä (€)" htmlFor="deferralAmount">
                  <Input id="deferralAmount" name="amount" inputMode="decimal" className="w-32 text-right" />
                </Field>
                <Field label="1. vuosi" htmlFor="year1" hint="Tyhjä = tasan, kuten laki edellyttää">
                  <Input id="year1" name="year1" inputMode="decimal" className="w-28 text-right" />
                </Field>
                <Field label="2. vuosi" htmlFor="year2">
                  <Input id="year2" name="year2" inputMode="decimal" className="w-28 text-right" />
                </Field>
                <Field label="3. vuosi" htmlFor="year3">
                  <Input id="year3" name="year3" inputMode="decimal" className="w-28 text-right" />
                </Field>
                <Field label="Lisätieto" htmlFor="deferralNote">
                  <Input id="deferralNote" name="note" maxLength={500} />
                </Field>
                <Button variant="secondary">Lisää jaksotus</Button>
              </form>
            ) : null}
          </section>

          <section id="tuet" className="mb-10 scroll-mt-6">
            <SectionTitle>Investointituet {year}</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">
              Investointituki ei ole tuloa. Se vähennetään investoinnin poistopohjasta sinä vuonna, kun tuki on saatu.
            </p>
            {d.grants.length ? (
              <Table>
                <tbody>
                  {d.grants.map((g) => (
                    <tr key={g.id}>
                      <Td>
                        {g.asset_description}
                        {g.note ? <span className="block text-xs text-ink/55">{g.note}</span> : null}
                      </Td>
                      <Td numeric>{formatEur(g.amount)}</Td>
                      <Td className="text-right">
                        {!closed ? (
                          <form action={deleteGrantAction}>
                            {hidden}
                            <input type="hidden" name="id" value={g.id} />
                            <button className="text-sm font-semibold text-coral">Poista</button>
                          </form>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-ink/65">Ei investointitukia tälle vuodelle.</p>
            )}
            {!closed && d.assets.length ? (
              <form action={addGrantAction} className="mt-4 flex flex-wrap items-end gap-3">
                {hidden}
                <Field label="Investointi" htmlFor="grantAsset">
                  <Select id="grantAsset" name="assetId" defaultValue="">
                    <option value="" disabled>
                      Valitse
                    </option>
                    {d.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.description}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tuki (€)" htmlFor="grantAmount">
                  <Input id="grantAmount" name="amount" inputMode="decimal" className="w-32 text-right" />
                </Field>
                <Field label="Lisätieto" htmlFor="grantNote">
                  <Input id="grantNote" name="note" maxLength={500} />
                </Field>
                <Button variant="secondary">Lisää tuki</Button>
              </form>
            ) : null}
          </section>

          <section id="ajoneuvot" className="mb-10 scroll-mt-6">
            <SectionTitle>Ajoneuvot ja matkat</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">
              Täytä vain ne osat, joita asiakkaalla on. Skog laskee lomakkeen kentät: yksityis- ja metsätalouden ajot tuloutetaan maataloudessa, ja
              metsätalouden ajot vähennetään metsätaloudessa (2C, kohta 630). Oman auton ja matkojen lisävähennys tulee muihin vähennyksiin. Vuoden {year}{" "}
              kilometrikorvaus on {rates.kmRate.toLocaleString("fi-FI")} €/km, kokopäiväraha {rates.fullDay} € ja osapäiväraha {rates.partDay} €.
            </p>
            {d.extras.some((x) => vehicleCodes.has(x.code)) ? (
              <div className="mb-4">
                <Notice tone="warn" title="Ajoneuvo- tai matkakenttiä on annettu käsin.">
                  {hasVehicleReport(d.vehicle)
                    ? "Selvitys korvaa ne. Poista käsin annetut kentät alempaa."
                    : "Ne ovat käytössä, kunnes täytät tämän selvityksen. Silloin selvitys korvaa ne."}
                </Notice>
              </div>
            ) : null}
            <form action={saveVehicleReportAction} className="grid max-w-4xl gap-5">
              {hidden}
              <fieldset disabled={closed} className="grid gap-5">
                <Panel className="grid gap-4">
                  <p className="font-semibold">Maatalouden kalustoon kuuluva ajoneuvo</p>
                  <p className="text-sm text-ink/70">
                    Ajoneuvo kuuluu maatalouteen, jos yli puolet ajoista on maatalouden ajoja. Kokonaismenoihin kuuluvat kaikki ajoneuvon kulut ja sen poisto
                    kirjanpidossa.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-5">
                    <Field label="Peruste" htmlFor="vehicleBasis">
                      <Select id="vehicleBasis" name="vehicleBasis" defaultValue={vehicle.vehicleBasis ?? ""}>
                        <option value="">Ei valittu</option>
                        <option value="1">Ajopäiväkirja</option>
                        <option value="2">Muu selvitys</option>
                      </Select>
                    </Field>
                    <Field label="Kilometrit yhteensä" htmlFor="vehicleTotalKm">
                      <Input id="vehicleTotalKm" name="vehicleTotalKm" inputMode="numeric" defaultValue={fi(vehicle.vehicleTotalKm)} className="text-right" />
                    </Field>
                    <Field label="Yksityisajot (km)" htmlFor="vehiclePrivateKm">
                      <Input id="vehiclePrivateKm" name="vehiclePrivateKm" inputMode="numeric" defaultValue={fi(vehicle.vehiclePrivateKm)} className="text-right" />
                    </Field>
                    <Field label="Metsätalouden ajot (km)" htmlFor="vehicleForestryKm">
                      <Input id="vehicleForestryKm" name="vehicleForestryKm" inputMode="numeric" defaultValue={fi(vehicle.vehicleForestryKm)} className="text-right" />
                    </Field>
                    <Field label="Kokonaismenot (€)" htmlFor="vehicleCosts">
                      <Input id="vehicleCosts" name="vehicleCosts" inputMode="decimal" defaultValue={fi(vehicle.vehicleCosts)} className="text-right" />
                    </Field>
                  </div>
                </Panel>
                <Panel className="grid gap-4">
                  <p className="font-semibold">Oma auto maatalouden ajoissa</p>
                  <p className="text-sm text-ink/70">Auto kuuluu yksityistalouteen, jos enintään puolet ajoista on maatalouden ajoja. Vähennys on kilometrikorvaus.</p>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Field label="Peruste" htmlFor="carBasis">
                      <Select id="carBasis" name="carBasis" defaultValue={vehicle.carBasis ?? ""}>
                        <option value="">Ei valittu</option>
                        <option value="1">Ajopäiväkirja</option>
                        <option value="2">Muu selvitys</option>
                      </Select>
                    </Field>
                    <Field label="Kilometrit yhteensä" htmlFor="carTotalKm">
                      <Input id="carTotalKm" name="carTotalKm" inputMode="numeric" defaultValue={fi(vehicle.carTotalKm)} className="text-right" />
                    </Field>
                    <Field label="Maatalouden ajot (km)" htmlFor="carAgriKm">
                      <Input id="carAgriKm" name="carAgriKm" inputMode="numeric" defaultValue={fi(vehicle.carAgriKm)} className="text-right" />
                    </Field>
                    <Field label="Jo vähennetty kirjanpidossa (€)" htmlFor="carDeducted">
                      <Input id="carDeducted" name="carDeducted" inputMode="decimal" defaultValue={fi(vehicle.carDeducted)} className="text-right" />
                    </Field>
                  </div>
                </Panel>
                <Panel className="grid gap-4">
                  <p className="font-semibold">Tilapäiset työmatkat</p>
                  <p className="text-sm text-ink/70">
                    Anna matkapäivät ja kirjanpidossa jo vähennetyt kulut. Ulkomaan päiväraha on maakohtainen, joten anna sen yhteismäärä.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <Field label="Yli 10 h (päivää)" htmlFor="tripsFullDays">
                      <Input id="tripsFullDays" name="tripsFullDays" inputMode="numeric" defaultValue={fi(vehicle.tripsFullDays)} className="text-right" />
                    </Field>
                    <Field label="Yli 10 h, jo vähennetty (€)" htmlFor="tripsFullDeducted">
                      <Input id="tripsFullDeducted" name="tripsFullDeducted" inputMode="decimal" defaultValue={fi(vehicle.tripsFullDeducted)} className="text-right" />
                    </Field>
                    <Field label="Yli 6 h (päivää)" htmlFor="tripsPartDays">
                      <Input id="tripsPartDays" name="tripsPartDays" inputMode="numeric" defaultValue={fi(vehicle.tripsPartDays)} className="text-right" />
                    </Field>
                    <Field label="Yli 6 h, jo vähennetty (€)" htmlFor="tripsPartDeducted">
                      <Input id="tripsPartDeducted" name="tripsPartDeducted" inputMode="decimal" defaultValue={fi(vehicle.tripsPartDeducted)} className="text-right" />
                    </Field>
                    <Field label="Ulkomaan matkat (päivää)" htmlFor="tripsAbroadDays">
                      <Input id="tripsAbroadDays" name="tripsAbroadDays" inputMode="numeric" defaultValue={fi(vehicle.tripsAbroadDays)} className="text-right" />
                    </Field>
                    <Field label="Ulkomaan päivärahat yhteensä (€)" htmlFor="tripsAbroadMax">
                      <Input id="tripsAbroadMax" name="tripsAbroadMax" inputMode="decimal" defaultValue={fi(vehicle.tripsAbroadMax)} className="text-right" />
                    </Field>
                    <Field label="Ulkomaan matkat, jo vähennetty (€)" htmlFor="tripsAbroadDeducted">
                      <Input id="tripsAbroadDeducted" name="tripsAbroadDeducted" inputMode="decimal" defaultValue={fi(vehicle.tripsAbroadDeducted)} className="text-right" />
                    </Field>
                  </div>
                </Panel>
                {!closed ? (
                  <div>
                    <Button>Tallenna selvitys</Button>
                  </div>
                ) : null}
              </fieldset>
            </form>
            {vehicleResult ? (
              <div className="mt-5 max-w-4xl">
                {vehicleResult.errors.length ? (
                  <div className="mb-3">
                    <Notice tone="alert" title="Selvityksessä on puutteita.">
                      {vehicleResult.errors.join(" ")}
                    </Notice>
                  </div>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-3">
                  <Stat label="Tuloutus maataloudessa (221)" value={formatEur(vehicleResult.privateUseIncome)} />
                  <Stat label="Lisävähennys maataloudessa (464)" value={formatEur(vehicleResult.additionalDeduction)} />
                  <Stat label="Metsätalouden meno (2C: 630)" value={formatEur(vehicleResult.forestryTransfer)} />
                </div>
              </div>
            ) : null}
          </section>

          <section id="muut-kentat" className="mb-10 scroll-mt-6">
            <SectionTitle>Muut lomakkeen tiedot</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">
              Harvoin tarvittavat kentät, esimerkiksi käyttöön ottamattomat investoinnit. Arvo viedään veroilmoitukselle sellaisenaan. Ajoneuvot, oma auto ja
              työmatkat annetaan yllä olevassa selvityksessä.
            </p>
            {d.extras.length ? (
              <Table>
                <tbody>
                  {d.extras.map((x) => (
                    <tr key={x.code}>
                      <Td className="w-16 tabular text-ink/55">{x.code}</Td>
                      <Td>{extraField(x.code)?.label ?? x.code}</Td>
                      <Td numeric>{extraField(x.code)?.kind === "amount" ? formatEur(x.value) : x.value.toLocaleString("fi-FI")}</Td>
                      <Td className="text-right">
                        {!closed ? (
                          <form action={deleteExtraAction}>
                            {hidden}
                            <input type="hidden" name="code" value={x.code} />
                            <button className="text-sm font-semibold text-coral">Poista</button>
                          </form>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            {!closed ? (
              <form action={setExtraAction} className="mt-4 flex flex-wrap items-end gap-3">
                {hidden}
                <Field label="Kenttä" htmlFor="extraCode">
                  <Select id="extraCode" name="code" defaultValue="">
                    <option value="" disabled>
                      Valitse
                    </option>
                    {[...new Set(AGRI_EXTRA_FIELDS.filter((f) => !vehicleCodes.has(f.code)).map((f) => f.group))].map((g) => (
                      <optgroup key={g} label={g}>
                        {AGRI_EXTRA_FIELDS.filter((f) => f.group === g && !vehicleCodes.has(f.code)).map((f) => (
                          <option key={f.code} value={f.code}>
                            {f.code} {f.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label="Arvo" htmlFor="extraValue">
                  <Input id="extraValue" name="value" inputMode="decimal" className="w-32 text-right" />
                </Field>
                <Button variant="secondary">Tallenna kenttä</Button>
              </form>
            ) : null}
          </section>

          <section id="maatilat" className="mb-10 scroll-mt-6">
            <SectionTitle>Maatilat</SectionTitle>
            <p className="mb-3 max-w-3xl text-sm text-ink/70">Tasausvaraus tehdään maatiloittain. Lisää tila, jos asiakkaalla on useampi maatila.</p>
            {d.farms.length ? (
              <Table>
                <tbody>
                  {d.farms.map((f) => (
                    <tr key={f.id}>
                      <Td className="font-semibold">{f.name}</Td>
                      <Td className="tabular">{f.farm_code ?? "–"}</Td>
                      <Td className="text-right">
                        <form action={deleteFarmAction}>
                          {hidden}
                          <input type="hidden" name="id" value={f.id} />
                          <button className="text-sm font-semibold text-coral">Poista</button>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
            <form action={addFarmAction} className="mt-4 flex flex-wrap items-end gap-3">
              {hidden}
              <Field label="Maatilan nimi" htmlFor="farmName">
                <Input id="farmName" name="name" maxLength={200} />
              </Field>
              <Field label="Tilatunnus" htmlFor="farmCode" hint="Ruokaviraston tilatunnus, vapaaehtoinen.">
                <Input id="farmCode" name="farmCode" maxLength={40} />
              </Field>
              <Button variant="secondary">Lisää maatila</Button>
            </form>
          </section>

          <p className="text-sm text-ink/65">
            Lomakkeen 2 laskelma näkyy{" "}
            <Link href={`/asiakkaat/${id}/raportti?vuosi=${year}`} className="font-semibold text-sky">
              Veroraportti ja arkisto -välilehdellä
            </Link>
            .
          </p>
        </>
      )}
    </>
  );
}
