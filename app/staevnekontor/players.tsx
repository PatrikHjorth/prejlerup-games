'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Player = {
  id: string
  display_name: string
  credits: number
  is_admin: boolean
  created_at: string
}

type CreditTransaction = {
  id: string
  amount: number
  balance_after: number
  reason: string
  description: string | null
  created_at: string
}

const supabase = createClient()

export default function PlayerAdmin() {
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [workingPlayerId, setWorkingPlayerId] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')

  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [startCredits, setStartCredits] = useState('1000')

  const [creditAmounts, setCreditAmounts] =
    useState<Record<string, string>>({})

  const [openHistoryId, setOpenHistoryId] = useState('')
  const [history, setHistory] = useState<
    Record<string, CreditTransaction[]>
  >({})

  const filteredPlayers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return players
    return players.filter(player =>
      player.display_name.toLowerCase().includes(query)
    )
  }, [players, search])

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
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const contentType = response.headers.get('content-type') ?? ''
    const rawText = await response.text()

    if (!contentType.includes('application/json')) {
      throw new Error(`API-ruten svarede med status ${response.status}.`)
    }

    const result = JSON.parse(rawText)

    if (!response.ok) {
      throw new Error(result.error || 'Handlingen mislykkedes.')
    }

    return result
  }

  async function loadPlayers() {
    setLoading(true)

    try {
      const result = await adminRequest('GET')
      const loadedPlayers = (result.players ?? []) as Player[]
      setPlayers(loadedPlayers)

      setCreditAmounts(current => {
        const next = { ...current }
        for (const player of loadedPlayers) {
          if (!(player.id in next)) next[player.id] = '500'
        }
        return next
      })
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

  async function createPlayer(event: FormEvent<HTMLFormElement>) {
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

    setWorkingPlayerId('create')
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
      setWorkingPlayerId('')
    }
  }

  async function changeCredits(player: Player, direction: 1 | -1) {
    const amount = Number(creditAmounts[player.id] ?? '')

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Skriv et gyldigt beløb større end 0.')
      return
    }

    setWorkingPlayerId(player.id)
    setMessage('')

    try {
      const result = await adminRequest('PATCH', {
        action: 'credits',
        userId: player.id,
        amount: Math.round(amount) * direction,
      })

      setMessage(
        `${player.display_name} har nu ${result.credits} credits.`
      )

      setHistory(current => {
        const next = { ...current }
        delete next[player.id]
        return next
      })

      await loadPlayers()
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Credits kunne ikke ændres.'
      )
    } finally {
      setWorkingPlayerId('')
    }
  }

  async function toggleHistory(player: Player) {
    if (openHistoryId === player.id) {
      setOpenHistoryId('')
      return
    }

    setOpenHistoryId(player.id)

    if (history[player.id]) return

    setWorkingPlayerId(player.id)

    try {
      const result = await adminRequest(
        'GET',
        undefined,
        `?historyUserId=${encodeURIComponent(player.id)}`
      )

      setHistory(current => ({
        ...current,
        [player.id]: result.history ?? [],
      }))
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Historikken kunne ikke indlæses.'
      )
    } finally {
      setWorkingPlayerId('')
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

    setWorkingPlayerId(player.id)
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
      setWorkingPlayerId('')
    }
  }

  async function deletePlayer(player: Player) {
    const confirmed = window.confirm(
      `Vil du slette ${player.display_name}?\n\nSpilleren og spillerens predictions bliver fjernet permanent.`
    )

    if (!confirmed) return

    setWorkingPlayerId(player.id)
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
      setWorkingPlayerId('')
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
            onChange={event => setPassword(event.target.value)}
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
            onChange={event => setStartCredits(event.target.value)}
          />
        </label>

        <button type="submit" disabled={workingPlayerId === 'create'}>
          {workingPlayerId === 'create' ? 'Opretter…' : 'Opret spiller'}
        </button>
      </form>

      <div className="card">
        <h3>Administrér spillere</h3>

        <label>
          Søg efter spiller
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Skriv et navn"
          />
        </label>

        {loading && <p>Indlæser spillere…</p>}

        {!loading && filteredPlayers.length === 0 && (
          <p>Ingen spillere matcher søgningen.</p>
        )}

        {!loading &&
          filteredPlayers.map(player => {
            const isWorking = workingPlayerId === player.id
            const playerHistory = history[player.id] ?? []

            return (
              <article className="row" key={player.id}>
                <div style={{ width: '100%' }}>
                  <div>
                    <strong>{player.display_name}</strong>
                    <div>
                      {player.credits} credits
                      {player.is_admin ? ' · Administrator' : ''}
                    </div>
                  </div>

                  {!player.is_admin && (
                    <div className="actions">
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={creditAmounts[player.id] ?? '500'}
                        onChange={event =>
                          setCreditAmounts(current => ({
                            ...current,
                            [player.id]: event.target.value,
                          }))
                        }
                        aria-label={`Credit-beløb til ${player.display_name}`}
                        style={{ maxWidth: 120 }}
                      />

                      <button
                        type="button"
                        className="secondary"
                        disabled={isWorking}
                        onClick={() => void changeCredits(player, 1)}
                      >
                        Tilføj
                      </button>

                      <button
                        type="button"
                        className="secondary"
                        disabled={isWorking}
                        onClick={() => void changeCredits(player, -1)}
                      >
                        Fratræk
                      </button>

                      <button
                        type="button"
                        className="secondary"
                        disabled={isWorking}
                        onClick={() => void toggleHistory(player)}
                      >
                        {openHistoryId === player.id
                          ? 'Skjul historik'
                          : 'Historik'}
                      </button>

                      <button
                        type="button"
                        className="secondary"
                        disabled={isWorking}
                        onClick={() => void resetPassword(player)}
                      >
                        Ny kode
                      </button>

                      <button
                        type="button"
                        className="danger"
                        disabled={isWorking}
                        onClick={() => void deletePlayer(player)}
                      >
                        Slet
                      </button>
                    </div>
                  )}

                  {openHistoryId === player.id && (
                    <div className="card">
                      <h4>Credit-historik</h4>

                      {isWorking && <p>Indlæser historik…</p>}

                      {!isWorking && playerHistory.length === 0 && (
                        <p>Der er ingen registrerede bevægelser endnu.</p>
                      )}

                      {!isWorking &&
                        playerHistory.map(transaction => (
                          <div className="row" key={transaction.id}>
                            <div>
                              <strong>
                                {transaction.amount >= 0 ? '+' : ''}
                                {transaction.amount} credits
                              </strong>

                              <div>
                                {transaction.description ??
                                  reasonLabel(transaction.reason)}
                              </div>

                              <small>
                                {new Date(
                                  transaction.created_at
                                ).toLocaleString('da-DK')}
                              </small>
                            </div>

                            <strong>
                              Saldo: {transaction.balance_after}
                            </strong>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </article>
            )
          })}
      </div>
    </section>
  )
}

function reasonLabel(reason: string) {
  switch (reason) {
    case 'player_created':
      return 'Spiller oprettet'
    case 'admin_adjustment':
      return 'Manuel ændring'
    case 'prediction_stake':
      return 'Indsats'
    case 'prediction_payout':
      return 'Gevinst'
    case 'game_reset':
      return 'Nyt spil'
    default:
      return reason
  }
}