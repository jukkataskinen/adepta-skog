/**
 * Päällekkäisyyden tunnistus: onko ehdotusrivi mahdollisesti jo kirjattu tai
 * ehdotettu toisesta asiakirjasta. Tyypillinen tapaus on puukaupan
 * vuosi-ilmoitus, joka toistaa saman vuoden tilitysten summat yhteenvetona.
 *
 * Puhdas funktio: vertailu tehdään asiakkaan saman vuoden kirjauksiin ja
 * muihin odottaviin ehdotusriveihin (eri asiakirja). Tulos on varoitus, joka
 * ei estä tallennusta, koska kirjanpitäjä päättää, kumpi rivi jää.
 */

export interface DuplicateCandidate {
  key: string;
  /** Rivin asiakirja: saman asiakirjan rivejä ei verrata keskenään. */
  group: string;
  category: string;
  amountGross: number;
  contractNumber: string | null;
  invoiceNumber: string | null;
  /** Näytettävä kuvaus, esimerkiksi "Lasku 118, Metsäpalvelu". */
  label: string;
}

export interface ExistingEntry {
  /** vvvv-kk-pp */
  bookedOn: string;
  category: string;
  amountGross: number;
  description: string;
  reference: string | null;
}

/** Numeron vertailumuoto: ei välilyöntejä eikä väliviivoja, pienet kirjaimet. */
export function normalizeNumber(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[\s\-–./]/g, "");
}

/** Lyhyt numero (alle 3 merkkiä) osuisi sattumalta moneen selitteeseen. */
const usable = (n: string) => n.length >= 3;

function containsNumber(text: string, n: string): boolean {
  return usable(n) && normalizeNumber(text).includes(n);
}

const fiDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d}.${m}.${y}`;
};

type Reason = "contract" | "invoice" | "amount";
const REASON_TEXT: Record<Reason, string> = { contract: "sama sopimusnumero", invoice: "sama laskunumero", amount: "sama luokka ja summa" };

/**
 * Palauttaa varoituksen niille ehdotusriveille, joilla on mahdollinen pari:
 * sama sopimusnumero (kirjauksen viitteessä tai selitteessä), sama laskunumero,
 * tai sama luokka ja bruttosumma euron tarkkuudella.
 */
export function duplicateWarnings(candidates: DuplicateCandidate[], existing: ExistingEntry[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of candidates) {
    const contract = normalizeNumber(c.contractNumber);
    const invoice = normalizeNumber(c.invoiceNumber);
    const hits: { text: string; reason: Reason }[] = [];
    for (const e of existing) {
      const text = `${e.reference ?? ""} ${e.description}`;
      const reason: Reason | null = containsNumber(text, contract)
        ? "contract"
        : containsNumber(text, invoice)
          ? "invoice"
          : e.category === c.category && Math.abs(e.amountGross - c.amountGross) <= 1
            ? "amount"
            : null;
      if (reason) hits.push({ text: `kirjaus ${fiDate(e.bookedOn)} ${e.description || "(ei selitettä)"}`, reason });
    }
    for (const o of candidates) {
      if (o.group === c.group) continue;
      const oc = normalizeNumber(o.contractNumber);
      const oi = normalizeNumber(o.invoiceNumber);
      const reason: Reason | null =
        usable(contract) && contract === oc
          ? "contract"
          : usable(invoice) && invoice === oi
            ? "invoice"
            : o.category === c.category && Math.abs(o.amountGross - c.amountGross) <= 1
              ? "amount"
              : null;
      if (reason) hits.push({ text: `ehdotus ${o.label}`, reason });
    }
    if (!hits.length) continue;
    // Numeron osuma on vahvempi peruste kuin pelkkä summa, joten se näytetään ensin.
    const order: Record<Reason, number> = { contract: 0, invoice: 1, amount: 2 };
    const [first] = [...hits].sort((a, b) => order[a.reason] - order[b.reason]);
    const more = hits.length > 1 ? ` ja ${hits.length - 1} muu${hits.length > 2 ? "ta" : ""}` : "";
    out.set(c.key, `Mahdollinen päällekkäisyys: ${first.text} (${REASON_TEXT[first.reason]})${more}.`);
  }
  return out;
}
