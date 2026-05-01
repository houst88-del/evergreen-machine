import './globals.css'
import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { AuthHeader } from './components/auth-header'
import { CanonicalHostGuard } from './components/canonical-host-guard'
import { getPublicAppBase } from './lib/runtime'

export const metadata: Metadata = {
  title: 'Evergreen Machine',
  description: 'Build once. Refresh forever.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkPublishableKey = String(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim()
  const clerkEnabled =
    clerkPublishableKey.startsWith('pk_') && !clerkPublishableKey.includes('replace_me')
  const appOrigin = getPublicAppBase()

  return (
    <html lang="en">
      <body>
        <CanonicalHostGuard appOrigin={appOrigin} />
        {clerkEnabled ? (
          <ClerkProvider
            afterSignOutUrl={`${appOrigin}/login`}
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
