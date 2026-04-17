'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { login } from '../lib/auth'

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Evergreen</div>
            <div className="subtle">Log in and continue your mission control.</div>
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
                required
              />
            </label>

            {error && <div style={{ color: '#fca5a5' }}>{error}</div>}

            <button className="btn primary" disabled={loading}>
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </form>

          <div style={{ marginTop: 20 }}>
            <Link href="/signup">Create an account</Link>
          </div>
        </section>
      </div>
    </main>
  )
}