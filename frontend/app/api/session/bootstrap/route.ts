import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out`))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

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
    let user: Awaited<ReturnType<typeof client.users.getUser>> | null = null
    try {
      user = await withTimeout(client.users.getUser(userId), 4000, 'Clerk user lookup')
    } catch {
      return NextResponse.json({ detail: 'No Clerk session' }, { status: 401 })
    }
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

    const payload = {
      email: primaryEmail,
      handle: handleSeed,
      clerk_user_id: userId,
    }

    let lastStatus = 500
    let lastRaw = ''
    let lastJson: unknown = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await fetchWithTimeout(`${API_BASE}/api/auth/bootstrap-clerk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Evergreen-Internal-Secret': bootstrapSecret,
        },
        body: JSON.stringify(payload),
        cache: 'no-store',
      }, 8000)

      const raw = await res.text()
      let json: unknown = null

      if (raw) {
        try {
          json = JSON.parse(raw)
        } catch {
          json = null
        }
      }

      if (res.ok) {
        if (json && typeof json === 'object') {
          return NextResponse.json(json, { status: res.status })
        }

        return NextResponse.json(
          {
            detail: raw || 'Bootstrap bridge returned an empty response',
          },
          { status: res.status || 500 },
        )
      }

      lastStatus = res.status || 500
      lastRaw = raw
      lastJson = json

      if (![502, 503, 504].includes(lastStatus) || attempt === 2) {
        break
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }

    if (lastJson && typeof lastJson === 'object') {
      return NextResponse.json(lastJson, { status: lastStatus })
    }

    return NextResponse.json(
      {
        detail:
          lastRaw ||
          `Bootstrap bridge failed after retrying the backend handoff (${lastStatus})`,
      },
      { status: lastStatus || 500 },
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
