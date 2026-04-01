'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Asiakas = {
  id: string
  etunimi: string
  sukunimi: string
  y_tunnus: string | null
  kotikunta: string | null
  sahkoposti: string | null
  puhelin: string | null
  alv_rekisterissa: boolean
  osoite: string | null
  postinumero: string | null
  postitoimipaikka: string | null
  verotiliviite: string | null
  avoin_vuosi: number | null
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.5rem 0.75rem', backgroundColor: '#1c2b1e',
  border: '1px solid #2e4a32', borderRadius: '0.4rem', color: '#e8f0e9',
  fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.8rem', color: '#7a9e7e', marginBottom: '0.3rem',
}

export default function MuokkausForm({ asiakas }: { asiakas: Asiakas }) {
  const router = useRouter()
  const [auki, setAuki] = useState(false)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [virhe, setVirhe] = useState<string | null>(null)
  const [etunimi, setEtunimi] = useState(asiakas.etunimi)
  const [sukunimi, setSukunimi] = useState(asiakas.sukunimi)
  const [yTunnus, setYTunnus] = useState(asiakas.y_tunnus ?? '')
  const [kotikunta, setKotikunta] = useState(asiakas.kotikunta ?? '')
  const [sahkoposti, setSahkoposti] = useState(asiakas.sahkoposti ?? '')
  const [puhelin, setPuhelin] = useState(asiakas.puhelin ?? '')
  const [alvRekisterissa, setAlvRekisterissa] = useState(asiakas.alv_rekisterissa)
  const [osoite, setOsoite] = useState(asiakas.osoite ?? '')
  const [postinumero, setPostinumero] = useState(asiakas.postinumero ?? '')
  const [postitoimipaikka, setPostitoimipaikka] = useState(asiakas.postitoimipaikka ?? '')
  const [verotiliviite, setVerotiliviite] = useState(asiakas.verotiliviite ?? '')
  const [avoinVuosi, setAvoinVuosi] = useState(asiakas.avoin_vuosi ?? 2025)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!etunimi.trim() || !sukunimi.trim()) return
    setTallennetaan(true)
    setVirhe(null)
    try {
      const res = await fetch(`/api/asiakkaat/${asiakas.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          etunimi: etunimi.trim(),
          sukunimi: sukunimi.trim(),
          y_tunnus: yTunnus.trim() || null,
          kotikunta: kotikunta.trim() || null,
          sahkoposti: sahkoposti.trim() || null,
          puhelin: puhelin.trim() || null,
          alv_rekisterissa: alvRekisterissa,
          osoite: osoite.trim() || null,
          postinumero: postinumero.trim() || null,
          postitoimipaikka: postitoimipaikka.trim() || null,
          verotiliviite: verotiliviite.trim() || null,
          avoin_vuosi: avoinVuosi,
        }),
      })
      if (res.ok) { setAuki(false); router.refresh() }
      else { const json = await res.json(); setVirhe(json.error ?? 'Tallennus epäonnistui') }
    } catch { setVirhe('Verkkovirhe, yritä uudelleen') }
    setTallennetaan(false)
  }

  return (
    <>
      <button type="button" onClick={() => setAuki(true)} style={{ padding: '0.5rem 1.25rem', backgroundColor: 'transparent', color: '#1D9E75', border: '1px solid #1D9E75', borderRadius: '0.4rem', fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer' }}>
        Muokkaa
      </button>
      {auki && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setAuki(false) }} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ backgroundColor: '#223528', border: '1px solid #2e4a32', borderRadius: '0.75rem', padding: '2rem', width: '100%', maxWidth: '480px', margin: '1rem', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '1.3rem', color: '#e8f0e9', margin: '0 0 1.5rem' }}>Muokkaa asiakasta</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><label style={labelStyle}>Etunimi *</label><input value={etunimi} onChange={e => setEtunimi(e.target.value)} required style={inputStyle} autoFocus /></div>
                <div><label style={labelStyle}>Sukunimi *</label><input value={sukunimi} onChange={e => setSukunimi(e.target.value)} required style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>Y-tunnus</label><input value={yTunnus} onChange={e => setYTunnus(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Kotikunta</label><input value={kotikunta} onChange={e => setKotikunta(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Osoite</label><input value={osoite} onChange={e => setOsoite(e.target.value)} style={inputStyle} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                <div><label style={labelStyle}>Postinumero</label><input value={postinumero} onChange={e => setPostinumero(e.target.value)} style={inputStyle} /></div>
                <div><label style={labelStyle}>Postitoimipaikka</label><input value={postitoimipaikka} onChange={e => setPostitoimipaikka(e.target.value)} style={inputStyle} /></div>
              </div>
              <div><label style={labelStyle}>Sähköposti</label><input value={sahkoposti} onChange={e => setSahkoposti(e.target.value)} type="email" style={inputStyle} /></div>
              <div><label style={labelStyle}>Puhelin</label><input value={puhelin} onChange={e => setPuhelin(e.target.value)} style={inputStyle} /></div>
              <div><label style={labelStyle}>Verotiliviite</label><input value={verotiliviite} onChange={e => setVerotiliviite(e.target.value)} placeholder="RF-viite OmaVeroon" style={inputStyle} /></div>
              <div>
                <label style={labelStyle}>Avoin verovuosi</label>
                <select value={avoinVuosi} onChange={e => setAvoinVuosi(Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {[2023, 2024, 2025, 2026, 2027].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input type="checkbox" id="alv" checked={alvRekisterissa} onChange={e => setAlvRekisterissa(e.target.checked)} style={{ accentColor: '#1D9E75', width: 16, height: 16 }} />
                <label htmlFor="alv" style={{ fontSize: '0.9rem', color: '#9ab89e', cursor: 'pointer' }}>ALV-rekisterissä</label>
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
