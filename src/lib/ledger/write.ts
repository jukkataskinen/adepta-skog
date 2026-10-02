import type { Sql } from "@/lib/db/types";
import { audit } from "@/lib/audit";
import { netFromGross, percentOf } from "@/lib/tax/amounts";
import { otherSharePct, sharePct } from "@/lib/tax/share";
import { allowsOtherShare, ASSET_CLASS_PCTS, category, isAssetPurchase, isAssetSale, parseAgriAssetChoice, smallAssetLimit, type TransactionKind } from "@/lib/tax/rules";
import { AGRI_ASSET_CLASS_MESSAGE, ASSET_CLASS_MESSAGE, DEPRECIATED_MESSAGE, effectiveKind, SALE_ASSET_MESSAGE, smallAssetMessage } from "@/lib/ledger/transaction-input";

/**
 * Kirjauksen tallennus ja poisto investointeineen. Lomake ja taulukko käyttävät
 * samoja funktioita, jotta investoinnin säännöt ovat yhdessä paikassa. Aina
 * käyttäjän RLS-transaktiossa, ja virhe heitetään, jolloin koko transaktio perutaan.
 */

/** Käyttäjälle näytettävä virhe. Heitetään, jotta transaktio perutaan. */
export class LedgerError extends Error {}


export interface Actor {
  organizationId: string;
  userId: string;
}

export interface TransactionWrite {
  bookedOn: string;
  category: string;
  /** Tyhjä = luokan tyyppi, tai muokatessa entinen, jos luokka ei muuttunut. */
  kind: TransactionKind | null;
  description: string;
  amountGross: number;
  /** Tehokas verokanta (oletus jo ratkaistu). */
  vatRate: number;
  withholding: number;
  /** Oman toiminnon osuus prosentteina (0 < x ≤ 100). Summat ovat silti koko tositteen. */
  businessSharePct: number;
  /** Toisen toiminnon osuus prosentteina (vain menot). Puuttuva = 0. */
  otherSharePct?: number;
  /** undefined = muokatessa ennallaan (taulukossa ei ole viitesaraketta). */
  reference?: string | null;
  forestPropertyId: string | null;
  /** Metsätalouden hankinta: hyödykelaji eli menojäännöspoiston prosentti. */
  assetRatePct: number | null;
  /** Maatalouden hankinta: poistoryhmän valinta (rules.ts agriAssetChoices). */
  agriAssetChoice?: string | null;
  /** Myynti: myytävä investointi. */
  saleAssetId: string | null;
}

interface Previous {
  asset_id: string | null;
  category: string;
  kind: TransactionKind;
}

async function previous(tx: Sql, clientId: string, id: string): Promise<Previous> {
  const [prev] = await tx.query<Previous>("select asset_id, category, kind from sk_transactions where id = $1 and client_id = $2", [id, clientId]);
  if (!prev) throw new LedgerError("Kirjausta ei löytynyt.");
  return prev;
}

/** Investoinnista tehdyt poistot estävät hankinnan poiston: poistolaskelma katkeaisi. */
async function removeAsset(tx: Sql, actor: Actor, assetId: string) {
  const [dep] = await tx.query("select 1 from sk_depreciations where asset_id = $1 limit 1", [assetId]);
  if (dep) throw new LedgerError(DEPRECIATED_MESSAGE);
  await tx.query("delete from sk_assets where id = $1", [assetId]);
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "asset.delete", entity: "sk_assets", entityId: assetId });
}

async function restoreSoldAsset(tx: Sql, assetId: string) {
  await tx.query("update sk_assets set disposed_on = null, sale_price = null where id = $1", [assetId]);
}

