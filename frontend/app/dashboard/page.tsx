'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { logout, me, type AuthUser } from '../lib/auth'

type JobRecord = {
  id: string
  job_type: string
  status: string
  created_at?: string
}

type PacingOption = {
  mode: string
  min_minutes: number
  max_minutes: number
  label: string
}

type Status = {
  user_id: number
  connected_account_id?: number | null
  running: boolean
  connected: boolean
  provider: string
  account_handle: string
  posts_in_rotation: number
  last_post_text?: string | null
  last_action_at?: string | null
  next_cycle_at?: string | null
  pacing_mode?: string
  pacing_options?: PacingOption[]
  metadata?: {
    next_refresh_at?: string | null
    next_refresh_delay_minutes?: number
    next_maintenance_at?: string | null
    next_maintenance_delay_hours?: number
    last_refresh_message?: string | null
  }
}

type ConnectedAccount = {
  id: number
  provider: string
  handle: string
  connection_status?: string
}

type SystemStatus = {
  backend?: { ok?: boolean }
  worker?: {
    ok?: boolean
    heartbeat?: {
      status?: string
      timestamp?: string | null
      queued?: number
      processed?: number
      error?: string | null
    }
  }
  frontend_hint?: string
}

const API_BASE = 'http://127.0.0.1:8000'
const ACCOUNT_STORAGE_KEY = 'evergreen_selected_account_id'

