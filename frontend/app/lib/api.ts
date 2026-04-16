'use client'

import { apiFetch, me } from './auth'

export type Status = {
  user_id: number
  running: boolean
  connected: boolean
  provider: string
  account_handle: string
  posts_in_rotation: number
  last_post_text?: string | null
  last_action_at?: string | null
  next_cycle_at?: string | null
}

export type JobRecord = {
  id: string
  job_type: string
  status: string
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
  payload?: Record<string, unknown>
  result?: Record<string, any> | null
  error?: string | null
}

async function resolveUserId() {
  const session = await me()
  return session?.user?.id ?? 1
}

export async function getStatus(): Promise<Status> {
  const userId = await resolveUserId()
  const res = await apiFetch(`/api/status?user_id=${userId}`)

  if (!res.ok) {
    throw new Error('Failed to load status')
  }

  return res.json()
}

export async function toggleAutopilot(enabled: boolean): Promise<Status> {
  const userId = await resolveUserId()
  const res = await apiFetch(`/api/status/toggle?user_id=${userId}`, {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  })

  if (!res.ok) {
    throw new Error('Failed to toggle autopilot')
  }

  return res.json()
}

export async function connectProvider(provider = 'x'): Promise<Status> {
  const userId = await resolveUserId()
  const res = await apiFetch(`/api/providers/connect?user_id=${userId}`, {
    method: 'POST',
    body: JSON.stringify({ provider }),
  })

  if (!res.ok) {
    throw new Error('Failed to connect provider')
  }

  return res.json()
}

export async function disconnectProvider(): Promise<Status> {
  const userId = await resolveUserId()
  const res = await apiFetch(`/api/providers/disconnect?user_id=${userId}`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error('Failed to disconnect provider')
  }

  return res.json()
}

export async function refreshNow(): Promise<{ ok: boolean; job: JobRecord }> {
  const userId = await resolveUserId()
  const res = await apiFetch(`/api/jobs/refresh-now?user_id=${userId}`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error('Failed to queue refresh')
  }

  return res.json()
}

export async function runAnalytics(): Promise<{ ok: boolean; job: JobRecord }> {
  const userId = await resolveUserId()
  const res = await apiFetch(`/api/jobs/run-analytics?user_id=${userId}`, {
    method: 'POST',
  })

  if (!res.ok) {
    throw new Error('Failed to queue analytics')
  }

  return res.json()
}

export async function getJobs(limit = 20): Promise<JobRecord[]> {
  const res = await apiFetch(`/api/jobs?limit=${limit}`)

  if (!res.ok) {
    throw new Error('Failed to load jobs')
  }

  const json = await res.json()
  return Array.isArray(json.jobs) ? json.jobs : []
}