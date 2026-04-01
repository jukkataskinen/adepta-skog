'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

// ── Tyypit ──────────────────────────────────────────────────
type Asiakas = { id: string; etunimi: string; sukunimi: string; kotikunta: string | null }
type Rivi = {
  id: string // temp id client-puolella
  paivamaara: string
  kuvaus: string
  tyyppi: 'tulo' | 'meno'
  summa_alv0: number   // veroton summa
  alv_prosentti: number
  kategoria: string
  ennakko: number
}

const AVR = [0, 10, 14, 25.5]
const KATEGORIAT_TULO = ['Pystykauppa', 'Hankintakauppa', 'Hankintatyö', 'Metsänvuokra', 'Muut tulot']
const KATEGORIAT_MENO = ['Metsänhoito', 'Uudistaminen', 'Lannoitus', 'Tiestö ja ojitus', 'Vakuutukset', 'Muut vuosimenot']
const VUODET = [2022, 2023, 2024, 2025, 2026]

function uusiId() { return Math.random().toString(36).slice(2) }
function uusiRivi(): Rivi {
  return { id: uusiId(), paivamaara: '', kuvaus: '', tyyppi: 'tulo', summa_alv0: 0, alv_prosentti: 25.5, kategoria: '', ennakko: 0 }
}
function brutto(r: Rivi) { return r.summa_alv0 * (1 + r.alv_prosentti / 100) }
function fmt(n: number) { return n.toLocaleString('fi-FI', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

// ── Pääkomponentti ──────────────────────────────────────────
export default function KirjanpitoClient() {
  const [asiakkaat, setAsiakkaat] = useState<Asiakas[]>([])
  const [haku, setHaku] = useState('')
  const [curAs, setCurAs] = useState<Asiakas | null>(null)
  const [vuosi, setVuosi] = useState(2025)
  const [rivit, setRivit] = useState<Rivi[]>([])
  const [dirty, setDirty] = useState(false)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [ladataan, setLadataan] = useState(false)
  const [viesti, setViesti] = useState<string | null>(null)

  // Lataa asiakkaat
  useEffect(() => {
    fetch('/api/asiakkaat').then(r => r.json()).then(setAsiakkaat)
  }, [])

  // Lataa tapahtumat kun asiakas tai vuosi vaihtuu
  useEffect(() => {
    if (!curAs) return
    setLadataan(true)
    fetch(`/api/tapahtumat?asiakas_id=${curAs.id}&vuosi=${vuosi}`)
      .then(r => r.json())
      .then((data: {
        id: string; paivamaara: string; kuvaus: string; tyyppi: string;
        summa_alv0: number; alv_prosentti: number; kategoria: string | null; ennakko: number | null
      }[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setRivit(data.map(d => ({
            id: uusiId(),
            paivamaara: d.paivamaara?.slice(0, 10) ?? '',
            kuvaus: d.kuvaus,
            tyyppi: d.tyyppi as 'tulo' | 'meno',
            summa_alv0: Number(d.summa_alv0),
            alv_prosentti: Number(d.alv_prosentti),
            kategoria: d.kategoria ?? '',
            ennakko: Number(d.ennakko ?? 0),
          })))
        } else {
          setRivit([uusiRivi()])
        }
        setDirty(false)
      })
      .finally(() => setLadataan(false))
  }, [curAs, vuosi])

  const muutaRivi = useCallback((id: string, kentta: keyof Rivi, arvo: string | number) => {
    setRivit(rv => rv.map(r => r.id === id ? { ...r, [kentta]: arvo } : r))
    setDirty(true)
  }, [])

  const lisaaRivi = useCallback(() => {
    setRivit(rv => [...rv, uusiRivi()])
    setDirty(true)
  }, [])

  const poistaRivi = useCallback((id: string) => {
    setRivit(rv => rv.filter(r => r.id !== id))
    setDirty(true)
  }, [])

  async function tallenna() {
    if (!curAs || !dirty) return
    setTallennetaan(true)
    try {
      const res = await fetch('/api/tapahtumat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asiakas_id: curAs.id,
          vuosi,
          rivit: rivit.filter(r => r.paivamaara && r.kuvaus).map(r => ({
            paivamaara: r.paivamaara,
            kuvaus: r.kuvaus,
            tyyppi: r.tyyppi,
            summa_alv0: r.summa_alv0,
            alv_prosentti: r.alv_prosentti,
            kategoria: r.kategoria,
            ennakko: r.ennakko,
          }))
        })
      })
      const json = await res.json()
      if (res.ok) {
        setDirty(false)
        naytaViesti(`✓ ${json.tallennettu} tapahtumaa tallennettu`)
      } else {
        naytaViesti(`Virhe: ${json.error}`)
      }
    } finally {
      setTallennetaan(false)
    }
  }

  function naytaViesti(teksti: string) {
    setViesti(teksti)
    setTimeout(() => setViesti(null), 3000)
  }

  // Summat
  const tulot    = rivit.filter(r => r.tyyppi === 'tulo').reduce((s, r) => s + r.summa_alv0, 0)
  const menot    = rivit.filter(r => r.tyyppi === 'meno').reduce((s, r) => s + r.summa_alv0, 0)
  const tulos    = tulot - menot
  const alvSaldo = rivit.reduce((s, r) => {
    const alv = r.summa_alv0 * r.alv_prosentti / 100
    return r.tyyppi === 'tulo' ? s + alv : s - alv
  }, 0)

  const filtteroidut = asiakkaat.filter(a =>
    `${a.sukunimi} ${a.etunimi}`.toLowerCase().includes(haku.toLowerCase())
  )

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#1c2b1e', color: '#f0f4f1', fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Sivupalkki ── */}
      <div style={{ width: 220, flexShrink: 0, backgroundColor: '#162318', borderRight: '1px solid #2e4a32', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.5rem 1.25rem 1rem' }}>
          <a href="/" style={{ fontFamily: "'Fraunces', serif", fontSize: '1.2rem', fontWeight: 600, color: '#1D9E75', textDecoration: 'none', display: 'block', marginBottom: '1.5rem' }}>
            Adepta SKOG
          </a>
          {[
            { label: 'Asiakkaat', href: '/asiakkaat' },
            { label: 'Kirjanpito', href: '/kirjanpito' },
            { label: 'ALV-raportti', href: '/kirjanpito/alv' },
            { label: 'Verosuunnitelma', href: '/vero-optimointi' },
            { label: 'Käyttäjät', href: '/kayttajat' },
          ].map(link => (
            <a key={link.href} href={link.href} style={{ display: 'block', padding: '0.55rem 0', fontSize: '0.875rem', color: link.href === '/kirjanpito' ? '#1D9E75' : '#9ab89e', textDecoration: 'none', borderLeft: link.href === '/kirjanpito' ? '2px solid #1D9E75' : '2px solid transparent', paddingLeft: '0.75rem' }}>
              {link.label}
            </a>
          ))}
        </div>

        <div style={{ padding: '0 1rem 0.75rem', borderTop: '1px solid #2e4a32', marginTop: '0.5rem', paddingTop: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '0.5rem' }}>Asiakkaat</div>
          <input
            value={haku}
            onChange={e => setHaku(e.target.value)}
            placeholder="Hae nimellä…"
            style={{ width: '100%', padding: '6px 10px', backgroundColor: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, color: '#fff', fontSize: '0.8rem', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtteroidut.map(a => (
            <div
              key={a.id}
              onClick={() => { setCurAs(a); setHaku('') }}
              style={{ padding: '8px 14px', cursor: 'pointer', borderLeft: curAs?.id === a.id ? '3px solid #1D9E75' : '3px solid transparent', backgroundColor: curAs?.id === a.id ? 'rgba(29,158,117,0.1)' : 'transparent' }}
            >
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.85)' }}>{a.sukunimi}, {a.etunimi}</div>
              {a.kotikunta && <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{a.kotikunta}</div>}
            </div>
          ))}
        </div>

        {/* Verovuosivalinta */}
        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '0.4rem' }}>Verovuosi</div>
          <select
            value={vuosi}
            onChange={e => setVuosi(parseInt(e.target.value))}
            style={{ width: '100%', padding: '5px 8px', backgroundColor: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 5, color: '#fff', fontSize: '0.85rem', outline: 'none', cursor: 'pointer' }}
          >
            {VUODET.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* ── Pääalue ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', backgroundColor: '#f8f7f4' }}>

        {/* Yläpalkki */}
        <div style={{ backgroundColor: '#1c2b1e', padding: '0.75rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
            {curAs ? (
              <span style={{ color: '#fff' }}>{curAs.sukunimi}, {curAs.etunimi} — Verovuosi {vuosi}</span>
            ) : (
              <span>Valitse asiakas vasemmalta</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {dirty && <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>Tallentamattomia muutoksia</span>}
            <button
              onClick={tallenna}
              disabled={!curAs || !dirty || tallennetaan}
              style={{ padding: '6px 18px', backgroundColor: dirty && curAs ? '#1D9E75' : 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.85rem', fontWeight: 500, cursor: dirty && curAs ? 'pointer' : 'not-allowed', opacity: tallennetaan ? 0.7 : 1 }}
            >
              {tallennetaan ? 'Tallennetaan…' : 'Tallenna'}
            </button>
          </div>
        </div>

        {/* Taulukko */}
        {!curAs ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: '3rem', color: '#ddd', marginBottom: '0.5rem' }}>🌲</div>
              <div style={{ fontSize: '0.9rem' }}>Valitse asiakas vasemmalta aloittaaksesi</div>
            </div>
          </div>
        ) : ladataan ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '0.9rem' }}>Ladataan…</div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 'auto' }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr style={{ backgroundColor: '#f2f0eb', borderBottom: '1px solid #c8c6be' }}>
                  {['', 'Päivämäärä', 'Kuvaus', 'Kategoria', 'Brutto €', 'ALV %', 'Veroton €', 'Tyyppi', ''].map((h, i) => (
                    <th key={i} style={{ padding: '8px 10px', textAlign: h === 'Brutto €' || h === 'ALV %' || h === 'Veroton €' ? 'right' : 'left', fontSize: '0.7rem', fontWeight: 500, color: '#888', letterSpacing: '0.07em', textTransform: 'uppercase', position: 'sticky', top: 0, backgroundColor: '#f2f0eb', zIndex: 10 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rivit.map((r, i) => (
                  <RiviKomponentti
                    key={r.id}
                    rivi={r}
                    indeksi={i}
                    onChange={muutaRivi}
                    onPoista={poistaRivi}
                  />
                ))}
                <tr>
                  <td colSpan={9} style={{ padding: '4px' }}>
                    <button
                      onClick={lisaaRivi}
                      style={{ width: '100%', padding: '8px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#888', textAlign: 'left', paddingLeft: 14 }}
                    >
                      + Lisää rivi
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Alatunniste — summat */}
        {curAs && (
          <div style={{ backgroundColor: '#1c2b1e', padding: '10px 24px', display: 'flex', gap: 32, alignItems: 'center', flexShrink: 0 }}>
            <Summa label="Tulot (alv 0%)" arvo={tulot} positiivinen />
            <div style={{ width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <Summa label="Menot (alv 0%)" arvo={menot} />
            <div style={{ width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <Summa label="Tulos" arvo={tulos} positiivinen={tulos >= 0} />
            <div style={{ width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <Summa label="ALV-saldo" arvo={alvSaldo} positiivinen={alvSaldo >= 0} sininen />
          </div>
        )}
      </div>

      {/* Toast */}
      {viesti && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1c2b1e', color: '#1D9E75', padding: '9px 22px', borderRadius: 24, fontSize: '0.8rem', fontWeight: 500, border: '1px solid rgba(29,158,117,0.3)', zIndex: 999 }}>
          {viesti}
        </div>
      )}
    </div>
  )
}

// ── Yksittäinen rivi ────────────────────────────────────────
function RiviKomponentti({ rivi, indeksi, onChange, onPoista }: {
  rivi: Rivi
  indeksi: number
  onChange: (id: string, kentta: keyof Rivi, arvo: string | number) => void
  onPoista: (id: string) => void
}) {
  const isTulo = rivi.tyyppi === 'tulo'
  const bruttoArvo = rivi.summa_alv0 > 0 ? brutto(rivi) : 0

  return (
    <tr style={{ borderBottom: '1px solid #e8e6df', borderLeft: `3px solid ${isTulo ? '#6b8f4e' : '#a05c1a'}` }}>
      <td style={{ textAlign: 'center', fontSize: '0.7rem', color: '#bbb', paddingLeft: 8 }}>{indeksi + 1}</td>
      <td style={{ padding: 0 }}>
        <input
          type="date"
          value={rivi.paivamaara}
          onChange={e => onChange(rivi.id, 'paivamaara', e.target.value)}
          style={inputSt}
        />
      </td>
      <td style={{ padding: 0 }}>
        <input
          value={rivi.kuvaus}
          onChange={e => onChange(rivi.id, 'kuvaus', e.target.value)}
          placeholder="Kuvaus…"
          style={inputSt}
        />
      </td>
      <td style={{ padding: 0 }}>
        <select
          value={rivi.kategoria}
          onChange={e => onChange(rivi.id, 'kategoria', e.target.value)}
          style={{ ...inputSt, appearance: 'none', cursor: 'pointer' }}
        >
          <option value="">—</option>
          {(isTulo ? KATEGORIAT_TULO : KATEGORIAT_MENO).map(k => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </td>
      <td style={{ padding: 0 }}>
        <input
          type="number"
          value={bruttoArvo || ''}
          onChange={e => {
            const brutto = parseFloat(e.target.value) || 0
            onChange(rivi.id, 'summa_alv0', brutto / (1 + rivi.alv_prosentti / 100))
          }}
          placeholder="0,00"
          style={{ ...inputSt, textAlign: 'right' }}
        />
      </td>
      <td style={{ padding: 0 }}>
        <select
          value={rivi.alv_prosentti}
          onChange={e => onChange(rivi.id, 'alv_prosentti', parseFloat(e.target.value))}
          style={{ ...inputSt, appearance: 'none', textAlign: 'right', cursor: 'pointer' }}
        >
          {AVR.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </td>
      <td style={{ padding: 0 }}>
        <input
          type="number"
          value={rivi.summa_alv0 || ''}
          onChange={e => onChange(rivi.id, 'summa_alv0', parseFloat(e.target.value) || 0)}
          placeholder="0,00"
          style={{ ...inputSt, textAlign: 'right', color: isTulo ? '#3B6D11' : '#8B2000' }}
        />
      </td>
      <td style={{ padding: 0 }}>
        <button
          onClick={() => onChange(rivi.id, 'tyyppi', isTulo ? 'meno' : 'tulo')}
          style={{ width: '100%', height: 44, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: isTulo ? '#6b8f4e' : '#a05c1a' }}
        >
          {isTulo ? 'TULO' : 'MENO'}
        </button>
      </td>
      <td style={{ padding: 0 }}>
        <button
          onClick={() => onPoista(rivi.id)}
          style={{ width: 36, height: 44, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', color: '#ccc', fontSize: '1rem' }}
        >
          ×
        </button>
      </td>
    </tr>
  )
}

function Summa({ label, arvo, positiivinen, sininen }: { label: string; arvo: number; positiivinen?: boolean; sininen?: boolean }) {
  const color = sininen ? '#7ab8e8' : positiivinen ? '#7ec488' : '#e8a86a'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)' }}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 400, color }}>{fmt(arvo)} €</div>
    </div>
  )
}

const inputSt: React.CSSProperties = {
  width: '100%', height: 44, padding: '0 10px', fontFamily: "'DM Sans', sans-serif",
  fontSize: '0.85rem', color: '#1a1c18', backgroundColor: 'transparent',
  border: 'none', outline: 'none',
}
