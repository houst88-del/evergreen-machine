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
message?: unknown
result?: unknown
connected_account_id?: number
}

const API_BASE =
process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
'https://backend-fixed-production.up.railway.app'

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
} catch {}
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
} catch {}
}

useEffect(() => {
if (!session?.user) return

let mounted = true

async function loadMissionControl() {
try {
await refreshMissionControlNow()
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
<section className="card">
<Link className="btn primary" href="/login">
Go to Login
</Link>
</section>
</div>
</main>
)
}

const recentJobs = jobs.slice(0, 5)

return (

<main className="page">
<div className="shell">

<section className="card">
<h3>Recent Jobs</h3>

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

<div style={{ fontWeight: 700 }}>{job.type || 'Job'}</div>

<div style={{ marginTop: 12 }}>
{safeText(job.message) ||
safeText(job.result) ||
'No message provided.'}
</div>

<div style={{ marginTop: 10, fontSize: 13 }}>
Created: {fmtWhen(job.created_at)}
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
