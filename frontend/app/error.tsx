'use client'

import { useEffect } from 'react'

const CHUNK_RELOAD_KEY = 'evergreen-chunk-reload-once'

function isChunkLoadError(error: Error & { digest?: string }) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('loading chunk') ||
    message.includes('chunkloaderror') ||
    message.includes('/_next/static/chunks/')
  )
}

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (typeof window === 'undefined' || !isChunkLoadError(error)) return
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return

    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
    window.location.reload()
  }, [error])

  return (
    <main style={{ padding: 24, color: 'white', background: '#07110b', minHeight: '100vh' }}>
      <h1>Something went wrong</h1>
      <p>{error.message || 'Unknown error'}</p>
      <button
        onClick={() => {
          if (typeof window !== 'undefined' && isChunkLoadError(error)) {
            window.sessionStorage.removeItem(CHUNK_RELOAD_KEY)
            window.location.reload()
            return
          }
          reset()
        }}
        style={{
          marginTop: 12,
          padding: '10px 14px',
          borderRadius: 12,
          border: '1px solid rgba(156,227,169,0.18)',
          background: '#9ce3a9',
          color: '#08110a',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </main>
  )
}
