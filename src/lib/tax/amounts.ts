/**
 * Kirjauksen summat. Käyttäjä syöttää summan arvonlisäveron kanssa (kuitin
 * summa), ja veroton osa lasketaan siitä. Kannassa on molemmat: bruttosumma on
 * lähde, veroton summa lasketaan siitä triggerillä samalla säännöllä
 * (migraatio 0009), ja verolaskenta käyttää verotonta.
 *
 * Säännöt ovat tässä yhdessä paikassa:
 *   veroton = pyöristys(brutto / (1 + alv/100), 2)
 *   alv     = brutto − veroton
 * Näin kuitin summa säilyy sentilleen, ja veron pyöristys jää veroon.
 *
 * Laskenta tehdään kokonaisina sentteinä (BigInt), jotta pyöristys on sama
 * kuin Postgresin round(): puolikas pois nollasta. Liukuluvuilla 41,83 / 1,255
 * voisi pyöristyä eri suuntaan kuin kannassa.
 */

const cents = (n: number): bigint => {
  // Syöte voi olla liukuluku, jossa on pyöristysvirhettä (0.1 + 0.2), joten ensin lähimpään senttiin.
  const scaled = n * 100;
  const r = Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-7);
  return BigInt(r);
};

/** Kokonaislukujako, pyöristys lähimpään, puolikas pois nollasta (kuten Postgres). */
function divRound(num: bigint, den: bigint): bigint {
  const neg = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  let q = a / b;
  if ((a % b) * 2n >= b) q += 1n;
  return neg ? -q : q;
}

/** Verokanta sadasosina (25,5 % → 2550). Kannassa verokannassa on kaksi desimaalia. */
const rateBp = (rate: number): bigint => cents(rate);

/** Pyöristys senteille, puolikas pois nollasta. */
export function round2(n: number): number {
  return Number(cents(n)) / 100;
}

/** Veroton summa bruttosummasta. */
export function netFromGross(gross: number, vatRate: number): number {
  const g = cents(gross);
  const r = rateBp(vatRate);
  return Number(divRound(g * 10000n, 10000n + r)) / 100;
}

/**
 * Bruttosumma verottomasta: veroton + pyöristys(veroton × alv/100, 2).
 * Vanha sovellus tallensi verottoman summan ja näytti brutton näin, joten
 * tuonti ja vertailu käyttävät tätä. Tällä saatu brutto antaa takaisin saman
 * verottoman summan (netFromGross), koska ero on alle puoli senttiä.
 */
export function grossFromNet(net: number, vatRate: number): number {
  const n = cents(net);
  const vat = divRound(n * rateBp(vatRate), 10000n);
  return Number(n + vat) / 100;
}

/** Arvonlisävero: brutto miinus veroton. */
export function vatOf(amountNet: number, amountGross: number): number {
  return Number(cents(amountGross) - cents(amountNet)) / 100;
}

/** Bruttosumma osiin. */
export function splitGross(gross: number, vatRate: number): { net: number; vat: number; gross: number } {
  const net = netFromGross(gross, vatRate);
  return { net, vat: vatOf(net, gross), gross: round2(gross) };
}

/**
 * Prosenttiosuus summasta senteiksi pyöristettynä: pyöristys(summa × osuus/100, 2),
 * puolikas pois nollasta. Osuudessa on enintään kaksi desimaalia (numeric(5,2)).
 * Käytetään metsätalouden osuuteen (src/lib/tax/share.ts).
 */
export function percentOf(amount: number, pct: number): number {
  return Number(divRound(cents(amount) * cents(pct), 10000n)) / 100;
}