/**
 * Lisää (id = null) tai päivittää kirjauksen paikallaan, jotta tositteet, loki
 * ja investoinnin linkki säilyvät. Palauttaa kirjauksen tunnisteen.
 *
 * Investoinnit:
 * - Hankinta luo investoinnin verottomalla summalla, ja muutos päivittää sen.
 *   Jos vain osa kuuluu metsätaloudelle, hankintameno on metsätalouden osuus.
 * - Enintään 600 euron hankinta ohjataan vuosimenoksi (TVL 115 § 3 mom.), maataloudessa 1 200 euron.
 *   Rajaa verrataan toiminnon osuuteen, koska vain se on toiminnon hankintamenoa.
 * - Myynti merkitsee investoinnin myydyksi verottomalla hinnalla (metsätalouden osuus).
 * - Jos hankinnan luokka vaihtuu, investointi poistetaan samoin säännöin kuin
 *   hankinnan poistossa. Jos myynnin luokka tai kohde vaihtuu, entinen kohde palautetaan.
 */
export async function saveTransaction(
  tx: Sql,
  actor: Actor,
  clientId: string,
  id: string | null,
  w: TransactionWrite,
  details?: Record<string, unknown>,
): Promise<string> {
  const cat = category(w.category);
  if (!cat) throw new LedgerError("Valitse luokka.");
  const prev = id ? await previous(tx, clientId, id) : null;
  const share = sharePct(w.businessSharePct);
  // Toisen toiminnon osuus vain menoille, joille se sallitaan (rules.ts allowsOtherShare); muuten 0.
  const otherShare = allowsOtherShare(cat.code) ? Math.min(otherSharePct(w.otherSharePct), 100 - share) : 0;
  // Investoinnin hankintameno ja myyntihinta ovat toiminnon osuus verottomasta summasta (src/lib/tax/share.ts).
  const net = percentOf(netFromGross(w.amountGross, w.vatRate), share);
  const kind = effectiveKind(cat.code, w.kind ?? (prev && prev.category === cat.code ? prev.kind : null));

  let assetId = prev?.asset_id ?? null;
  // Luokan vaihto pois investoinnista (myös metsän ja maatalouden investoinnin välillä):
  // entinen investointi pois tai takaisin käyttöön, koska laji ja poistotapa ovat eri.
  if (prev?.asset_id && isAssetPurchase(prev.category) && cat.code !== prev.category) {
    await removeAsset(tx, actor, prev.asset_id);
    assetId = null;
  }
  if (prev?.asset_id && isAssetSale(prev.category) && (cat.code !== prev.category || (w.saleAssetId && w.saleAssetId !== prev.asset_id))) {
    await restoreSoldAsset(tx, prev.asset_id);
    assetId = null;
  }

  if (isAssetPurchase(cat.code) && !assetId) {
    if (net <= smallAssetLimit(cat.activity)) throw new LedgerError(smallAssetMessage(cat.activity));
    let cols: { rate: number; assetClass: string | null; accelerated: boolean };
    if (cat.activity === "agriculture") {
      // Maatalouden investoinnilla on poistoryhmä, ja uuden koneen korotettu poisto valitaan vuoden mukaan.
      const choice = w.agriAssetChoice ? parseAgriAssetChoice(w.agriAssetChoice, Number(w.bookedOn.slice(0, 4))) : null;
      if (!choice) throw new LedgerError(AGRI_ASSET_CLASS_MESSAGE);
      cols = { rate: choice.pct, assetClass: choice.assetClass, accelerated: choice.accelerated };
    } else {
      if (!w.assetRatePct || !ASSET_CLASS_PCTS.includes(w.assetRatePct)) throw new LedgerError(ASSET_CLASS_MESSAGE);
      cols = { rate: w.assetRatePct, assetClass: null, accelerated: false };
    }
    const [a] = await tx.query<{ id: string }>(
      `insert into sk_assets (organization_id, client_id, description, acquired_on, acquisition_cost, method, useful_life_years, declining_rate_pct,
                              forest_property_id, activity, asset_class, accelerated)
       values ($1,$2,$3,$4,$5,'declining_balance',null,$6,$7,$8,$9,$10) returning id`,
      [actor.organizationId, clientId, w.description || cat.label, w.bookedOn, net, cols.rate, w.forestPropertyId, cat.activity, cols.assetClass, cols.accelerated],
    );
    assetId = a.id;
    await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "asset.create", entity: "sk_assets", entityId: a.id });
  } else if (isAssetPurchase(cat.code) && assetId) {
    // Hankinnan muutos päivittää investoinnin hinnan ja päivän. Hankintameno on veroton summa.
    await tx.query("update sk_assets set acquisition_cost = $2, acquired_on = $3, description = $4, forest_property_id = $5 where id = $1", [
      assetId, net, w.bookedOn, w.description || cat.label, w.forestPropertyId,
    ]);
  }
  if (isAssetSale(cat.code)) {
    const saleAsset = w.saleAssetId ?? assetId;
    if (!saleAsset && !prev) throw new LedgerError(SALE_ASSET_MESSAGE);
    if (saleAsset) {
      // Myytävän investoinnin on oltava saman toiminnon: maatalouden myynti pienentää poistoryhmää.
      const rows = await tx.query("update sk_assets set disposed_on = $2, sale_price = $3 where id = $1 and client_id = $4 and activity = $5 returning id", [
        saleAsset, w.bookedOn, net, clientId, cat.activity,
      ]);
      if (!rows.length) throw new LedgerError(SALE_ASSET_MESSAGE);
    }
    assetId = saleAsset;
  }
  if (!isAssetPurchase(cat.code) && !isAssetSale(cat.code)) assetId = null;

  // Toiminto tulee luokasta, ja kanta tarkistaa saman säännön (0015).
  const values = [w.bookedOn, kind, cat.code, w.description, w.amountGross, w.vatRate, w.withholding, assetId, w.forestPropertyId, share, cat.activity, otherShare];
  if (id) {
    const keepReference = w.reference === undefined;
    await tx.query(
      `update sk_transactions set booked_on = $3, kind = $4, category = $5, description = $6, amount_gross = $7, vat_rate = $8, withholding = $9,
              asset_id = $10, forest_property_id = $11, business_share_pct = $12, activity = $13, other_share_pct = $14${keepReference ? "" : ", reference = $15"}
        where id = $1 and client_id = $2`,
      keepReference ? [id, clientId, ...values] : [id, clientId, ...values, w.reference],
    );
  } else {
    const [row] = await tx.query<{ id: string }>(
      `insert into sk_transactions (organization_id, client_id, booked_on, kind, category, description, amount_gross, vat_rate, withholding, asset_id,
                                    forest_property_id, business_share_pct, activity, other_share_pct, reference, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [actor.organizationId, clientId, ...values, w.reference ?? null, actor.userId],
    );
    id = row.id;
  }
  await audit(tx, {
    organizationId: actor.organizationId, userId: actor.userId, action: prev ? "transaction.update" : "transaction.create", entity: "sk_transactions",
    entityId: id!, details,
  });
  return id!;
}

/**
 * Poistaa kirjauksen. Myynnin poisto palauttaa investoinnin käyttöön. Hankinnan
 * poisto poistaa investoinnin, jos sillä ei ole poistoja. Palauttaa verovuoden.
 */
export async function deleteTransaction(tx: Sql, actor: Actor, clientId: string, id: string, details?: Record<string, unknown>): Promise<number> {
  const [t] = await tx.query<{ tax_year: number; category: string; asset_id: string | null }>(
    "select tax_year, category, asset_id from sk_transactions where id = $1 and client_id = $2",
    [id, clientId],
  );
  if (!t) throw new LedgerError("Kirjausta ei löytynyt.");
  await tx.query("delete from sk_transactions where id = $1", [id]);
  if (t.asset_id && isAssetSale(t.category)) await restoreSoldAsset(tx, t.asset_id);
  else if (t.asset_id && isAssetPurchase(t.category)) await removeAsset(tx, actor, t.asset_id);
  await audit(tx, { organizationId: actor.organizationId, userId: actor.userId, action: "transaction.delete", entity: "sk_transactions", entityId: id, details });
  return Number(t.tax_year);
}
