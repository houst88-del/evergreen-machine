'use client'

import { useEffect } from 'react'

const CHUNK_RELOAD_KEY = 'evergreen-chunk-reload-once'

function isChunkLoadError(error: Error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('loading chunk') ||
    message.includes('chunkloaderror') ||
    message.includes('/_next/static/chunks/')
  )
}

export default function Error({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  console.error(error)

  useEffect(() => {
    if (typeof window === 'undefined' || !isChunkLoadError(error)) return
    if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1') return

    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
    window.location.reload()
  }, [error])

  return (
    <div style={{ padding: 40, color: 'white', background: '#03130f', minHeight: '100vh' }}>
      <h2>Dashboard error</h2>
      <p>{error.message}</p>
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
          marginTop: 20,
          padding: '8px 16px',
          borderRadius: 999,
          background: '#0b1f18',
          color: 'white',
          border: '1px solid rgba(180,255,210,0.2)',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}
