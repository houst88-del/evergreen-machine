'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error
  reset: () => void
}) {
  console.error(error)

  return (
    <div style={{ padding: 40, color: 'white', background: '#03130f', minHeight: '100vh' }}>
      <h2>Dashboard error</h2>
      <p>{error.message}</p>
      <button
        onClick={() => reset()}
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
