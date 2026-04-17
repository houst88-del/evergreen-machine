'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getApiBase, getToken } from '../lib/auth'

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
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [statusMap, setStatusMap] = useState<Record<number, AccountStatus>>({})
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        setError('')

        const accountsRes = await apiFetch('/api/connected-accounts?user_id=1')
        const accountsJson = await accountsRes.json()
        const nextAccounts = Array.isArray(accountsJson.accounts) ? accountsJson.accounts : []

        const nextStatusMap: Record<number, AccountStatus> = {}
        for (const account of nextAccounts) {
          const res = await apiFetch(`/api/status?user_id=1&connected_account_id=${account.id}`)
          if (!res.ok) continue
          nextStatusMap[account.id] = await res.json()
        }

        const jobsRes = await apiFetch('/api/jobs?user_id=1')
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
  }, [])

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
            <Link className="btn primary" href="/galaxy">Open Galaxy</Link>
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