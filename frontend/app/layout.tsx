import './globals.css'
import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'

export const metadata: Metadata = {
  title: 'Evergreen Machine',
  description: 'Build once. Refresh forever.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

  return (
    <html lang="en">
      <body>{clerkEnabled ? <ClerkProvider>{children}</ClerkProvider> : children}</body>
    </html>
  )
}
