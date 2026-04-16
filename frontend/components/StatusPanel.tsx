'use client'

import { useState } from 'react'
import { connectProvider, Status, toggleAutopilot } from '../app/lib/api'

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function StatusPanel({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState(initialStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    setBusy(true)
    setError(null)
    try {
      const next = await connectProvider('x')
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggle() {
    setBusy(true)
    setError(null)
    try {
      const next = await toggleAutopilot(!status.running)
      setStatus(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update status')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <h2>Evergreen Status</h2>
        <div className="metric">{status.running ? 'Running' : 'Paused'}</div>

        <div className="row">
          <div className="label">Account</div>
          <div className="value mono">{status.account_handle}</div>
        </div>
        <div className="row">
          <div className="label">Connected</div>
          <div className="value">{status.connected ? 'Yes' : 'No'}</div>
        </div>
        <div className="row">
          <div className="label">Posts in rotation</div>
          <div className="value">{status.posts_in_rotation}</div>
        </div>
        <div className="row">
          <div className="label">Next cycle</div>
          <div className="value">{formatDate(status.next_cycle_at)}</div>
        </div>

        <div className="actions" style={{ marginTop: 18 }}>
          {!status.connected ? (
            <button className="btn primary" onClick={handleConnect} disabled={busy}>
              {busy ? 'Connecting…' : 'Connect X'}
            </button>
          ) : (
            <button className="btn primary" onClick={handleToggle} disabled={busy}>
              {busy ? 'Updating…' : status.running ? 'Pause Evergreen' : 'Turn On Evergreen'}
            </button>
          )}
        </div>

        {error ? <p className="small" style={{ marginTop: 14 }}>{error}</p> : null}
      </section>

      <section className="card">
        <h2>Last Activity</h2>
        <div className="row">
          <div className="label">Last resurfaced post</div>
          <div className="value">{status.last_post_text || 'Nothing yet'}</div>
        </div>
        <div className="row">
          <div className="label">Last action time</div>
          <div className="value">{formatDate(status.last_action_at)}</div>
        </div>
      </section>
    </div>
  )
}
