'use client'

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main style={{ padding: 24, color: 'white', background: '#07110b', minHeight: '100vh' }}>
      <h1>Something went wrong</h1>
      <p>{error.message || 'Unknown error'}</p>
      <button
        onClick={() => reset()}
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

