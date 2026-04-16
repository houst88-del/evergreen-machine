'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

type GalaxyNode = {
  id: string
  post_id: number
  url: string
  label: string
  score: number
  gravity: string
  archetype: string
  revival_score: number
  refresh_count: number
  state: string
  connected_account_id: number | null
  provider?: string
  handle?: string
  x: number
  y: number
  candidate?: boolean
  current_cycle?: boolean
  last_resurfaced_at?: string | null
}

type GalaxyResponse = {
  nodes: GalaxyNode[]
  meta?: {
    connected_account_id?: number | null
    count?: number
    running?: boolean
    connected?: boolean
    last_action_at?: string | null
    next_cycle_at?: string | null
  }
}

type ConnectedAccount = {
  id: number
  provider: string
  handle: string
  connection_status?: string
}

type MetadataVisibility = {
  score: boolean
  gravity: boolean
  archetype: boolean
  revival: boolean
  refreshes: boolean
  state: boolean
  postId: boolean
  url: boolean
}

const API_BASE = 'http://127.0.0.1:8000'
const ACCOUNT_STORAGE_KEY = 'evergreen_selected_account_id'
const UNIFIED_STORAGE_KEY = 'evergreen_unified_mode'

const defaultMetadataVisibility: MetadataVisibility = {
  score: true,
  gravity: true,
  archetype: true,
  revival: true,
  refreshes: true,
  state: false,
  postId: false,
  url: false,
}

function starSize(score: number) {
  if (score >= 250) return 18
  if (score >= 120) return 12
  if (score >= 60) return 8
  return 5
}

function starGlow(
  gravity: string,
  glowEnabled: boolean,
  isCandidate: boolean,
  isCurrentCycle: boolean,
  provider?: string
) {
  if (!glowEnabled) return 'none'
  if (isCurrentCycle) return '0 0 34px rgba(255,245,190,1), 0 0 60px rgba(255,245,190,0.4)'
  if (isCandidate) return '0 0 24px rgba(220,255,180,0.9), 0 0 42px rgba(220,255,180,0.28)'

  const isBluesky = String(provider || '').toLowerCase() === 'bluesky' || String(provider || '').toLowerCase() === 'bsky'
  if (gravity === 'gravity') {
    return isBluesky
      ? '0 0 24px rgba(140,210,255,0.95)'
      : '0 0 24px rgba(255,220,120,0.9)'
  }
  if (gravity === 'strong') {
    return isBluesky
      ? '0 0 18px rgba(120,210,255,0.95)'
      : '0 0 18px rgba(170,225,255,0.82)'
  }
  return isBluesky ? '0 0 12px rgba(150,220,255,0.65)' : '0 0 12px rgba(180,255,200,0.55)'
}

function starColor(
  gravity: string,
  isCandidate: boolean,
  isCurrentCycle: boolean,
  isRecent: boolean,
  provider?: string
) {
  if (isCurrentCycle) return '#fff0ae'
  if (isCandidate) return '#d9ff9f'
  if (isRecent) return '#f5ffbf'

  const isBluesky = String(provider || '').toLowerCase() === 'bluesky' || String(provider || '').toLowerCase() === 'bsky'
  if (gravity === 'gravity') return isBluesky ? '#8bd3ff' : '#ffd76a'
  if (gravity === 'strong') return isBluesky ? '#7fd8ff' : '#b5e4ff'
  return isBluesky ? '#97ddff' : '#9ff5b0'
}

function prettyGravity(gravity: string) {
  if (gravity === 'gravity') return 'Gravity'
  if (gravity === 'strong') return 'Strong'
  return 'Standard'
}

function shortLabel(label: string) {
  const clean = String(label || '').trim()
  if (!clean) return 'Untitled post'
  if (clean.length <= 42) return clean
  return `${clean.slice(0, 42)}…`
}

function providerLabel(provider: string) {
  const value = String(provider || 'x').trim().toLowerCase()
  if (value === 'bluesky' || value === 'bsky') return 'Bluesky'
  return 'X'
}

function providerChipStyle(provider?: string): CSSProperties {
  const value = String(provider || 'x').trim().toLowerCase()
  const bluesky = value === 'bluesky' || value === 'bsky'
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontWeight: 700,
    borderRadius: 999,
    padding: '4px 8px',
    border: bluesky ? '1px solid rgba(139,211,255,0.35)' : '1px solid rgba(255,215,106,0.28)',
    background: bluesky ? 'rgba(40,90,130,0.22)' : 'rgba(90,72,18,0.22)',
    color: bluesky ? '#bde7ff' : '#ffe9a4',
    width: 'fit-content',
  }
}

