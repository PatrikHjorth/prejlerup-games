'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Profile = {
  id: string
  display_name: string
  credits: number
  is_admin: boolean
}

type CompetitionOption = {
  id: string
  label: string
  sort_order: number
}

type Competition = {
  id: string
  title: string
  description: string | null
  status: 'draft' | 'open' | 'closed' | 'finished'
  betting_closes_at: string | null
  winning_option_id: string | null
  competition_options: CompetitionOption[]
}

type Prediction = {
  id: string
  competition_id: string
  option_id: string
  stake: number
  odds: number
  payout: number
  is_winner: boolean | null
}

type Notice = {
  id: string
  title: string
  message: string
  created_at: string
}

const supabase = createClient()

function usernameToEmail(name: string) {
  const username = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'oe')
    .replace(/å/g, 'aa')
    .replace(/[^a-z0-9]/g, '')

  if (username === 'admin') {
    return 'kontakt@prejlerupridning.dk'
  }

  return `${username}@players.prejlerup.dk`
}

export default function Home() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [notices, setNotices] = useState<Notice[]>([])

  const [tab, setTab] = useState('spil')
  const [activeCompetitionId, setActiveCompetitionId] = useState('')
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [stake, setStake] = useState(100)
  const [message, setMessage] = useState('')
  const [placing, setPlacing] = useState(false)

  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setProfile(null)
      setCompetitions([])
      setPredictions([])
      setNotices([])
      setSessionReady(true)
      return
    }

    const [
      profileResult,
      competitionsResult,
      predictionsResult,
      noticesResult,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, display_name, credits, is_admin')
        .eq('id', user.id)
        .single(),

      supabase
        .from('competitions')
        .select(`
          id,
          title,
          description,
          status,
          betting_closes_at,
          winning_option_id,
          competition_options (
            id,
            label,
            sort_order
          )
        `)
        .in('status', ['open', 'closed', 'finished'])
        .order('created_at', { ascending: false }),

      supabase
        .from('predictions')
        .select(`
          id,
          competition_id,
          option_id,
          stake,
          odds,
          payout,
          is_winner
        `)
        .eq('user_id', user.id),

      supabase
        .from('notifications')
        .select('id, title, message, created_at')
        .order('created_at', { ascending: false }),
    ])

    if (profileResult.error) {
      setMessage(profileResult.error.message)
    }

    if (competitionsResult.error) {
      setMessage(competitionsResult.error.message)
    }

    if (predictionsResult.error) {
      setMessage(predictionsResult.error.message)
    }

    if (noticesResult.error) {
      setMessage(noticesResult.error.message)
    }

    setProfile(profileResult.data as Profile | null)
    setCompetitions(
      (competitionsResult.data ?? []) as Competition[]
    )
    setPredictions(
      (predictionsResult.data ?? []) as Prediction[]
    )
    setNotices((noticesResult.data ?? []) as Notice[])
    setSessionReady(true)
  }

  useEffect(() => {
    void load()

    const channel = supabase
      .channel('prejlerup-games-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'competitions',
        },
        () => void load()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'competition_options',
        },
        () => void load()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => void load()
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        () => void load()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const activeCompetition = useMemo(() => {
    if (activeCompetitionId) {
      return competitions.find(
        competition => competition.id === activeCompetitionId
      )
    }

    return (
      competitions.find(competition => competition.status === 'open') ??
      competitions[0]
    )
  }, [competitions, activeCompetitionId])

  useEffect(() => {
    if (!activeCompetition) {
      setSelectedOptionId('')
      return
    }

    const sortedOptions = [...activeCompetition.competition_options]
      .sort((a, b) => a.sort_order - b.sort_order)

    const optionStillExists = sortedOptions.some(
      option => option.id === selectedOptionId
    )

    if (!optionStillExists) {
      setSelectedOptionId(sortedOptions[0]?.id ?? '')
    }
  }, [activeCompetition, selectedOptionId])

  const existingPrediction = activeCompetition
    ? predictions.find(
        prediction =>
          prediction.competition_id === activeCompetition.id
      )
    : undefined

  const odds = 2

  async function placePrediction() {
    if (!profile || !activeCompetition || !selectedOptionId) {
      return
    }

    if (stake < 10) {
      setMessage('Mindste indsats er 10 credits.')
      return
    }

    if (stake > profile.credits) {
      setMessage('Du har ikke nok credits.')
      return
    }

    setPlacing(true)
    setMessage('')

    const { error } = await supabase.rpc('place_prediction', {
      p_competition_id: activeCompetition.id,
      p_option_id: selectedOptionId,
      p_stake: stake,
      p_odds: odds,
    })

    if (error) {
      setMessage(error.message)
      setPlacing(false)
      return
    }

    setMessage('Din prediction er placeret.')
    await load()
    setPlacing(false)
  }

  if (!sessionReady) {
    return <main className="loading">Indlæser…</main>
  }

  return (
    <div className="app">
      <img
        className="hero"
        src="/prejlerup.jpg"
        alt="Prejlerup Ridning"
      />

      <header>
        <h1>
          PREJLERUP
          <br />
          GAMES
        </h1>

        <p>Live predictions og virtuelle credits</p>
      </header>

      <nav>
        {[
          'spil',
          'stilling',
          'profil',
          'beskeder',
          ...(profile?.is_admin ? ['staevnekontor'] : []),
        ].map(item => (
          <button
            key={item}
            className={tab === item ? 'active' : ''}
            onClick={() => {
              if (item === 'staevnekontor') {
                window.location.href = '/staevnekontor'
                return
              }

              setTab(item)
            }}
          >
            {item}
          </button>
        ))}
      </nav>

      <main>
        {message && <div className="notice">{message}</div>}

        {tab === 'spil' && (
          <CompetitionGame
            profile={profile}
            competitions={competitions}
            activeCompetition={activeCompetition}
            activeCompetitionId={activeCompetitionId}
            setActiveCompetitionId={setActiveCompetitionId}
            selectedOptionId={selectedOptionId}
            setSelectedOptionId={setSelectedOptionId}
            stake={stake}
            setStake={setStake}
            odds={odds}
            existingPrediction={existingPrediction}
            placing={placing}
            placePrediction={placePrediction}
            goToProfile={() => setTab('profil')}
          />
        )}

        {tab === 'stilling' && <Leaderboard />}

        {tab === 'profil' && (
          <Auth profile={profile} reload={load} />
        )}

        {tab === 'beskeder' && (
          <section>
            <h2>Beskeder</h2>

            {!profile && (
              <div className="card">
                Log ind for at se beskeder.
              </div>
            )}

            {profile && notices.length === 0 && (
              <div className="card">
                Der er ingen beskeder endnu.
              </div>
            )}

            {profile &&
              notices.map(notice => (
                <article className="card" key={notice.id}>
                  <strong>{notice.title}</strong>
                  <p>{notice.message}</p>

                  <small>
                    {new Date(notice.created_at).toLocaleString(
                      'da-DK'
                    )}
                  </small>
                </article>
              ))}
          </section>
        )}
      </main>
    </div>
  )
}

