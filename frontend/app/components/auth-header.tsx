'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import { getStoredUser, type AuthUser } from '../lib/auth'

export function AuthHeader({ clerkEnabled }: { clerkEnabled: boolean }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [evergreenUser, setEvergreenUser] = useState<AuthUser | null>(null)
  const isAppSurface = pathname === '/dashboard' || pathname === '/galaxy'
  const isSignedIn = Boolean(evergreenUser)

  useEffect(() => {
    if (!isAppSurface) {
      setCollapsed(false)
      return
    }

    const onScroll = () => {
      setCollapsed(window.scrollY > 120)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [isAppSurface])

  useEffect(() => {
    const syncUser = () => {
      setEvergreenUser(getStoredUser())
    }

    syncUser()
    window.addEventListener('storage', syncUser)
    window.addEventListener('evergreen-auth-changed', syncUser)

    return () => {
      window.removeEventListener('storage', syncUser)
      window.removeEventListener('evergreen-auth-changed', syncUser)
    }
  }, [])

  if (!clerkEnabled) {
    return (
      <header className={`auth-header-shell${collapsed ? ' is-collapsed' : ''}`}>
        <div className="auth-header">
          <div className="wordmark">Evergreen Machine</div>
          <div className="auth-actions">
            {isSignedIn ? (
              <Link className="btn" href="/dashboard">
                Dashboard
              </Link>
            ) : (
              <>
                <a className="btn" href="/login">
                  Sign In
                </a>
                <a className="btn primary" href="/signup">
                  Sign Up
                </a>
              </>
            )}
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className={`auth-header-shell${collapsed ? ' is-collapsed' : ''}`}>
      <div className="auth-header">
        <div className="wordmark">Evergreen Machine</div>
        <div className="auth-actions">
          {!isSignedIn ? (
            <a className="btn" href="/login">
              Sign In
            </a>
          ) : null}
          {!isSignedIn ? (
            <a className="btn primary" href="/signup">
              Create Account
            </a>
          ) : null}

          {isSignedIn ? (
            <Link className="btn" href="/dashboard">
              Dashboard
            </Link>
          ) : null}

          {clerkEnabled && isSignedIn ? (
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
              <UserButton userProfileMode="navigation" userProfileUrl="/account" />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
