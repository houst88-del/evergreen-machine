'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { getToken } from '../lib/auth'

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
              {jobs.map((job, index) => (
                <div
                  key={job.id || job.job_id || `${job.type}-${index}`}
                  style={{
                    border: '1px solid rgba(52,211,153,0.18)',
                    borderRadius: 18,
                    padding: 16,
                    background: 'rgba(16,185,129,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{job.type || 'Job'}</div>
                      <div style={{ color: 'rgba(236,253,245,0.65)', fontSize: 13 }}>
                        ID: {job.id || job.job_id || '—'}
                      </div>
                    </div>

                    <div className="btn" style={{ cursor: 'default' }}>
                      {job.state || job.status || 'unknown'}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, color: 'rgba(236,253,245,0.88)' }}>
                    {job.message || job.result || 'No message provided.'}
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