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
          <section className="card" style={{ maxWidth: 560 }}>
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
            <div className="wordmark">Evergreen Dashboard</div>
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
          <div className="wordmark">Evergreen Dashboard</div>
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
      </div>
    </main>
  )
}
