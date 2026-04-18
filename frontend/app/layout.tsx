import './globals.css'
import type { Metadata } from 'next'
import {
  ClerkProvider,
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from '@clerk/nextjs'

export const metadata: Metadata = {
  title: 'Evergreen Machine',
  description: 'Build once. Refresh forever.',
}

function AuthHeader({ clerkEnabled }: { clerkEnabled: boolean }) {
  return (
    <header className="auth-header-shell">
      <div className="auth-header">
        <div className="wordmark">Evergreen Machine</div>
        <div className="auth-actions">
          {clerkEnabled ? (
            <>
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="btn">Sign In</button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="btn primary">Sign Up</button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </>
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

  return (
    <html lang="en">
      <body>
        {clerkEnabled ? (
          <ClerkProvider>
            <AuthHeader clerkEnabled={clerkEnabled} />
            {children}
          </ClerkProvider>
        ) : (
          <>
            <AuthHeader clerkEnabled={clerkEnabled} />
            {children}
          </>
        )}
      </body>
    </html>
  )
}
