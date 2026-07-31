'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Player = {
  id: string
  display_name: string
  credits: number
  is_admin: boolean
  created_at: string
}

const supabase = createClient()

export default function PlayerAdmin() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [startCredits, setStartCredits] = useState('1000')

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!session?.access_token) {
      throw new Error('Du skal være logget ind som administrator.')
    }

    return session.access_token
  }

  async function adminRequest(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    query = ''
  ) {
    const token = await getAccessToken()

    const response = await fetch(`/api/admin/players${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const result = await response.json()

    if (!response.ok) {
      throw new Error(result.error || 'Handlingen mislykkedes.')
    }

    return result
  }

  async function loadPlayers() {
    setLoading(true)

    try {
      const result = await adminRequest('GET')
      setPlayers(result.players ?? [])
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Spillerne kunne ikke indlæses.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPlayers()
  }, [])

  async function createPlayer(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()

    const credits = Number(startCredits)

    if (name.trim().length < 2) {
      setMessage('Navnet skal være på mindst 2 tegn.')
      return
    }

    if (password.length < 6) {
      setMessage('Koden skal være på mindst 6 tegn.')
      return
    }

    if (!Number.isFinite(credits) || credits < 0) {
      setMessage('Startcredits skal være 0 eller mere.')
      return
    }

    setWorking(true)
    setMessage('')

    try {
      await adminRequest('POST', {
        name: name.trim(),
        password,
        credits,
      })

      setName('')
      setPassword('')
      setStartCredits('1000')
      setMessage('Spilleren er oprettet.')

      await loadPlayers()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Spilleren kunne ikke oprettes.'
      )
    } finally {
      setWorking(false)
    }
  }

  async function changeCredits(
    player: Player,
    amount: number
  ) {
    setWorking(true)
    setMessage('')

    try {
      const result = await adminRequest('PATCH', {
        action: 'credits',
        userId: player.id,
        amount,
      })

      setMessage(
        `${player.display_name} har nu ${result.credits} credits.`
      )

      await loadPlayers()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Credits kunne ikke ændres.'
      )
    } finally {
      setWorking(false)
    }
  }

  async function resetPassword(player: Player) {
    const newPassword = window.prompt(
      `Skriv en ny kode til ${player.display_name}.\nKoden skal være på mindst 6 tegn.`
    )

    if (newPassword === null) return

    if (newPassword.length < 6) {
      setMessage('Koden skal være på mindst 6 tegn.')
      return
    }

    setWorking(true)
    setMessage('')

    try {
      await adminRequest('PATCH', {
        action: 'password',
        userId: player.id,
        password: newPassword,
      })

      setMessage(
        `Koden til ${player.display_name} er blevet nulstillet.`
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Koden kunne ikke nulstilles.'
      )
    } finally {
      setWorking(false)
    }
  }

  async function deletePlayer(player: Player) {
    const confirmed = window.confirm(
      `Vil du slette ${player.display_name}?\n\nSpilleren og spillerens predictions bliver fjernet permanent.`
    )

    if (!confirmed) return

    setWorking(true)
    setMessage('')

    try {
      await adminRequest(
        'DELETE',
        undefined,
        `?userId=${encodeURIComponent(player.id)}`
      )

      setMessage(`${player.display_name} er slettet.`)
      await loadPlayers()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Spilleren kunne ikke slettes.'
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <section>
      <h2>Spillere</h2>

      {message && <div className="notice">{message}</div>}

      <form className="card" onSubmit={createPlayer}>
        <h3>Opret spiller</h3>

        <label>
          Navn
          <input
            required
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Spillerens navn"
          />
        </label>

        <label>
          Midlertidig kode
          <input
            required
            type="text"
            minLength={6}
            value={password}
            onChange={event =>
              setPassword(event.target.value)
            }
            placeholder="Mindst 6 tegn"
          />
        </label>

        <label>
          Startcredits
          <input
            required
            type="number"
            min={0}
            value={startCredits}
            onChange={event =>
              setStartCredits(event.target.value)
            }
          />
        </label>

        <button type="submit" disabled={working}>
          {working ? 'Opretter…' : 'Opret spiller'}
        </button>
      </form>

      <div className="card">
        <h3>Administrér spillere</h3>

        {loading && <p>Indlæser spillere…</p>}

        {!loading && players.length === 0 && (
          <p>Der er ingen spillere endnu.</p>
        )}

        {!loading &&
          players.map(player => (
            <article className="row" key={player.id}>
              <div>
                <strong>{player.display_name}</strong>

                <div>
                  {player.credits} credits
                  {player.is_admin ? ' · Administrator' : ''}
                </div>
              </div>

              <div className="actions">
                {!player.is_admin && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={working}
                      onClick={() =>
                        void changeCredits(player, 500)
                      }
                    >
                      +500
                    </button>

                    <button
                      type="button"
                      className="secondary"
                      disabled={working}
                      onClick={() =>
                        void changeCredits(player, -500)
                      }
                    >
                      −500
                    </button>

                    <button
                      type="button"
                      className="secondary"
                      disabled={working}
                      onClick={() =>
                        void resetPassword(player)
                      }
                    >
                      Ny kode
                    </button>

                    <button
                      type="button"
                      className="danger"
                      disabled={working}
                      onClick={() =>
                        void deletePlayer(player)
                      }
                    >
                      Slet
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
      </div>
    </section>
  )
}
