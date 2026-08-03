'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase'

const supabase = createClient()

export default function ResetGame() {
  const [startCredits, setStartCredits] = useState('1000')
  const [keepPlayers, setKeepPlayers] = useState(true)
  const [confirmation, setConfirmation] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  async function resetGame() {
    const credits = Number(startCredits)

    if (!Number.isFinite(credits) || credits < 0) {
      setMessage('Startcredits skal være 0 eller mere.')
      return
    }

    if (confirmation !== 'RESET') {
      setMessage('Skriv RESET med store bogstaver.')
      return
    }

    const firstConfirmation = window.confirm(
      keepPlayers
        ? 'Er du sikker? Alle dyster, predictions og beskeder slettes. Spillerne beholdes og får ny startsaldo.'
        : 'Er du sikker? Alle dyster, predictions, beskeder og almindelige spillere slettes. Kun Admin beholdes.'
    )

    if (!firstConfirmation) return

    const secondConfirmation = window.confirm(
      'Dette kan ikke fortrydes. Skal nulstillingen gennemføres nu?'
    )

    if (!secondConfirmation) return

    setWorking(true)
    setMessage('Nulstiller spillet…')

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.access_token) {
        throw new Error('Du skal være logget ind som administrator.')
      }

      const response = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startCredits: credits,
          keepPlayers,
          confirmation,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Nulstillingen mislykkedes.')
      }

      setConfirmation('')

      if (keepPlayers) {
        setMessage(
          `Nyt spil er klar. ${result.playersReset ?? 0} spiller(e) ` +
            `har fået ${result.startCredits ?? credits} credits.`
        )
      } else {
        setMessage(
          `Fuld nulstilling gennemført. ` +
            `${result.playersDeleted ?? 0} spiller(e) er slettet.`
        )
      }

      window.setTimeout(() => window.location.reload(), 1200)
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Nulstillingen mislykkedes.'
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="card">
      <h2>Start nyt spil</h2>

      <p>
        Brug denne funktion, når testperioden er slut, og det rigtige
        spil skal begynde.
      </p>

      {message && <div className="notice">{message}</div>}

      <label>
        Startcredits
        <input
          type="number"
          min={0}
          value={startCredits}
          onChange={event => setStartCredits(event.target.value)}
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={keepPlayers}
          onChange={event => setKeepPlayers(event.target.checked)}
        />
        Behold spillerprofiler
      </label>

      <p>
        {keepPlayers
          ? 'Spillerne beholdes, og deres saldo nulstilles til startbeløbet.'
          : 'Alle almindelige spillere slettes. Kun Admin beholdes.'}
      </p>

      <label>
        Skriv RESET for at bekræfte
        <input
          value={confirmation}
          onChange={event => setConfirmation(event.target.value)}
          placeholder="RESET"
          autoComplete="off"
        />
      </label>

      <button
        type="button"
        className="danger"
        disabled={working || confirmation !== 'RESET'}
        onClick={() => void resetGame()}
      >
        {working ? 'Nulstiller…' : 'Nulstil og start nyt spil'}
      </button>
    </section>
  )
}
