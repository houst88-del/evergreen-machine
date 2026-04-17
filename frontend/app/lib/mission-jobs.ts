export type JobItem = {
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

export type JobPayload = {
  provider?: string
  handle?: string
  message?: string
  error?: string
  debug_notes?: string[]
  next_step?: string
  last_action_at?: string | null
  next_cycle_at?: string | null
  cycle_events?: string[]
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function safeText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function providerLabel(provider?: string) {
  const p = String(provider || '').toLowerCase()
  if (p === 'x' || p === 'twitter') return 'X'
  if (p === 'bluesky' || p === 'bsky') return 'Bluesky'
  return provider || 'Provider'
}

export function startCase(value?: string | null) {
  const raw = String(value || '').trim()
  if (!raw) return 'Unknown'
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function compactNumber(value: unknown) {
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : '—'
}

export function parseJobPayload(job: JobItem): JobPayload {
  const result = asRecord(job.result)
  const message = asRecord(job.message)
  const merged = { ...(message || {}), ...(result || {}) }
  const cycleEvents = Array.isArray(merged.cycle_events)
    ? merged.cycle_events.filter((item): item is string => typeof item === 'string')
    : []
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
    cycle_events: cycleEvents,
    pacing_mode: typeof merged.pacing_mode === 'string' ? merged.pacing_mode : undefined,
    pacing_reason: typeof merged.pacing_reason === 'string' ? merged.pacing_reason : undefined,
    next_delay_minutes:
      typeof merged.next_delay_minutes === 'number' ? merged.next_delay_minutes : undefined,
    rotation_health: asRecord(merged.rotation_health) as JobPayload['rotation_health'],
  }
}

export function normalizedJobType(job: JobItem) {
  return String(job.type || job.job_type || '').trim().toLowerCase()
}

export function normalizedJobState(job: JobItem) {
  return String(job.state || job.status || '').trim().toLowerCase()
}

export function headlineForJob(job: JobItem, payload: JobPayload) {
  const provider = providerLabel(payload.provider)
  const lowerMessage = String(payload.message || '').toLowerCase()
  const type = normalizedJobType(job)
  const state = normalizedJobState(job)

  if (state.includes('fail') || state.includes('error')) {
    if (type.includes('analytics')) return `${provider} analytics failed`
    if (type.includes('refresh')) return `${provider} refresh failed`
    return `${provider} mission failure`
  }

  if (lowerMessage.includes('importer complete')) return `${provider} import complete`
  if (lowerMessage.includes('resurfaced') || lowerMessage.includes('retweeted')) {
    return `${provider} resurfaced post`
  }
  if (type.includes('analytics')) return `${provider} analytics sweep`
  if (type.includes('refresh')) return `${provider} refresh cycle`
  return `${provider} mission update`
}

export function jobStateTone(value?: string) {
  const state = String(value || '').toLowerCase()
  if (state.includes('fail') || state.includes('error')) return 'danger' as const
  if (state.includes('complete') || state.includes('success') || state.includes('done')) {
    return 'mint' as const
  }
  if (state.includes('run') || state.includes('queue') || state.includes('process')) {
    return 'gold' as const
  }
  return 'neutral' as const
}