function accountOptionLabel(account: ConnectedAccount) {
  return `${providerLabel(account.provider)} · @${String(account.handle || 'unknown').replace(/^@+/, '')}`
}

function isRecentlyResurfaced(lastResurfacedAt?: string | null) {
  if (!lastResurfacedAt) return false
  const t = new Date(lastResurfacedAt).getTime()
  if (Number.isNaN(t)) return false
  return Date.now() - t < 15 * 60 * 1000
}

function seededUnit(seed: number) {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function galaxyPosition(node: GalaxyNode, index: number) {
  const seedBase = (node.post_id || index + 1) * 12.9898 + index * 78.233
  const u1 = seededUnit(seedBase)
  const u2 = seededUnit(seedBase * 1.77 + 11.1)
  const u3 = seededUnit(seedBase * 0.63 + 29.2)
  const u4 = seededUnit(seedBase * 1.37 + 19.19)
  const u5 = seededUnit(seedBase * 0.91 + 7.7)

  const armCount = 4
  const armIndex = index % armCount
  const armBase = (Math.PI * 2 * armIndex) / armCount

  let rawRadius = 0
  if (node.gravity === 'gravity') {
    rawRadius = 8 + u2 * 14
  } else if (node.gravity === 'strong') {
    rawRadius = 28 + u2 * 24
  } else if (node.candidate) {
    rawRadius = 65 + u2 * 35
  } else {
    rawRadius = 40 + u2 * 45
  }

  const maxRawRadius = 100
  const compressionStrength = 1.55
  const radius =
    maxRawRadius *
    ((1 - Math.exp(-(rawRadius / maxRawRadius) * compressionStrength)) /
      (1 - Math.exp(-compressionStrength)))

  const spiralTightness = 0.085
  const finalAngle = armBase + radius * spiralTightness + (u1 - 0.5) * 0.5

  const tilt = 0.68
  let x = 50 + Math.cos(finalAngle) * radius
  let y = 50 + Math.sin(finalAngle) * radius * tilt

  x += (u3 - 0.5) * 4.6
  y += (u4 - 0.5) * 5.2

  if (node.gravity === 'gravity') {
    x += (u5 - 0.5) * 2.0
    y += (u1 - 0.5) * 1.8
  }

  if (node.candidate && node.gravity !== 'gravity') {
    x += Math.cos(finalAngle + Math.PI / 2) * 3.2
    y += Math.sin(finalAngle + Math.PI / 2) * 3.0
  }

  const edgePaddingX = 6
  const edgePaddingY = 8

  return {
    left: Math.max(edgePaddingX, Math.min(100 - edgePaddingX, x)),
    top: Math.max(edgePaddingY, Math.min(100 - edgePaddingY, y)),
  }
}

function LegendDot({ color, glow = false }: { color: string; glow?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: color,
        boxShadow: glow ? `0 0 10px ${color}` : 'none',
        marginRight: 8,
      }}
    />
  )
}

