'use client'

import { useState } from 'react'

type Props = {
  organisaatioId: string
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.75rem',
  backgroundColor: '#1c2b1e',
  border: '1px solid #2e4a32',
  borderRadius: '0.4rem',
  color: '#e8f0e9',
  fontFamily: "'DM Sans', sans-serif",
  fontSize: '0.9rem',
  boxSizing: 'border-box',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  color: '#7a9e7e',
  marginBottom: '0.3rem',
}

export default function AsiakasForm({ organisaatioId }: Props) {
  const [auki, setAuki] = useState(false)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [virhe, setVirhe] = useState<string | null>(null)
  const [nimi, setNimi] = useState('')
  const [yTunnus, setYTunnus] = useState('')
  const [kotikunta, setKotikunta] = useState('')
  const [sahkoposti, setSahkoposti] = useState('')
  const [puhelin, setPuhelin] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!nimi.trim()) return
    setTallennetaan(true)
    setVirhe(null)

    try {
      const res = await fetch('/api/asiakkaat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nimi: nimi.trim(),
          y_tunnus: yTunnus.trim() || null,
          kotikunta: kotikunta.trim() || null,
          sahkoposti: sahkoposti.trim() || null,
          puhelin: puhelin.trim() || null,
          organisaatio_id: organisaatioId,
        }),
      })

      if (res.ok) {
        setAuki(false)
        setNimi(''); setYTunnus(''); setKotikunta(''); setSahkoposti(''); setPuhelin('')
        window.location.reload()
      } else {
        const json = await res.json()
        setVirhe(json.error ?? 'Tallennus epäonnistui')
      }
    } catch {
      setVirhe('Verkkovirhe, yritä uudelleen')
    }
    setTallennetaan(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAuki(true)}
        style={{
          padding: '0.5rem 1.25rem',
          backgroundColor: '#1D9E75',
          color: '#fff',
          border: 'none',
          borderRadius: '0.4rem',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '0.9rem',
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        + Lisää asiakas
      </button>

      {auki && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setAuki(false) }}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div style={{
            backgroundColor: '#223528', border: '1px solid #2e4a32',
            borderRadius: '0.75rem', padding: '2rem', width: '100%', maxWidth: '440px',
            margin: '1rem',
          }}>
            <h2 style={{
              fontFamily: "'Fraunces', serif", fontSize: '1.3rem',
              color: '#e8f0e9', margin: '0 0 1.5rem',
            }}>
              Uusi asiakas
            </h2>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Nimi *</label>
                <input
                  value={nimi}
                  onChange={e => setNimi(e.target.value)}
                  required
                  style={inputStyle}
                  autoFocus
                />
              </div>
              <div>
                <label style={labelStyle}>Y-tunnus</label>
                <input value={yTunnus} onChange={e => setYTunnus(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Kotikunta</label>
                <input value={kotikunta} onChange={e => setKotikunta(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Sähköposti</label>
                <input value={sahkoposti} onChange={e => setSahkoposti(e.target.value)} type="email" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Puhelin</label>
                <input value={puhelin} onChange={e => setPuhelin(e.target.value)} style={inputStyle} />
              </div>

              {virhe && (
                <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{virhe}</p>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={tallennetaan}
                  style={{
                    flex: 1, padding: '0.6rem', backgroundColor: '#1D9E75',
                    color: '#fff', border: 'none', borderRadius: '0.4rem',
                    fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem',
                    fontWeight: 500, cursor: tallennetaan ? 'not-allowed' : 'pointer',
                    opacity: tallennetaan ? 0.7 : 1,
                  }}
                >
                  {tallennetaan ? 'Tallennetaan...' : 'Tallenna'}
                </button>
                <button
                  type="button"
                  onClick={() => setAuki(false)}
                  style={{
                    flex: 1, padding: '0.6rem', backgroundColor: 'transparent',
                    color: '#9ab89e', border: '1px solid #2e4a32', borderRadius: '0.4rem',
                    fontFamily: "'DM Sans', sans-serif", fontSize: '0.9rem', cursor: 'pointer',
                  }}
                >
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
