import './globals.css'
import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { AuthHeader } from './components/auth-header'

export const metadata: Metadata = {
  title: 'Evergreen Machine',
  description: 'Build once. Refresh forever.',
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