function toggleStyle(active: boolean): CSSProperties {
  return {
    borderRadius: 999,
    border: `1px solid ${active ? 'rgba(180,255,210,0.34)' : 'rgba(180,255,210,0.12)'}`,
    background: active ? 'rgba(20,58,39,0.95)' : 'rgba(7,23,17,0.72)',
    color: active ? '#eaffef' : '#9bbca6',
    padding: '9px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  }
}

export default function GalaxyPage() {
  const [nodes, setNodes] = useState<GalaxyNode[]>([])
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [connectedAccountId, setConnectedAccountId] = useState<number | null>(null)
  const [unifiedMode, setUnifiedMode] = useState(false)
  const [meta, setMeta] = useState<GalaxyResponse['meta'] | null>(null)
  const initialLoadDone = useRef(false)

  const [showGravity, setShowGravity] = useState(true)
  const [showStrong, setShowStrong] = useState(true)
  const [showStandard, setShowStandard] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [showGlow, setShowGlow] = useState(true)
  const [animateGalaxy, setAnimateGalaxy] = useState(true)
  const [showConstellations, setShowConstellations] = useState(true)

  const [metadataVisibility, setMetadataVisibility] =
    useState<MetadataVisibility>(defaultMetadataVisibility)
  const [hoveredStarId, setHoveredStarId] = useState<string | null>(null)

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

  function persistUnifiedMode(value: boolean) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(UNIFIED_STORAGE_KEY, value ? '1' : '0')
  }

  function readStoredUnifiedMode() {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(UNIFIED_STORAGE_KEY) === '1'
  }

  async function fetchAccounts() {
    const res = await fetch(`${API_BASE}/api/connected-accounts?user_id=1`, {
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`Accounts request failed: ${res.status}`)
    }
    const data = await res.json()
    return (data.accounts || []) as ConnectedAccount[]
  }

  async function fetchGalaxy(accountId: number | null, useUnified: boolean) {
    const url = useUnified
      ? `${API_BASE}/api/galaxy?unified=1`
      : `${API_BASE}/api/galaxy?connected_account_id=${accountId}`

    const res = await fetch(url, {
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`Galaxy request failed: ${res.status}`)
    }
    return (await res.json()) as GalaxyResponse
  }

  function resolvePreferredAccountId(
    nextAccounts: ConnectedAccount[],
    preferred?: number | null
  ) {
    const candidates = [
      preferred ?? null,
      connectedAccountId,
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

  async function loadAll(options?: { preferredAccountId?: number | null; preferredUnified?: boolean }) {
    try {
      setError('')
      setLoading(true)

      const nextAccounts = await fetchAccounts()
      setAccounts(nextAccounts)

      const nextUnified = options?.preferredUnified ?? unifiedMode
      setUnifiedMode(nextUnified)
      persistUnifiedMode(nextUnified)

      const resolvedAccountId = resolvePreferredAccountId(
        nextAccounts,
        options?.preferredAccountId
      )
      setConnectedAccountId(resolvedAccountId)
      if (!nextUnified) {
        persistSelectedAccount(resolvedAccountId)
      }

      if (!nextUnified && resolvedAccountId == null) {
        setNodes([])
        setMeta(null)
        return
      }

      const data = await fetchGalaxy(resolvedAccountId, nextUnified)
      setNodes(data.nodes || [])
      setMeta(data.meta || null)
    } catch (err: any) {
      console.error('Galaxy load failed', err)
      setError(err?.message || 'Failed to load galaxy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initialLoadDone.current) return
    initialLoadDone.current = true

    const params = new URLSearchParams(window.location.search)
    const connectedAccountParam = params.get('connected_account_id')
    const unifiedParam = params.get('unified')

    let preferredAccountId: number | null = null
    let preferredUnified = readStoredUnifiedMode()

    if (unifiedParam === '1' || unifiedParam === 'true') {
      preferredUnified = true
    } else if (unifiedParam === '0' || unifiedParam === 'false') {
      preferredUnified = false
    }

    if (connectedAccountParam) {
      const parsed = Number(connectedAccountParam)
      if (!Number.isNaN(parsed)) preferredAccountId = parsed
    } else {
      preferredAccountId = readStoredAccountId()
    }

    void loadAll({ preferredAccountId, preferredUnified })
  }, [])

  useEffect(() => {
    if (!initialLoadDone.current) return
    persistUnifiedMode(unifiedMode)

    if (!unifiedMode && connectedAccountId == null) return

    if (!unifiedMode) {
      persistSelectedAccount(connectedAccountId)
    }

    void loadAll({ preferredAccountId: connectedAccountId, preferredUnified: unifiedMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccountId, unifiedMode])

  useEffect(() => {
    if (!initialLoadDone.current) return
    if (!unifiedMode && connectedAccountId == null) return

    const interval = setInterval(() => {
      void loadAll({ preferredAccountId: connectedAccountId, preferredUnified: unifiedMode })
    }, 10000)

    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccountId, unifiedMode])

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (node.gravity === 'gravity' && !showGravity) return false
      if (node.gravity === 'strong' && !showStrong) return false
      if (node.gravity === 'standard' && !showStandard) return false
      return true
    })
  }, [nodes, showGravity, showStrong, showStandard])

  const stats = useMemo(() => {
    const gravity = nodes.filter((n) => n.gravity === 'gravity').length
    const strong = nodes.filter((n) => n.gravity === 'strong').length
    const standard = nodes.filter((n) => n.gravity === 'standard').length
    return { gravity, strong, standard }
  }, [nodes])

  const liveStats = useMemo(() => {
    const candidates = nodes.filter((n) => n.candidate).length
    const currentCycle = nodes.filter((n) => n.current_cycle).length
    return { candidates, currentCycle }
  }, [nodes])

  const pulseStats = useMemo(() => {
    return {
      recentlyResurfaced: nodes.filter((n) => isRecentlyResurfaced(n.last_resurfaced_at)).length,
    }
  }, [nodes])

  const constellationLines = useMemo(() => {
    const visible = filteredNodes
      .map((node, index) => {
        const pos = galaxyPosition(node, index)
        return { node, pos, index }
      })
      .filter(({ node }) => node.gravity === 'strong' || node.gravity === 'gravity' || node.candidate)

    const lines: Array<{
      key: string
      x1: number
      y1: number
      x2: number
      y2: number
      strength: 'candidate' | 'strong' | 'gravity'
    }> = []

    for (let i = 0; i < visible.length; i += 1) {
      const a = visible[i]
      let best: typeof a | null = null
      let bestDistance = Number.POSITIVE_INFINITY

      for (let j = i + 1; j < visible.length; j += 1) {
        const b = visible[j]
        const dx = a.pos.left - b.pos.left
        const dy = a.pos.top - b.pos.top
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance > 26) continue

        const sameTypeBonus = a.node.gravity === b.node.gravity ? -3 : 0
        const candidateBonus = a.node.candidate && b.node.candidate ? -5 : 0
        const weightedDistance = distance + sameTypeBonus + candidateBonus

        if (weightedDistance < bestDistance) {
          bestDistance = weightedDistance
          best = b
        }
      }

      if (best) {
        let strength: 'candidate' | 'strong' | 'gravity' = 'strong'
        if (a.node.candidate && best.node.candidate) strength = 'candidate'
        else if (a.node.gravity === 'gravity' || best.node.gravity === 'gravity') strength = 'gravity'

        lines.push({
          key: `${a.node.id}-${best.node.id}`,
          x1: a.pos.left,
          y1: a.pos.top,
          x2: best.pos.left,
          y2: best.pos.top,
          strength,
        })
      }
    }

    return lines
  }, [filteredNodes])

  function toggleMetadataField(field: keyof MetadataVisibility) {
    setMetadataVisibility((prev) => ({
      ...prev,
      [field]: !prev[field],
    }))
  }

  function normalizePostUrl(url: string) {
    const clean = String(url || '').trim()
    if (!clean) return ''
    if (clean.startsWith('http://') || clean.startsWith('https://')) return clean
    if (clean.startsWith('//')) return `https:${clean}`
    if (clean.startsWith('x.com/') || clean.startsWith('twitter.com/') || clean.startsWith('bsky.app/')) {
      return `https://${clean}`
    }
    return clean
  }

  function openPost(url: string, newTab = false) {
    const targetUrl = normalizePostUrl(url)
    if (!targetUrl) return
    if (newTab) {
      window.open(targetUrl, '_blank', 'noopener,noreferrer')
      return
    }
    window.location.href = targetUrl
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 16,
        background:
          'radial-gradient(circle at top, rgba(15,80,45,0.35), rgba(3,14,12,1) 55%)',
        color: '#ecfff1',
      }}
    >
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
          <h1 style={{ fontSize: 48, margin: 0, fontWeight: 800 }}>Evergreen Galaxy</h1>
          <p style={{ marginTop: 10, color: '#a9cdb5' }}>
            A living cinematic spiral observatory of resurfacing potential.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href={
              unifiedMode
                ? '/dashboard?unified=1'
                : connectedAccountId
                  ? `/dashboard?connected_account_id=${connectedAccountId}`
                  : '/dashboard'
            }
            style={{
              color: '#d8ffe2',
              border: '1px solid rgba(180,255,210,0.18)',
              padding: '10px 16px',
              borderRadius: 999,
              textDecoration: 'none',
            }}
          >
            ← Dashboard
          </a>

          <label style={{ color: '#b6dcc0', fontSize: 14 }}>
            Galaxy View
            <select
              value={unifiedMode ? 'unified' : connectedAccountId ?? ''}
              onChange={(e) => {
                const value = e.target.value
                if (value === 'unified') {
                  setUnifiedMode(true)
                  return
                }
                setUnifiedMode(false)
                setConnectedAccountId(value ? Number(value) : null)
              }}
              style={{
                marginLeft: 8,
                background: '#081511',
                color: '#ecfff1',
                border: '1px solid rgba(180,255,210,0.18)',
                borderRadius: 10,
                padding: '8px 10px',
                minWidth: 260,
              }}
            >
              <option value="unified">Unified Galaxy</option>
              {accounts.length === 0 ? <option value="">No accounts yet</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {accountOptionLabel(account)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginTop: 24,
            padding: 16,
            borderRadius: 16,
            border: '1px solid rgba(255,120,120,0.35)',
            background: 'rgba(80,10,10,0.25)',
            color: '#ffb0b0',
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          marginTop: 28,
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(135px, 1fr))',
          gap: 14,
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>Total Stars</div>
          <div style={valueStyle}>{nodes.length}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Gravity Stars</div>
          <div style={valueStyle}>{stats.gravity}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Strong Stars</div>
          <div style={valueStyle}>{stats.strong}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Standard Stars</div>
          <div style={valueStyle}>{stats.standard}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Candidates</div>
          <div style={valueStyle}>{liveStats.candidates}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Current Cycle</div>
          <div style={valueStyle}>{liveStats.currentCycle}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>Recent Pulses</div>
          <div style={valueStyle}>{pulseStats.recentlyResurfaced}</div>
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: 14,
        }}
      >
        <div style={panelStyle}>
          <div style={panelTitleStyle}>Legend + Star Filters</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <button onClick={() => setShowGravity((v) => !v)} style={toggleStyle(showGravity)} type="button">
              <LegendDot color="#ffd76a" glow />
              Gravity
            </button>

            <button onClick={() => setShowStrong((v) => !v)} style={toggleStyle(showStrong)} type="button">
              <LegendDot color="#8bd3ff" glow />
              Strong
            </button>

            <button onClick={() => setShowStandard((v) => !v)} style={toggleStyle(showStandard)} type="button">
              <LegendDot color="#9ff5b0" glow />
              Standard
            </button>

            <button onClick={() => setShowGlow((v) => !v)} style={toggleStyle(showGlow)} type="button">
              Glow
            </button>

            <button onClick={() => setShowLabels((v) => !v)} style={toggleStyle(showLabels)} type="button">
              Inline labels
            </button>

            <button onClick={() => setAnimateGalaxy((v) => !v)} style={toggleStyle(animateGalaxy)} type="button">
              Live motion
            </button>

            <button
              onClick={() => setShowConstellations((v) => !v)}
              style={toggleStyle(showConstellations)}
              type="button"
            >
              Constellation lines
            </button>
          </div>

          <div style={{ marginTop: 14, color: '#9bbca6', fontSize: 13, lineHeight: 1.5 }}>
            Bigger stars have stronger pull. Gold stars lean X, blue stars lean Bluesky, and brighter rings show
            live candidate activity. Gravity stars gather in the bright core, strong posts trace the inner arms, standard posts sweep the outer spiral, and candidates drift as outer debris. Outer stars are compressed toward the edge so the universe stays round instead of clipping flat.
          </div>
        </div>

        <div style={panelStyle}>
          <div style={panelTitleStyle}>Hover Card Fields</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
            <button onClick={() => toggleMetadataField('score')} style={toggleStyle(metadataVisibility.score)} type="button">Score</button>
            <button onClick={() => toggleMetadataField('gravity')} style={toggleStyle(metadataVisibility.gravity)} type="button">Gravity</button>
            <button onClick={() => toggleMetadataField('archetype')} style={toggleStyle(metadataVisibility.archetype)} type="button">Archetype</button>
            <button onClick={() => toggleMetadataField('revival')} style={toggleStyle(metadataVisibility.revival)} type="button">Revival</button>
            <button onClick={() => toggleMetadataField('refreshes')} style={toggleStyle(metadataVisibility.refreshes)} type="button">Refreshes</button>
            <button onClick={() => toggleMetadataField('state')} style={toggleStyle(metadataVisibility.state)} type="button">State</button>
            <button onClick={() => toggleMetadataField('postId')} style={toggleStyle(metadataVisibility.postId)} type="button">Post ID</button>
            <button onClick={() => toggleMetadataField('url')} style={toggleStyle(metadataVisibility.url)} type="button">URL</button>
          </div>
        </div>
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
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {unifiedMode ? 'Unified Spiral Galaxy' : 'Cinematic Spiral Galaxy'} · core = strongest pull
            {loading ? ' · loading…' : ''}
          </span>
          <span>
            {filteredNodes.length} visible stars · {meta?.running ? 'Autopilot running' : 'Autopilot idle'}
          </span>
        </div>

        <div
          style={{
            position: 'relative',
            minHeight: 920,
            background:
              'radial-gradient(circle at 50% 50%, rgba(18, 78, 48, 0.15), rgba(2, 10, 9, 1) 70%)',
          }}
        >
          {filteredNodes.length === 0 && !loading ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                color: '#9bbca6',
                textAlign: 'center',
                padding: 24,
              }}
            >
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#dfffea', marginBottom: 10 }}>
                  No stars in this galaxy yet
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                  Choose a connected account from the dropdown above, then import posts and run analytics
                  from the dashboard to begin building this universe.
                </div>
              </div>
            </div>
          ) : null}

          {showConstellations ? (
            <svg
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                overflow: 'visible',
              }}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {constellationLines.map((line) => (
                <line
                  key={line.key}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  stroke={
                    line.strength === 'candidate'
                      ? 'rgba(199,255,138,0.22)'
                      : line.strength === 'gravity'
                        ? 'rgba(255,232,157,0.24)'
                        : 'rgba(139,211,255,0.16)'
                  }
                  strokeWidth={line.strength === 'gravity' ? 0.18 : 0.12}
                  strokeDasharray={line.strength === 'candidate' ? '0.6 0.45' : 'none'}
                />
              ))}
            </svg>
          ) : null}

          {filteredNodes.map((node, index) => {
            const size = starSize(node.score)
            const pos = galaxyPosition(node, index)
            const recent = isRecentlyResurfaced(node.last_resurfaced_at)
            const candidate = Boolean(node.candidate)
            const currentCycle = Boolean(node.current_cycle)

            const driftDuration = 8 + (index % 7)
            const pulseDuration = 2.5 + (index % 5)
            const driftX = ((index % 5) - 2) * 2.4
            const driftY = ((index % 7) - 3) * 1.7

            return (
              <div
                key={node.id}
                className="star-wrap"
                onMouseEnter={() => setHoveredStarId(node.id)}
                onMouseLeave={() => setHoveredStarId((current) => (current === node.id ? null : current))}
                style={{
                  position: 'absolute',
                  left: `${pos.left}%`,
                  top: `${pos.top}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: normalizePostUrl(node.url) ? 'pointer' : 'default',
                  }}
                >
                  <button
                    type="button"
                    aria-label={normalizePostUrl(node.url) ? `Open post ${shortLabel(node.label)}` : 'No post URL on this star'}
                    onClick={(e) => {
                      e.stopPropagation()
                      openPost(node.url, true)
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      openPost(node.url, false)
                    }}
                    title={normalizePostUrl(node.url) ? 'Click to open in new tab · double click to open here' : 'No post URL on this star'}
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                      width: Math.max(28, size + 18),
                      height: Math.max(28, size + 18),
                      borderRadius: '50%',
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      margin: 0,
                      zIndex: 6,
                      cursor: normalizePostUrl(node.url) ? 'pointer' : 'default',
                    }}
                  />
                  <div
                    className={animateGalaxy && hoveredStarId !== node.id ? 'star-shell animated-shell' : 'star-shell'}
                    style={
                      animateGalaxy
                        ? ({
                            ['--drift-x' as any]: `${driftX}px`,
                            ['--drift-y' as any]: `${driftY}px`,
                            ['--drift-duration' as any]: `${driftDuration}s`,
                            ['--orbit-radius' as any]: `${4 + (index % 6) * 1.15}px`,
                            ['--orbit-duration' as any]: `${18 + (index % 9) * 4}s`,
                            ['--orbit-offset' as any]: `${(index % 12) * 0.45}s`,
                          } as CSSProperties)
                        : undefined
                    }
                  >
                    <div style={{ position: 'relative' }}>
                      {recent ? (
                        <>
                          <div
                            className={animateGalaxy ? 'refresh-pulse refresh-pulse-a' : 'refresh-pulse'}
                            style={{
                              position: 'absolute',
                              left: '50%',
                              top: '50%',
                              width: size + 18,
                              height: size + 18,
                              transform: 'translate(-50%, -50%)',
                              borderRadius: '50%',
                              border: '1px solid rgba(255,245,185,0.65)',
                              boxShadow: '0 0 22px rgba(255,236,163,0.40)',
                            }}
                          />
                          <div
                            className={animateGalaxy ? 'refresh-pulse refresh-pulse-b' : 'refresh-pulse'}
                            style={{
                              position: 'absolute',
                              left: '50%',
                              top: '50%',
                              width: size + 32,
                              height: size + 32,
                              transform: 'translate(-50%, -50%)',
                              borderRadius: '50%',
                              border: '1px solid rgba(255,245,185,0.34)',
                              boxShadow: '0 0 28px rgba(255,236,163,0.24)',
                            }}
                          />
                        </>
                      ) : null}

                      {candidate ? (
                        <div
                          className={animateGalaxy ? 'candidate-ring animated-ring' : 'candidate-ring'}
                          style={{
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            width: size + 14,
                            height: size + 14,
                            transform: 'translate(-50%, -50%)',
                            borderRadius: '50%',
                            border: currentCycle
                              ? '1px solid rgba(255,232,157,0.7)'
                              : '1px solid rgba(199,255,138,0.55)',
                            boxShadow: currentCycle
                              ? '0 0 20px rgba(255,232,157,0.35)'
                              : '0 0 14px rgba(199,255,138,0.28)',
                            opacity: node.state === 'active' ? 0.95 : 0.45,
                          }}
                        />
                      ) : null}

                      <div
                        className={animateGalaxy ? 'star-core animated-core' : 'star-core'}
                        style={{
                          width: size,
                          height: size,
                          borderRadius: '50%',
                          background: starColor(
                            node.gravity,
                            candidate,
                            currentCycle,
                            recent,
                            node.provider
                          ),
                          boxShadow: starGlow(
                            node.gravity,
                            showGlow,
                            candidate,
                            currentCycle,
                            node.provider
                          ),
                          opacity: node.state === 'active' ? 0.98 : 0.35,
                          ...(animateGalaxy
                            ? ({
                                ['--pulse-duration' as any]: currentCycle ? '1.35s' : `${pulseDuration}s`,
                              } as CSSProperties)
                            : {}),
                        }}
                      />
                    </div>
                  </div>
                </div>

                {showLabels ? (
                  <div className="star-label" style={starLabelStyle}>
                    {shortLabel(node.label)}
                  </div>
                ) : null}

                <div className="hover-card" style={hoverCardStyle}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f4fff7', marginBottom: 8 }}>
                    {shortLabel(node.label)}
                  </div>

                  {(node.provider || node.handle) ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {node.provider ? (
                        <div style={providerChipStyle(node.provider)}>{providerLabel(node.provider)}</div>
                      ) : null}
                      {node.handle ? (
                        <div style={{ fontSize: 12, color: '#c7e9d2' }}>
                          @{String(node.handle).replace(/^@+/, '')}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div style={{ display: 'grid', gap: 6, fontSize: 12, color: '#cbe8d4' }}>
                    {metadataVisibility.score ? (
                      <div>
                        <strong style={hoverKeyStyle}>Score:</strong> {Number(node.score).toFixed(1)}
                      </div>
                    ) : null}

                    {metadataVisibility.gravity ? (
                      <div>
                        <strong style={hoverKeyStyle}>Gravity:</strong> {prettyGravity(node.gravity)}
                      </div>
                    ) : null}

                    {metadataVisibility.archetype ? (
                      <div>
                        <strong style={hoverKeyStyle}>Archetype:</strong> {node.archetype || 'Unassigned'}
                      </div>
                    ) : null}

                    {metadataVisibility.revival ? (
                      <div>
                        <strong style={hoverKeyStyle}>Revival:</strong> {Number(node.revival_score).toFixed(1)}
                      </div>
                    ) : null}

                    {metadataVisibility.refreshes ? (
                      <div>
                        <strong style={hoverKeyStyle}>Refreshes:</strong> {node.refresh_count}
                      </div>
                    ) : null}

                    <div>
                      <strong style={hoverKeyStyle}>Candidate:</strong> {candidate ? 'Yes' : 'No'}
                    </div>

                    <div>
                      <strong style={hoverKeyStyle}>Current cycle:</strong> {currentCycle ? 'Live now' : 'No'}
                    </div>

                    <div>
                      <strong style={hoverKeyStyle}>Recent pulse:</strong> {recent ? 'Yes' : 'No'}
                    </div>

                    <div>
                      <strong style={hoverKeyStyle}>Post link:</strong> {normalizePostUrl(node.url) ? 'Available' : 'Missing'}
                    </div>

                    {metadataVisibility.state ? (
                      <div>
                        <strong style={hoverKeyStyle}>State:</strong> {node.state}
                      </div>
                    ) : null}

                    {metadataVisibility.postId ? (
                      <div>
                        <strong style={hoverKeyStyle}>Post ID:</strong> {node.post_id}
                      </div>
                    ) : null}

                    {metadataVisibility.url && node.url ? (
                      <div style={{ wordBreak: 'break-all' }}>
                        <strong style={hoverKeyStyle}>URL:</strong> {node.url}
                      </div>
                    ) : null}
                  </div>

                  {node.url ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <a
                        href={normalizePostUrl(node.url)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: '#9fe8ff',
                          fontSize: 12,
                          textDecoration: 'none',
                          fontWeight: 600,
                        }}
                      >
                        Open post ↗
                      </a>

                      <button
                        type="button"
                        onClick={() => openPost(node.url, true)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ffe89d',
                          padding: 0,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Open in new tab
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}

          <style jsx>{`
            .star-wrap {
              z-index: 1;
            }

            .star-wrap:hover {
              z-index: 30;
            }

            .star-wrap button {
              appearance: none;
              -webkit-appearance: none;
            }

            .star-wrap:hover .animated-shell,
            .star-wrap:hover .animated-core,
            .star-wrap:hover .animated-ring,
            .star-wrap:hover .refresh-pulse-a,
            .star-wrap:hover .refresh-pulse-b {
              animation-play-state: paused;
            }

            .hover-card {
              opacity: 0;
              pointer-events: none;
              transform: translate(-50%, -14px) scale(0.98);
              transition: opacity 160ms ease, transform 160ms ease;
            }

            .star-wrap:hover .hover-card {
              opacity: 1;
              transform: translate(-50%, -22px) scale(1);
              pointer-events: auto;
            }

            .star-wrap:hover .star-label {
              opacity: 1;
            }

            .animated-shell {
              animation:
                drift var(--drift-duration) ease-in-out infinite alternate,
                orbit var(--orbit-duration) linear infinite;
              animation-delay: 0s, calc(var(--orbit-offset) * -1);
              will-change: transform;
            }

            .animated-core {
              animation: pulse var(--pulse-duration) ease-in-out infinite;
              will-change: transform, opacity;
            }

            .animated-ring {
              animation: ringPulse 2.6s ease-in-out infinite;
              will-change: transform, opacity;
            }

            .refresh-pulse-a {
              animation: refreshBurstA 1.8s ease-out infinite;
              will-change: transform, opacity;
            }

            .refresh-pulse-b {
              animation: refreshBurstB 2.2s ease-out infinite;
              will-change: transform, opacity;
            }

            @keyframes pulse {
              0%,
              100% {
                transform: scale(1);
                opacity: 0.78;
              }
              50% {
                transform: scale(1.18);
                opacity: 1;
              }
            }

            @keyframes drift {
              0% {
                transform: translate(0px, 0px);
              }
              100% {
                transform: translate(var(--drift-x), var(--drift-y));
              }
            }
            @keyframes orbit {
              0% {
                transform: rotate(0deg) translateX(var(--orbit-radius)) rotate(0deg);
              }
              100% {
                transform: rotate(360deg) translateX(var(--orbit-radius)) rotate(-360deg);
              }
            }


            @keyframes ringPulse {
              0%,
              100% {
                transform: translate(-50%, -50%) scale(0.96);
                opacity: 0.42;
              }
              50% {
                transform: translate(-50%, -50%) scale(1.08);
                opacity: 0.92;
              }
            }

            @keyframes refreshBurstA {
              0% {
                transform: translate(-50%, -50%) scale(0.82);
                opacity: 0.85;
              }
              100% {
                transform: translate(-50%, -50%) scale(1.65);
                opacity: 0;
              }
            }

            @keyframes refreshBurstB {
              0% {
                transform: translate(-50%, -50%) scale(0.9);
                opacity: 0.55;
              }
              100% {
                transform: translate(-50%, -50%) scale(2.1);
                opacity: 0;
              }
            }

            @media (max-width: 900px) {
              .hover-card {
                width: 220px !important;
              }
            }
          `}</style>
        </div>
      </section>
    </main>
  )
}

const cardStyle: CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'rgba(7, 23, 17, 0.8)',
  padding: 18,
}

const panelStyle: CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'rgba(7, 23, 17, 0.8)',
  padding: 18,
}

const panelTitleStyle: CSSProperties = {
  fontSize: 14,
  color: '#dfffea',
  fontWeight: 700,
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  color: '#94b8a0',
  marginBottom: 8,
}

const valueStyle: CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
  color: '#ecfff1',
}

const hoverCardStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: '100%',
  marginBottom: 14,
  width: 260,
  borderRadius: 16,
  border: '1px solid rgba(180,255,210,0.14)',
  background: 'rgba(7, 18, 14, 0.96)',
  boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
  padding: 14,
  backdropFilter: 'blur(10px)',
}

const hoverKeyStyle: CSSProperties = {
  color: '#8fe7ad',
  fontWeight: 700,
}

const starLabelStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '100%',
  marginTop: 8,
  transform: 'translateX(-50%)',
  whiteSpace: 'nowrap',
  fontSize: 11,
  color: '#bfeccc',
  background: 'rgba(4, 14, 11, 0.72)',
  border: '1px solid rgba(180,255,210,0.08)',
  borderRadius: 999,
  padding: '4px 8px',
  opacity: 0.9,
  pointerEvents: 'none',
}
