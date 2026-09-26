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

export default function InvestointiForm({ asiakasId }: { asiakasId: string }) {
  const router = useRouter()
  const [auki, setAuki] = useState(false)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [virhe, setVirhe] = useState<string | null>(null)
  const [kuvaus, setKuvaus] = useState('')
  const [hankintapvm, setHankintapvm] = useState('')
  const [hankintahinta, setHankintahinta] = useState('')
  const [jaannosarvo, setJaannosarvo] = useState('0')
  const [poistoaika, setPoistoaika] = useState('')
  const [poistotapa, setPoistotapa] = useState('tasa')

  function avaa() {
    setKuvaus('')
    setHankintapvm('')
    setHankintahinta('')
    setJaannosarvo('0')
    setPoistoaika('')
    setPoistotapa('tasa')
    setVirhe(null)
    setAuki(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!kuvaus.trim() || !hankintahinta || !hankintapvm || !poistoaika) return
    setTallennetaan(true)
    setVirhe(null)
    try {
      const res = await fetch('/api/investoinnit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asiakas_id: asiakasId,
          kuvaus: kuvaus.trim(),
          hankintapvm,
          hankintahinta: Number(hankintahinta),
          jaannosarvo: Number(jaannosarvo) || 0,
          poistoaika_vuotta: Number(poistoaika),
          poistotapa,
          aktiivinen: true,
        }),
      })
      if (res.ok) { setAuki(false); router.refresh() }
      else { const json = await res.json(); setVirhe(json.error ?? 'Tallennus epäonnistui') }
    } catch { setVirhe('Verkkovirhe, yritä uudelleen') }
    setTallennetaan(false)
  }

  return (
    <>
      <button type="button" onClick={avaa} style={{ padding: '0.5rem 1.25rem', backgroundColor: 'transparent', color: '#1D9E75', border: '1px solid #1D9E75', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer' }}>
        + Lisää investointi
      </button>
      {auki && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setAuki(false) }} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: '#223528', border: '1px solid #2e4a32', borderRadius: '0.75rem', padding: '2rem', width: '100%', maxWidth: '480px', margin: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '1.3rem', color: '#e8f0e9', margin: '0 0 1.5rem' }}>Lisää investointi</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div><label style={labelStyle}>Kohde *</label><input value={kuvaus} onChange={e => setKuvaus(e.target.value)} required placeholder="esim. Metsätraktori" style={inputStyle} autoFocus /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={labelStyle}>Hankintapäivä *</label><input value={hankintapvm} onChange={e => setHankintapvm(e.target.value)} required type="date" style={inputStyle} /></div>
                <div><label style={labelStyle}>Hankintahinta (€) *</label><input value={hankintahinta} onChange={e => setHankintahinta(e.target.value)} required type="number" min="0" step="0.01" style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={labelStyle}>Jäännösarvo (€)</label><input value={jaannosarvo} onChange={e => setJaannosarvo(e.target.value)} type="number" min="0" step="0.01" style={inputStyle} /></div>
                <div><label style={labelStyle}>Poistoaika (vuotta) *</label><input value={poistoaika} onChange={e => setPoistoaika(e.target.value)} required type="number" min="1" step="1" style={inputStyle} /></div>
              </div>
              <div>
                <label style={labelStyle}>Poistotapa *</label>
                <select value={poistotapa} onChange={e => setPoistotapa(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="tasa">Tasapoisto</option>
                  <option value="menojannos">Menojäännös 25%</option>
                </select>
              </div>
              {virhe && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{virhe}</p>}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button type="submit" disabled={tallennetaan} style={{ flex: 1, padding: '0.6rem', backgroundColor: '#1D9E75', color: '#fff', border: 'none', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', fontWeight: 500, cursor: tallennetaan ? 'not-allowed' : 'pointer', opacity: tallennetaan ? 0.7 : 1 }}>
                  {tallennetaan ? 'Tallennetaan...' : 'Tallenna'}
                </button>
                <button type="button" onClick={() => setAuki(false)} style={{ flex: 1, padding: '0.6rem', backgroundColor: 'transparent', color: '#9ab89e', border: '1px solid #2e4a32', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', cursor: 'pointer' }}>
                  Peruuta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
