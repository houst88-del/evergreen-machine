import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Evergreen',
  description: 'Set it and forget it.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
