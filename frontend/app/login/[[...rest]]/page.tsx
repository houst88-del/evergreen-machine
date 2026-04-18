'use client'

import { SignIn, useAuth } from '@clerk/nextjs'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { login, me, resetAuthState } from '../../lib/auth'

export default function LoginPage() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const { isLoaded: clerkLoaded, userId } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    if (clerkEnabled) {
      const params = new URLSearchParams(window.location.search)
      if (params.get('fresh') === '1') {
        void resetAuthState({ includeClerk: true }).finally(() => {
          router.replace('/login')
        })
        return
      }

      if (!clerkLoaded) {
        setCheckingSession(true)
        return
      }

      if (!userId) {
        setCheckingSession(false)
        return
      }

      let mounted = true

      async function finalizeClerkSession() {
        try {
          const session = await me()
          if (!mounted) return

          if (session?.user) {
            router.replace('/dashboard')
            return
          }
        } finally {
          if (mounted) setCheckingSession(false)
        }
      }

      setCheckingSession(true)
      void finalizeClerkSession()

      return () => {
        mounted = false
      }
    }

    let mounted = true

    async function checkSession() {
      try {
        const session = await me()
        if (!mounted) return
        if (session?.user) {
          router.replace('/dashboard')
          return
        }
      } finally {
        if (mounted) setCheckingSession(false)
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [clerkEnabled, clerkLoaded, router, userId])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await login(email, password)
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <main className="page">
        <div className="shell">
          <section className="card" style={{ maxWidth: 560 }}>
            {clerkEnabled && userId
              ? 'Finalizing your login...'
              : 'Checking session...'}
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Evergreen Machine</div>
            <div className="subtle">Log in and continue your evergreen publishing system.</div>
          </div>
        </header>

        {clerkEnabled ? (
          <section className="card auth-card" style={{ maxWidth: 560 }}>
            <h2>Welcome back</h2>
            <div className="small" style={{ marginTop: 10, marginBottom: 18 }}>
              Continue with Google, Apple, or email.
            </div>
            <SignIn
              routing="path"
              path="/login"
              signUpUrl="/signup"
              forceRedirectUrl="/dashboard"
              fallbackRedirectUrl="/dashboard"
              appearance={{
                elements: {
                  card: { background: 'transparent', boxShadow: 'none', border: 'none' },
                  rootBox: { width: '100%' },
                },
              }}
            />
          </section>
        ) : (
          <section className="card" style={{ maxWidth: 560 }}>
            <h2>Log In</h2>

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14, marginTop: 20 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Email</span>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@evergreen.com"
                  required
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span>Password</span>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  required
                />
              </label>

              {error ? <div style={{ color: '#fca5a5' }}>{error}</div> : null}

              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? 'Logging in...' : 'Log In'}
              </button>
            </form>

            <div style={{ marginTop: 20 }}>
              <Link href="/signup">Create an account</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
