'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { me, signup } from '../lib/auth'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [handle, setHandle] = useState('')
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
      </div>
    </main>
  )
}
