'use client'

import dynamic from 'next/dynamic'
import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@clerk/nextjs'
import { useRouter } from 'next/navigation'
import {
  apiFetch as authApiFetch,
  getAppBase,
  getLastBootstrapError,
  getStoredUser,
  getToken,
  logout,
  me,
  resetAuthState,
  setStoredUser,
} from '../lib/auth'
import { STRIPE_LINKS } from '../lib/billing'
import { missionBadgeStyle, missionEyebrowStyle } from '../lib/mission-ui'

const EmbeddedGalaxySurface = dynamic(
  () => import('../galaxy/galaxy-surface').then((mod) => mod.GalaxySurface),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          minHeight: 720,
          borderRadius: 26,
          border: '1px solid rgba(52,211,153,0.16)',
          background:
            'linear-gradient(180deg, rgba(3,18,15,0.96), rgba(2,12,11,0.92))',
          display: 'grid',
          placeItems: 'center',
          color: 'rgba(236,253,245,0.72)',
          fontSize: 14,
          letterSpacing: '0.04em',
        }}
      >
        Loading constellation…
      </div>
    ),
  }
)

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

type GalaxyNode = {
  connected_account_id?: number | null
  provider?: string
  handle?: string
}

type GalaxyResponse = {
  nodes?: GalaxyNode[]
  meta?: {
    connected_account_id?: number | null
    count?: number
    running?: boolean
    connected?: boolean
    last_action_at?: string | null
    next_cycle_at?: string | null
    mode?: 'single' | 'unified'
    account_count?: number
    metadata?: Record<string, unknown>
  }
}

type JobItem = {
  id?: string
  job_id?: string
  type?: string
  job_type?: string
  state?: string
  status?: string
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
  last_heartbeat_at?: string | null
  updated_at?: string
  message?: unknown
  result?: unknown
  error?: unknown
  connected_account_id?: number
}

