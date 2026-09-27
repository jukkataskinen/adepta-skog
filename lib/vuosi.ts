// Verovuosi valitaan aina samalla tavalla: pyydetty vuosi, sitten asiakkaan avoin vuosi, sitten kuluva vuosi.
// Aiemmin reiteissä oli kiinteä 2025, joka olisi vuodenvaihteessa näyttänyt väärän vuoden.

// Kuluva vuosi Suomen ajassa, jotta uudenvuodenyö UTC-aikaan ei anna edellistä vuotta
export function kuluvaVuosi(): number {
  const vuosi = new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', year: 'numeric' }).format(new Date())
  return parseInt(vuosi, 10)
}

// Hyväksyy vain järkevän vuoden, jotta URL:n roskat eivät päädy kyselyihin
export function kelvollinenVuosi(arvo: unknown): number | null {
  const n = typeof arvo === 'number' ? arvo : parseInt(String(arvo ?? ''), 10)
  if (!Number.isInteger(n) || n < 2000 || n > 2100) return null
  return n
}

export function valitseVuosi(pyydetty: unknown, avoinVuosi?: unknown): number {
  return kelvollinenVuosi(pyydetty) ?? kelvollinenVuosi(avoinVuosi) ?? kuluvaVuosi()
}

// Vuosivalintojen lista avoimen ja kuluvan vuoden ympäriltä, ettei kiinteä lista vanhene
export function vuosiValinnat(nykyinen: number): number[] {
  const kuluva = kuluvaVuosi()
  const vuodet: number[] = []
  for (let v = Math.min(nykyinen, kuluva) - 2; v <= Math.max(nykyinen, kuluva) + 1; v++) vuodet.push(v)
  return vuodet
}
