import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

export async function POST() {
  try {
    const { userId } = await auth({ treatPendingAsSignedOut: false })
    const bootstrapSecret = process.env.EVERGREEN_INTERNAL_BOOTSTRAP_SECRET

    if (!userId) {
      return NextResponse.json({ detail: 'No Clerk session' }, { status: 401 })
    }

    if (!bootstrapSecret) {
      return NextResponse.json(
        { detail: 'Missing EVERGREEN_INTERNAL_BOOTSTRAP_SECRET' },
        { status: 500 },
      )
    }

    const client = await clerkClient()
    const user = await client.users.getUser(userId)
    const primaryEmail =
      user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress || ''

    if (!primaryEmail) {
      return NextResponse.json({ detail: 'No email available on Clerk user' }, { status: 400 })
    }

    const handleSeed =
      user?.username ||
      user?.firstName ||
      user?.fullName ||
      primaryEmail.split('@')[0] ||
      'creator'

    const res = await fetch(`${API_BASE}/api/auth/bootstrap-clerk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Evergreen-Internal-Secret': bootstrapSecret,
      },
      body: JSON.stringify({
        email: primaryEmail,
        handle: handleSeed,
        clerk_user_id: userId,
      }),
      cache: 'no-store',
    })

    const raw = await res.text()
    let json: unknown = null

    if (raw) {
      try {
        json = JSON.parse(raw)
      } catch {
        json = null
      }
    }

    if (json && typeof json === 'object') {
      return NextResponse.json(json, { status: res.status })
    }

    return NextResponse.json(
      {
        detail: raw || 'Bootstrap bridge returned an empty response',
      },
      { status: res.status || 500 },
    )
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : 'Bootstrap bridge failed',
      },
      { status: 500 },
    )
  }
}
