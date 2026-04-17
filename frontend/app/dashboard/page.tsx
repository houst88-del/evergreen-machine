'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getToken, logout, me } from '../lib/auth'

type SystemStatus = {
  backend?: { ok?: boolean }
  worker?: {
    ok?: boolean
    heartbeat?: {
      status?: string
      timestamp?: string
      queued?: number
      processed?: number
      synced_accounts?: number
      repaired_jobs?: number
      startup_burst_done?: boolean
      error?: string | null
      poll_seconds?: number
    }
  }
  frontend_hint?: string
}

type ConnectedAccount = {
  id: number
  provider: string
  handle: string
  connection_status?: string
}

type AccountStatus = {
  connected_account_id?: number | null
  running?: boolean
  connected?: boolean
  provider?: string
  account_handle?: string
  posts_in_rotation?: number
  last_post_text?: string | null
  last_action_at?: string | null
  next_cycle_at?: string | null
  metadata?: Record<string, unknown>
}

type JobItem = {
  id?: string
  job_id?: string
  type?: string
  state?: string
  status?: string
  created_at?: string
  updated_at?: string
  message?: string
  result?: string
  connected_account_id?: number
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

function fmtWhen(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function relativeWhen(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'

  const diffMs = d.getTime() - Date.now()
  const mins = Math.round(Math.abs(diffMs) / 60000)

  if (mins < 1) return diffMs >= 0 ? 'now' : 'just now'
  if (mins < 60) return diffMs >= 0 ? `in ${mins}m` : `${mins}m ago`

  const hrs = Math.round(mins / 60)
  if (hrs < 24) return diffMs >= 0 ? `in ${hrs}h` : `${hrs}h ago`

  const days = Math.round(hrs / 24)
  return diffMs >= 0 ? `in ${days}d` : `${days}d ago`
}

function cycleLabel(value?: string | null) {
  if (!value) return 'No cycle scheduled'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'No cycle scheduled'

  const diffMs = d.getTime() - Date.now()
  if (diffMs < -5 * 60 * 1000) return 'Overdue'

  return relativeWhen(value)
}

function providerLabel(provider?: string) {
  const p = String(provider || '').toLowerCase()
  if (p === 'x' || p === 'twitter') return 'X'
  if (p === 'bluesky' || p === 'bsky') return 'Bluesky'
  return provider || 'Provider'
}

function statusPillStyle(kind: 'good' | 'warn' | 'neutral' | 'bad'): React.CSSProperties {
  if (kind === 'good') {
    return {
      border: '1px solid rgba(110,231,183,0.28)',
      background: 'rgba(16,185,129,0.10)',
      color: '#d1fae5',
    }
  }

  if (kind === 'warn') {
    return {
      border: '1px solid rgba(253,224,71,0.28)',
      background: 'rgba(250,204,21,0.10)',
      color: '#fef9c3',
    }
  }

  if (kind === 'bad') {
    return {
      border: '1px solid rgba(248,113,113,0.28)',
      background: 'rgba(239,68,68,0.10)',
      color: '#fecaca',
    }
  }

  return {
    border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(236,253,245,0.88)',
  }
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const token = getToken()
  const headers = new Headers(init.headers || {})

  if (!headers.has('Content-Type') && init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  })
}

export default function DashboardPage() {
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [statusMap, setStatusMap] = useState<Record<number, AccountStatus>>({})
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      try {
        const data = await me()
        if (!mounted) return
        setSession(data)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [])

  async function refreshMissionControlNow() {
    if (!session?.user) return

    try {
      const userId = session.user.id || 1

      const [systemRes, accountsRes, jobsRes] = await Promise.all([
        apiFetch('/api/system-status'),
        apiFetch(`/api/connected-accounts?user_id=${userId}`),
        apiFetch(`/api/jobs?user_id=${userId}`),
      ])

      const systemJson = await systemRes.json()
      const accountsJson = await accountsRes.json()
      const jobsJson = await jobsRes.json()

      const nextAccounts = Array.isArray(accountsJson.accounts)
        ? accountsJson.accounts
        : Array.isArray(accountsJson)
          ? accountsJson
          : []

      const nextStatusMap: Record<number, AccountStatus> = {}
      await Promise.all(
        nextAccounts.map(async (account: ConnectedAccount) => {
          try {
            const res = await apiFetch(
              `/api/status?user_id=${userId}&connected_account_id=${account.id}`
            )
            if (!res.ok) return
            nextStatusMap[account.id] = await res.json()
          } catch {
            // ignore account-specific failures
          }
        })
      )

      const nextJobs = Array.isArray(jobsJson.jobs)
        ? jobsJson.jobs
        : Array.isArray(jobsJson)
          ? jobsJson
          : []

      setSystem(systemJson)
      setAccounts(nextAccounts)
      setStatusMap(nextStatusMap)
      setJobs(nextJobs)
      setError('')
    } catch {
      // ignore silent refresh failures
    }
  }

  function scheduleFollowupRefreshes() {
    window.setTimeout(refreshMissionControlNow, 1200)
    window.setTimeout(refreshMissionControlNow, 4000)
    window.setTimeout(refreshMissionControlNow, 8000)
  }

  useEffect(() => {
    if (!session?.user) return

    let mounted = true

    async function loadMissionControl() {
      try {
        const userId = session.user.id || 1

        const [systemRes, accountsRes, jobsRes] = await Promise.all([
          apiFetch('/api/system-status'),
          apiFetch(`/api/connected-accounts?user_id=${userId}`),
          apiFetch(`/api/jobs?user_id=${userId}`),
        ])

        const systemJson = await systemRes.json()
        const accountsJson = await accountsRes.json()
        const jobsJson = await jobsRes.json()

        const nextAccounts = Array.isArray(accountsJson.accounts)
          ? accountsJson.accounts
          : Array.isArray(accountsJson)
            ? accountsJson
            : []

        const nextStatusMap: Record<number, AccountStatus> = {}
        await Promise.all(
          nextAccounts.map(async (account: ConnectedAccount) => {
            try {
              const res = await apiFetch(
                `/api/status?user_id=${userId}&connected_account_id=${account.id}`
              )
              if (!res.ok) return
              nextStatusMap[account.id] = await res.json()
            } catch {
              // ignore account-specific failures
            }
          })
        )

        const nextJobs = Array.isArray(jobsJson.jobs)
          ? jobsJson.jobs
          : Array.isArray(jobsJson)
            ? jobsJson
            : []

        if (!mounted) return

        setSystem(systemJson)
        setAccounts(nextAccounts)
        setStatusMap(nextStatusMap)
        setJobs(nextJobs)
        setError('')
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Could not load mission control')
      }
    }

    loadMissionControl()
    const id = window.setInterval(loadMissionControl, 6000)

    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [session])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('provider') === 'x' && params.get('connected') === '1') {
      setActionMessage('X account connected.')
      refreshMissionControlNow()
      scheduleFollowupRefreshes()
      params.delete('provider')
      params.delete('connected')
      const next = params.toString()
      const url = next ? `${window.location.pathname}?${next}` : window.location.pathname
      window.history.replaceState({}, '', url)
    }

    if (params.get('provider') === 'x' && params.get('error')) {
      setError(params.get('error') || 'X OAuth failed.')
      params.delete('provider')
      params.delete('error')
      const next = params.toString()
      const url = next ? `${window.location.pathname}?${next}` : window.location.pathname
      window.history.replaceState({}, '', url)
    }
  }, [session])

  const summary = useMemo(() => {
    const heartbeat = system?.worker?.heartbeat || {}
    const accountStatuses = Object.values(statusMap)

    const postsInRotation = accountStatuses.reduce(
      (sum, item) => sum + (item.posts_in_rotation || 0),
      0
    )

    const connectedCount = accountStatuses.filter((item) => item.connected).length

    const nextCycleCandidates = accountStatuses
      .map((item) => item.next_cycle_at)
      .filter(Boolean) as string[]

    const nextCycle =
      nextCycleCandidates.length > 0
        ? nextCycleCandidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
        : null

    return {
      backendOnline: !!system?.backend?.ok,
      workerState: heartbeat.status || (system?.worker?.ok ? 'running' : 'offline'),
      queued: heartbeat.queued ?? 0,
      processed: heartbeat.processed ?? 0,
      syncedAccounts: heartbeat.synced_accounts ?? accounts.length,
      repairedJobs: heartbeat.repaired_jobs ?? 0,
      pollSeconds: heartbeat.poll_seconds ?? 0,
      heartbeatAt: heartbeat.timestamp ?? null,
      workerError: heartbeat.error || null,
      postsInRotation,
      connectedCount,
      nextCycle,
    }
  }, [system, statusMap, accounts.length])

  async function handleRefreshNow(connectedAccountId?: number, accountHandle?: string) {
    if (!session?.user) return
    const busyKey = connectedAccountId ? `refresh-${connectedAccountId}` : 'refresh-global'
    setBusyAction(busyKey)
    setActionMessage('')
    setError('')

    try {
      const query = connectedAccountId
        ? `/api/jobs/refresh-now?user_id=${session.user.id || 1}&connected_account_id=${connectedAccountId}`
        : `/api/jobs/refresh-now?user_id=${session.user.id || 1}`

      const res = await apiFetch(query, {
        method: 'POST',
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Could not queue refresh')
      }

      setActionMessage(
        connectedAccountId
          ? `Refresh job queued for ${accountHandle || 'account'}.`
          : 'Refresh job queued.'
      )
      scheduleFollowupRefreshes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue refresh')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRunAnalytics(connectedAccountId?: number, accountHandle?: string) {
    if (!session?.user) return
    const busyKey = connectedAccountId ? `analytics-${connectedAccountId}` : 'analytics-global'
    setBusyAction(busyKey)
    setActionMessage('')
    setError('')

    try {
      const query = connectedAccountId
        ? `/api/jobs/run-analytics?user_id=${session.user.id || 1}&connected_account_id=${connectedAccountId}`
        : `/api/jobs/run-analytics?user_id=${session.user.id || 1}`

      const res = await apiFetch(query, {
        method: 'POST',
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Could not queue analytics')
      }

      setActionMessage(
        connectedAccountId
          ? `Analytics job queued for ${accountHandle || 'account'}.`
          : 'Analytics job queued.'
      )
      scheduleFollowupRefreshes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue analytics')
    } finally {
      setBusyAction(null)
    }
  }

  function handleConnectXOAuth() {
    setActionMessage('')
    setError('')
    setBusyAction('connect-x')
    window.location.assign(`${API_BASE}/api/providers/x/start`)
  }

  async function handleConnectBluesky() {
    if (!session?.user) return
    const handle = window.prompt('Enter your Bluesky handle', '')
    if (!handle) return
    const appPassword = window.prompt('Enter your Bluesky app password', '')
    if (!appPassword) return

    setActionMessage('')
    setError('')
    setBusyAction('connect-bluesky')

    try {
      const res = await apiFetch(`/api/providers/connect?user_id=${session.user.id || 1}`, {
        method: 'POST',
        body: JSON.stringify({
          provider: 'bluesky',
          handle,
          app_password: appPassword,
        }),
      })

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Could not connect Bluesky')
      }

      setActionMessage(`Connected Bluesky for ${json.account_handle || handle}.`)
      await refreshMissionControlNow()
      window.setTimeout(refreshMissionControlNow, 2000)
      window.setTimeout(refreshMissionControlNow, 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect Bluesky')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDisconnectAccount(accountId: number) {
    if (!session?.user) return
    setActionMessage('')
    setError('')

    try {
      const res = await apiFetch(
        `/api/providers/disconnect?user_id=${session.user.id || 1}&connected_account_id=${accountId}`,
        {
          method: 'POST',
        }
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Could not disconnect account')
      }

      setActionMessage(`Disconnected ${json.account_handle || 'account'}.`)
      await refreshMissionControlNow()
      window.setTimeout(refreshMissionControlNow, 1500)
      window.setTimeout(refreshMissionControlNow, 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect account')
    }
  }

  async function handleToggleAutopilot(accountId: number, enabled: boolean) {
    if (!session?.user) return
    setActionMessage('')
    setError('')

    try {
      const res = await apiFetch(
        `/api/status/toggle?user_id=${session.user.id || 1}&connected_account_id=${accountId}`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        }
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json.detail || json.message || 'Could not update autopilot')
      }

      setActionMessage(
        `${enabled ? 'Started' : 'Paused'} autopilot for ${json.account_handle || 'account'}.`
      )
      await refreshMissionControlNow()
      window.setTimeout(refreshMissionControlNow, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update autopilot')
    }
  }

  if (loading) {
    return (
      <main className="page">
        <div className="shell">
          <section className="card">Checking session...</section>
        </div>
      </main>
    )
  }

  if (!session?.user) {
    return (
      <main className="page">
        <div className="shell">
          <header className="header">
            <div className="wordmark">Evergreen</div>
          </header>

          <section className="card">
            <p>No active login found.</p>
            <Link className="btn primary" href="/login">
              Go to Login
            </Link>
          </section>
        </div>
      </main>
    )
  }

  const user = session.user
  const recentJobs = jobs.slice(0, 5)

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Evergreen Mission Control</div>
            <div className="subtle">Live command deck for your resurfacing engine.</div>
          </div>

          <button
            className="btn"
            onClick={() => {
              logout()
              window.location.href = '/login'
            }}
          >
            Logout
          </button>
        </header>

        {error ? (
          <section className="card" style={{ borderColor: 'rgba(248,113,113,0.35)' }}>
            <div style={{ color: '#fecaca' }}>{error}</div>
          </section>
        ) : null}

        {actionMessage ? (
          <section className="card" style={{ borderColor: 'rgba(52,211,153,0.28)' }}>
            <div style={{ color: '#bbf7d0' }}>{actionMessage}</div>
          </section>
        ) : null}

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Welcome back</h2>
          <p>Email: {user.email}</p>
          <p>Handle: {user.handle}</p>
        </section>

        <section
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 16,
          }}
        >
          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Backend</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>
              {summary.backendOnline ? 'Online' : 'Offline'}
            </div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Worker</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{summary.workerState}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Connected Accounts</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{summary.connectedCount}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Posts in Rotation</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{summary.postsInRotation}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Queued</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{summary.queued}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Processed</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{summary.processed}</div>
          </div>
        </section>

        <section className="card">
          <h3 style={{ marginTop: 0 }}>Control Center</h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: 16,
              marginTop: 20,
            }}
          >
            <Link className="btn primary" href="/galaxy">
              🌌 Open Galaxy
            </Link>

            <Link className="btn" href="/posts">
              🪐 Post Manager
            </Link>

            <Link className="btn" href="/analytics">
              📈 Analytics
            </Link>
          </div>
        </section>

        <section className="card">
          <h3 style={{ marginTop: 0 }}>Connect Accounts</h3>
          <p style={{ color: 'rgba(236,253,245,0.72)', marginTop: 6 }}>
            X uses real OAuth. Bluesky uses your handle and app password.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: 16,
              marginTop: 20,
            }}
          >
            <button
              className="btn"
              onClick={handleConnectXOAuth}
              disabled={busyAction === 'connect-x'}
            >
              {busyAction === 'connect-x' ? 'Starting X OAuth...' : '𝕏 Connect X with OAuth'}
            </button>

            <button
              className="btn"
              onClick={handleConnectBluesky}
              disabled={busyAction === 'connect-bluesky'}
            >
              {busyAction === 'connect-bluesky' ? 'Connecting Bluesky...' : '☁️ Connect Bluesky'}
            </button>
          </div>
        </section>

        <section
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
            gap: 16,
          }}
        >
          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Last Heartbeat</div>
            <div>{fmtWhen(summary.heartbeatAt)}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Poll Interval</div>
            <div>{summary.pollSeconds ? `${summary.pollSeconds}s` : '—'}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Next Cycle</div>
            <div>
              {summary.nextCycle ? fmtWhen(summary.nextCycle) : 'No cycle scheduled'}{' '}
              <span style={{ opacity: 0.7 }}>
                {summary.nextCycle ? `(${cycleLabel(summary.nextCycle)})` : ''}
              </span>
            </div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Worker Error</div>
            <div>{summary.workerError || 'No worker error reported.'}</div>
          </div>
        </section>

        <section className="card">
          <h3 style={{ marginTop: 0 }}>Connected Accounts Snapshot</h3>

          {accounts.length === 0 ? (
            <div>No connected accounts yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {accounts.map((account) => {
                const status = statusMap[account.id]
                const nextCycleText = cycleLabel(status?.next_cycle_at)
                const isOverdue = nextCycleText === 'Overdue'

                return (
                  <div
                    key={account.id}
                    style={{
                      border: '1px solid rgba(52,211,153,0.18)',
                      borderRadius: 18,
                      padding: 16,
                      background: 'rgba(16,185,129,0.04)',
                    }}
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr repeat(4, minmax(110px, 1fr))',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            color: 'rgba(236,253,245,0.62)',
                            fontSize: 11,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                          }}
                        >
                          {providerLabel(account.provider)}
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>
                          {account.handle}
                        </div>
                      </div>

                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12, marginBottom: 6 }}>
                          Connected
                        </div>
                        <span
                          className="btn"
                          style={{
                            cursor: 'default',
                            ...statusPillStyle(status?.connected ? 'good' : 'neutral'),
                          }}
                        >
                          {status?.connected ? 'Yes' : 'No'}
                        </span>
                      </div>

                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12, marginBottom: 6 }}>
                          Autopilot
                        </div>
                        <span
                          className="btn"
                          style={{
                            cursor: 'default',
                            ...statusPillStyle(status?.running ? 'good' : 'neutral'),
                          }}
                        >
                          {status?.running ? 'Running' : 'Idle'}
                        </span>
                      </div>

                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Rotation</div>
                        <div>{status?.posts_in_rotation ?? 0}</div>
                      </div>

                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12, marginBottom: 6 }}>
                          Next Cycle
                        </div>
                        <span
                          className="btn"
                          style={{
                            cursor: 'default',
                            ...statusPillStyle(isOverdue ? 'warn' : 'neutral'),
                          }}
                        >
                          {nextCycleText}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: 10,
                        flexWrap: 'wrap',
                        marginTop: 14,
                      }}
                    >
                      <button
                        className="btn"
                        onClick={() => handleToggleAutopilot(account.id, !status?.running)}
                      >
                        {status?.running ? 'Pause Autopilot' : 'Start Autopilot'}
                      </button>

                      <button
                        className="btn"
                        onClick={() => handleRefreshNow(account.id, account.handle)}
                        disabled={busyAction === `refresh-${account.id}`}
                      >
                        {busyAction === `refresh-${account.id}` ? 'Queueing Refresh...' : '⚡ Refresh Now'}
                      </button>

                      <button
                        className="btn"
                        onClick={() => handleRunAnalytics(account.id, account.handle)}
                        disabled={busyAction === `analytics-${account.id}`}
                      >
                        {busyAction === `analytics-${account.id}` ? 'Queueing Analytics...' : '🧠 Run Analytics'}
                      </button>

                      <button className="btn" onClick={() => handleDisconnectAccount(account.id)}>
                        Disconnect
                      </button>

                      <Link className="btn" href="/galaxy">
                        Open in Galaxy
                      </Link>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                        gap: 12,
                        marginTop: 12,
                        fontSize: 13,
                        color: 'rgba(236,253,245,0.72)',
                      }}
                    >
                      <div>Last action: {fmtWhen(status?.last_action_at)}</div>
                      <div>Next cycle: {fmtWhen(status?.next_cycle_at)}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="card">
          <h3 style={{ marginTop: 0 }}>Recent Jobs</h3>

          {recentJobs.length === 0 ? (
            <div>No jobs found yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {recentJobs.map((job, index) => (
                <div
                  key={job.id || job.job_id || `${job.type}-${index}`}
                  style={{
                    border: '1px solid rgba(52,211,153,0.18)',
                    borderRadius: 18,
                    padding: 16,
                    background: 'rgba(16,185,129,0.04)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{job.type || 'Job'}</div>
                      <div style={{ color: 'rgba(236,253,245,0.65)', fontSize: 13 }}>
                        ID: {job.id || job.job_id || '—'}
                      </div>
                      <div style={{ color: 'rgba(236,253,245,0.65)', fontSize: 13, marginTop: 4 }}>
                        Account: {job.connected_account_id ?? '—'}
                      </div>
                    </div>

                    <div
                      className="btn"
                      style={{
                        cursor: 'default',
                        ...statusPillStyle(
                          String(job.state || job.status || '').toLowerCase().includes('fail')
                            ? 'bad'
                            : String(job.state || job.status || '').toLowerCase().includes('complete')
                              ? 'good'
                              : 'neutral'
                        ),
                      }}
                    >
                      {job.state || job.status || 'unknown'}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, color: 'rgba(236,253,245,0.88)' }}>
                    {job.message || job.result || 'No message provided.'}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                      gap: 12,
                      marginTop: 12,
                      fontSize: 13,
                      color: 'rgba(236,253,245,0.72)',
                    }}
                  >
                    <div>Created: {fmtWhen(job.created_at)}</div>
                    <div>Updated: {fmtWhen(job.updated_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}