'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getToken } from '../lib/auth'
import { missionBadgeStyle, missionEyebrowStyle } from '../lib/mission-ui'
import {
  compactNumber,
  headlineForJob,
  jobStateTone,
  parseJobPayload,
  providerLabel,
  startCase,
  type JobItem,
} from '../lib/mission-jobs'

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
  if (token) headers.set('Authorization', `Bearer ${token}`)

  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  })
}

export default function AnalyticsPage() {
  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        setError('')

        const [systemRes, jobsRes] = await Promise.all([
          apiFetch('/api/system-status'),
          apiFetch('/api/jobs?user_id=1'),
        ])

        const systemJson = await systemRes.json()
        const jobsJson = await jobsRes.json()
        const nextJobs = Array.isArray(jobsJson.jobs)
          ? jobsJson.jobs
          : Array.isArray(jobsJson)
            ? jobsJson
            : []

        if (!mounted) return
        setSystem(systemJson)
        setJobs(nextJobs)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Could not load analytics console')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    load()
    const id = window.setInterval(load, 12000)

    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  const summary = useMemo(() => {
    const heartbeat = system?.worker?.heartbeat || {}
    return {
      queued: heartbeat.queued ?? 0,
      processed: heartbeat.processed ?? 0,
      syncedAccounts: heartbeat.synced_accounts ?? 0,
      repairedJobs: heartbeat.repaired_jobs ?? 0,
      pollSeconds: heartbeat.poll_seconds ?? 0,
      heartbeatAt: heartbeat.timestamp ?? null,
      workerStatus: heartbeat.status || (system?.worker?.ok ? 'ok' : 'offline'),
      workerError: heartbeat.error || null,
    }
  }, [system])

  return (
    <main className="page">
      <div className="shell">
        <header className="header">
          <div>
            <div className="wordmark">Analytics Console</div>
            <div className="subtle">System health, worker heartbeat, and recent Evergreen jobs.</div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link className="btn" href="/dashboard">← Dashboard</Link>
            <Link className="btn primary" href="/galaxy">Open Galaxy</Link>
          </div>
        </header>

        {error ? (
          <section className="card" style={{ borderColor: 'rgba(248,113,113,0.35)' }}>
            <div style={{ color: '#fecaca' }}>{error}</div>
          </section>
        ) : null}

        <section
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
          }}
        >
          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Backend</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>
              {system?.backend?.ok ? 'Online' : loading ? '…' : 'Offline'}
            </div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Worker</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.workerStatus}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Queued</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.queued}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Processed</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.processed}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Synced Accounts</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.syncedAccounts}</div>
          </div>

          <div>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Repaired Jobs</div>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{summary.repairedJobs}</div>
          </div>
        </section>

        <section className="card">
          <h2 style={{ marginTop: 0 }}>Worker Heartbeat</h2>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
              marginTop: 18,
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
              <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12 }}>Startup Burst</div>
              <div>{system?.worker?.heartbeat?.startup_burst_done ? 'Complete' : 'Not yet'}</div>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ color: 'rgba(236,253,245,0.6)', fontSize: 12, marginBottom: 8 }}>Worker Error</div>
            <div>{summary.workerError || 'No worker error reported.'}</div>
          </div>
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
                  payload.rotation_health?.refreshes_last_24h != null
                    ? `24h ${compactNumber(payload.rotation_health.refreshes_last_24h)} refreshes`
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
                          {payload.next_step || 'Awaiting next worker instruction'}
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
                          {payload.rotation_health?.last_strategy ||
                            payload.rotation_health?.mix_hint ||
                            'Stable'}
                        </div>
                      </div>
                    </div>

                    {payload.cycle_events && payload.cycle_events.length > 0 ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                        {payload.cycle_events.map((event) => (
                          <span key={event} style={missionBadgeStyle('mint')}>
                            {event}
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
                      {payload.message || payload.rotation_health?.selection_reason || 'No message provided.'}
                    </div>

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