type SubscriptionInfo = {
  status?: string | null
  trial_started_at?: string | null
  trial_ends_at?: string | null
  can_run_autopilot?: boolean
  plan?: string | null
  price_id?: string | null
  billing_email?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  current_period_end?: string | null
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

type IdentityHints = {
  email?: string | null
  handle?: string | null
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'
function inferHealthyLane(status?: AccountStatus | null) {
  if (!status) return false
  if (Boolean(status.running)) return true
  if (typeof status.posts_in_rotation === 'number' && status.posts_in_rotation > 0) return true
  if (String(status.last_action_at || '').trim() && String(status.next_cycle_at || '').trim()) return true
  return false
}

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

function isFreshJobActivity(
  job: JobItem | null | undefined,
  nowMs: number,
  pollSeconds?: number | null,
) {
  if (!job) return false

  const state = String(job.status || job.state || '').trim().toLowerCase()
  if (state !== 'queued' && state !== 'running') return false

  const marker =
    parseApiDate(job.last_heartbeat_at) ||
    parseApiDate(job.started_at) ||
    parseApiDate(job.created_at)

  if (!marker) return false

  const ageMs = nowMs - marker.getTime()
  const heartbeatMarker = parseApiDate(job.last_heartbeat_at)
  const heartbeatAgeMs = heartbeatMarker ? nowMs - heartbeatMarker.getTime() : Number.POSITIVE_INFINITY
  const queueWindowMs = Math.max(45000, Number(pollSeconds || 0) * 2000)
  const runningWindowMs = Math.max(60000, Number(pollSeconds || 0) * 2500)

  if (state === 'queued') {
    return ageMs <= queueWindowMs
  }

  if (heartbeatMarker) {
    return heartbeatAgeMs <= runningWindowMs
  }

  return ageMs <= runningWindowMs
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

function hasInformativeJobPayload(payload: JobPayload | null) {
  if (!payload) return false
  return Boolean(
    String(payload.message || '').trim() ||
      String(payload.next_step || '').trim() ||
      String(payload.last_action_at || '').trim() ||
      String(payload.next_cycle_at || '').trim() ||
      (payload.rotation_health &&
        Object.values(payload.rotation_health).some((value) => value !== null && value !== undefined && value !== ''))
  )
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

async function apiFetch(path: string, init: RequestInit = {}, identityHints?: IdentityHints) {
  if (typeof window === 'undefined') {
    return authApiFetch(path, init)
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  const token = getToken()
  const headers = new Headers(init.headers || {})

  if (!headers.has('Content-Type') && init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json')
  }

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const storedUser = getStoredUser()
  const emailHint = String(identityHints?.email || storedUser?.email || '').trim()
  const handleHint = String(identityHints?.handle || storedUser?.handle || '').trim()

  if (emailHint && !headers.has('x-evergreen-email')) {
    headers.set('x-evergreen-email', emailHint)
  }

  if (handleHint && !headers.has('x-evergreen-handle')) {
    headers.set('x-evergreen-handle', handleHint)
  }

  const normalizedPath = path.startsWith('/api/') ? path.slice('/api/'.length) : path

  try {
    return await fetch(`/api/evergreen/${normalizedPath}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

function isConnectedAccount(account?: ConnectedAccount | null, status?: AccountStatus | null) {
  const accountConnected =
    String(account?.connection_status || '')
      .trim()
      .toLowerCase() === 'connected'

  if (accountConnected) return true
  if (typeof status?.connected === 'boolean') return status.connected
  if (Boolean(status?.running)) return true
  if (typeof status?.posts_in_rotation === 'number' && status.posts_in_rotation > 0) return true
  if (String(status?.last_action_at || '').trim()) return true
  if (String(status?.next_cycle_at || '').trim()) return true
  if (String(status?.account_handle || '').trim() && String(status?.provider || '').trim()) return true
  return false
}

async function fetchJsonOrThrow(path: string, init: RequestInit = {}, identityHints?: IdentityHints) {
  const res = await apiFetch(path, init, identityHints)
  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    const message =
      typeof json?.detail === 'string'
        ? json.detail
        : typeof json?.message === 'string'
          ? json.message
          : `Evergreen request failed (${res.status})`
    throw new Error(message)
  }

  return json
}

async function fetchAccountsFromGalaxy(
  userId: number,
  identityHints?: IdentityHints,
): Promise<ConnectedAccount[]> {
  const json = (await fetchJsonOrThrow(
    `/api/galaxy?user_id=${encodeURIComponent(String(userId))}&unified=true`,
    {},
    identityHints,
  )) as GalaxyResponse

  const nodes = Array.isArray(json.nodes) ? json.nodes : []
  const deduped = new Map<number, ConnectedAccount>()

  for (const node of nodes) {
    const accountId = Number(node.connected_account_id || 0)
    const provider = String(node.provider || '').trim().toLowerCase()
    const handle = String(node.handle || '').trim()
    if (!accountId || !provider || !handle || deduped.has(accountId)) continue

    deduped.set(accountId, {
      id: accountId,
      provider,
      handle,
      connection_status: 'connected',
    })
  }

  return Array.from(deduped.values()).sort((a, b) => {
    const providerDiff = String(a.provider).localeCompare(String(b.provider))
    if (providerDiff !== 0) return providerDiff
    return a.id - b.id
  })
}

function mergeConnectedAccounts(
  primary: ConnectedAccount[],
  discovered: ConnectedAccount[],
): ConnectedAccount[] {
  const merged = new Map<string, ConnectedAccount>()

  for (const account of [...primary, ...discovered]) {
    const provider = String(account.provider || '').trim().toLowerCase()
    const handle = String(account.handle || '').trim().toLowerCase()
    const key = `${provider}::${handle || account.id}`
    const existing = merged.get(key)

    if (!existing) {
      merged.set(key, {
        ...account,
        connection_status:
          String(account.connection_status || '').trim().toLowerCase() === 'connected'
            ? 'connected'
            : account.connection_status,
      })
      continue
    }

    const existingConnected =
      String(existing.connection_status || '').trim().toLowerCase() === 'connected'
    const accountConnected =
      String(account.connection_status || '').trim().toLowerCase() === 'connected'

    merged.set(key, {
      ...existing,
      ...account,
      id: existingConnected ? existing.id : account.id || existing.id,
      connection_status:
        existingConnected || accountConnected
          ? 'connected'
          : account.connection_status || existing.connection_status,
    })
  }

  return Array.from(merged.values()).sort((a, b) => {
    const providerDiff = String(a.provider || '').localeCompare(String(b.provider || ''))
    if (providerDiff !== 0) return providerDiff
    return Number(a.id || 0) - Number(b.id || 0)
  })
}

function deriveStatusFromGalaxy(account: ConnectedAccount, galaxy: GalaxyResponse): AccountStatus {
  const nodes = Array.isArray(galaxy.nodes) ? galaxy.nodes : []
  const meta = asRecord(galaxy.meta?.metadata)
  const currentNode = nodes.find((node) => Boolean((node as any).current_cycle)) || nodes[0]

  return {
    connected_account_id: account.id,
    running: Boolean(galaxy.meta?.running),
    connected:
      typeof galaxy.meta?.connected === 'boolean'
        ? galaxy.meta.connected
        : String(account.connection_status || '').trim().toLowerCase() === 'connected',
    provider: account.provider,
    account_handle: account.handle,
    posts_in_rotation:
      typeof galaxy.meta?.count === 'number'
        ? galaxy.meta.count
        : nodes.length,
    last_post_text:
      String((currentNode as any)?.label || '').trim() ||
      String((currentNode as any)?.url || '').trim() ||
      null,
    last_action_at:
      typeof galaxy.meta?.last_action_at === 'string' ? galaxy.meta.last_action_at : null,
    next_cycle_at:
      typeof meta?.next_cycle_at === 'string'
        ? meta.next_cycle_at
        : typeof galaxy.meta?.next_cycle_at === 'string'
          ? galaxy.meta.next_cycle_at
          : null,
    metadata: meta || {},
  }
}

function accountScopedGalaxyFromUnified(
  unifiedGalaxy: GalaxyResponse,
  account: ConnectedAccount,
): GalaxyResponse {
  const accountProvider = String(account.provider || '').trim().toLowerCase()
  const accountHandle = String(account.handle || '').trim().toLowerCase()
  const unifiedMeta = asRecord(unifiedGalaxy.meta) || {}
  const unifiedMetadata = asRecord(unifiedMeta.metadata) || {}
  const { next_cycle_at: _sharedNextCycleAt, ...sanitizedUnifiedMeta } = unifiedMeta
  const { next_cycle_at: _sharedMetadataNextCycleAt, ...sanitizedUnifiedMetadata } =
    unifiedMetadata
  const nodes = Array.isArray(unifiedGalaxy.nodes)
    ? unifiedGalaxy.nodes.filter((node) => {
        const nodeAccountId = Number(node.connected_account_id || 0)
        if (nodeAccountId === account.id) return true

        const nodeProvider = String(node.provider || '').trim().toLowerCase()
        const nodeHandle = String(node.handle || '').trim().toLowerCase()
        return Boolean(
          accountProvider &&
            accountHandle &&
            nodeProvider === accountProvider &&
            nodeHandle === accountHandle,
        )
      })
    : []

  const latestActionAt = nodes
    .map((node) => String((node as any).last_resurfaced_at || '').trim())
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null

  return {
    nodes,
    meta: {
      ...sanitizedUnifiedMeta,
      connected_account_id: account.id,
      count: nodes.length,
      connected: true,
      mode: 'single',
      last_action_at: latestActionAt,
      next_cycle_at: null,
      metadata: sanitizedUnifiedMetadata,
    },
  }
}

function mergeAccountStatus(
  status: AccountStatus | null | undefined,
  galaxyStatus: AccountStatus | null | undefined,
): AccountStatus {
  const mergedMetadata = {
    ...(asRecord(galaxyStatus?.metadata) || {}),
    ...(asRecord(status?.metadata) || {}),
  }

  return {
    connected_account_id:
      status?.connected_account_id ?? galaxyStatus?.connected_account_id ?? null,
    running: Boolean(status?.running || galaxyStatus?.running),
    connected:
      typeof status?.connected === 'boolean'
        ? status.connected
        : typeof galaxyStatus?.connected === 'boolean'
          ? galaxyStatus.connected
          : undefined,
    provider: status?.provider || galaxyStatus?.provider,
    account_handle: status?.account_handle || galaxyStatus?.account_handle,
    posts_in_rotation: Math.max(
      Number(status?.posts_in_rotation || 0),
      Number(galaxyStatus?.posts_in_rotation || 0),
    ),
    last_post_text: status?.last_post_text || galaxyStatus?.last_post_text || null,
    last_action_at: status?.last_action_at || galaxyStatus?.last_action_at || null,
    next_cycle_at: status?.next_cycle_at || galaxyStatus?.next_cycle_at || null,
    pacing_mode: status?.pacing_mode,
    pacing_label: status?.pacing_label,
    pacing_description: status?.pacing_description,
    pacing_window_label: status?.pacing_window_label,
    pacing_options: status?.pacing_options,
    breathing_room_active:
      typeof status?.breathing_room_active === 'boolean'
        ? status.breathing_room_active
        : undefined,
    breathing_room_until: status?.breathing_room_until || null,
    breathing_room_reason: status?.breathing_room_reason || null,
    latest_original_post_at: status?.latest_original_post_at || null,
    fresh_post_protection_enabled:
      typeof status?.fresh_post_protection_enabled === 'boolean'
        ? status.fresh_post_protection_enabled
        : undefined,
    metadata: mergedMetadata,
  }
}

async function fetchLaneStatusMap(
  userId: number,
  accounts: ConnectedAccount[],
  identityHints?: IdentityHints,
): Promise<Record<number, AccountStatus>> {
  const entries = await Promise.all(
    accounts.map(async (account) => {
      let statusJson: AccountStatus | null = null
      let galaxyStatus: AccountStatus | null = null

      try {
        const res = await apiFetch(
          `/api/status?user_id=${userId}&connected_account_id=${account.id}`,
          {},
          identityHints,
        )
        if (res.ok) {
          statusJson = (await res.json()) as AccountStatus
        }
      } catch {
        // ignore account-specific status failures
      }

      try {
        const galaxyJson = (await fetchJsonOrThrow(
          `/api/galaxy?user_id=${encodeURIComponent(String(userId))}&connected_account_id=${account.id}`,
          {},
          identityHints,
        )) as GalaxyResponse
        galaxyStatus = deriveStatusFromGalaxy(account, galaxyJson)
      } catch {
        // ignore account-specific galaxy failures
      }

      const merged = mergeAccountStatus(statusJson, galaxyStatus)
      const hasSignal = Boolean(
        merged.connected ||
          merged.running ||
          (typeof merged.posts_in_rotation === 'number' && merged.posts_in_rotation > 0) ||
          String(merged.last_action_at || '').trim() ||
          String(merged.next_cycle_at || '').trim(),
      )

      return hasSignal ? [account.id, merged] : null
    }),
  )

  return Object.fromEntries(
    entries.filter((entry): entry is [number, AccountStatus] => Array.isArray(entry)),
  )
}

function inferAccountsFromMissionData(
  primary: ConnectedAccount[],
  statusMap: Record<number, AccountStatus>,
  jobs: JobItem[],
  galaxyNodes: GalaxyNode[],
): ConnectedAccount[] {
  const discovered: ConnectedAccount[] = []

  for (const [rawId, status] of Object.entries(statusMap)) {
    const id = Number(rawId)
    const provider = String(status?.provider || '').trim().toLowerCase()
    const handle = String(status?.account_handle || '').trim()
    if (!id || !provider || !handle) continue
    discovered.push({
      id,
      provider,
      handle,
      connection_status: status?.connected ? 'connected' : undefined,
    })
  }

  for (const job of jobs) {
    const id = Number(job.connected_account_id || 0)
    if (!id) continue
    const payload = parseJobPayload(job)
    const provider = String(payload.provider || '').trim().toLowerCase()
    const handle = String(payload.handle || '').trim()
    if (!provider || !handle) continue
    discovered.push({
      id,
      provider,
      handle,
      connection_status: 'connected',
    })
  }

  for (const node of galaxyNodes) {
    const id = Number(node.connected_account_id || 0)
    const provider = String(node.provider || '').trim().toLowerCase()
    const handle = String(node.handle || '').trim()
    if (!id || !provider || !handle) continue
    discovered.push({
      id,
      provider,
      handle,
      connection_status: 'connected',
    })
  }

  return mergeConnectedAccounts(primary, discovered)
}

function DashboardPageClient() {
  const router = useRouter()
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  const { isLoaded: clerkLoaded, userId } = useAuth({ treatPendingAsSignedOut: false })
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [missionHydratedOnce, setMissionHydratedOnce] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [statusMap, setStatusMap] = useState<Record<number, AccountStatus>>({})
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [missionGalaxy, setMissionGalaxy] = useState<GalaxyResponse>({ nodes: [], meta: {} })
  const [optimisticRunningMap, setOptimisticRunningMap] = useState<Record<number, boolean>>({})
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [actionMessage, setActionMessage] = useState('')
  const [error, setError] = useState('')
  const [subscriptionInfo, setSubscriptionInfo] = useState<SubscriptionInfo | null>(null)
  const [billingEmailInput, setBillingEmailInput] = useState('')
  const stardenSectionRef = useRef<HTMLDivElement | null>(null)
  const [stardenPrimed, setStardenPrimed] = useState(false)
  const emptyBootstrapRefreshRef = useRef(false)
  const missionDataRef = useRef({
    accounts: 0,
    jobs: 0,
    galaxyNodes: 0,
    statusEntries: 0,
  })
  const sessionRef = useRef<any>(null)
  const missionRefreshPromiseRef = useRef<Promise<void> | null>(null)
  const pendingMissionRefreshRef = useRef(false)
  const subscriptionRefreshPromiseRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    missionDataRef.current = {
      accounts: accounts.length,
      jobs: jobs.length,
      galaxyNodes: Array.isArray(missionGalaxy.nodes) ? missionGalaxy.nodes.length : 0,
      statusEntries: Object.keys(statusMap).length,
    }
  }, [accounts, jobs, missionGalaxy.nodes, statusMap])

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  function getActiveUserSnapshot() {
    return sessionRef.current?.user || getStoredUser()
  }

  async function refreshSessionUser() {
    const storedUser = getStoredUser()
    const existingToken = getToken()
    const attempts = !existingToken && storedUser ? 3 : 1

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const latest = await me()
        if (latest?.user) {
          setSession(latest)
          return latest
        }
      } catch {
        // fall through to retry or stored-session fallback
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 700))
      }
    }

    try {
      const latest = await me()
      if (latest?.user) {
        setSession(latest)
        return latest
      }
    } catch {
      // fall through to stored-session fallback
    }

    if (storedUser) {
      const fallback = { user: storedUser }
      setSession((current: any) => (current?.user ? current : fallback))
      return fallback as any
    }

    return null
  }

  async function refreshSubscriptionInfo() {
    if (subscriptionRefreshPromiseRef.current) {
      return subscriptionRefreshPromiseRef.current
    }

    subscriptionRefreshPromiseRef.current = (async () => {
    try {
      const res = await apiFetch('/api/auth/subscription')
      const json = await res.json()
      if (res.ok && json?.subscription) {
        setSubscriptionInfo(json.subscription)
        setSession((current: any) => {
          if (!current?.user) return current
          return {
            ...current,
            user: {
              ...current.user,
              subscription_status: json.subscription.status ?? current.user.subscription_status,
              trial_started_at: json.subscription.trial_started_at ?? current.user.trial_started_at,
              trial_ends_at: json.subscription.trial_ends_at ?? current.user.trial_ends_at,
              can_run_autopilot:
                json.subscription.can_run_autopilot ?? current.user.can_run_autopilot,
              stripe_price_id: json.subscription.price_id ?? current.user.stripe_price_id,
              stripe_billing_email:
                json.subscription.billing_email ?? current.user.stripe_billing_email,
              current_period_end:
                json.subscription.current_period_end ?? current.user.current_period_end,
            },
          }
        })
        if (!billingEmailInput && json.subscription.billing_email) {
          setBillingEmailInput(String(json.subscription.billing_email))
        }
      }
    } catch {
      // ignore subscription panel refresh failures during polling
    }
    })().finally(() => {
      subscriptionRefreshPromiseRef.current = null
    })

    return subscriptionRefreshPromiseRef.current
  }

  function currentSubscriptionState() {
    const user = session?.user || {}
    const effectiveStatus = subscriptionInfo?.status ?? user.subscription_status
    const effectiveTrialEndsAt = subscriptionInfo?.trial_ends_at ?? user.trial_ends_at
    const effectiveCanRunAutopilot =
      typeof subscriptionInfo?.can_run_autopilot === 'boolean'
        ? subscriptionInfo.can_run_autopilot
        : user.can_run_autopilot

    const rawStatus = String(effectiveStatus || 'inactive').trim().toLowerCase()
    const trialEndsAt =
      typeof effectiveTrialEndsAt === 'string' ? effectiveTrialEndsAt : null
    const trialEndsAtDate = parseApiDate(trialEndsAt)
    const trialActive = Boolean(trialEndsAtDate && trialEndsAtDate.getTime() > nowMs)

    if (rawStatus === 'active') {
      return {
        subscriptionStatus: 'active',
        trialEndsAt,
        canRunAutopilot:
          typeof effectiveCanRunAutopilot === 'boolean' ? effectiveCanRunAutopilot : true,
      }
    }

    if (trialActive) {
      return {
        subscriptionStatus: 'trialing',
        trialEndsAt,
        canRunAutopilot:
          typeof effectiveCanRunAutopilot === 'boolean' ? effectiveCanRunAutopilot : true,
      }
    }

    if (trialEndsAt) {
      return {
        subscriptionStatus: 'expired',
        trialEndsAt,
        canRunAutopilot:
          typeof effectiveCanRunAutopilot === 'boolean' ? effectiveCanRunAutopilot : false,
      }
    }

    return {
      subscriptionStatus: rawStatus || 'inactive',
      trialEndsAt: null,
      canRunAutopilot: Boolean(effectiveCanRunAutopilot),
    }
  }

  useEffect(() => {
    if (!clerkEnabled) return
    if (!clerkLoaded) return

    const token = getToken()
    const storedUser = getStoredUser()
    if (!userId && !token && !storedUser) {
      setSession(null)
      setLoading(false)
      router.replace('/login')
      return
    }

    if (storedUser) {
      setSession((current: any) => (current?.user ? current : { user: storedUser }))
      setBillingEmailInput((current) => current || storedUser.email || '')
      setLoading(false)
    }
  }, [clerkEnabled, clerkLoaded, router, userId])

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      const storedUser = getStoredUser()

      if (storedUser && mounted) {
        setSession((current: any) => (current?.user ? current : { user: storedUser }))
        setBillingEmailInput((current) => current || storedUser.email || '')
        setLoading(false)
      }

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
        if (!data?.user) {
          if (!storedUser) {
            setSession(null)
            router.replace('/login')
          }
          return
        }

        setSession(data)
        if (data.user.email) {
          setBillingEmailInput((current) => current || data.user.email)
          await refreshSubscriptionInfo()
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
      router.replace('/login')
    }, 7000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [error, loading, router])

  function scrollToStarden() {
    setStardenPrimed(true)
    stardenSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const section = stardenSectionRef.current
    if (!section || stardenPrimed) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        setStardenPrimed(true)
        observer.disconnect()
      },
      { rootMargin: '360px 0px' }
    )

    observer.observe(section)
    return () => observer.disconnect()
  }, [stardenPrimed])

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
    router.replace('/login')
  }, [error, loading, router, session])

  useEffect(() => {
    function handleAuthChanged() {
      const activeUser = getActiveUserSnapshot()
      if (activeUser) {
        void refreshMissionControlNow()
        scheduleFollowupRefreshes()
      }

      refreshSessionUser()
        .then((latest) => {
          if (latest?.user && !activeUser) {
            void refreshMissionControlNow()
            scheduleFollowupRefreshes()
          }
        })
        .catch(() => {
          // ignore transient auth change refresh failures
        })
    }

    window.addEventListener('evergreen-auth-changed', handleAuthChanged)
    return () => {
      window.removeEventListener('evergreen-auth-changed', handleAuthChanged)
    }
  }, [session])

  async function refreshMissionControlNow() {
    if (missionRefreshPromiseRef.current) {
      pendingMissionRefreshRef.current = true
      return missionRefreshPromiseRef.current
    }

    missionRefreshPromiseRef.current = (async () => {
      do {
        pendingMissionRefreshRef.current = false

        try {
          let activeUser = getActiveUserSnapshot()

          if (!activeUser) {
            const latestSession = await refreshSessionUser()
            activeUser = latestSession?.user || null
          } else {
            void refreshSessionUser().catch(() => {
              // keep using current local Evergreen identity if background verification lags
            })
          }

          if (!activeUser) return

          setStoredUser(activeUser)
          setSession((current: any) =>
            current?.user ? { ...current, user: { ...current.user, ...activeUser } } : { user: activeUser }
          )
          void refreshSubscriptionInfo()

          const identityHints = {
            email: activeUser.email,
            handle: activeUser.handle,
          }

          const userId = activeUser.id || 1
          const [systemResult, accountsResult, jobsResult, galaxyResult] = await Promise.allSettled([
            fetchJsonOrThrow('/api/system-status', {}, identityHints),
            fetchJsonOrThrow(`/api/connected-accounts?user_id=${userId}`, {}, identityHints),
            fetchJsonOrThrow(`/api/jobs?user_id=${userId}`, {}, identityHints),
            fetchJsonOrThrow(
              `/api/galaxy?user_id=${encodeURIComponent(String(userId))}&unified=true`,
              {},
              identityHints,
            ),
          ])

          if (systemResult.status === 'fulfilled') {
            setSystem(systemResult.value)
          }

          let discoveredAccounts: ConnectedAccount[] = []
          let galaxySnapshot: GalaxyResponse | null = null
          if (galaxyResult.status === 'fulfilled') {
            galaxySnapshot = galaxyResult.value as GalaxyResponse
            discoveredAccounts = Array.isArray(galaxySnapshot.nodes)
              ? mergeConnectedAccounts([], inferAccountsFromMissionData([], {}, [], galaxySnapshot.nodes))
              : []
          }

          if (galaxySnapshot) {
            setMissionGalaxy({
              nodes: Array.isArray(galaxySnapshot.nodes) ? galaxySnapshot.nodes : [],
              meta: galaxySnapshot.meta || {},
            })
          }

          let nextAccounts: ConnectedAccount[] = []
          if (accountsResult.status === 'fulfilled') {
            const accountsJson = accountsResult.value
            nextAccounts = Array.isArray(accountsJson.accounts)
              ? accountsJson.accounts
              : Array.isArray(accountsJson)
                ? accountsJson
                : []
          }

          nextAccounts = mergeConnectedAccounts(nextAccounts, discoveredAccounts)

          if (nextAccounts.length > 0) {
            setAccounts(nextAccounts)
            const nextStatusMap = await fetchLaneStatusMap(userId, nextAccounts, identityHints)
            setStatusMap((current) =>
              Object.keys(nextStatusMap).length > 0 || Object.keys(current).length === 0
                ? nextStatusMap
                : current,
            )
          }

          if (jobsResult.status === 'fulfilled') {
            const jobsJson = jobsResult.value
            const nextJobs = Array.isArray(jobsJson.jobs)
              ? jobsJson.jobs
              : Array.isArray(jobsJson)
                ? jobsJson
                : []
            if (nextJobs.length > 0 || missionDataRef.current.jobs === 0) {
              setJobs(nextJobs)
            }
          }

          setError('')
        } catch {
          // ignore silent refresh failures
        }
      } while (pendingMissionRefreshRef.current)
    })().finally(() => {
      missionRefreshPromiseRef.current = null
    })

    return missionRefreshPromiseRef.current
  }

  function scheduleFollowupRefreshes() {
    window.setTimeout(refreshMissionControlNow, 1200)
    window.setTimeout(refreshMissionControlNow, 4000)
    window.setTimeout(refreshMissionControlNow, 8000)
  }

  async function waitForConnectedProvider(
    provider: string,
    options?: { attempts?: number; delayMs?: number; connectedAccountId?: number | null }
  ) {
    const storedUser = getStoredUser()
    const activeUser = session?.user || storedUser
    if (!activeUser?.id) return false

    const attempts = options?.attempts ?? 20
    const delayMs = options?.delayMs ?? 350
    const expectedAccountId = options?.connectedAccountId ?? null
    const target = provider.toLowerCase()
    const identityHints = {
      email: activeUser.email,
      handle: activeUser.handle,
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const res = await apiFetch(
          `/api/connected-accounts?user_id=${activeUser.id}`,
          {},
          identityHints,
        )
        const json = await res.json().catch(() => ({}))
        const nextAccounts = Array.isArray(json.accounts)
          ? json.accounts
          : Array.isArray(json)
            ? json
            : []

        if (
          nextAccounts.some((account: ConnectedAccount) => {
            const accountProvider = String(account.provider || '').toLowerCase()
            const accountId = Number(account.id || 0)
            return (
              accountProvider === target &&
              (!expectedAccountId || accountId === expectedAccountId) &&
              String(account.connection_status || '').toLowerCase() === 'connected'
            )
          })
        ) {
          setAccounts((current) => mergeConnectedAccounts(current, nextAccounts))
          void fetchLaneStatusMap(activeUser.id, nextAccounts, identityHints).then((nextStatusMap) => {
            setStatusMap((current) =>
              Object.keys(nextStatusMap).length > 0 || Object.keys(current).length === 0
                ? nextStatusMap
                : current,
            )
          })
          void refreshMissionControlNow()
          return true
        }
      } catch {
        // ignore transient polling failures during OAuth handoff
      }

      await new Promise((resolve) => window.setTimeout(resolve, delayMs))
    }

    return false
  }

  useEffect(() => {
    if (!session?.user) return

    let mounted = true

    async function loadMissionControl() {
      try {
        await refreshMissionControlNow()
      } finally {
        if (mounted) {
          setMissionHydratedOnce(true)
        }
      }
    }

    loadMissionControl()
    window.setTimeout(loadMissionControl, 1200)
    window.setTimeout(loadMissionControl, 3500)
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

    if (params.get('provider') === 'x' && params.get('connected') === '1' && session?.user) {
      const connectedAccountId = Number(params.get('connected_account_id') || 0) || null
      setActionMessage('Finalizing X connection…')
      void refreshMissionControlNow()
      scheduleFollowupRefreshes()
      ;(async () => {
        const connected = await waitForConnectedProvider('x', { connectedAccountId })
        if (connected) {
          setActionMessage('X account connected.')
          scheduleFollowupRefreshes()
        } else {
          setError('X connected, but the dashboard is still syncing. Refresh once in a few seconds.')
        }

        params.delete('provider')
        params.delete('connected')
        params.delete('connected_account_id')
        const next = params.toString()
        const url = next ? `${window.location.pathname}?${next}` : window.location.pathname
        window.history.replaceState({}, '', url)
      })()
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

  const resolvedAccounts = useMemo(
    () =>
      inferAccountsFromMissionData(
        accounts,
        statusMap,
        jobs,
        Array.isArray(missionGalaxy.nodes) ? missionGalaxy.nodes : []
      ),
    [accounts, jobs, missionGalaxy.nodes, statusMap]
  )

  useEffect(() => {
    if (!session?.user || loading || !missionHydratedOnce) return

    const hasMissionData =
      resolvedAccounts.length > 0 ||
      jobs.length > 0 ||
      (Array.isArray(missionGalaxy.nodes) ? missionGalaxy.nodes.length > 0 : false) ||
      Object.keys(statusMap).length > 0

    if (hasMissionData) {
      emptyBootstrapRefreshRef.current = false
      return
    }

    if (emptyBootstrapRefreshRef.current) return
    emptyBootstrapRefreshRef.current = true

    void refreshMissionControlNow()
    window.setTimeout(() => {
      void refreshMissionControlNow()
    }, 1200)
    window.setTimeout(() => {
      void refreshMissionControlNow()
    }, 3200)
  }, [jobs.length, loading, missionGalaxy.nodes, missionHydratedOnce, resolvedAccounts.length, session, statusMap])

  const summary = useMemo(() => {
    const heartbeat = system?.worker?.heartbeat || {}
    const accountStatuses = Object.values(statusMap)
    const galaxyCount = Array.isArray(missionGalaxy.nodes) ? missionGalaxy.nodes.length : 0
    const hasMissionData =
      resolvedAccounts.length > 0 || accountStatuses.length > 0 || jobs.length > 0 || galaxyCount > 0

    const postsInRotationFromStatus = accountStatuses.reduce(
      (sum, item) => sum + (item.posts_in_rotation || 0),
      0
    )
    const postsInRotation = postsInRotationFromStatus > 0 ? postsInRotationFromStatus : galaxyCount

    const connectedCount =
      resolvedAccounts.filter((account) => isConnectedAccount(account, statusMap[account.id]))
        .length || resolvedAccounts.length

    const nextCycleCandidates = accountStatuses
      .map((item) => item.next_cycle_at)
      .filter(Boolean) as string[]

    const nextCycle =
      nextCycleCandidates.length > 0
        ? nextCycleCandidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
        : null

    const inferredWorkerState =
      system?.worker?.ok
        ? heartbeat.status || 'running'
        : accountStatuses.some((item) => item.running)
          ? 'running'
          : missionGalaxy.meta?.running
            ? 'running'
          : hasMissionData
            ? 'idle'
            : 'offline'

    return {
      backendOnline: typeof system?.backend?.ok === 'boolean' ? !!system.backend.ok : hasMissionData,
      workerState: inferredWorkerState,
      queued: heartbeat.queued ?? 0,
      processed: heartbeat.processed ?? 0,
      syncedAccounts: heartbeat.synced_accounts ?? resolvedAccounts.length,
      repairedJobs: heartbeat.repaired_jobs ?? 0,
      pollSeconds: heartbeat.poll_seconds ?? 0,
      heartbeatAt: heartbeat.timestamp ?? null,
      workerError: heartbeat.error || null,
      postsInRotation,
      connectedCount: connectedCount || Number(missionGalaxy.meta?.account_count || 0),
      nextCycle,
    }
  }, [jobs, missionGalaxy.meta, missionGalaxy.nodes, resolvedAccounts, system, statusMap])

  const derivedUnifiedStatusMap = useMemo(() => {
    if (!Array.isArray(missionGalaxy.nodes) || missionGalaxy.nodes.length === 0) {
      return {} as Record<number, AccountStatus>
    }

    return Object.fromEntries(
      resolvedAccounts.map((account) => {
        const scopedGalaxy = accountScopedGalaxyFromUnified(missionGalaxy, account)
        return [account.id, deriveStatusFromGalaxy(account, scopedGalaxy)]
      }),
    )
  }, [missionGalaxy, resolvedAccounts])

  const effectiveStatusMap = useMemo(
    () =>
      Object.fromEntries(
        resolvedAccounts.map((account) => [
          account.id,
          mergeAccountStatus(statusMap[account.id], derivedUnifiedStatusMap[account.id]),
        ]),
      ),
    [derivedUnifiedStatusMap, resolvedAccounts, statusMap],
  )

  const deploymentWindows = useMemo(() => {
    const providerOrder = ['x', 'bluesky']
    const jobFreshnessWindowSeconds = Number(system?.worker?.heartbeat?.poll_seconds || 0)

    return resolvedAccounts
      .slice()
      .sort((a, b) => {
        const providerDiff =
          providerOrder.indexOf(String(a.provider || '').toLowerCase()) -
          providerOrder.indexOf(String(b.provider || '').toLowerCase())
        if (providerDiff !== 0) return providerDiff
        return a.id - b.id
      })
      .map((account) => {
        const status = effectiveStatusMap[account.id]
        const meta = asRecord(status?.metadata)
        const laneJobs = jobs.filter((job) => job.connected_account_id === account.id)
        const latestJob = laneJobs[0]
        const activeRefreshJob = laneJobs.find((job) => {
          if (job.connected_account_id !== account.id) return false
          const jobType = String(job.job_type || job.type || '').trim().toLowerCase()
          return (
            jobType.includes('refresh') &&
            isFreshJobActivity(job, nowMs, jobFreshnessWindowSeconds)
          )
        })
        const latestInformativeJob =
          laneJobs.find((job) => {
            const payload = parseJobPayload(job)
            return hasInformativeJobPayload(payload)
          }) || latestJob
        const activeRefreshPayload = activeRefreshJob ? parseJobPayload(activeRefreshJob) : null
        const displayPayload = latestInformativeJob ? parseJobPayload(latestInformativeJob) : null
        const payload = activeRefreshPayload || displayPayload
        const rotationHealth =
          payload?.rotation_health || displayPayload?.rotation_health || activeRefreshPayload?.rotation_health || {}
        const effectivePostsInRotation =
          typeof status?.posts_in_rotation === 'number' && status.posts_in_rotation > 0
            ? status.posts_in_rotation
            : typeof rotationHealth.pool_size === 'number'
              ? rotationHealth.pool_size
              : 0
        const effectiveLastActionAt =
          status?.last_action_at ||
          displayPayload?.last_action_at ||
          activeRefreshPayload?.last_action_at ||
          latestInformativeJob?.finished_at ||
          latestInformativeJob?.last_heartbeat_at ||
          latestInformativeJob?.started_at ||
          latestInformativeJob?.created_at ||
          activeRefreshJob?.last_heartbeat_at ||
          activeRefreshJob?.started_at ||
          activeRefreshJob?.created_at ||
          null
        const effectiveNextCycleAt =
          status?.next_cycle_at || activeRefreshPayload?.next_cycle_at || displayPayload?.next_cycle_at || null
        const jobDerivedRunning =
          String(activeRefreshJob?.status || activeRefreshJob?.state || '')
            .trim()
            .toLowerCase() === 'running'
        const jobDerivedQueued =
          String(activeRefreshJob?.status || activeRefreshJob?.state || '')
            .trim()
            .toLowerCase() === 'queued'
        const inferredHealthyRunning = inferHealthyLane(status)
        const laneHasLiveCycleSignal = Boolean(
          effectivePostsInRotation > 0 ||
            (String(effectiveLastActionAt || '').trim() &&
              String(effectiveNextCycleAt || '').trim()),
        )
        const optimisticRunning = optimisticRunningMap[account.id]
        const effectiveRunning =
          typeof optimisticRunning === 'boolean'
            ? optimisticRunning
            : Boolean(
                status?.running ||
                  jobDerivedRunning ||
                  jobDerivedQueued ||
                  inferredHealthyRunning ||
                  laneHasLiveCycleSignal,
              )

        const latestPost =
          status?.last_post_text ||
          displayPayload?.message ||
          activeRefreshPayload?.message ||
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
          latestInformativeJob,
          activeRefreshJob,
          effectiveRunning,
          effectivePostsInRotation,
          latestHeadline: latestInformativeJob
            ? headlineForJob(latestInformativeJob, displayPayload || {})
            : latestJob
              ? headlineForJob(latestJob, activeRefreshPayload || {})
              : 'Deployment lane idle',
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
                : countdownUntil(effectiveNextCycleAt, nowMs),
          nextCycleText: fmtWhen(effectiveNextCycleAt),
          lastActionText: fmtWhen(effectiveLastActionAt),
        }
      })
  }, [effectiveStatusMap, jobs, nowMs, optimisticRunningMap, resolvedAccounts, system?.worker?.heartbeat?.poll_seconds])

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

    const token = getToken()
    if (!token) {
      setError('Missing Evergreen session token. Please sign in again.')
      return
    }

    setActionMessage('')
    setError('')
    setBusyAction('connect-x')

    window.location.assign(
      `${API_BASE}/api/providers/x/start?user_id=${encodeURIComponent(String(session.user.id))}&auth_token=${encodeURIComponent(token)}`
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

      const connectedAccountId =
        Number(json.connected_account_id || json.status?.connected_account_id || 0) || null
      const connected = await waitForConnectedProvider('bluesky', { connectedAccountId })

      setActionMessage(
        connected
          ? `Connected Bluesky for ${json.account_handle || handle}.`
          : `Connected Bluesky for ${json.account_handle || handle}. Finalizing lane…`
      )
      scheduleFollowupRefreshes()
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
      resolvedAccounts.some((account) => String(account.provider || '').trim().toLowerCase() === 'bluesky') ||
      resolvedAccounts.length > 1
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
      setOptimisticRunningMap((current) => ({
        ...current,
        [accountId]: enabled,
      }))
      setStatusMap((current) => ({
        ...current,
        [accountId]: {
          ...(current[accountId] || {}),
          connected_account_id: accountId,
          connected:
            typeof current[accountId]?.connected === 'boolean' ? current[accountId]?.connected : true,
          running: enabled,
        },
      }))
      await refreshMissionControlNow()
      window.setTimeout(refreshMissionControlNow, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update autopilot')
    }
  }

  async function handleGlobalAutopilotAction() {
    if (!session?.user) return
    const { canRunAutopilot } = currentSubscriptionState()
    const readyAccounts = resolvedAccounts.filter((account) =>
      isConnectedAccount(account, statusMap[account.id])
    )
    const runningTargets = readyAccounts.filter((account) => statusMap[account.id]?.running)
    const idleTargets = readyAccounts.filter((account) => !statusMap[account.id]?.running)
    const upgradeHref =
      resolvedAccounts.some((account) => String(account.provider || '').trim().toLowerCase() === 'bluesky') ||
      resolvedAccounts.length > 1
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
  const accountMap = new Map(resolvedAccounts.map((account) => [account.id, account]))
  const connectedProviders = new Set(
    resolvedAccounts
      .filter((account) => isConnectedAccount(account, effectiveStatusMap[account.id]))
      .map((account) => String(account.provider || '').trim().toLowerCase())
      .filter(Boolean)
  )
  const xAccount = resolvedAccounts.find(
    (account) => String(account.provider || '').trim().toLowerCase() === 'x'
  )
  const blueskyAccount = resolvedAccounts.find(
    (account) => String(account.provider || '').trim().toLowerCase() === 'bluesky'
  )
  const anyAutopilotRunning = deploymentWindows.some((lane) => lane.effectiveRunning)
  const connectedLaneCount = resolvedAccounts.filter((account) =>
    isConnectedAccount(account, effectiveStatusMap[account.id])
  ).length
  const hasMissionSignals =
    resolvedAccounts.length > 0 ||
    jobs.length > 0 ||
    (Array.isArray(missionGalaxy.nodes) ? missionGalaxy.nodes.length > 0 : false) ||
    Object.keys(statusMap).length > 0
  const missionHydrating = !error && !missionHydratedOnce && !hasMissionSignals
  const embeddedMissionUser = session?.user || getStoredUser() || null
  const embeddedMissionUserId = embeddedMissionUser?.id ?? null
  const embeddedMissionIdentityHints = {
    email: embeddedMissionUser?.email ?? null,
    handle: embeddedMissionUser?.handle ?? null,
  }
  const runningLaneCount = deploymentWindows.filter(
    (lane) => isConnectedAccount(lane.account, effectiveStatusMap[lane.account.id]) && lane.effectiveRunning
  ).length
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
    missionHydrating
      ? null
      : connectedLaneCount === 0
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
  const standardFriendly = resolvedAccounts.filter(
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
      detail: resolvedAccounts.length > 0
        ? 'Watch selections and refresh timing below.'
        : 'Starden gets more useful once a lane is connected.',
      kind: resolvedAccounts.length > 0 ? 'good' : 'neutral',
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
  const activePlanLabel = subscriptionInfo?.plan || (subscriptionStatus === 'active' ? 'Paid' : null)

  return (
    <main className="page mission-page">
      <div className="shell">
        <header className="header mission-header-block">
          <div>
            <div className="wordmark">Evergreen Mission Control</div>
            <div className="subtle">One live surface for your resurfacing engine and Starden.</div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={async () => {
                setBusyAction('logout')
                try {
                  await Promise.race([
                    logout(),
                    new Promise<void>((resolve) => {
                      window.setTimeout(resolve, 3000)
                    }),
                  ])
                } finally {
                  window.location.assign(`${getAppBase()}/login?fresh=1`)
                }
              }}
              disabled={busyAction === 'logout'}
            >
              {busyAction === 'logout' ? 'Logging out...' : 'Logout'}
            </button>
          </div>
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

        {subscriptionInfo ? (
          <section
            className="card"
            style={{
              marginTop: 10,
              borderColor:
                subscriptionInfo.status === 'active'
                  ? 'rgba(156,227,169,0.2)'
                  : 'rgba(255,255,255,0.08)',
              background:
                subscriptionInfo.status === 'active'
                  ? 'linear-gradient(135deg, rgba(16,185,129,0.07), rgba(7,17,11,0.82))'
                  : 'rgba(7,17,11,0.82)',
            }}
          >
            <div style={missionEyebrowStyle}>Subscription</div>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {activePlanLabel ? <span style={statusPillStyle('good')}>{activePlanLabel}</span> : null}
              <span
                style={statusPillStyle(
                  subscriptionInfo.status === 'active'
                    ? 'good'
                    : subscriptionInfo.status === 'trialing'
                      ? 'warn'
                      : 'neutral'
                )}
              >
                {String(subscriptionInfo.status || 'inactive').replace(/^./, (m) => m.toUpperCase())}
              </span>
              {subscriptionInfo.billing_email ? (
                <span style={statusPillStyle('neutral')}>Billing: {subscriptionInfo.billing_email}</span>
              ) : null}
              {subscriptionInfo.current_period_end ? (
                <span style={statusPillStyle('neutral')}>
                  Renews {new Date(subscriptionInfo.current_period_end).toLocaleDateString()}
                </span>
              ) : null}
            </div>

            {subscriptionInfo.status !== 'active' ? (
              <>
                <div style={{ marginTop: 12, color: 'rgba(236,253,245,0.72)', maxWidth: 780, lineHeight: 1.6 }}>
                  If you paid with a different billing email through Link or Stripe, you can claim that subscription here and attach it to this Evergreen account.
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
                  <input
                    value={billingEmailInput}
                    onChange={(event) => setBillingEmailInput(event.target.value)}
                    placeholder="Billing email used at checkout"
                    style={{
                      minWidth: 280,
                      flex: '1 1 320px',
                      background: 'rgba(12,26,19,0.95)',
                      color: '#ecfdf5',
                      border: '1px solid rgba(110,231,183,0.18)',
                      borderRadius: 14,
                      padding: '12px 14px',
                    }}
                  />
                  <button
                    className="btn"
                    disabled={busyAction === 'claim-subscription'}
                    onClick={async () => {
                      setBusyAction('claim-subscription')
                      setError('')
                      setActionMessage('')
                      try {
                        const res = await apiFetch('/api/auth/subscription/claim', {
                          method: 'POST',
                          body: JSON.stringify({ billing_email: billingEmailInput }),
                        })
                        const json = await res.json()
                        if (!res.ok) {
                          throw new Error(json?.detail || 'Could not claim subscription')
                        }
                        await refreshSessionUser()
                        await refreshSubscriptionInfo()
                        setActionMessage('Subscription linked to this account.')
                      } catch (claimError) {
                        setError(
                          claimError instanceof Error
                            ? claimError.message
                            : 'Could not claim subscription'
                        )
                      } finally {
                        setBusyAction(null)
                      }
                    }}
                  >
                    {busyAction === 'claim-subscription' ? 'Linking…' : 'Claim paid subscription'}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}

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

              <button
                className="btn primary"
                onClick={scrollToStarden}
              >
                ✦ Jump to Starden
              </button>
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

        <section
          id="starden-panel"
          ref={stardenSectionRef}
          className="card"
          style={{
            marginTop: 18,
            padding: 18,
            background: 'linear-gradient(180deg, rgba(8,26,18,0.92), rgba(3,18,15,0.88))',
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <div style={missionEyebrowStyle}>Starden</div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em' }}>
              Constellation View
            </div>
          </div>

          {stardenPrimed ? (
            <EmbeddedGalaxySurface
              embedded
              embeddedUserId={embeddedMissionUserId}
              embeddedIdentityHints={embeddedMissionIdentityHints}
              embeddedAccounts={resolvedAccounts}
              embeddedStatusMap={statusMap}
              embeddedUnifiedGalaxy={missionGalaxy}
            />
          ) : (
            <div
              style={{
                minHeight: 720,
                borderRadius: 26,
                border: '1px solid rgba(52,211,153,0.16)',
                background:
                  'linear-gradient(180deg, rgba(3,18,15,0.96), rgba(2,12,11,0.92))',
                display: 'grid',
                gap: 16,
                alignContent: 'center',
                justifyItems: 'center',
                padding: 28,
                textAlign: 'center',
              }}
            >
              <div style={{ ...missionEyebrowStyle, marginBottom: 4 }}>Starden</div>
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em' }}>
                Constellation preview loads when you reach it
              </div>
              <div style={{ maxWidth: 620, color: 'rgba(236,253,245,0.7)', lineHeight: 1.7 }}>
                Mission Control stays light on first paint, then the live galaxy wakes up as you scroll here or use
                Jump to Starden.
              </div>
            </div>
          )}
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

          {missionHydrating ? (
            <div>Syncing live mission data…</div>
          ) : resolvedAccounts.length === 0 ? (
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
                const activeRefreshState = String(
                  lane.activeRefreshJob?.status || lane.activeRefreshJob?.state || ''
                )
                  .trim()
                  .toLowerCase()
                const refreshBusy =
                  activeRefreshState === 'queued' || activeRefreshState === 'running'
                const nextRefreshCountdown = lane.nextRefreshCountdown
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
                          onClick={() => handleToggleAutopilot(account.id, !lane.effectiveRunning)}
                        >
                        {lane.effectiveRunning
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
                              lane.effectiveRunning ? 'good' : canRunAutopilot ? 'neutral' : 'warn'
                            ),
                          }}
                        >
                          Autopilot {lane.effectiveRunning ? 'Running' : canRunAutopilot ? 'Idle' : 'Locked'}
                        </span>

                          <span
                            className="btn"
                            style={{
                              cursor: 'default',
                              ...statusPillStyle('neutral'),
                          }}
                          >
                            Rotation {lane.effectivePostsInRotation}
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

const DashboardPage = dynamic(async () => DashboardPageClient, {
  ssr: false,
})

export default DashboardPage
