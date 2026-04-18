'use client'

import { SignUp } from '@clerk/nextjs'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { me, resetAuthState, signup } from '../../lib/auth'

export default function SignupPage() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    if (clerkEnabled) {
      const params = new URLSearchParams(window.location.search)
      if (params.get('fresh') === '1') {
        void resetAuthState({ includeClerk: true }).finally(() => {
          setCheckingSession(false)
        })
        return
      }

      setCheckingSession(false)
      return
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
  }, [clerkEnabled, router])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await signup(email, password, handle)
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <main className="page">
        <div className="shell">
          <section className="card" style={{ maxWidth: 560 }}>
            Checking session...
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
            <div className="subtle">Create your account and start your evergreen engine.</div>
          </div>
        </header>

        {clerkEnabled ? (
          <section className="card auth-card" style={{ maxWidth: 560 }}>
            <h2>Create your account</h2>
            <div className="small" style={{ marginTop: 10, marginBottom: 18 }}>
              Sign up with Google, Apple, or email and we&apos;ll lock in your account flow from there.
            </div>
            <SignUp
              routing="path"
              path="/signup"
              signInUrl="/login"
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
            <h2>Sign Up</h2>

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
                <span>X Handle</span>
                <input
                  className="input"
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  placeholder="@yourhandle"
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
                  placeholder="At least 8 characters"
                  required
                />
              </label>

              {error ? <div style={{ color: '#fca5a5' }}>{error}</div> : null}

              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </form>

            <div style={{ marginTop: 20 }}>
              <Link href="/login">Already have an account? Log in</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