function CompetitionGame({
  profile,
  competitions,
  activeCompetition,
  activeCompetitionId,
  setActiveCompetitionId,
  selectedOptionId,
  setSelectedOptionId,
  stake,
  setStake,
  odds,
  existingPrediction,
  placing,
  placePrediction,
  goToProfile,
}: {
  profile: Profile | null
  competitions: Competition[]
  activeCompetition: Competition | undefined
  activeCompetitionId: string
  setActiveCompetitionId: (id: string) => void
  selectedOptionId: string
  setSelectedOptionId: (id: string) => void
  stake: number
  setStake: (stake: number) => void
  odds: number
  existingPrediction: Prediction | undefined
  placing: boolean
  placePrediction: () => Promise<void>
  goToProfile: () => void
}) {
  if (!profile) {
    return (
      <section>
        <div className="card">
          <h2>Log ind for at spille</h2>
          <p>Opret en profil eller log ind med navn og kode.</p>
          <button onClick={goToProfile}>Gå til profil</button>
        </div>
      </section>
    )
  }

  if (competitions.length === 0 || !activeCompetition) {
    return (
      <section>
        <div className="card">
          Der er endnu ingen åbne eller afsluttede dyster.
        </div>
      </section>
    )
  }

  const sortedOptions = [...activeCompetition.competition_options]
    .sort((a, b) => a.sort_order - b.sort_order)

  const selectedOption = sortedOptions.find(
    option => option.id === existingPrediction?.option_id
  )

  const deadlinePassed =
    activeCompetition.betting_closes_at !== null &&
    new Date(activeCompetition.betting_closes_at).getTime() <=
      Date.now()

  const canPlay =
    activeCompetition.status === 'open' &&
    !deadlinePassed &&
    !existingPrediction

  return (
    <section>
      {competitions.length > 1 && (
        <div className="card">
          <label>
            Vælg dyst
            <select
              value={activeCompetitionId || activeCompetition.id}
              onChange={event =>
                setActiveCompetitionId(event.target.value)
              }
            >
              {competitions.map(competition => (
                <option
                  key={competition.id}
                  value={competition.id}
                >
                  {competition.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="dark card">
        <span className="badge">
          {statusLabel(activeCompetition.status)}
        </span>

        <h2>{activeCompetition.title}</h2>

        {activeCompetition.description && (
          <p>{activeCompetition.description}</p>
        )}

        {activeCompetition.betting_closes_at && (
          <small>
            Betting lukker:{' '}
            {new Date(
              activeCompetition.betting_closes_at
            ).toLocaleString('da-DK')}
          </small>
        )}
      </div>

      <div className="options">
        {sortedOptions.map(option => {
          const isChosen =
            selectedOptionId === option.id ||
            existingPrediction?.option_id === option.id

          return (
            <button
              type="button"
              key={option.id}
              className={isChosen ? 'selected' : ''}
              disabled={!canPlay}
              onClick={() => setSelectedOptionId(option.id)}
            >
              <strong>{option.label}</strong>
              <span>Odds {odds.toFixed(2)}</span>
            </button>
          )
        })}
      </div>

      {existingPrediction ? (
        <div className="card">
          <h3>Din prediction</h3>

          <p>
            Du valgte:{' '}
            <strong>
              {selectedOption?.label ?? 'Ukendt valgmulighed'}
            </strong>
          </p>

          <p>
            Indsats: <strong>{existingPrediction.stake} credits</strong>
          </p>

          <p>
            Odds: <strong>{existingPrediction.odds.toFixed(2)}</strong>
          </p>

          {activeCompetition.status === 'finished' && (
            <p>
              Resultat:{' '}
              <strong>
                {existingPrediction.is_winner
                  ? `Vundet – ${existingPrediction.payout} credits`
                  : 'Ikke vundet'}
              </strong>
            </p>
          )}
        </div>
      ) : (
        <div className="card">
          <label>
            Indsats
            <input
              type="number"
              min={10}
              max={profile.credits}
              value={stake}
              onChange={event =>
                setStake(Number(event.target.value))
              }
            />
          </label>

          <p>
            Saldo: <strong>{profile.credits} credits</strong>
          </p>

          <p>
            Mulig udbetaling:{' '}
            <strong>{Math.round(stake * odds)} credits</strong>
          </p>

          <button
            disabled={!canPlay || placing}
            onClick={() => void placePrediction()}
          >
            {placing
              ? 'Placerer…'
              : activeCompetition.status !== 'open'
                ? 'Dysten er lukket'
                : deadlinePassed
                  ? 'Tiden er udløbet'
                  : 'Placér prediction'}
          </button>
        </div>
      )}
    </section>
  )
}

function Auth({
  profile,
  reload,
}: {
  profile: Profile | null
  reload: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [authMessage, setAuthMessage] = useState('')

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const cleanedName = name.trim()

    if (cleanedName.length < 2) {
      setAuthMessage('Navnet skal være på mindst 2 tegn.')
      return
    }

    if (cleanedName.toLowerCase() === 'admin') {
      setAuthMessage('Navnet Admin er reserveret.')
      return
    }

    if (password.length < 6) {
      setAuthMessage('Koden skal være på mindst 6 tegn.')
      return
    }

    setWorking(true)
    setAuthMessage('')

    const { error } = await supabase.auth.signUp({
      email: usernameToEmail(cleanedName),
      password,
      options: {
        data: {
          display_name: cleanedName,
        },
      },
    })

    if (error) {
      const errorText = error.message.toLowerCase()

      if (
        errorText.includes('already') ||
        errorText.includes('registered')
      ) {
        setAuthMessage(
          'Navnet er allerede taget. Log ind eller vælg et andet navn.'
        )
      } else {
        setAuthMessage(error.message)
      }

      setWorking(false)
      return
    }

    setAuthMessage('Profilen er oprettet.')
    await reload()
    setWorking(false)
  }

  async function signIn() {
    if (!name.trim() || !password) {
      setAuthMessage('Skriv både navn og kode.')
      return
    }

    setWorking(true)
    setAuthMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(name),
      password,
    })

    if (error) {
      setAuthMessage('Forkert navn eller kode.')
      setWorking(false)
      return
    }

    await reload()
    setWorking(false)
  }

  if (profile) {
    return (
      <div className="card">
        <h2>{profile.display_name}</h2>

        <p>
          <strong>{profile.credits}</strong> credits
        </p>

        {profile.is_admin && (
          <p>
            <a href="/staevnekontor">
              Åbn Stævnekontoret
            </a>
          </p>
        )}

        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut()
            location.reload()
          }}
        >
          Log ud
        </button>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={signUp}>
      <h2>Log ind eller opret profil</h2>

      {authMessage && (
        <div className="notice">{authMessage}</div>
      )}

      <label>
        Navn
        <input
          required
          autoComplete="username"
          value={name}
          onChange={event => setName(event.target.value)}
          placeholder="Dit navn"
        />
      </label>

      <label>
        Kode
        <input
          required
          minLength={6}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder="Mindst 6 tegn"
        />
      </label>

      <div className="actions">
        <button
          type="button"
          disabled={working}
          onClick={() => void signIn()}
        >
          {working ? 'Vent…' : 'Log ind'}
        </button>

        <button
          type="submit"
          className="secondary"
          disabled={working}
        >
          Opret ny profil
        </button>
      </div>
    </form>
  )
}

function Leaderboard() {
  const [rows, setRows] = useState<Profile[]>([])

  useEffect(() => {
    void supabase
      .from('profiles')
      .select('id, display_name, credits, is_admin')
      .order('credits', { ascending: false })
      .then(({ data }) =>
        setRows((data ?? []) as Profile[])
      )
  }, [])

  return (
    <section>
      <h2>Leaderboard</h2>

      {rows.map((player, index) => (
        <div className="row" key={player.id}>
          <strong>
            #{index + 1} {player.display_name}
          </strong>

          <strong>{player.credits} credits</strong>
        </div>
      ))}
    </section>
  )
}

function statusLabel(status: Competition['status']) {
  switch (status) {
    case 'draft':
      return 'KLADDE'
    case 'open':
      return 'ÅBEN'
    case 'closed':
      return 'LUKKET'
    case 'finished':
      return 'AFSLUTTET'
  }
}
