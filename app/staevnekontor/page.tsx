'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

type Profile = {
  id: string
  display_name: string
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
  competition_options: CompetitionOption[]
}

export default function StaevnekontorPage() {
  const supabase = createClient()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [status, setStatus] = useState<'draft' | 'open'>('draft')
  const [options, setOptions] = useState(['', ''])

  useEffect(() => {
    void loadPage()
  }, [])

  async function loadPage() {
    setLoading(true)
    setMessage('')

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setMessage('Du skal være logget ind for at åbne Stævnekontoret.')
      setLoading(false)
      return
    }

    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('id, display_name, is_admin')
      .eq('id', user.id)
      .single()

    if (profileError || !profileData) {
      setMessage('Din profil kunne ikke indlæses.')
      setLoading(false)
      return
    }

    setProfile(profileData)

    if (!profileData.is_admin) {
      setMessage('Du har ikke adgang til Stævnekontoret.')
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('competitions')
      .select(`
        id,
        title,
        description,
        status,
        betting_closes_at,
        competition_options (
          id,
          label,
          sort_order
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      setMessage(error.message)
    } else {
      setCompetitions((data ?? []) as Competition[])
    }

    setLoading(false)
  }

  function updateOption(index: number, value: string) {
    setOptions(current =>
      current.map((option, optionIndex) =>
        optionIndex === index ? value : option
      )
    )
  }

  function removeOption(index: number) {
    if (options.length <= 2) return

    setOptions(current =>
      current.filter((_, optionIndex) => optionIndex !== index)
    )
  }

  async function createCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const cleanedOptions = options
      .map(option => option.trim())
      .filter(Boolean)

    if (!profile?.is_admin) {
      setMessage('Du har ikke adgang til at oprette dyster.')
      return
    }

    if (!title.trim()) {
      setMessage('Dysten skal have en titel.')
      return
    }

    if (cleanedOptions.length < 2) {
      setMessage('Tilføj mindst to valgmuligheder.')
      return
    }

    setSaving(true)
    setMessage('')

    const { data: competition, error: competitionError } = await supabase
      .from('competitions')
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        status,
        betting_closes_at: deadline
          ? new Date(deadline).toISOString()
          : null,
        created_by: profile.id,
      })
      .select('id')
      .single()

    if (competitionError || !competition) {
      setMessage(
        competitionError?.message ?? 'Dysten kunne ikke oprettes.'
      )
      setSaving(false)
      return
    }

    const optionRows = cleanedOptions.map((label, index) => ({
      competition_id: competition.id,
      label,
      sort_order: index,
    }))

    const { error: optionsError } = await supabase
      .from('competition_options')
      .insert(optionRows)

    if (optionsError) {
      await supabase
        .from('competitions')
        .delete()
        .eq('id', competition.id)

      setMessage(optionsError.message)
      setSaving(false)
      return
    }

    setTitle('')
    setDescription('')
    setDeadline('')
    setStatus('draft')
    setOptions(['', ''])
    setMessage('Dysten er oprettet.')

    await loadPage()
    setSaving(false)
  }

  async function changeStatus(
    competitionId: string,
    nextStatus: Competition['status']
  ) {
    setMessage('')

    const { error } = await supabase
      .from('competitions')
      .update({ status: nextStatus })
      .eq('id', competitionId)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Dystens status er opdateret.')
    await loadPage()
  }

  if (loading) {
    return (
      <main>
        <h1>Stævnekontor</h1>
        <p>Indlæser…</p>
      </main>
    )
  }

  if (!profile?.is_admin) {
    return (
      <main>
        <h1>Stævnekontor</h1>
        <p>{message || 'Du har ikke adgang til denne side.'}</p>
        <a href="/">Tilbage til forsiden</a>
      </main>
    )
  }

  return (
    <main>
      <p>
        <a href="/">← Tilbage til Prejlerup Games</a>
      </p>

      <h1>Stævnekontor</h1>
      <p>Logget ind som {profile.display_name}</p>

      {message && <div className="notice">{message}</div>}

      <form className="card" onSubmit={createCompetition}>
        <h2>Opret dyst</h2>

        <label>
          Titel
          <input
            required
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="Eksempel: Hvem vinder næste klasse?"
          />
        </label>

        <label>
          Beskrivelse
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Beskriv dysten"
          />
        </label>

        <label>
          Betting lukker
          <input
            type="datetime-local"
            value={deadline}
            onChange={event => setDeadline(event.target.value)}
          />
        </label>

        <label>
          Startstatus
          <select
            value={status}
            onChange={event =>
              setStatus(event.target.value as 'draft' | 'open')
            }
          >
            <option value="draft">Kladde</option>
            <option value="open">Åben for predictions</option>
          </select>
        </label>

        <h3>Valgmuligheder</h3>

        {options.map((option, index) => (
          <div className="optionInput" key={index}>
            <input
              required
              value={option}
              onChange={event =>
                updateOption(index, event.target.value)
              }
              placeholder={`Valgmulighed ${index + 1}`}
            />

            <button
              type="button"
              className="danger"
              disabled={options.length <= 2}
              onClick={() => removeOption(index)}
            >
              Fjern
            </button>
          </div>
        ))}

        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => setOptions(current => [...current, ''])}
          >
            + Tilføj valgmulighed
          </button>

          <button type="submit" disabled={saving}>
            {saving ? 'Gemmer…' : 'Opret dyst'}
          </button>
        </div>
      </form>

      <section>
        <h2>Eksisterende dyster</h2>

        {competitions.length === 0 && (
          <div className="card">
            Der er endnu ikke oprettet nogen dyster.
          </div>
        )}

        {competitions.map(competition => {
          const sortedOptions = [...competition.competition_options]
            .sort((a, b) => a.sort_order - b.sort_order)

          return (
            <article className="card" key={competition.id}>
              <p>
                <strong>{competition.status.toUpperCase()}</strong>
              </p>

              <h3>{competition.title}</h3>

              {competition.description && (
                <p>{competition.description}</p>
              )}

              <ul>
                {sortedOptions.map(option => (
                  <li key={option.id}>{option.label}</li>
                ))}
              </ul>

              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    changeStatus(competition.id, 'draft')
                  }
                >
                  Kladde
                </button>

                <button
                  type="button"
                  onClick={() =>
                    changeStatus(competition.id, 'open')
                  }
                >
                  Åbn
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    changeStatus(competition.id, 'closed')
                  }
                >
                  Luk
                </button>
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
