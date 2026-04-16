'use client'

import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })

    setSent(true)
  }

  return (
    <main className="page">
      <div className="shell">
        <section className="card" style={{ maxWidth: 560 }}>
          <h2>Reset your password</h2>

          {sent ? (
            <p>Check your email for a password reset link.</p>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
              <input
                className="input"
                type="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <button className="btn primary">
                Send reset link
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}