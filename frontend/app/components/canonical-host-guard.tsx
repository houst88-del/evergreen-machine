'use client'

import { useEffect } from 'react'

type CanonicalHostGuardProps = {
  appOrigin: string
}

export function CanonicalHostGuard({ appOrigin }: CanonicalHostGuardProps) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const canonical = String(appOrigin || '').trim()
    if (!canonical) return

    let canonicalUrl: URL
    try {
      canonicalUrl = new URL(canonical)
    } catch {
      return
    }

    const current = window.location
    const currentHost = current.hostname.toLowerCase()
    const canonicalHost = canonicalUrl.hostname.toLowerCase()

    if (currentHost === canonicalHost) return
    if (currentHost === 'localhost' || currentHost === '127.0.0.1') return

    const nextUrl = `${canonicalUrl.origin}${current.pathname}${current.search}${current.hash}`
    window.location.replace(nextUrl)
  }, [appOrigin])

  return null
}
