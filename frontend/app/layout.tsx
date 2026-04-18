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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <header className="auth-header-shell">
            <div className="auth-header">
              <div className="wordmark">Evergreen Machine</div>
              <div className="auth-actions">
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
              </div>
            </div>
          </header>
          {children}
        </ClerkProvider>
      </body>
    </html>
  )
}
