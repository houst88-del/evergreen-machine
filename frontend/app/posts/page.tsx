'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getToken, me } from '../lib/auth'
import { missionBadgeStyle, missionEyebrowStyle } from '../lib/mission-ui'
import {
  compactNumber,
  headlineForJob,
  humanizeCycleEvent,
  humanizeNextStep,
  humanizeStrategyLabel,
  jobStateTone,
  parseJobPayload,
  providerLabel,
  startCase,
  type JobItem,
} from '../lib/mission-jobs'

type ConnectedAccount = {
  id: number
  provider: string
  handle: string
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

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

function fmtWhen(value?: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
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

export default function PostsPage() {
  const [userId, setUserId] = useState<number | null>(null)
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [statusMap, setStatusMap] = useState<Record<number, AccountStatus>>({})
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadSession() {
      const session = await me()
      if (!mounted) return
      setUserId(session?.user?.id ?? null)
      if (!session?.user?.id) {
        setLoading(false)
        setError('No active login found.')
      }
    }

    loadSession()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!userId) return

    let mounted = true

    async function load() {
      try {
        setError('')

        const accountsRes = await apiFetch(`/api/connected-accounts?user_id=${userId}`)
        const accountsJson = await accountsRes.json()
        const nextAccounts = Array.isArray(accountsJson.accounts) ? accountsJson.accounts : []

        const nextStatusMap: Record<number, AccountStatus> = {}
        for (const account of nextAccounts) {
          const res = await apiFetch(`/api/status?user_id=${userId}&connected_account_id=${account.id}`)
          if (!res.ok) continue
          nextStatusMap[account.id] = await res.json()
        }

        const jobsRes = await apiFetch(`/api/jobs?user_id=${userId}`)
        const jobsJson = await jobsRes.json()
        const nextJobs = Array.isArray(jobsJson.jobs)
          ? jobsJson.jobs
          : Array.isArray(jobsJson)
            ? jobsJson
            : []

        if (!mounted) return
        setAccounts(nextAccounts)
        setStatusMap(nextStatusMap)
        setJobs(nextJobs)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Could not load post manager')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    const id = window.setInterval(load, 15000)

    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [userId])

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Post Manager</div>
            <div className="subtle">Account rotation, status, and recent job activity.</div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="btn" href="/dashboard">← Dashboard</Link>
            <Link className="btn primary" href="/galaxy">Open Starden</Link>
          </div>
        </header>

        {error ? (
          <section className="card" style={{ borderColor: 'rgba(248,113,113,0.35)' }}>
            <div style={{ color: '#fecaca' }}>{error}</div>
          </section>
        ) : null}

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Connected Accounts</h2>

          {loading ? (
            <div>Loading accounts...</div>
          ) : accounts.length === 0 ? (
            <div>No connected accounts yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 16, marginTop: 18 }}>
              {accounts.map((account) => {
                const status = statusMap[account.id]
                return (
                  <div
                    key={account.id}
                    style={{
                      border: '1px solid rgba(52,211,153,0.18)',
                      borderRadius: 20,
                      padding: 18,
                      background: 'rgba(16,185,129,0.05)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 13, color: 'rgba(236,253,245,0.7)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                          {account.provider}
                        </div>
                        <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{account.handle}</div>
                      </div>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <span className="btn" style={{ cursor: 'default' }}>
                          {status?.connected ? 'Connected' : 'Disconnected'}
                        </span>
                        <span className="btn" style={{ cursor: 'default' }}>
                          {status?.running ? 'Autopilot Running' : 'Autopilot Idle'}
                        </span>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 14,
                        marginTop: 18,
                      }}
                    >
                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Posts in Rotation</div>
                        <div style={{ fontSize: 28, fontWeight: 700 }}>{status?.posts_in_rotation ?? 0}</div>
                      </div>

                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Last Action</div>
                        <div>{fmtWhen(status?.last_action_at)}</div>
                      </div>

                      <div>
                        <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Next Cycle</div>
                        <div>{fmtWhen(status?.next_cycle_at)}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 18 }}>
                      <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12, marginBottom: 8 }}>
                        Last Post Text
                      </div>
                      <div style={{ color: 'rgba(236,253,245,0.9)' }}>
                        {status?.last_post_text?.trim() || 'No recent post text recorded.'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Recent Jobs</h2>

          {loading ? (
            <div>Loading jobs...</div>
          ) : jobs.length === 0 ? (
            <div>No jobs found yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12, marginTop: 18 }}>
              {jobs.map((job, index) => {
                const payload = parseJobPayload(job)
                const state = job.state || job.status || 'unknown'
                const badges = [
                  payload.pacing_mode ? `Pacing ${startCase(payload.pacing_mode)}` : '',
                  typeof payload.next_delay_minutes === 'number'
                    ? `Delay ${payload.next_delay_minutes}m`
                    : '',
                  payload.rotation_health?.pool_size != null
                    ? `Pool ${compactNumber(payload.rotation_health.pool_size)}`
                    : '',
                  payload.rotation_health?.velocity_stack_active ? 'Velocity active' : '',
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
                      <div>
                        <div style={missionEyebrowStyle}>Mission Report</div>
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
                          {providerLabel(payload.provider)} · @{payload.handle || 'unknown'} · ID{' '}
                          {job.id || job.job_id || '—'}
                        </div>
                      </div>

                      <span style={missionBadgeStyle(jobStateTone(state))}>{startCase(state)}</span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
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
                          {humanizeStrategyLabel(
                            payload.rotation_health?.last_strategy || payload.rotation_health?.mix_hint,
                          )}
                        </div>
                      </div>
                    </div>

                    {payload.cycle_events && payload.cycle_events.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                        {payload.cycle_events.map((event) => (
                          <span key={event} style={missionBadgeStyle('mint')}>
                            {humanizeCycleEvent(event)}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {badges.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                        {badges.map((badge) => (
                          <span key={badge} style={missionBadgeStyle('gold')}>
                            {badge}
                          </span>
                        ))}
                      </div>
                    ) : null}

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
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {payload.error || payload.message || payload.rotation_health?.selection_reason || 'No message provided.'}
                    </div>

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

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: 12,
                        marginTop: 12,
                        fontSize: 13,
                        color: 'rgba(236,253,245,0.72)',
                      }}
                    >
                      <div>Created: {fmtWhen(job.created_at)}</div>
                      <div>Updated: {fmtWhen(job.updated_at)}</div>
                      <div>Next cycle: {fmtWhen(payload.next_cycle_at)}</div>
                    </div>
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
