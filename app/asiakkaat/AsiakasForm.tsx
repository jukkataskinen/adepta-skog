'use client'

import { useState } from 'react'

type Props = {
  organisaatioId: string
}

export default function AsiakasForm({ organisaatioId }: Props) {
  const [auki, setAuki] = useState(false)
  const [tallennetaan, setTallennetaan] = useState(false)
  const [virhe, setVirhe] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setTallennetaan(true)
    setVirhe(null)

    const form = e.currentTarget
    const data = {
      nimi: (form.elements.namedItem('nimi') as HTMLInputElement).value,
      y_tunnus: (form.elements.namedItem('y_tunnus') as HTMLInputElement).value,
      kotikunta: (form.elements.namedItem('kotikunta') as HTMLInputElement).value,
      sahkoposti: (form.elements.namedItem('sahkoposti') as HTMLInputElement).value,
      puhelin: (form.elements.namedItem('puhelin') as HTMLInputElement).value,
      organisaatio_id: organisaatioId,
    }

    const res = await fetch('/api/asiakkaat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (res.ok) {
      setAuki(false)
      window.location.reload()
    } else {
      const json = await res.json()
      setVirhe(json.error ?? 'Tallennus epäonnistui')
    }
    setTallennetaan(false)
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
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    color: '#7a9e7e',
    marginBottom: '0.3rem',
  }

  return (
    <>
      <button
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
        <div style={{
          position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        }}>
          <div style={{
            backgroundColor: '#223528', border: '1px solid #2e4a32',
            borderRadius: '0.75rem', padding: '2rem', width: '100%', maxWidth: '440px',
          }}>
            <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: '1.3rem', color: '#e8f0e9', margin: '0 0 1.5rem' }}>
              Uusi asiakas
            </h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Nimi *</label>
                <input name="nimi" required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Y-tunnus</label>
                <input name="y_tunnus" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Kotikunta</label>
                <input name="kotikunta" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Sähköposti</label>
                <input name="sahkoposti" type="email" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Puhelin</label>
                <input name="puhelin" style={inputStyle} />
              </div>
              {virhe && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: 0 }}>{virhe}</p>}
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
