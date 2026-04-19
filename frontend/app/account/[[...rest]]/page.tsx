'use client'

import { UserProfile } from '@clerk/nextjs'

export default function AccountPage() {
  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Evergreen Machine</div>
            <div className="subtle">Manage your account, profile, and security settings.</div>
          </div>
        </header>

        <section className="card auth-card" style={{ maxWidth: 900 }}>
          <UserProfile
            routing="path"
            path="/account"
            appearance={{
              elements: {
                card: { background: 'transparent', boxShadow: 'none', border: 'none' },
                rootBox: { width: '100%' },
              },
            }}
          />
        </section>
      </div>
    </main>
  )
}