function parseServerDate(value?: string | null) {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null

  // Backend is currently sending naive ISO timestamps that represent UTC.
  // If no timezone suffix is present, treat them as UTC by appending Z.
  const normalized =
    /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw}Z`

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function formatDateTime(value?: string | null) {
  const parsed = parseServerDate(value)
  if (!parsed) return value ? String(value) : '—'
  try {
    return parsed.toLocaleString()
  } catch {
    return value ? String(value) : '—'
  }
}

function safeText(value: unknown, fallback = '—') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function formatCountdown(target?: string | null) {
  const parsed = parseServerDate(target)
  if (!parsed) return '—'
  const end = parsed.getTime()
  const now = Date.now()
  const diff = end - now
  if (diff <= 0) return 'Due now'
  const totalSeconds = Math.floor(diff / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function providerLabel(provider: string) {
  const value = String(provider || 'x').trim().toLowerCase()
  if (value === 'bluesky' || value === 'bsky') return 'Bluesky'
  return 'X'
}

function providerIcon(provider: string) {
  const value = String(provider || 'x').trim().toLowerCase()
  if (value === 'bluesky' || value === 'bsky') return '☁️'
  return '✕'
}

function accountOptionLabel(account: ConnectedAccount) {
  return `${providerLabel(account.provider)} · ${account.handle || '@unknown'}`
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    borderRadius: 999,
    border: `1px solid ${active ? 'rgba(180,255,210,0.34)' : 'rgba(180,255,210,0.12)'}`,
    background: active ? 'rgba(20,58,39,0.95)' : 'rgba(7,23,17,0.72)',
    color: active ? '#eaffef' : '#9bbca6',
    padding: '10px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
  }
}

const buttonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(180,255,210,0.16)',
  background: 'rgba(7,23,17,0.78)',
  color: '#dfffea',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
}

const ghostButtonStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'transparent',
  color: '#dfffea',
  padding: '10px 14px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
}

function pacingLabel(mode?: string) {
  const raw = String(mode || 'standard').toLowerCase()
  if (raw === 'light') return 'Light'
  if (raw === 'heavy') return 'Heavy'
  return 'Standard'
}

function pacingDescription(option: PacingOption | undefined) {
  if (!option) return '—'
  return `${option.min_minutes}–${option.max_minutes} min`
}

export default function DashboardPage() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState('—')
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [accountStatuses, setAccountStatuses] = useState<Record<number, Status>>({})
  const [connectionNotice, setConnectionNotice] = useState('')
  const [showBlueskyModal, setShowBlueskyModal] = useState(false)
  const [blueskyHandle, setBlueskyHandle] = useState('')
  const [blueskyPassword, setBlueskyPassword] = useState('')
  const initialLoadDone = useRef(false)

  async function authHeaders(): Promise<Record<string, string>> {
    const token =
      typeof window !== 'undefined' ? window.localStorage.getItem('evergreen_auth_token') : null
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  function persistSelectedAccount(accountId: number | null) {
    if (typeof window === 'undefined') return
    if (accountId == null) {
      window.localStorage.removeItem(ACCOUNT_STORAGE_KEY)
      return
    }
    window.localStorage.setItem(ACCOUNT_STORAGE_KEY, String(accountId))
  }

  function readStoredAccountId(): number | null {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(ACCOUNT_STORAGE_KEY)
    if (!raw) return null
    const parsed = Number(raw)
    return Number.isNaN(parsed) ? null : parsed
  }

  async function fetchAccounts(userId: number) {
    const headers = await authHeaders()
    const res = await fetch(`${API_BASE}/api/connected-accounts?user_id=${userId}`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('Failed to load connected accounts')
    const data = await res.json()
    return (data.accounts || []) as ConnectedAccount[]
  }

  async function fetchStatus(userId: number, accountId: number | null) {
    const headers = await authHeaders()
    const suffix = accountId ? `&connected_account_id=${accountId}` : ''
    const res = await fetch(`${API_BASE}/api/status?user_id=${userId}${suffix}`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('Failed to load status')
    return (await res.json()) as Status
  }

  async function fetchJobs(accountId: number | null) {
    const suffix = accountId ? `?connected_account_id=${accountId}` : ''
    const res = await fetch(`${API_BASE}/api/jobs${suffix}`, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to load jobs')
    const data = await res.json()
    return (data.jobs || []) as JobRecord[]
  }

  async function fetchSystemStatus() {
    const res = await fetch(`${API_BASE}/api/system-status`, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to load system status')
    return (await res.json()) as SystemStatus
  }

  async function fetchStatusesForAccounts(userId: number, nextAccounts: ConnectedAccount[]) {
    const entries = await Promise.all(
      nextAccounts.map(async (account) => {
        try {
          const status = await fetchStatus(userId, account.id)
          return [account.id, status] as const
        } catch {
          return [account.id, null] as const
        }
      })
    )

    return Object.fromEntries(
      entries.filter((entry): entry is readonly [number, Status] => Boolean(entry[1]))
    ) as Record<number, Status>
  }

  function resolvePreferredAccountId(nextAccounts: ConnectedAccount[], preferred?: number | null) {
    const candidates = [
      preferred ?? null,
      selectedAccountId,
      readStoredAccountId(),
      nextAccounts[0]?.id ?? null,
    ]

    for (const candidate of candidates) {
      if (candidate == null) continue
      if (nextAccounts.some((account) => account.id === candidate)) {
        return candidate
      }
    }
    return null
  }

  async function loadAll(preferredAccountId?: number | null) {
    setError('')
    try {
      const session = await me()
      setUser(session?.user ?? null)
      const userId = session?.user?.id ?? 1
      const nextAccounts = await fetchAccounts(userId)
      setAccounts(nextAccounts)

      const statusMap = await fetchStatusesForAccounts(userId, nextAccounts)
      setAccountStatuses(statusMap)

      const resolvedAccountId = resolvePreferredAccountId(nextAccounts, preferredAccountId)
      setSelectedAccountId(resolvedAccountId)
      persistSelectedAccount(resolvedAccountId)

      let systemData: SystemStatus | null = null
      try {
        systemData = await fetchSystemStatus()
      } catch {
        systemData = null
      }
      setSystemStatus(systemData)

      if (resolvedAccountId) {
        const [statusData, jobsData] = await Promise.all([
          fetchStatus(userId, resolvedAccountId),
          fetchJobs(resolvedAccountId),
        ])
        setStatus(statusData)
        setJobs(jobsData)
      } else {
        setStatus(null)
        setJobs([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
      setBusy('')
    }
  }

  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true

    const params = new URLSearchParams(window.location.search)
    const connectedAccountId = params.get('connected_account_id')
    const provider = params.get('provider')
    const connection = params.get('connection')

    let preferred: number | null = null
    if (connectedAccountId) {
      const parsed = Number(connectedAccountId)
      if (!Number.isNaN(parsed)) {
        preferred = parsed
      }
    } else {
      preferred = readStoredAccountId()
    }

    if (provider && connection === 'success') {
      setConnectionNotice(`${provider.toUpperCase()} connected successfully.`)
    }

    if (connectedAccountId || provider || connection) {
      window.history.replaceState({}, '', window.location.pathname)
    }

    void loadAll(preferred)
  }, [])

  useEffect(() => {
    if (!initialLoadDone.current) return
    if (selectedAccountId == null) return
    persistSelectedAccount(selectedAccountId)
    void loadAll(selectedAccountId)
  }, [selectedAccountId])

  useEffect(() => {
    const interval = setInterval(() => {
      if (initialLoadDone.current) {
        void loadAll(selectedAccountId)
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [selectedAccountId])

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(formatCountdown(status?.metadata?.next_refresh_at ?? status?.next_cycle_at))
    }, 1000)
    setCountdown(formatCountdown(status?.metadata?.next_refresh_at ?? status?.next_cycle_at))
    return () => clearInterval(timer)
  }, [status?.metadata?.next_refresh_at, status?.next_cycle_at])

  useEffect(() => {
    if (selectedAccountId == null || !status) return
    setAccountStatuses((prev) => ({
      ...prev,
      [selectedAccountId]: status,
    }))
  }, [selectedAccountId, status])

  useEffect(() => {
    if (user && !blueskyHandle) {
      setBlueskyHandle((user.handle || '@creator').replace(/^@/, '') + '.bsky.social')
    }
  }, [user, blueskyHandle])

  async function postJson(
    path: string,
    body: object = {},
    options: { includeAccount?: boolean } = { includeAccount: true }
  ) {
    const headers = await authHeaders()
    const userId = user?.id ?? 1
    const includeAccount = options.includeAccount ?? true
    const accountSuffix =
      includeAccount && selectedAccountId ? `&connected_account_id=${selectedAccountId}` : ''
    const res = await fetch(`${API_BASE}${path}?user_id=${userId}${accountSuffix}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json()
    } else {
      payload = await res.text()
    }
    if (!res.ok) {
      const message =
        typeof payload === 'string'
          ? payload
          : payload?.detail || payload?.message || 'Request failed'
      throw new Error(message)
    }
    return payload
  }

  async function handleToggleAutopilot() {
    if (!status) return
    setBusy('autopilot')
    setError('')
    try {
      await postJson('/api/status/toggle', { enabled: !status.running })
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle autopilot')
    } finally {
      setBusy('')
    }
  }

  async function handleSetPacing(mode: string) {
    setBusy('pacing')
    setError('')
    try {
      await postJson('/api/status/pacing', { mode })
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pacing')
    } finally {
      setBusy('')
    }
  }

  async function handleConnectX() {
    setBusy('connect_x')
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/providers/x/start`)
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Failed to start X OAuth')
      }
      const data = await res.json()
      const url = data.authorization_url
      if (!url) throw new Error('Missing authorization URL')
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect X')
      setBusy('')
    }
  }

  async function handleConnectBluesky() {
    setBusy('connect_bluesky')
    setError('')
    try {
      if (!blueskyHandle.trim()) throw new Error('Bluesky handle is required')
      if (!blueskyPassword.trim()) throw new Error('Bluesky app password is required')
      await postJson(
        '/api/providers/bluesky/connect',
        {
          handle: blueskyHandle.trim(),
          app_password: blueskyPassword.trim(),
        },
        { includeAccount: false }
      )
      setBlueskyPassword('')
      setShowBlueskyModal(false)
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Bluesky')
    } finally {
      setBusy('')
    }
  }

  async function handleImportBluesky() {
    setBusy('import_bluesky')
    setError('')
    try {
      await postJson('/api/providers/bluesky/import-demo', {}, { includeAccount: false })
      await postJson('/api/jobs/run-analytics')
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import Bluesky posts')
    } finally {
      setBusy('')
    }
  }

  async function handleDisconnect() {
    setBusy('disconnect')
    setError('')
    try {
      await postJson('/api/providers/disconnect')
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect provider')
    } finally {
      setBusy('')
    }
  }

  async function handleRefreshNow() {
    setBusy('refresh')
    setError('')
    try {
      await postJson('/api/jobs/refresh-now')
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue refresh')
    } finally {
      setBusy('')
    }
  }

  async function handleRunAnalytics() {
    setBusy('analytics')
    setError('')
    try {
      await postJson('/api/jobs/run-analytics')
      await loadAll(selectedAccountId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue analytics')
    } finally {
      setBusy('')
    }
  }

  function handleLogout() {
    logout()
    window.location.href = '/'
  }

  const statusTone = useMemo(() => {
    if (!status) return '#9bbca6'
    if (status.connected && status.running) return '#9ee6b3'
    if (status.connected) return '#f3e48b'
    return '#ffb0b0'
  }, [status])

  const importerStatus =
    systemStatus?.worker?.ok ? 'Importer: active · every 20s' : 'Importer: inactive'

  const autopilotStatus = status?.running ? 'Autopilot: running' : 'Autopilot: idle'

  const pacingOptions = status?.pacing_options || []
  const selectedPacing = pacingOptions.find(
    (option) => option.mode === String(status?.pacing_mode || 'standard').toLowerCase()
  )

  const refreshCountdown = formatCountdown(status?.metadata?.next_refresh_at ?? status?.next_cycle_at)

  const perPlatformCountdowns = useMemo(() => {
    return accounts.map((account) => {
      const accountStatus =
        account.id === selectedAccountId && status ? status : accountStatuses[account.id]
      const label = providerLabel(account.provider)
      const countdownText = formatCountdown(
        accountStatus?.metadata?.next_refresh_at ?? accountStatus?.next_cycle_at
      )
      return `${label} next refresh: ${countdownText}`
    })
  }, [accounts, accountStatuses, selectedAccountId, status, countdown])

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 16,
        background: 'radial-gradient(circle at top, rgba(15,80,45,0.35), rgba(3,14,12,1) 55%)',
        color: '#ecfff1',
      }}
    >
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1 style={{ fontSize: 48, margin: 0, fontWeight: 800 }}>Evergreen Dashboard</h1>
            <p style={{ marginTop: 10, color: '#a9cdb5' }}>Mission control for your resurfacing system.</p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {user ? <span style={subtleBadgeStyle}>{user.handle}</span> : null}
            <label style={{ color: '#b6dcc0', fontSize: 14 }}>
              Galaxy{' '}
              <select
                value={selectedAccountId ?? ''}
                onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
                style={{
                  marginLeft: 8,
                  background: '#081511',
                  color: '#ecfff1',
                  border: '1px solid rgba(180,255,210,0.18)',
                  borderRadius: 10,
                  padding: '8px 10px',
                  minWidth: 220,
                }}
              >
                {accounts.length === 0 ? <option value="">No accounts yet</option> : null}
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountOptionLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <Link
              href={selectedAccountId ? `/galaxy?connected_account_id=${selectedAccountId}` : '/galaxy'}
              style={secondaryLinkStyle}
            >
              Open Galaxy
            </Link>
            <Link href="/" style={secondaryLinkStyle}>
              Home
            </Link>
            <button type="button" onClick={handleLogout} style={ghostButtonStyle}>
              Log out
            </button>
          </div>
        </div>

        {error ? <div style={errorBoxStyle}>{error}</div> : null}

        <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 14 }}>
          <section style={heroPanelStyle}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    color: '#8fb39a',
                    fontSize: 13,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                  }}
                >
                  Current galaxy
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={providerIconBubble}>{providerIcon(status?.provider || 'x')}</div>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800 }}>
                      {providerLabel(status?.provider || 'x')}
                    </div>
                    <div style={{ color: '#b6dcc0' }}>{safeText(status?.account_handle, '@unknown')}</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ ...statusBadgeStyle, borderColor: statusTone, color: statusTone }}>
                  {status?.connected ? 'Connected' : 'Disconnected'}
                </div>
                <div
                  style={{
                    ...statusBadgeStyle,
                    borderColor: status?.running ? '#9ee6b3' : '#8fb39a',
                    color: status?.running ? '#9ee6b3' : '#8fb39a',
                  }}
                >
                  {status?.running ? 'Autopilot running' : 'Autopilot idle'}
                </div>
              </div>
            </div>
          </section>

          <section style={heroPanelStyle}>
            <div
              style={{
                color: '#8fb39a',
                fontSize: 13,
                marginBottom: 10,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            >
              Quick connect
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleConnectX}
                disabled={busy === 'connect_x'}
                style={buttonStyle}
              >
                {busy === 'connect_x' ? 'Connecting X...' : '✕ Connect X'}
              </button>
              <button
                type="button"
                onClick={() => setShowBlueskyModal(true)}
                disabled={busy === 'connect_bluesky'}
                style={buttonStyle}
              >
                {busy === 'connect_bluesky' ? 'Connecting Bluesky...' : '☁️ Connect Bluesky'}
              </button>
            </div>
            <div style={{ marginTop: 12, color: '#9bbca6', fontSize: 13 }}>
              X uses OAuth redirect. Bluesky uses an app-password modal for now, and can be upgraded to full OAuth later.
            </div>
          </section>
        </div>

        {connectionNotice ? (
          <div
            style={{
              ...heroPanelStyle,
              marginTop: 16,
              borderColor: 'rgba(158,230,179,0.35)',
              color: '#9ee6b3',
            }}
          >
            {connectionNotice}
          </div>
        ) : null}

        <section style={{ ...panelStyle, marginTop: 16 }}>
          <div style={panelTitleStyle}>System Status</div>
          <div
            style={{
              marginTop: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            <InfoCard title="Backend" value={systemStatus?.backend?.ok ? 'Online' : 'Offline'} />
            <InfoCard title="Worker" value={systemStatus?.worker?.ok ? 'Online' : 'Waiting'} />
            <InfoCard
              title="Worker state"
              value={safeText(systemStatus?.worker?.heartbeat?.status, 'unknown')}
            />
            <InfoCard
              title="Last heartbeat"
              value={formatDateTime(systemStatus?.worker?.heartbeat?.timestamp)}
            />
          </div>

          <div
            style={{
              marginTop: 14,
              borderRadius: 16,
              border: '1px solid rgba(180,255,210,0.10)',
              background: 'rgba(4, 14, 11, 0.56)',
              padding: 14,
              color: '#a9cdb5',
              fontSize: 13,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 14,
              lineHeight: 1.5,
            }}
          >
            <span>{importerStatus}</span>
            <span>{autopilotStatus}</span>
            {perPlatformCountdowns.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
        </section>

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(160px, 1fr))',
            gap: 14,
          }}
        >
          <MetricCard label="Autopilot" value={loading ? '…' : status?.running ? 'Running' : 'Idle'} />
          <MetricCard label="Provider" value={loading ? '…' : providerLabel(status?.provider || 'x')} />
          <MetricCard label="Connected" value={loading ? '…' : status?.connected ? 'Yes' : 'No'} />
          <MetricCard
            label="Posts in Rotation"
            value={loading ? '…' : String(status?.posts_in_rotation ?? 0)}
          />
          <MetricCard label="Next refresh" value={loading ? '…' : refreshCountdown} compact />
        </div>

        <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 14 }}>
          <section style={panelStyle}>
            <div style={panelTitleStyle}>Live Status</div>
            <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
              <InfoCard
                title="Account handle"
                value={loading ? 'Loading…' : safeText(status?.account_handle)}
              />
              <InfoCard
                title="Last action"
                value={loading ? 'Loading…' : formatDateTime(status?.last_action_at)}
              />
              <InfoCard
                title="Next refresh timestamp"
                value={
                  loading
                    ? 'Loading…'
                    : formatDateTime(status?.metadata?.next_refresh_at ?? status?.next_cycle_at)
                }
              />
              <InfoCard
                title="Last post text"
                value={loading ? 'Loading…' : safeText(status?.last_post_text, 'No recent post text recorded')}
              />
            </div>
          </section>

          <section style={panelStyle}>
            <div style={panelTitleStyle}>Controls</div>

            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                onClick={handleToggleAutopilot}
                disabled={loading || busy === 'autopilot'}
                style={pillStyle(Boolean(status?.running))}
              >
                {busy === 'autopilot'
                  ? 'Updating...'
                  : status?.running
                    ? 'Disable Autopilot'
                    : 'Enable Autopilot'}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={loading || busy === 'disconnect'}
                style={ghostButtonStyle}
              >
                {busy === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
              </button>
              <button
                type="button"
                onClick={handleRefreshNow}
                disabled={loading || busy === 'refresh'}
                style={buttonStyle}
              >
                {busy === 'refresh' ? 'Queueing refresh...' : 'Refresh now'}
              </button>
              <button
                type="button"
                onClick={handleRunAnalytics}
                disabled={loading || busy === 'analytics'}
                style={buttonStyle}
              >
                {busy === 'analytics' ? 'Queueing analytics...' : 'Run analytics'}
              </button>
              <button
                type="button"
                onClick={handleImportBluesky}
                disabled={loading || busy === 'import_bluesky'}
                style={buttonStyle}
              >
                {busy === 'import_bluesky' ? 'Importing...' : 'Import Bluesky'}
              </button>
            </div>

            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 16,
                border: '1px solid rgba(180,255,210,0.10)',
                background: 'rgba(4, 14, 11, 0.56)',
              }}
            >
              <div style={{ ...panelTitleStyle, marginBottom: 10 }}>Refresh Frequency</div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {pacingOptions.map((option) => {
                  const active = String(status?.pacing_mode || 'standard') === option.mode
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => handleSetPacing(option.mode)}
                      disabled={busy === 'pacing'}
                      title={option.label}
                      style={pillStyle(active)}
                    >
                      {busy === 'pacing' && active
                        ? 'Updating...'
                        : `${pacingLabel(option.mode)} · ${option.min_minutes}–${option.max_minutes} min`}
                    </button>
                  )
                })}
              </div>

              <div style={{ marginTop: 12, color: '#9bbca6', fontSize: 13, lineHeight: 1.6 }}>
                {selectedPacing
                  ? `${providerLabel(status?.provider || 'x')} is currently set to ${pacingLabel(
                      selectedPacing.mode
                    )}: refreshes every ${pacingDescription(selectedPacing)}.`
                  : 'Choose how often this account should refresh.'}
              </div>
            </div>

            <div style={{ marginTop: 18, color: '#9bbca6', fontSize: 13, lineHeight: 1.6 }}>
              This page is account-scoped. X and Bluesky each keep separate posts, timing, analytics,
              and refresh cycles.
            </div>
          </section>
        </div>

        <section
          style={{
            marginTop: 28,
            borderRadius: 28,
            border: '1px solid rgba(180,255,210,0.14)',
            background: 'rgba(4, 14, 11, 0.74)',
            boxShadow: '0 10px 50px rgba(0,0,0,0.35)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '18px 20px',
              borderBottom: '1px solid rgba(180,255,210,0.08)',
              color: '#a9cdb5',
            }}
          >
            Recent Jobs
          </div>
          <div style={{ padding: 20 }}>
            {loading ? (
              <div style={infoTextStyle}>Loading jobs…</div>
            ) : jobs.length === 0 ? (
              <div style={infoTextStyle}>No jobs found yet.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {jobs.map((job) => (
                  <div key={job.id} style={jobRowStyle}>
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          color: '#ecfff1',
                          textTransform: 'capitalize',
                        }}
                      >
                        {safeText(job.job_type, 'unknown')}
                      </div>
                      <div style={jobSubtleStyle}>ID: {safeText(job.id)}</div>
                    </div>
                    <div>
                      <div style={jobBadgeStyle}>{safeText(job.status, 'unknown')}</div>
                    </div>
                    <div style={jobSubtleStyle}>Created: {formatDateTime(job.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {showBlueskyModal ? (
          <div style={modalBackdropStyle} onClick={() => setShowBlueskyModal(false)}>
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <div style={providerIconBubble}>☁️</div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 800 }}>Connect Bluesky</div>
                  <div style={{ color: '#9bbca6', fontSize: 13 }}>
                    Temporary app-password flow for development
                  </div>
                </div>
              </div>

              <label style={fieldLabelStyle}>Handle</label>
              <input
                value={blueskyHandle}
                onChange={(e) => setBlueskyHandle(e.target.value)}
                placeholder="jockulus.bsky.social"
                style={inputStyle}
              />

              <label style={{ ...fieldLabelStyle, marginTop: 14 }}>App Password</label>
              <input
                value={blueskyPassword}
                onChange={(e) => setBlueskyPassword(e.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
                type="password"
                style={inputStyle}
              />

              <div style={{ marginTop: 12, color: '#8fb39a', fontSize: 12, lineHeight: 1.5 }}>
                Use the password itself, not the date or label shown next to it in Bluesky.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowBlueskyModal(false)}
                  style={ghostButtonStyle}
                >
                  Cancel
                </button>
                <button type="button" onClick={handleConnectBluesky} style={buttonStyle}>
                  {busy === 'connect_bluesky' ? 'Connecting...' : 'Connect Bluesky'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}

function MetricCard({
  label,
  value,
  compact = false,
}: {
  label: string
  value: string
  compact?: boolean
}) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={compact ? valueStyleSmall : valueStyle}>{value}</div>
    </div>
  )
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={infoCardStyle}>
      <div style={infoTitleStyle}>{title}</div>
      <div style={infoTextStyle}>{value}</div>
    </div>
  )
}

const subtleBadgeStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(180,255,210,0.14)',
  background: 'rgba(7,23,17,0.72)',
  color: '#dfffea',
  padding: '10px 14px',
  fontSize: 13,
  fontWeight: 700,
}

const secondaryLinkStyle: React.CSSProperties = {
  color: '#d8ffe2',
  border: '1px solid rgba(180,255,210,0.18)',
  padding: '10px 16px',
  borderRadius: 999,
  textDecoration: 'none',
}

const errorBoxStyle: React.CSSProperties = {
  marginTop: 18,
  padding: 14,
  borderRadius: 16,
  border: '1px solid rgba(255,120,120,0.35)',
  background: 'rgba(80,10,10,0.25)',
  color: '#ffb0b0',
}

const heroPanelStyle: React.CSSProperties = {
  borderRadius: 22,
  border: '1px solid rgba(180,255,210,0.14)',
  background: 'linear-gradient(180deg, rgba(7,23,17,0.85), rgba(4,14,11,0.72))',
  padding: 18,
  boxShadow: '0 10px 40px rgba(0,0,0,0.25)',
}

const cardStyle: React.CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'rgba(7, 23, 17, 0.8)',
  padding: 18,
}

const panelStyle: React.CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'rgba(7, 23, 17, 0.8)',
  padding: 18,
}

const panelTitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#dfffea',
  fontWeight: 700,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#94b8a0',
  marginBottom: 8,
}

const valueStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
  color: '#ecfff1',
}

const valueStyleSmall: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 800,
  color: '#ecfff1',
}

const providerIconBubble: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: 16,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(20,58,39,0.95)',
  border: '1px solid rgba(180,255,210,0.14)',
  fontSize: 24,
}

const statusBadgeStyle: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(180,255,210,0.16)',
  padding: '8px 12px',
  fontSize: 13,
  fontWeight: 700,
  textAlign: 'center',
}

const infoCardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: '1px solid rgba(180,255,210,0.1)',
  background: 'rgba(4, 14, 11, 0.56)',
  padding: 14,
}

const infoTitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#88b79a',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
}

const infoTextStyle: React.CSSProperties = {
  color: '#ecfff1',
  lineHeight: 1.5,
}

const jobRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.2fr 0.6fr 1fr',
  gap: 12,
  alignItems: 'center',
  borderRadius: 16,
  border: '1px solid rgba(180,255,210,0.1)',
  background: 'rgba(4, 14, 11, 0.56)',
  padding: 14,
}

const jobSubtleStyle: React.CSSProperties = {
  color: '#9bbca6',
  fontSize: 13,
}

const jobBadgeStyle: React.CSSProperties = {
  color: '#eaffef',
  border: '1px solid rgba(180,255,210,0.18)',
  background: 'rgba(20,58,39,0.85)',
  padding: '6px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'capitalize',
}

const modalBackdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
}

const modalCardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 460,
  borderRadius: 24,
  border: '1px solid rgba(180,255,210,0.16)',
  background: 'linear-gradient(180deg, rgba(7,23,17,0.95), rgba(4,14,11,0.92))',
  boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
  padding: 22,
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  color: '#b6dcc0',
  fontSize: 13,
  marginBottom: 8,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#081511',
  color: '#ecfff1',
  border: '1px solid rgba(180,255,210,0.16)',
  borderRadius: 12,
  padding: '12px 14px',
  outline: 'none',
}