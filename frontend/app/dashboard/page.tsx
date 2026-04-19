'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getAppBase, getLastBootstrapError, getToken, logout, me, resetAuthState } from '../lib/auth'
import { STRIPE_LINKS } from '../lib/billing'
import { missionBadgeStyle, missionEyebrowStyle } from '../lib/mission-ui'

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
  pacing_mode?: string
  pacing_label?: string
  pacing_description?: string
  pacing_window_label?: string
  pacing_options?: Array<{
    mode: string
    min_minutes: number
    max_minutes: number
    label: string
    display_name: string
    description: string
  }>
  breathing_room_active?: boolean
  breathing_room_until?: string | null
  breathing_room_reason?: string | null
  latest_original_post_at?: string | null
  fresh_post_protection_enabled?: boolean
  metadata?: Record<string, unknown>
}

type JobItem = {
  id?: string
  job_id?: string
  type?: string
  job_type?: string
  state?: string
  status?: string
  created_at?: string
  updated_at?: string
  message?: unknown
  result?: unknown
  error?: unknown
  connected_account_id?: number
}

type JobPayload = {
  provider?: string
  handle?: string
  message?: string
  error?: string
  debug_notes?: string[]
  next_step?: string
  last_action_at?: string | null
  next_cycle_at?: string | null
  cycle_events?: unknown
  pacing_mode?: string
  pacing_reason?: string
  next_delay_minutes?: number
  rotation_health?: {
    pool_size?: number
    refreshes_last_24h?: number
    last_strategy?: string
    mix_hint?: string
    selection_reason?: string
    momentum_stack_remaining?: number
    velocity_stack_active?: boolean
    pending_pair_post_id?: string
  }
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

function parseApiDate(value?: string | null) {
  if (!value) return null
  const raw = String(value).trim()
  if (!raw) return null
  const normalized =
    /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}Z`
  const d = new Date(normalized)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function fmtWhen(value?: string | null) {
  const d = parseApiDate(value)
  if (!d) return '—'
  return d.toLocaleString()
}

function relativeWhen(value?: string | null) {
  const d = parseApiDate(value)
  if (!d) return '—'

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
  const d = parseApiDate(value)
  if (!d) return 'No cycle scheduled'

  const diffMs = d.getTime() - Date.now()
  if (diffMs < -5 * 60 * 1000) return 'Overdue'

  return relativeWhen(value)
}

function longCountdownUntil(value?: string | null, nowMs = Date.now()) {
  const d = parseApiDate(value)
  if (!d) return '—'

  const diffMs = d.getTime() - nowMs
  if (diffMs <= 0) return 'ready now'

  const totalMinutes = Math.ceil(diffMs / 60000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function countdownUntil(value?: string | null, nowMs = Date.now()) {
  const d = parseApiDate(value)
  if (!d) return '—'

  const diffMs = d.getTime() - nowMs
  if (diffMs <= 0) return 'Ready now'

  const totalSeconds = Math.floor(diffMs / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function selectedPacingOption(status?: AccountStatus | null) {
  const options = status?.pacing_options || []
  return options.find((option) => option.mode === status?.pacing_mode) || options[0] || null
}

function providerLabel(provider?: string) {
  const p = String(provider || '').toLowerCase()
  if (p === 'x' || p === 'twitter') return 'X'
  if (p === 'bluesky' || p === 'bsky') return 'Bluesky'
  return provider || 'Provider'
}

function pacingModeTone(mode?: string): 'good' | 'warn' | 'neutral' {
  if (mode === 'heavy') return 'warn'
  if (mode === 'light') return 'neutral'
  return 'good'
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

function safeText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseJobPayload(job: JobItem): JobPayload {
  const result = asRecord(job.result)
  const message = asRecord(job.message)
  const merged = { ...(message || {}), ...(result || {}) }
  const debugNotes = Array.isArray(merged.debug_notes)
    ? merged.debug_notes.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : []

  return {
    provider: typeof merged.provider === 'string' ? merged.provider : undefined,
    handle: typeof merged.handle === 'string' ? merged.handle : undefined,
    message: typeof merged.message === 'string' ? merged.message : safeText(job.message || job.result),
    error: safeText(job.error),
    debug_notes: debugNotes,
    next_step: typeof merged.next_step === 'string' ? merged.next_step : undefined,
    last_action_at: typeof merged.last_action_at === 'string' ? merged.last_action_at : null,
    next_cycle_at: typeof merged.next_cycle_at === 'string' ? merged.next_cycle_at : null,
    cycle_events: merged.cycle_events,
    pacing_mode: typeof merged.pacing_mode === 'string' ? merged.pacing_mode : undefined,
    pacing_reason: typeof merged.pacing_reason === 'string' ? merged.pacing_reason : undefined,
    next_delay_minutes:
      typeof merged.next_delay_minutes === 'number' ? merged.next_delay_minutes : undefined,
    rotation_health: asRecord(merged.rotation_health) as JobPayload['rotation_health'],
  }
}

function startCase(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return 'Unknown'
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function compactNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : '—'
}

function humanizeStrategyLabel(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return 'Stable'

  const normalized = raw.toLowerCase()
  if (normalized === 'x_db_tier_a') return 'X priority orbit'
  if (normalized === 'constellation circulation') return 'Constellation circulation'

  return startCase(raw)
}

function humanizeNextStep(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return 'Standing by for the next cycle window'

  if (raw.toLowerCase() === 'awaiting next worker instruction') {
    return 'Standing by for the next cycle window'
  }

  return raw
}

function humanizeCycleEvent(value: string) {
  const raw = String(value || '').trim()
  if (!raw) return 'mission update'

  const normalized = raw.toLowerCase()
  if (normalized.startsWith('selected via ')) {
    return `selected via ${humanizeStrategyLabel(raw.slice('selected via '.length))}`
  }

  return raw
}

function compactText(value: unknown, max = 92) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return 'No post selected yet.'
  if (text.startsWith('at://')) {
    const tail = text.split('/').pop() || text
    return `Bluesky record · ${tail}`
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function metadataValue(meta: Record<string, unknown> | null, key: string) {
  const value = meta?.[key]
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
}

function humanizeGravityTier(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalized = raw.toLowerCase()
  if (normalized === 'outer_field') return 'Outer field'
  if (normalized === 'inner_core') return 'Inner core'
  return startCase(raw)
}

function humanizeFunnelStage(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return startCase(raw)
}

function headlineForJob(job: JobItem, payload: JobPayload) {
  const provider = providerLabel(payload.provider)
  const lowerMessage = String(payload.message || '').toLowerCase()
  const type = String(job.type || job.job_type || '').toLowerCase()
  const state = String(job.state || job.status || '').toLowerCase()

  if (state.includes('fail') || state.includes('error')) {
    if (type.includes('analytics')) return `${provider} analytics failed`
    if (type.includes('refresh')) return `${provider} refresh failed`
    return `${provider} mission failure`
  }

  if (lowerMessage.includes('importer complete')) {
    return `${provider} import complete`
  }

  if (lowerMessage.includes('resurfaced') || lowerMessage.includes('retweeted')) {
    return `${provider} resurfaced post`
  }

  if (type.includes('analytics')) {
    return `${provider} analytics sweep`
  }

  if (type.includes('refresh')) {
    return `${provider} refresh cycle`
  }

  return `${provider} mission update`
}

function jobStateKind(value?: string) {
  const state = String(value || '').toLowerCase()
  if (state.includes('fail') || state.includes('error')) return 'bad'
  if (state.includes('complete') || state.includes('success') || state.includes('done')) {
    return 'good'
  }
  if (state.includes('run') || state.includes('queue') || state.includes('process')) return 'warn'
  return 'neutral'
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

  const normalizedPath = path.startsWith('/api/') ? path.slice('/api/'.length) : path

  return fetch(`/api/evergreen/${normalizedPath}`, {
    ...init,
    headers,
    cache: 'no-store',
  })
}

export default function DashboardPage() {
  const router = useRouter()
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [statusMap, setStatusMap] = useState<Record<number, AccountStatus>>({})
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [error, setError] = useState('')

  async function refreshSessionUser() {
    try {
      const latest = await me()
      if (latest?.user) {
        setSession(latest)
      }
      return latest
    } catch {
      return null
    }
  }

  function currentSubscriptionState() {
    const user = session?.user || {}
    const rawStatus = String(user.subscription_status || 'inactive').trim().toLowerCase()
    const trialEndsAt = typeof user.trial_ends_at === 'string' ? user.trial_ends_at : null
    const trialEndsAtDate = parseApiDate(trialEndsAt)
    const trialActive = Boolean(trialEndsAtDate && trialEndsAtDate.getTime() > nowMs)

    if (rawStatus === 'active') {
      return {
        subscriptionStatus: 'active',
        trialEndsAt,
        canRunAutopilot: true,
      }
    }

    if (trialActive) {
      return {
        subscriptionStatus: 'trialing',
        trialEndsAt,
        canRunAutopilot: true,
      }
    }

    if (trialEndsAt) {
      return {
        subscriptionStatus: 'expired',
        trialEndsAt,
        canRunAutopilot: false,
      }
    }

    return {
      subscriptionStatus: rawStatus || 'inactive',
      trialEndsAt: null,
      canRunAutopilot: false,
    }
  }

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      try {
        const attempts = clerkEnabled ? 3 : 1
        let data = null

        for (let attempt = 0; attempt < attempts; attempt += 1) {
          data = await me()
          if (data?.user) break
          if (clerkEnabled && attempt < attempts - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 750))
          }
        }

        if (!mounted) return
        setSession(data)
        if (!data?.user && clerkEnabled) {
          setError(
            getLastBootstrapError() ||
              'Evergreen could not finish your account session. Please try sign-in again.',
          )
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [clerkEnabled])

  useEffect(() => {
    if (error) return
    if (!loading) return

    const timeoutId = window.setTimeout(() => {
      setError(
        getLastBootstrapError() ||
          'Evergreen could not finish the dashboard handoff. Your Clerk login may be active, but the app session did not complete.',
      )
      setLoading(false)
    }, 7000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [error, loading])

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (error) return
    if (loading || session?.user) return
    setError(
      getLastBootstrapError() ||
        'Evergreen could not verify your dashboard session. Please return to sign-in once this message is visible.',
    )
  }, [error, loading, router, session])

  async function refreshMissionControlNow() {
    if (!session?.user) return

    try {
      const latestSession = await refreshSessionUser()
      const activeSession = latestSession?.user ? latestSession : session
      const activeUser = activeSession?.user
      if (!activeUser) return

      const userId = activeUser.id || 1

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
        const latestSession = await refreshSessionUser()
        const activeSession = latestSession?.user ? latestSession : session
        const activeUser = activeSession?.user
        if (!activeUser) return

        const userId = activeUser.id || 1

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

    function handleVisibilityRefresh() {
      if (document.visibilityState === 'visible') {
        loadMissionControl()
      }
    }

    window.addEventListener('focus', loadMissionControl)
    document.addEventListener('visibilitychange', handleVisibilityRefresh)

    return () => {
      mounted = false
      window.clearInterval(id)
      window.removeEventListener('focus', loadMissionControl)
      document.removeEventListener('visibilitychange', handleVisibilityRefresh)
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
      workerState: system?.worker?.ok ? heartbeat.status || 'running' : 'offline',
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

  const deploymentWindows = useMemo(() => {
    const providerOrder = ['x', 'bluesky']

    return accounts
      .slice()
      .sort((a, b) => {
        const providerDiff =
          providerOrder.indexOf(String(a.provider || '').toLowerCase()) -
          providerOrder.indexOf(String(b.provider || '').toLowerCase())
        if (providerDiff !== 0) return providerDiff
        return a.id - b.id
      })
      .map((account) => {
        const status = statusMap[account.id]
        const meta = asRecord(status?.metadata)
        const latestJob = jobs.find((job) => job.connected_account_id === account.id)
        const activeRefreshJob = jobs.find((job) => {
          if (job.connected_account_id !== account.id) return false
          const jobType = String(job.job_type || job.type || '').trim().toLowerCase()
          const jobState = String(job.status || job.state || '').trim().toLowerCase()
          return jobType === 'refresh' && (jobState === 'queued' || jobState === 'running')
        })
        const payload = latestJob ? parseJobPayload(latestJob) : null
        const rotationHealth = payload?.rotation_health || {}

        const latestPost =
          status?.last_post_text ||
          payload?.message ||
          metadataValue(meta, 'last_candidate_provider_post_id') ||
          ''

        const strategy = humanizeStrategyLabel(
          metadataValue(meta, 'last_strategy') ||
            (typeof rotationHealth.last_strategy === 'string' ? rotationHealth.last_strategy : '') ||
            (typeof rotationHealth.mix_hint === 'string' ? rotationHealth.mix_hint : ''),
        )

        const selectionReason =
          metadataValue(meta, 'last_selection_reason') ||
          (typeof rotationHealth.selection_reason === 'string' ? rotationHealth.selection_reason : '') ||
          'Balanced weighted pick'

        const gravityTier = humanizeGravityTier(metadataValue(meta, 'last_candidate_gravity_tier'))
        const funnelStage = humanizeFunnelStage(metadataValue(meta, 'last_candidate_funnel_stage'))
        const momentumReason = metadataValue(meta, 'last_momentum_reason')
        const pendingPairReason = metadataValue(meta, 'pending_pair_reason')
        const pendingPairId =
          metadataValue(meta, 'pending_pair_post_id') ||
          (typeof rotationHealth.pending_pair_post_id === 'string'
            ? rotationHealth.pending_pair_post_id
            : '')
        const velocityActive =
          metadataValue(meta, 'velocity_stack_active') === 'True' ||
          metadataValue(meta, 'velocity_stack_active') === 'true' ||
          Boolean(rotationHealth.velocity_stack_active)
        const momentumRemaining = compactNumber(
          metadataValue(meta, 'momentum_stack_remaining') || rotationHealth.momentum_stack_remaining,
        )
        const activeSignal = [
          momentumReason ? `Momentum: ${startCase(momentumReason)}` : '',
          pendingPairReason ? `Pair: ${startCase(pendingPairReason)}` : '',
          velocityActive ? 'Velocity stack live' : '',
        ]
          .filter(Boolean)
          .join(' • ')

        const sourceGroup = [gravityTier, funnelStage ? `${funnelStage} lane` : '']
          .filter(Boolean)
          .join(' • ')

        return {
          account,
          status,
          latestJob,
          activeRefreshJob,
          latestHeadline: latestJob ? headlineForJob(latestJob, payload || {}) : 'Deployment lane idle',
          latestState: latestJob ? String(latestJob.state || latestJob.status || 'unknown') : 'idle',
          latestPost: compactText(latestPost),
          strategy,
          selectionReason,
          sourceGroup: sourceGroup || 'Balanced pool',
          activeSignal: activeSignal || 'No live pressure detected',
          pendingPair: pendingPairId ? compactText(pendingPairId, 44) : 'No queued pair',
          momentumRemaining: momentumRemaining === '—' ? '0' : momentumRemaining,
          nextRefreshCountdown:
            String(activeRefreshJob?.status || activeRefreshJob?.state || '').trim().toLowerCase() === 'running'
              ? 'Running now'
              : String(activeRefreshJob?.status || activeRefreshJob?.state || '').trim().toLowerCase() === 'queued'
                ? 'Queued now'
                : countdownUntil(status?.next_cycle_at, nowMs),
          nextCycleText: fmtWhen(status?.next_cycle_at),
          lastActionText: fmtWhen(status?.last_action_at),
        }
      })
  }, [accounts, jobs, nowMs, statusMap])

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
    if (!session?.user?.id) {
      setError('Missing session user.')
      return
    }

    setActionMessage('')
    setError('')
    setBusyAction('connect-x')

    window.location.assign(
      `${API_BASE}/api/providers/x/start?user_id=${encodeURIComponent(String(session.user.id))}`
    )
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

  async function handleDisconnectAccount(
    accountId: number,
    options?: { busyKey?: string; label?: string }
  ) {
    if (!session?.user) return
    if (options?.busyKey) setBusyAction(options.busyKey)
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

      setActionMessage(`Disconnected ${options?.label || json.account_handle || 'account'}.`)
      await refreshMissionControlNow()
      window.setTimeout(refreshMissionControlNow, 1500)
      window.setTimeout(refreshMissionControlNow, 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect account')
    } finally {
      if (options?.busyKey) setBusyAction(null)
    }
  }

  async function handleToggleAutopilot(accountId: number, enabled: boolean) {
    if (!session?.user) return
    const { canRunAutopilot } = currentSubscriptionState()
    const upgradeHref =
      accounts.some((account) => String(account.provider || '').trim().toLowerCase() === 'bluesky') ||
      accounts.length > 1
        ? STRIPE_LINKS.pro
        : STRIPE_LINKS.standard

    if (enabled && !canRunAutopilot) {
      setActionMessage('Autopilot is part of your active trial or subscription. Upgrade to turn it back on.')
      setError('')
      window.location.assign(upgradeHref)
      return
    }

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

  async function handleGlobalAutopilotAction() {
    if (!session?.user) return
    const { canRunAutopilot } = currentSubscriptionState()
    const readyAccounts = accounts.filter((account) => statusMap[account.id]?.connected)
    const runningTargets = readyAccounts.filter((account) => statusMap[account.id]?.running)
    const idleTargets = readyAccounts.filter((account) => !statusMap[account.id]?.running)
    const upgradeHref =
      accounts.some((account) => String(account.provider || '').trim().toLowerCase() === 'bluesky') ||
      accounts.length > 1
        ? STRIPE_LINKS.pro
        : STRIPE_LINKS.standard

    if (readyAccounts.length === 0) {
      setActionMessage('Connect a lane first.')
      setError('')
      return
    }

    if (!canRunAutopilot) {
      setActionMessage('Your 1-day free trial has ended. Subscribe to restart Autopilot.')
      setError('')
      window.location.assign(upgradeHref)
      return
    }

    setBusyAction('start-autopilot')
    setActionMessage('')
    setError('')

    try {
      if (idleTargets.length === 0 && runningTargets.length > 0) {
        await Promise.all(runningTargets.map((account) => handleToggleAutopilot(account.id, false)))
        setActionMessage(
          runningTargets.length === 1
            ? `Paused autopilot for ${runningTargets[0].handle}.`
            : `Paused autopilot for ${runningTargets.length} connected lanes.`
        )
      } else {
        await Promise.all(idleTargets.map((account) => handleToggleAutopilot(account.id, true)))
        setActionMessage(
          idleTargets.length === 1
            ? `Started autopilot for ${idleTargets[0].handle}.`
            : `Started autopilot for ${idleTargets.length} connected lanes.`
        )
      }
      await refreshMissionControlNow()
      scheduleFollowupRefreshes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update autopilot')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSetPacing(accountId: number, mode: string) {
    if (!session?.user) return
    const busyKey = `pacing-${accountId}`
    setBusyAction(busyKey)
    setActionMessage('')
    setError('')

    try {
      const res = await apiFetch(
        `/api/status/pacing?user_id=${session.user.id || 1}&connected_account_id=${accountId}`,
        {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.ok === false) {
        throw new Error(json.detail || json.message || json.error || 'Could not update refresh window')
      }

      setStatusMap((current) => {
        const existing = current[accountId] || {}
        return {
          ...current,
          [accountId]: {
            ...existing,
            pacing_mode: typeof json.pacing_mode === 'string' ? json.pacing_mode : existing.pacing_mode,
            pacing_label: typeof json.pacing_label === 'string' ? json.pacing_label : existing.pacing_label,
            pacing_description:
              typeof json.pacing_description === 'string'
                ? json.pacing_description
                : existing.pacing_description,
            pacing_window_label:
              typeof json.pacing_window_label === 'string'
                ? json.pacing_window_label
                : existing.pacing_window_label,
            pacing_options: Array.isArray(json.pacing_options)
              ? json.pacing_options
              : existing.pacing_options,
            next_cycle_at:
              typeof json.next_cycle_at === 'string' ? json.next_cycle_at : existing.next_cycle_at,
          },
        }
      })

      setActionMessage(`Refresh window updated to ${json.pacing_label || mode}.`)
      await refreshMissionControlNow()
      window.setTimeout(refreshMissionControlNow, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update refresh window')
    } finally {
      setBusyAction(null)
    }
  }

  async function handleToggleFreshPostProtection(accountId: number, enabled: boolean) {
    if (!session?.user) return
    const busyKey = `breathing-${accountId}`
    setBusyAction(busyKey)
    setActionMessage('')
    setError('')

    try {
      const res = await apiFetch(
        `/api/status/breathing-room?user_id=${session.user.id || 1}&connected_account_id=${accountId}`,
        {
          method: 'POST',
          body: JSON.stringify({ enabled }),
        }
      )

      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.ok === false) {
        throw new Error(json.detail || json.message || json.error || 'Could not update fresh-post protection')
      }

      setActionMessage(
        `${enabled ? 'Enabled' : 'Disabled'} fresh-post protection for ${json.account_handle || 'account'}.`
      )
      await refreshMissionControlNow()
      scheduleFollowupRefreshes()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update fresh-post protection')
    } finally {
      setBusyAction(null)
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
            <p>{error || 'No active login found.'}</p>
            <Link className="btn primary" href="/signup">
              Go to Signup
            </Link>
          </section>
        </div>
      </main>
    )
  }

  const user = session.user
  const { subscriptionStatus, trialEndsAt, canRunAutopilot } = currentSubscriptionState()
  const recentJobs = jobs.slice(0, 5)
  const accountMap = new Map(accounts.map((account) => [account.id, account]))
  const connectedProviders = new Set(
    accounts.map((account) => String(account.provider || '').trim().toLowerCase()).filter(Boolean)
  )
  const xAccount = accounts.find(
    (account) => String(account.provider || '').trim().toLowerCase() === 'x'
  )
  const blueskyAccount = accounts.find(
    (account) => String(account.provider || '').trim().toLowerCase() === 'bluesky'
  )
  const anyAutopilotRunning = Object.values(statusMap).some((status) => Boolean(status?.running))
  const connectedLaneCount = accounts.filter((account) => statusMap[account.id]?.connected).length
  const runningLaneCount = accounts.filter((account) => statusMap[account.id]?.connected && statusMap[account.id]?.running).length
  const trialCountdown = trialEndsAt ? longCountdownUntil(trialEndsAt, nowMs) : null
  const upgradeHref =
    connectedProviders.has('bluesky') || connectedProviders.size > 1
      ? STRIPE_LINKS.pro
      : STRIPE_LINKS.standard
  const globalAutopilotLabel =
    !canRunAutopilot
      ? '✦ Unlock Autopilot'
      : connectedLaneCount === 0
      ? '▶ Start Autopilot'
      : runningLaneCount === connectedLaneCount
        ? '❚❚ Pause Autopilot'
        : runningLaneCount > 0
          ? '▶ Resume Autopilot'
          : '▶ Start Autopilot'
  const onboardingCue =
    connectedLaneCount === 0
      ? {
          eyebrow: 'First Flight',
          title: 'Connect your first lane to wake up Evergreen.',
          body: 'Start with X or Bluesky. Once one lane is linked, Evergreen can import the pool, score the rotation, and get Starden moving.',
        }
      : !anyAutopilotRunning
        ? {
            eyebrow: 'Next Move',
            title: 'Your lanes are ready. Turn on Autopilot when you want Evergreen to begin cycling.',
            body: 'The worker will keep importing new posts, refreshing scores, and selecting the next pulse from there.',
          }
        : null
  const standardFriendly = accounts.filter(
    (account) => String(account.provider || '').trim().toLowerCase() === 'x'
  ).length <= 1
  const activationSteps = [
    {
      label: 'Connect X',
      detail: connectedProviders.has('x') ? 'X is linked and ready.' : 'Best first step for Standard.',
      kind: connectedProviders.has('x') ? 'good' : 'neutral',
    },
    {
      label: 'Connect Bluesky',
      detail: connectedProviders.has('bluesky')
        ? 'Bluesky is linked too.'
        : 'Optional second lane for Pro.',
      kind: connectedProviders.has('bluesky') ? 'good' : 'neutral',
    },
    {
      label: 'Start Autopilot',
      detail: !canRunAutopilot
        ? 'Subscribe after the free trial to keep Evergreen running.'
        : anyAutopilotRunning
          ? 'At least one lane is live.'
          : 'Turn on Evergreen after connecting.',
      kind: !canRunAutopilot ? 'warn' : anyAutopilotRunning ? 'good' : 'warn',
    },
    {
      label: 'Monitor Starden',
      detail: accounts.length > 0
        ? 'Watch selections and refresh timing below.'
        : 'Starden gets more useful once a lane is connected.',
      kind: accounts.length > 0 ? 'good' : 'neutral',
    },
  ] as const
  const subscriptionBanner =
    subscriptionStatus === 'trialing'
      ? {
          eyebrow: '1-Day Free Trial',
          title: 'Autopilot is live while your trial runs.',
          body: `Your trial gives you one full day to connect a lane, run Evergreen, and explore Starden. Autopilot will pause automatically when the timer ends unless you subscribe.`,
          meta: trialCountdown ? `Trial ends in ${trialCountdown}.` : 'Trial active now.',
          tone: 'good' as const,
        }
      : subscriptionStatus === 'expired'
        ? {
            eyebrow: 'Trial Complete',
            title: 'Autopilot is paused until you subscribe.',
            body: 'You can still sign in, connect lanes, and look around, but the refresh engine will stay off until you choose a plan.',
            meta: 'Choose Standard for one lane or Pro for both X and Bluesky.',
            tone: 'warn' as const,
          }
        : null

  return (
    <main className="page mission-page">
      <div className="shell">
        <header className="header mission-header-block">
          <div>
            <div className="wordmark">Evergreen Mission Control</div>
            <div className="subtle">Live command deck for your resurfacing engine.</div>
          </div>

          <button
            className="btn"
            onClick={async () => {
              setBusyAction('logout')
              try {
                await logout()
              } finally {
                window.location.assign(`${getAppBase()}/login`)
              }
            }}
            disabled={busyAction === 'logout'}
          >
            {busyAction === 'logout' ? 'Logging out...' : 'Logout'}
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

        <section
          className="card telemetry-card"
          style={{
            padding: '10px 16px',
            background: 'rgba(8, 26, 18, 0.82)',
            marginTop: 2,
            marginBottom: 4,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              alignItems: 'center',
              fontSize: 12,
              color: 'rgba(236,253,245,0.8)',
            }}
          >
            <span style={missionEyebrowStyle}>Live Pulse</span>
            <span style={statusPillStyle(summary.backendOnline ? 'good' : 'bad')}>
              Backend {summary.backendOnline ? 'online' : 'offline'}
            </span>
            <span style={statusPillStyle(summary.workerState === 'running' ? 'good' : 'neutral')}>
              Worker {startCase(summary.workerState)}
            </span>
            <span>{summary.connectedCount} connected</span>
            <span>{summary.postsInRotation} in rotation</span>
            <span>{summary.queued} queued</span>
            <span>{summary.processed} processed</span>
            {summary.nextCycle ? <span>Next cycle {cycleLabel(summary.nextCycle)}</span> : null}
            {summary.workerError ? <span style={{ color: '#fecaca' }}>Worker issue: {summary.workerError}</span> : null}
          </div>
        </section>

        <div
          style={{
            marginTop: 4,
            marginBottom: 2,
            color: 'rgba(236,253,245,0.62)',
            fontSize: 13,
            letterSpacing: '0.01em',
          }}
        >
          Signed in as {user.email} · {user.handle}
        </div>

        {subscriptionBanner ? (
          <section
            className="card"
            style={{
              marginTop: 10,
              borderColor:
                subscriptionBanner.tone === 'good'
                  ? 'rgba(156,227,169,0.2)'
                  : 'rgba(250,204,21,0.24)',
              background:
                subscriptionBanner.tone === 'good'
                  ? 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(7,17,11,0.82))'
                  : 'linear-gradient(135deg, rgba(250,204,21,0.08), rgba(7,17,11,0.82))',
            }}
          >
            <div style={missionEyebrowStyle}>{subscriptionBanner.eyebrow}</div>
            <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>
              {subscriptionBanner.title}
            </div>
            <div style={{ marginTop: 8, color: 'rgba(236,253,245,0.74)', maxWidth: 760, lineHeight: 1.6 }}>
              {subscriptionBanner.body}
            </div>
            <div
              style={{
                marginTop: 10,
                color:
                  subscriptionBanner.tone === 'good'
                    ? 'rgba(187,247,208,0.9)'
                    : 'rgba(254,240,138,0.9)',
                fontSize: 13,
              }}
            >
              {subscriptionBanner.meta}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              <a className="btn" href={STRIPE_LINKS.standard}>
                Start Standard
              </a>
              <a className="btn primary" href={STRIPE_LINKS.pro}>
                Start Pro
              </a>
            </div>
          </section>
        ) : null}

        {onboardingCue ? (
          <section
            className="card"
            style={{
              marginTop: 10,
              borderColor: 'rgba(156,227,169,0.2)',
              background: 'linear-gradient(135deg, rgba(16,185,129,0.07), rgba(7,17,11,0.82))',
            }}
          >
            <div style={missionEyebrowStyle}>{onboardingCue.eyebrow}</div>
            <div style={{ marginTop: 8, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>
              {onboardingCue.title}
            </div>
            <div style={{ marginTop: 8, color: 'rgba(236,253,245,0.74)', maxWidth: 760, lineHeight: 1.6 }}>
              {onboardingCue.body}
            </div>
          </section>
        ) : null}

        <section
          className="card activation-card"
          style={{
            display: 'grid',
            gap: 18,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Activate Evergreen</h3>
              <div style={{ color: 'rgba(236,253,245,0.72)', maxWidth: 720 }}>
                Move top to bottom: connect your channels, turn on the engine, then monitor the refresh flow.
                {standardFriendly
                  ? ' Standard can stay lean with one lane. Pro can stack both X and Bluesky.'
                  : ' Both lanes can run side by side when you want a fuller Pro setup.'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={() => {
                  if (xAccount) {
                    handleDisconnectAccount(xAccount.id, {
                      busyKey: 'disconnect-x',
                      label: xAccount.handle || 'X account',
                    })
                    return
                  }
                  handleConnectXOAuth()
                }}
                disabled={busyAction === 'connect-x' || busyAction === 'disconnect-x'}
              >
                {busyAction === 'connect-x'
                  ? 'Starting X OAuth...'
                  : busyAction === 'disconnect-x'
                    ? 'Disconnecting X...'
                    : xAccount
                      ? '𝕏 Disconnect X'
                      : '𝕏 Connect X'}
              </button>

              <button
                className="btn"
                onClick={() => {
                  if (blueskyAccount) {
                    handleDisconnectAccount(blueskyAccount.id, {
                      busyKey: 'disconnect-bluesky',
                      label: blueskyAccount.handle || 'Bluesky account',
                    })
                    return
                  }
                  handleConnectBluesky()
                }}
                disabled={busyAction === 'connect-bluesky' || busyAction === 'disconnect-bluesky'}
              >
                {busyAction === 'connect-bluesky'
                  ? 'Connecting Bluesky...'
                  : busyAction === 'disconnect-bluesky'
                    ? 'Disconnecting Bluesky...'
                    : blueskyAccount
                      ? '☁️ Disconnect Bluesky'
                      : '☁️ Connect Bluesky'}
              </button>

              <button
                className="btn"
                onClick={handleGlobalAutopilotAction}
                disabled={busyAction === 'start-autopilot'}
              >
                {busyAction === 'start-autopilot'
                  ? runningLaneCount === connectedLaneCount && connectedLaneCount > 0
                    ? 'Pausing Autopilot...'
                    : 'Starting Autopilot...'
                  : globalAutopilotLabel}
              </button>

              <Link className="btn primary" href="/galaxy">
                ✦ Open Starden
              </Link>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: 12,
            }}
          >
            {activationSteps.map((step) => (
              <div
                key={step.label}
                style={{
                  border: '1px solid rgba(52,211,153,0.14)',
                  borderRadius: 16,
                  padding: 14,
                  background: 'rgba(16,185,129,0.04)',
                }}
              >
                <div
                  style={{
                    ...missionEyebrowStyle,
                    marginBottom: 8,
                  }}
                >
                  {step.label}
                </div>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 999,
                    ...statusPillStyle(step.kind),
                  }}
                >
                  {step.kind === 'good' ? 'Ready' : step.kind === 'warn' ? 'Next up' : 'Optional'}
                </div>
                <div style={{ marginTop: 10, color: 'rgba(236,253,245,0.76)', fontSize: 13 }}>
                  {step.detail}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <h3 style={{ marginTop: 0, marginBottom: 6 }}>Refresh Engine</h3>
              <div style={{ color: 'rgba(236,253,245,0.68)', fontSize: 13 }}>
                Each lane handles connection, autopilot state, refresh pacing, and the next selection view in one place.
              </div>
            </div>
          </div>

          {accounts.length === 0 ? (
            <div>No connected accounts yet.</div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))',
                gap: 14,
                marginTop: 18,
              }}
            >
              {deploymentWindows.map((lane) => {
                const account = lane.account
                const status = lane.status
                const activePacingOption = selectedPacingOption(status)
                const pacingDescription =
                  activePacingOption?.description ||
                  status?.pacing_description ||
                  'Balanced refresh cadence.'
                const pacingWindowLabel =
                  activePacingOption?.label ||
                  status?.pacing_window_label ||
                  'Standard · 24–49 min'
                const pacingDisplayLabel =
                  activePacingOption?.display_name ||
                  status?.pacing_label ||
                  'Moderate'
                const nextCycleText = cycleLabel(status?.next_cycle_at)
                const activeRefreshState = String(
                  lane.activeRefreshJob?.status || lane.activeRefreshJob?.state || ''
                )
                  .trim()
                  .toLowerCase()
                const refreshBusy =
                  activeRefreshState === 'queued' || activeRefreshState === 'running'
                const nextRefreshCountdown = refreshBusy
                  ? activeRefreshState === 'running'
                    ? 'Running now'
                    : 'Queued now'
                  : countdownUntil(status?.next_cycle_at, nowMs)
                const isOverdue = nextCycleText === 'Overdue' && !refreshBusy
                const freshPostProtectionEnabled =
                  status?.fresh_post_protection_enabled !== false
                const breathingRoomActive = Boolean(status?.breathing_room_active)
                const breathingRoomCountdown = longCountdownUntil(
                  status?.breathing_room_until,
                  nowMs
                )
                const latestOriginalText = relativeWhen(status?.latest_original_post_at)

                return (
                  <div
                    key={account.id}
                    style={{
                      border: '1px solid rgba(52,211,153,0.18)',
                      borderRadius: 18,
                      padding: 16,
                      background:
                        account.provider === 'x'
                          ? 'linear-gradient(180deg, rgba(125,211,252,0.05), rgba(16,185,129,0.03))'
                          : 'linear-gradient(180deg, rgba(110,231,183,0.05), rgba(16,185,129,0.03))',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 16,
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: '1 1 240px' }}>
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
                        <div style={{ color: 'rgba(236,253,245,0.7)', marginTop: 6 }}>
                          {lane.latestHeadline}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(96px, max-content))',
                          gap: 10,
                          alignItems: 'start',
                          justifyContent: 'end',
                          flex: '0 1 430px',
                        }}
                      >
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
                        {status?.running
                          ? 'Pause Autopilot'
                          : canRunAutopilot
                            ? 'Start Autopilot'
                            : 'Unlock Autopilot'}
                      </button>

                      <button
                        className="btn"
                        onClick={() => handleRefreshNow(account.id, account.handle)}
                        disabled={busyAction === `refresh-${account.id}` || refreshBusy}
                      >
                        {busyAction === `refresh-${account.id}`
                          ? 'Queueing Refresh...'
                          : activeRefreshState === 'running'
                            ? 'Refresh Running...'
                            : activeRefreshState === 'queued'
                              ? 'Refresh Queued...'
                              : '⚡ Refresh Now'}
                      </button>

                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 10,
                        marginTop: 12,
                        fontSize: 13,
                      }}
                    >
                      <div
                        style={{
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 14,
                          padding: 12,
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <div style={missionEyebrowStyle}>Selected / Resurfaced</div>
                        <div style={{ marginTop: 8, color: '#ecfdf5' }}>{lane.latestPost}</div>
                      </div>

                      <div
                        style={{
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 14,
                          padding: 12,
                          background: 'rgba(255,255,255,0.03)',
                        }}
                      >
                        <div style={missionEyebrowStyle}>Strategy / Why</div>
                        <div style={{ marginTop: 8, color: '#ecfdf5' }}>{lane.strategy}</div>
                        <div style={{ marginTop: 6, color: 'rgba(236,253,245,0.7)' }}>
                          {compactText(lane.selectionReason, 72)}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 12,
                        padding: '12px 14px',
                        borderRadius: 14,
                        border: '1px solid rgba(52,211,153,0.12)',
                        background: 'rgba(6,24,18,0.65)',
                      }}
                    >
                      <div
                        style={{
                          color: 'rgba(236,253,245,0.62)',
                          fontSize: 11,
                          letterSpacing: '0.14em',
                          textTransform: 'uppercase',
                          marginBottom: 8,
                        }}
                      >
                        Refresh Window
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(status?.pacing_options || []).map((option) => {
                          const selected = option.mode === status?.pacing_mode
                          return (
                            <button
                              key={option.mode}
                              className="btn"
                              onClick={() => handleSetPacing(account.id, option.mode)}
                              disabled={busyAction === `pacing-${account.id}`}
                              style={{
                                ...(selected
                                  ? statusPillStyle(pacingModeTone(option.mode))
                                  : statusPillStyle('neutral')),
                                opacity: busyAction === `pacing-${account.id}` && !selected ? 0.7 : 1,
                              }}
                            >
                              {option.display_name}
                            </button>
                          )
                        })}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginTop: 10,
                        }}
                        >
                          <span
                            className="btn"
                            style={{
                              cursor: 'default',
                            ...statusPillStyle(
                              status?.running ? 'good' : canRunAutopilot ? 'neutral' : 'warn'
                            ),
                          }}
                        >
                          Autopilot {status?.running ? 'Running' : canRunAutopilot ? 'Idle' : 'Locked'}
                        </span>

                          <span
                            className="btn"
                            style={{
                              cursor: 'default',
                              ...statusPillStyle('neutral'),
                          }}
                          >
                            Rotation {status?.posts_in_rotation ?? 0}
                          </span>
                        </div>

                      <div
                        style={{
                          marginTop: 10,
                          fontSize: 13,
                          color: 'rgba(236,253,245,0.76)',
                        }}
                      >
                        {pacingDescription}
                      </div>

                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 12,
                          color: 'rgba(236,253,245,0.56)',
                        }}
                      >
                        {pacingWindowLabel}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: 8,
                          flexWrap: 'wrap',
                          marginTop: 10,
                          alignItems: 'center',
                        }}
                      >
                        <button
                          className="btn"
                          onClick={() =>
                            handleToggleFreshPostProtection(
                              account.id,
                              !freshPostProtectionEnabled
                            )
                          }
                          disabled={busyAction === `breathing-${account.id}`}
                          style={{
                            ...statusPillStyle(
                              freshPostProtectionEnabled ? 'good' : 'neutral'
                            ),
                          }}
                        >
                          {busyAction === `breathing-${account.id}`
                            ? 'Updating...'
                            : freshPostProtectionEnabled
                              ? 'Fresh-post protection: Enabled'
                              : 'Fresh-post protection: Disabled'}
                        </button>

                        <div
                          style={{
                            fontSize: 12,
                            color: 'rgba(236,253,245,0.62)',
                          }}
                        >
                          {breathingRoomActive
                            ? `Fresh original post is still breathing. Countdown: ${breathingRoomCountdown}.`
                            : freshPostProtectionEnabled
                              ? `Fresh originals get breathing room before resurfacing resumes. Latest original: ${latestOriginalText}.`
                              : 'Evergreen can refresh immediately after new live posts.'}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
                          gap: 12,
                          marginTop: 12,
                          fontSize: 13,
                          color: 'rgba(236,253,245,0.72)',
                        }}
                      >
                        <div>Last action: {lane.lastActionText}</div>
                        <div>Next refresh: {nextRefreshCountdown}</div>
                      </div>
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
              {recentJobs.map((job, index) => {
                const payload = parseJobPayload(job)
                const account = job.connected_account_id
                  ? accountMap.get(job.connected_account_id)
                  : undefined
                const provider = providerLabel(payload.provider || account?.provider)
                const handle = payload.handle || account?.handle || 'Unknown handle'
                const state = job.state || job.status || 'unknown'
                const events = Array.isArray(payload.cycle_events)
                  ? payload.cycle_events.filter((item): item is string => typeof item === 'string')
                  : []
                const rotationHealth = payload.rotation_health || {}
                const missionBadges = [
                  payload.pacing_mode ? `Pacing ${startCase(payload.pacing_mode)}` : '',
                  typeof payload.next_delay_minutes === 'number'
                    ? `Delay ${payload.next_delay_minutes}m`
                    : '',
                  rotationHealth.pool_size != null
                    ? `Pool ${compactNumber(rotationHealth.pool_size)}`
                    : '',
                  rotationHealth.refreshes_last_24h != null
                    ? `24h ${compactNumber(rotationHealth.refreshes_last_24h)} refreshes`
                    : '',
                  rotationHealth.velocity_stack_active ? 'Velocity active' : '',
                  rotationHealth.momentum_stack_remaining
                    ? `Momentum ${compactNumber(rotationHealth.momentum_stack_remaining)}`
                    : '',
                ].filter(Boolean)

                return (
                  <div
                    key={job.id || job.job_id || `${job.type}-${index}`}
                    style={{
                      border: '1px solid rgba(52,211,153,0.18)',
                      borderRadius: 18,
                      padding: 18,
                      background:
                        'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(3,18,15,0.62))',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={missionEyebrowStyle}
                        >
                          Mission Report
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>
                          {headlineForJob(job, payload)}
                        </div>
                        <div
                          style={{
                            color: 'rgba(236,253,245,0.7)',
                            fontSize: 14,
                            marginTop: 8,
                          }}
                        >
                          {provider} · @{handle} · account {job.connected_account_id ?? '—'}
                        </div>
                      </div>

                      <div
                        className="btn"
                        style={{
                          cursor: 'default',
                          ...statusPillStyle(jobStateKind(state)),
                        }}
                      >
                        {startCase(state)}
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                        gap: 12,
                        marginTop: 16,
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.54)', fontSize: 11 }}>Next Step</div>
                        <div style={{ marginTop: 6, color: 'rgba(236,253,245,0.88)' }}>
                          {humanizeNextStep(payload.next_step)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.54)', fontSize: 11 }}>Last Action</div>
                        <div style={{ marginTop: 6, color: 'rgba(236,253,245,0.88)' }}>
                          {fmtWhen(payload.last_action_at || job.updated_at)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.54)', fontSize: 11 }}>Rotation Health</div>
                        <div style={{ marginTop: 6, color: 'rgba(236,253,245,0.88)' }}>
                          {humanizeStrategyLabel(rotationHealth.last_strategy || rotationHealth.mix_hint)}
                        </div>
                      </div>
                    </div>

                    {events.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                        {events.map((event) => (
                          <span
                            key={event}
                            style={missionBadgeStyle('mint')}
                          >
                            {humanizeCycleEvent(event)}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {missionBadges.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        {missionBadges.map((badge) => (
                          <span
                            key={badge}
                            style={missionBadgeStyle('gold')}
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
                        gap: 12,
                        marginTop: 14,
                        fontSize: 13,
                        color: 'rgba(236,253,245,0.72)',
                      }}
                    >
                      <div>Created: {fmtWhen(job.created_at)}</div>
                      <div>Updated: {fmtWhen(job.updated_at)}</div>
                      <div>Next cycle: {fmtWhen(payload.next_cycle_at)}</div>
                    </div>

                    {(payload.error || payload.message || rotationHealth.selection_reason) && (
                    <div
                      style={{
                        marginTop: 14,
                        padding: '12px 14px',
                        borderRadius: 14,
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.03)',
                          color: 'rgba(236,253,245,0.76)',
                          fontSize: 13,
                          lineHeight: 1.65,
                        }}
                      >
                        {payload.error || payload.message || rotationHealth.selection_reason}
                      </div>
                    )}

                    {payload.debug_notes && payload.debug_notes.length > 0 ? (
                      <div
                        style={{
                          marginTop: 10,
                          display: 'grid',
                          gap: 8,
                        }}
                      >
                        {payload.debug_notes.map((note) => (
                          <div
                            key={note}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 12,
                              border: '1px solid rgba(96,165,250,0.18)',
                              background: 'rgba(59,130,246,0.07)',
                              color: 'rgba(219,234,254,0.88)',
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            {note}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
