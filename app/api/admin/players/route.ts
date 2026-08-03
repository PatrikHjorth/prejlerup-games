import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
const secretKey = process.env.SUPABASE_SECRET_KEY!

function createPublicClient() {
  return createClient(supabaseUrl, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

function createAdminClient() {
  return createClient(supabaseUrl, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

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

  return `${username}@players.prejlerup.dk`
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

  return {
    adminClient,
    currentUser: user,
  }
}

export async function GET(request: NextRequest) {
  const authorization = await requireAdmin(request)

  if ('error' in authorization) {
    return authorization.error
  }

  const historyUserId =
    request.nextUrl.searchParams.get('historyUserId')

  if (historyUserId) {
    const { data, error } = await authorization.adminClient
      .from('credit_transactions')
      .select(`
        id,
        amount,
        balance_after,
        reason,
        description,
        created_at
      `)
      .eq('user_id', historyUserId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ history: data ?? [] })
  }

  const { data, error } = await authorization.adminClient
    .from('profiles')
    .select('id, display_name, credits, is_admin, created_at')
    .order('display_name')

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json({ players: data ?? [] })
}

export async function POST(request: NextRequest) {
  const authorization = await requireAdmin(request)

  if ('error' in authorization) {
    return authorization.error
  }

  const body = await request.json()
  const name = String(body.name ?? '').trim()
  const password = String(body.password ?? '')
  const credits = Number(body.credits ?? 1000)

  if (name.length < 2) {
    return NextResponse.json(
      { error: 'Navnet skal være på mindst 2 tegn.' },
      { status: 400 }
    )
  }

  if (name.toLowerCase() === 'admin') {
    return NextResponse.json(
      { error: 'Navnet Admin er reserveret.' },
      { status: 400 }
    )
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Koden skal være på mindst 6 tegn.' },
      { status: 400 }
    )
  }

  if (!Number.isFinite(credits) || credits < 0) {
    return NextResponse.json(
      { error: 'Startcredits skal være 0 eller mere.' },
      { status: 400 }
    )
  }

  const email = usernameToEmail(name)

  const { data, error } =
    await authorization.adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: name,
      },
    })

  if (error || !data.user) {
    return NextResponse.json(
      {
        error:
          error?.message ??
          'Spilleren kunne ikke oprettes.',
      },
      { status: 400 }
    )
  }

  const roundedCredits = Math.round(credits)

  const { error: profileError } = await authorization.adminClient
    .from('profiles')
    .upsert({
      id: data.user.id,
      display_name: name,
      credits: roundedCredits,
      is_admin: false,
    })

  if (profileError) {
    await authorization.adminClient.auth.admin.deleteUser(
      data.user.id
    )

    return NextResponse.json(
      { error: profileError.message },
      { status: 400 }
    )
  }

  const { error: historyError } = await authorization.adminClient
    .from('credit_transactions')
    .insert({
      user_id: data.user.id,
      amount: roundedCredits,
      balance_after: roundedCredits,
      reason: 'player_created',
      description: 'Spiller oprettet',
      created_by: authorization.currentUser.id,
    })

  if (historyError) {
    return NextResponse.json(
      { error: historyError.message },
      { status: 400 }
    )
  }

  return NextResponse.json({
    success: true,
    player: {
      id: data.user.id,
      display_name: name,
      credits: roundedCredits,
      is_admin: false,
    },
  })
}

export async function PATCH(request: NextRequest) {
  const authorization = await requireAdmin(request)

  if ('error' in authorization) {
    return authorization.error
  }

  const body = await request.json()
  const userId = String(body.userId ?? '')
  const action = String(body.action ?? '')

  if (!userId) {
    return NextResponse.json(
      { error: 'Spilleren mangler.' },
      { status: 400 }
    )
  }

  if (action === 'password') {
    const password = String(body.password ?? '')

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Den nye kode skal være på mindst 6 tegn.' },
        { status: 400 }
      )
    }

    const { error } =
      await authorization.adminClient.auth.admin.updateUserById(
        userId,
        { password }
      )

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  }

  if (action === 'credits') {
    const amount = Number(body.amount)

    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json(
        { error: 'Skriv et gyldigt antal credits.' },
        { status: 400 }
      )
    }

    const { data: profile, error: profileError } =
      await authorization.adminClient
        .from('profiles')
        .select('credits')
        .eq('id', userId)
        .single()

    if (profileError || !profile) {
      return NextResponse.json(
        {
          error:
            profileError?.message ??
            'Spilleren blev ikke fundet.',
        },
        { status: 404 }
      )
    }

    const roundedAmount = Math.round(amount)
    const newCredits = Math.max(
      0,
      Number(profile.credits) + roundedAmount
    )

    const actualAmount = newCredits - Number(profile.credits)

    const { error } = await authorization.adminClient
      .from('profiles')
      .update({ credits: newCredits })
      .eq('id', userId)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    const { error: historyError } = await authorization.adminClient
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: actualAmount,
        balance_after: newCredits,
        reason: 'admin_adjustment',
        description:
          actualAmount >= 0
            ? 'Credits tilføjet af Admin'
            : 'Credits fratrukket af Admin',
        created_by: authorization.currentUser.id,
      })

    if (historyError) {
      return NextResponse.json(
        { error: historyError.message },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      credits: newCredits,
    })
  }

  return NextResponse.json(
    { error: 'Ukendt handling.' },
    { status: 400 }
  )
}

export async function DELETE(request: NextRequest) {
  const authorization = await requireAdmin(request)

  if ('error' in authorization) {
    return authorization.error
  }

  const userId = request.nextUrl.searchParams.get('userId')

  if (!userId) {
    return NextResponse.json(
      { error: 'Spilleren mangler.' },
      { status: 400 }
    )
  }

  if (userId === authorization.currentUser.id) {
    return NextResponse.json(
      { error: 'Du kan ikke slette din egen adminkonto.' },
      { status: 400 }
    )
  }

  const { data: targetProfile } =
    await authorization.adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single()

  if (targetProfile?.is_admin) {
    return NextResponse.json(
      { error: 'En administratorkonto kan ikke slettes her.' },
      { status: 400 }
    )
  }

  const { error } =
    await authorization.adminClient.auth.admin.deleteUser(userId)

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json({ success: true })
}
