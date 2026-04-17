'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { me, logout } from '../lib/auth'

export default function DashboardPage() {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkSession() {
      const data = await me()
      setSession(data)
      setLoading(false)
    }

    checkSession()
  }, [])

  if (loading) {
    return (
      <main className="page">
        <div className="shell">
          <section className="card">
            Checking session...
          </section>
        </div>
      </main>
    )
  }

  if (!session?.user) {
    return (
      <main className="page">
        <div className="shell">
          <header className="header">
            <div className="wordmark">Evergreen</div>
          </header>

          <section className="card">
            <p>No active login found.</p>
            <Link className="btn primary" href="/login">
              Go to Login
            </Link>
          </section>
        </div>
      </main>
    )
  }

  const user = session.user

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div className="wordmark">Evergreen Mission Control</div>

          <button
            className="btn"
            onClick={() => {
              logout()
              window.location.href = '/login'
            }}
          >
            Logout
          </button>
        </header>

        <section className="card">
          <h2>Welcome back</h2>
          <p>Email: {user.email}</p>
          <p>Handle: {user.handle}</p>
        </section>

        <section className="card">
          <h3>Control Center</h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: 16,
              marginTop: 20,
            }}
          >
            <Link className="btn primary" href="/galaxy">
              🌌 Open Galaxy
            </Link>

            <Link className="btn" href="/posts">
              🪐 Post Manager
            </Link>

            <Link className="btn" href="/analytics">
              📈 Analytics
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
