import './globals.css'
import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'

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
          <a className="btn" href="/login">
            Sign In
          </a>
          <a className="btn primary" href="/signup">
            {clerkEnabled ? 'Create Account' : 'Sign Up'}
          </a>
        </div>
      </div>
    </header>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || 'https://www.evergreenmachine.ai'

  return (
    <html lang="en">
      <body>
        {clerkEnabled ? (
          <ClerkProvider
            signInUrl="/login"
            signUpUrl="/signup"
            signInForceRedirectUrl={`${appOrigin}/dashboard`}
            signUpForceRedirectUrl={`${appOrigin}/dashboard`}
            signInFallbackRedirectUrl={`${appOrigin}/dashboard`}
            signUpFallbackRedirectUrl={`${appOrigin}/dashboard`}
          >
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
