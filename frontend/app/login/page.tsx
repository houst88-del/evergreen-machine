'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { login, me } from '../lib/auth'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
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
  }, [router])

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
            <div className="wordmark">Evergreen</div>
            <div className="subtle">Log in to your creator autopilot.</div>
          </div>
        </header>

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
                placeholder="••••••••"
                required
              />
            </label>

            {error ? <div style={{ color: '#fca5a5' }}>{error}</div> : null}

            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </form>

          <div style={{ marginTop: 20, display: 'flex', gap: 16 }}>
            <Link href="/signup">Need an account? Sign up</Link>
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
        </section>
      </div>
    </main>
  )
}