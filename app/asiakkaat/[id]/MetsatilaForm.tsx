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

export default function MetsatilaForm({ asiakasId }: { asiakasId: string }) {
  const router = useRouter()
  const [auki, setAuki] = useState(false)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [virhe, setVirhe] = useState<string | null>(null)
  const [nimi, setNimi] = useState('')
  const [kiinteistotunnus, setKiinteistotunnus] = useState('')
  const [pintaAla, setPintaAla] = useState('')
  const [hankintahinta, setHankintahinta] = useState('')
  const [hankintapvm, setHankintapvm] = useState('')
  const [metsamaanOsuus, setMetsamaanOsuus] = useState('60')

  function avaa() {
    setNimi('')
    setKiinteistotunnus('')
    setPintaAla('')
    setHankintahinta('')
    setHankintapvm('')
    setMetsamaanOsuus('60')
    setVirhe(null)
    setAuki(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nimi.trim()) return
    setTallennetaan(true)
    setVirhe(null)
    try {
      const res = await fetch('/api/metsatilat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asiakas_id: asiakasId,
          nimi: nimi.trim(),
          kiinteistotunnus: kiinteistotunnus.trim() || null,
          pinta_ala_ha: pintaAla ? Number(pintaAla) : null,
          hankintahinta: hankintahinta ? Number(hankintahinta) : null,
          hankintapvm: hankintapvm || null,
          metsämaan_osuus_prosentti: metsamaanOsuus ? Number(metsamaanOsuus) : 60,
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
        + Lisää metsätila
      </button>
      {auki && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setAuki(false) }} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: '#223528', border: '1px solid #2e4a32', borderRadius: '0.75rem', padding: '2rem', width: '100%', maxWidth: '480px', margin: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '1.3rem', color: '#e8f0e9', margin: '0 0 1.5rem' }}>Lisää metsätila</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div><label style={labelStyle}>Tilan nimi *</label><input value={nimi} onChange={e => setNimi(e.target.value)} required style={inputStyle} autoFocus /></div>
              <div><label style={labelStyle}>Kiinteistötunnus</label><input value={kiinteistotunnus} onChange={e => setKiinteistotunnus(e.target.value)} style={inputStyle} placeholder="123-456-7-89" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={labelStyle}>Pinta-ala (ha)</label><input value={pintaAla} onChange={e => setPintaAla(e.target.value)} type="number" min="0" step="0.01" style={inputStyle} /></div>
                <div><label style={labelStyle}>Metsämaan osuus (%)</label><input value={metsamaanOsuus} onChange={e => setMetsamaanOsuus(e.target.value)} type="number" min="0" max="100" step="1" style={inputStyle} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={labelStyle}>Hankintahinta (€)</label><input value={hankintahinta} onChange={e => setHankintahinta(e.target.value)} type="number" min="0" step="0.01" style={inputStyle} /></div>
                <div><label style={labelStyle}>Hankintapäivä</label><input value={hankintapvm} onChange={e => setHankintapvm(e.target.value)} type="date" style={inputStyle} /></div>
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
