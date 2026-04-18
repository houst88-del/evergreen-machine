'use client'

import Link from 'next/link'
import { Show, UserButton } from '@clerk/nextjs'

export function AuthHeader({ clerkEnabled }: { clerkEnabled: boolean }) {
  if (!clerkEnabled) {
    return (
      <header className="auth-header-shell">
        <div className="auth-header">
          <div className="wordmark">Evergreen Machine</div>
          <div className="auth-actions">
            <a className="btn" href="/login">
              Sign In
            </a>
            <a className="btn primary" href="/signup">
              Sign Up
            </a>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="auth-header-shell">
      <div className="auth-header">
        <div className="wordmark">Evergreen Machine</div>
        <div className="auth-actions">
          <Show when="signed-out">
            <a className="btn" href="/login">
              Sign In
            </a>
            <a className="btn primary" href="/signup">
              Create Account
            </a>
          </Show>

          <Show when="signed-in">
            <Link className="btn" href="/dashboard">
              Dashboard
            </Link>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 44,
                minHeight: 44,
                padding: 4,
                borderRadius: 999,
                border: '1px solid rgba(52,211,153,0.14)',
                background: 'rgba(16,185,129,0.04)',
              }}
            >
              <UserButton />
            </div>
          </Show>
        </div>
      </div>
    </header>
  )
}
