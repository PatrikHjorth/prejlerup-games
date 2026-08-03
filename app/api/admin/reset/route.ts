import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY!

function createPublicClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function createAdminClient() {
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function requireAdmin(request: NextRequest) {
  const authorization = request.headers.get('authorization')

  if (!authorization?.startsWith('Bearer ')) {
    return {
      error: NextResponse.json(
        { error: 'Du skal være logget ind.' },
        { status: 401 }
      ),
    }
  }

  const accessToken = authorization.slice('Bearer '.length)
  const publicClient = createPublicClient()

  const {
    data: { user },
    error: userError,
  } = await publicClient.auth.getUser(accessToken)

  if (userError || !user) {
    return {
      error: NextResponse.json(
        { error: 'Din session er ugyldig.' },
        { status: 401 }
      ),
    }
  }

  const adminClient = createAdminClient()

  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (profileError || !profile?.is_admin) {
    return {
      error: NextResponse.json(
        { error: 'Du har ikke administratoradgang.' },
        { status: 403 }
      ),
    }
  }

  return { adminClient, currentUser: user }
}

export async function POST(request: NextRequest) {
  const authorization = await requireAdmin(request)

  if ('error' in authorization) {
    return authorization.error
  }

  const body = await request.json()
  const confirmation = String(body.confirmation ?? '')
  const keepPlayers = Boolean(body.keepPlayers)
  const startCredits = Number(body.startCredits ?? 1000)

  if (confirmation !== 'RESET') {
    return NextResponse.json(
      { error: 'Skriv RESET for at bekræfte.' },
      { status: 400 }
    )
  }

  if (
    !Number.isFinite(startCredits) ||
    startCredits < 0 ||
    startCredits > 100000000
  ) {
    return NextResponse.json(
      { error: 'Startcredits skal være mellem 0 og 100.000.000.' },
      { status: 400 }
    )
  }

  const adminClient = authorization.adminClient
  const roundedCredits = Math.round(startCredits)

  for (const table of [
    'predictions',
    'competition_options',
    'competitions',
    'notifications',
    'credit_transactions',
  ]) {
    const { error } = await adminClient
      .from(table)
      .delete()
      .not('id', 'is', null)

    if (error) {
      return NextResponse.json(
        { error: `Reset stoppede: ${error.message}` },
        { status: 400 }
      )
    }
  }

  if (keepPlayers) {
    const { data: players, error: playersError } = await adminClient
      .from('profiles')
      .select('id')
      .eq('is_admin', false)

    if (playersError) {
      return NextResponse.json(
        { error: playersError.message },
        { status: 400 }
      )
    }

    const { error: resetError } = await adminClient
      .from('profiles')
      .update({ credits: roundedCredits })
      .eq('is_admin', false)

    if (resetError) {
      return NextResponse.json(
        { error: resetError.message },
        { status: 400 }
      )
    }

    const historyRows = (players ?? []).map(player => ({
      user_id: player.id,
      amount: roundedCredits,
      balance_after: roundedCredits,
      reason: 'game_reset',
      description: 'Nyt spil startet af Admin',
      created_by: authorization.currentUser.id,
    }))

    if (historyRows.length > 0) {
      const { error: historyError } = await adminClient
        .from('credit_transactions')
        .insert(historyRows)

      if (historyError) {
        return NextResponse.json(
          { error: historyError.message },
          { status: 400 }
        )
      }
    }

    return NextResponse.json({
      success: true,
      mode: 'keep_players',
      playersReset: players?.length ?? 0,
      startCredits: roundedCredits,
    })
  }

  const { data: playerProfiles, error: profilesError } = await adminClient
    .from('profiles')
    .select('id')
    .eq('is_admin', false)

  if (profilesError) {
    return NextResponse.json(
      { error: profilesError.message },
      { status: 400 }
    )
  }

  const failedDeletions: string[] = []

  for (const player of playerProfiles ?? []) {
    const { error } =
      await adminClient.auth.admin.deleteUser(player.id)

    if (error) failedDeletions.push(player.id)
  }

  if (failedDeletions.length > 0) {
    return NextResponse.json(
      {
        error:
          `${failedDeletions.length} spiller(e) kunne ikke slettes. ` +
          'De øvrige testdata er nulstillet.',
      },
      { status: 400 }
    )
  }

  return NextResponse.json({
    success: true,
    mode: 'admin_only',
    playersDeleted: playerProfiles?.length ?? 0,
  })
}
