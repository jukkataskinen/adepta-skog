'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem', backgroundColor: '#1c2b1e',
  border: '1px solid #2e4a32', borderRadius: '0.4rem', color: '#e8f0e9',
  fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', color: '#7a9e7e', marginBottom: '0.3rem',
}

export default function VuosiModal({ asiakas }: { asiakas: { id: string; avoin_vuosi: number } }) {
  const router = useRouter()
  const [auki, setAuki] = useState(false)
  const [vuosi, setVuosi] = useState(asiakas.avoin_vuosi ?? 2025)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [virhe, setVirhe] = useState<string | null>(null)
  const [varoitus, setVaroitus] = useState(false)

  const nykyinen = asiakas.avoin_vuosi ?? 2025
  const vuodet = [2023, 2024, 2025, 2026, 2027]

  async function handleSubmit() {
    if (vuosi < nykyinen && !varoitus) {
      setVaroitus(true)
      return
    }
    setTallennetaan(true)
    setVirhe(null)
    try {
      if (vuosi > nykyinen) {
        const pdfRes = await fetch(`/api/arkisto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asiakas_id: asiakas.id, verovuosi: nykyinen }),
        })
        if (!pdfRes.ok) {
          const j = await pdfRes.json()
          setVirhe('PDF-tallennus epäonnistui: ' + j.error)
          setTallennetaan(false)
          return
        }
      }
      const res = await fetch(`/api/asiakkaat/${asiakas.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avoin_vuosi: vuosi }),
      })
      if (res.ok) {
        setAuki(false)
        setVaroitus(false)
        router.refresh()
      } else {
        const j = await res.json()
        setVirhe(j.error ?? 'Tallennus epäonnistui')
      }
    } catch {
      setVirhe('Verkkovirhe')
    }
    setTallennetaan(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setAuki(true); setVuosi(nykyinen); setVaroitus(false); setVirhe(null) }}
        style={{ padding: '0.4rem 1rem', backgroundColor: 'transparent', color: '#1D9E75', border: '1px solid #1D9E75', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.85rem', cursor: 'pointer' }}
      >
        Vaihda vuosi
      </button>

      {auki && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setAuki(false) }}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div style={{ backgroundColor: '#223528', border: '1px solid #2e4a32', borderRadius: '0.75rem', padding: '2rem', width: '100%', maxWidth: '420px', margin: '1rem' }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '1.3rem', color: '#e8f0e9', margin: '0 0 1.5rem' }}>Vaihda verovuosi</h2>

            {varoitus && (
              <div style={{ backgroundColor: '#3d1a1a', border: '1px solid #8b2020', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#f87171' }}>
                Avaat jo suljetun verovuoden ({vuosi}). Tämä on poikkeustilanne. Haluatko varmasti jatkaa?
              </div>
            )}

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={labelStyle}>Avoin verovuosi</label>
              <select
                value={vuosi}
                onChange={e => { setVuosi(Number(e.target.value)); setVaroitus(false) }}
                style={inputStyle}
              >
                {vuodet.map(v => (
                  <option key={v} value={v}>{v}{v === nykyinen ? ' (nykyinen)' : v > nykyinen ? ' → sulkee ' + nykyinen : ' ← avaa aiempi'}</option>
                ))}
              </select>
            </div>

            {vuosi > nykyinen && (
              <p style={{ fontSize: '0.8rem', color: '#7a9e7e', marginBottom: '1rem', backgroundColor: '#1c2b1e', padding: '0.75rem', borderRadius: '0.4rem' }}>
                Vuosi {nykyinen} suljetaan ja tallennetaan arkistoon. Uusi avoin vuosi on {vuosi}.
              </p>
            )}

            {virhe && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 1rem' }}>{virhe}</p>}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={tallennetaan || vuosi === nykyinen}
                style={{ flex: 1, padding: '0.6rem', backgroundColor: varoitus ? '#8b2020' : '#1D9E75', color: '#fff', border: 'none', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', fontWeight: 500, cursor: (tallennetaan || vuosi === nykyinen) ? 'not-allowed' : 'pointer', opacity: (tallennetaan || vuosi === nykyinen) ? 0.6 : 1 }}
              >
                {tallennetaan ? 'Tallennetaan...' : varoitus ? 'Vahvista avaus' : 'Tallenna'}
              </button>
              <button
                type="button"
                onClick={() => setAuki(false)}
                style={{ flex: 1, padding: '0.6rem', backgroundColor: 'transparent', color: '#9ab89e', border: '1px solid #2e4a32', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', cursor: 'pointer' }}
              >
                Peruuta
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
