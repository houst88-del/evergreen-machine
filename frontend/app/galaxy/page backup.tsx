'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

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

const API_BASE = 'http://127.0.0.1:8000'
const ACCOUNT_STORAGE_KEY = 'evergreen_selected_account_id'

function starSize(score: number) {
  if (score >= 250) return 18
  if (score >= 120) return 12
  if (score >= 60) return 8
  return 5
}

function starGlow(gravity: string, glowEnabled: boolean, isCandidate: boolean, isCurrentCycle: boolean) {
  if (!glowEnabled) return 'none'
  if (isCurrentCycle) return '0 0 34px rgba(255,245,190,1), 0 0 60px rgba(255,245,190,0.4)'
  if (isCandidate) return '0 0 24px rgba(220,255,180,0.9), 0 0 42px rgba(220,255,180,0.28)'
  if (gravity === 'gravity') return '0 0 24px rgba(255,220,120,0.9)'
  if (gravity === 'strong') return '0 0 18px rgba(120,210,255,0.85)'
  return '0 0 12px rgba(180,255,200,0.55)'
}

function starColor(gravity: string, isCandidate: boolean, isCurrentCycle: boolean, isRecent: boolean) {
  if (isCurrentCycle) return '#fff0ae'
  if (isCandidate) return '#d9ff9f'
  if (isRecent) return '#f5ffbf'
  if (gravity === 'gravity') return '#ffd76a'
  if (gravity === 'strong') return '#8bd3ff'
  return '#9ff5b0'
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

function accountOptionLabel(account: ConnectedAccount) {
  return `${providerLabel(account.provider)} · ${account.handle || '@unknown'}`
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
  const seedA = node.post_id * 12.9898 + index * 78.233
  const seedB = node.post_id * 93.9898 + index * 17.123
  const seedC = node.post_id * 45.778 + index * 11.411

  const u1 = seededUnit(seedA)
  const u2 = seededUnit(seedB)
  const u3 = seededUnit(seedA * 1.37 + 19.19)
  const u4 = seededUnit(seedC)

  const angle = u1 * Math.PI * 2

  let radius
  if (node.gravity === 'gravity') {
    radius = 8 + u2 * 10
  } else if (node.gravity === 'strong') {
    radius = 15 + u2 * 20
  } else {
    radius = 26 + u2 * 36
  }

  const spiralTwist = radius * 0.12
  const finalAngle = angle + spiralTwist

  const bandOffset = (u4 - 0.5) * 18
  const x = 50 + Math.cos(finalAngle) * radius + (u3 - 0.5) * 5
  const y = 50 + Math.sin(finalAngle) * radius * 0.68 + bandOffset * 0.35

  return {
    left: Math.max(3, Math.min(97, x)),
    top: Math.max(8, Math.min(92, y)),
  }
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

export default function GalaxyPage() {
  const [nodes, setNodes] = useState<GalaxyNode[]>([])
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [connectedAccountId, setConnectedAccountId] = useState<number | null>(null)
  const [meta, setMeta] = useState<GalaxyResponse['meta'] | null>(null)
  const initialLoadDone = useRef(false)

  const [showGravity, setShowGravity] = useState(true)
  const [showStrong, setShowStrong] = useState(true)
  const [showStandard, setShowStandard] = useState(true)
  const [showLabels, setShowLabels] = useState(false)
  const [showGlow, setShowGlow] = useState(true)
  const [animateGalaxy, setAnimateGalaxy] = useState(true)
  const [showConstellations, setShowConstellations] = useState(true)

  const [metadataVisibility, setMetadataVisibility] = useState<MetadataVisibility>(
    defaultMetadataVisibility
  )

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

  async function fetchGalaxy(accountId: number) {
    const res = await fetch(`${API_BASE}/api/galaxy?connected_account_id=${accountId}`, {
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

  async function loadAll(preferredAccountId?: number | null) {
    try {
      setError('')
      setLoading(true)

      const nextAccounts = await fetchAccounts()
      setAccounts(nextAccounts)

      const resolvedAccountId = resolvePreferredAccountId(nextAccounts, preferredAccountId)
      setConnectedAccountId(resolvedAccountId)
      persistSelectedAccount(resolvedAccountId)

      if (resolvedAccountId == null) {
        setNodes([])
        setMeta(null)
        return
      }

      const data = await fetchGalaxy(resolvedAccountId)
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
    let preferred: number | null = null

    if (connectedAccountParam) {
      const parsed = Number(connectedAccountParam)
      if (!Number.isNaN(parsed)) preferred = parsed
    } else {
      preferred = readStoredAccountId()
    }

    void loadAll(preferred)
  }, [])

  useEffect(() => {
    if (!initialLoadDone.current) return
    if (connectedAccountId == null) return
    persistSelectedAccount(connectedAccountId)
    void loadAll(connectedAccountId)
  }, [connectedAccountId])

  useEffect(() => {
    if (connectedAccountId == null) return

    const interval = setInterval(() => {
      void loadAll(connectedAccountId)
    }, 10000)

    return () => clearInterval(interval)
  }, [connectedAccountId])

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

  function openPost(url: string) {
    if (!url) return
    window.open(url, '_blank', 'noopener,noreferrer')
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
            A living starfield of resurfacing potential.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href={connectedAccountId ? `/dashboard?connected_account_id=${connectedAccountId}` : '/dashboard'}
            style={{
              color: '#d8ffe2',
              border: '1px solid rgba(180,255,210,0.18)',
              padding: '10px 16px',
              borderRadius: 999,
              textDecoration: 'none',
            }}
          >
            ← Dashboard
          </Link>

          <label style={{ color: '#b6dcc0', fontSize: 14 }}>
            Account{' '}
            <select
              value={connectedAccountId ?? ''}
              onChange={(e) => setConnectedAccountId(e.target.value ? Number(e.target.value) : null)}
              style={{
                marginLeft: 8,
                background: '#081511',
                color: '#ecfff1',
                border: '1px solid rgba(180,255,210,0.18)',
                borderRadius: 10,
                padding: '8px 10px',
                minWidth: 240,
              }}
            >
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
            Bigger stars have stronger pull. Gold stars are highest-gravity posts, blue stars are
            strong performers, and green stars are standard rotation posts. Double click any star to
            open the post.
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
            Content Universe · bigger stars = stronger pull
            {loading ? ' · loading…' : ''}
          </span>
          <span>
            {filteredNodes.length} visible stars · {meta?.running ? 'Autopilot running' : 'Autopilot idle'}
          </span>
        </div>

        <div
          style={{
            position: 'relative',
            minHeight: 780,
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
                style={{
                  position: 'absolute',
                  left: `${pos.left}%`,
                  top: `${pos.top}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div
                  onDoubleClick={() => openPost(node.url)}
                  title={node.url ? 'Double click to open post' : undefined}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: node.url ? 'pointer' : 'default',
                  }}
                >
                  <div
                    className={animateGalaxy ? 'star-shell animated-shell' : 'star-shell'}
                    style={
                      animateGalaxy
                        ? ({
                            ['--drift-x' as any]: `${driftX}px`,
                            ['--drift-y' as any]: `${driftY}px`,
                            ['--drift-duration' as any]: `${driftDuration}s`,
                          } as React.CSSProperties)
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
                          background: starColor(node.gravity, candidate, currentCycle, recent),
                          boxShadow: starGlow(node.gravity, showGlow, candidate, currentCycle),
                          opacity: node.state === 'active' ? 0.98 : 0.35,
                          ...(animateGalaxy
                            ? ({
                                ['--pulse-duration' as any]: currentCycle ? '1.35s' : `${pulseDuration}s`,
                              } as React.CSSProperties)
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
                        href={node.url}
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
                        onClick={() => openPost(node.url)}
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
              animation: drift var(--drift-duration) ease-in-out infinite alternate;
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

function toggleStyle(active: boolean): React.CSSProperties {
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

const cardStyle: React.CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'rgba(7, 23, 17, 0.8)',
  padding: 18,
}

const panelStyle: React.CSSProperties = {
  borderRadius: 20,
  border: '1px solid rgba(180,255,210,0.12)',
  background: 'rgba(7, 23, 17, 0.8)',
  padding: 18,
}

const panelTitleStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#dfffea',
  fontWeight: 700,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#94b8a0',
  marginBottom: 8,
}

const valueStyle: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
  color: '#ecfff1',
}

const hoverCardStyle: React.CSSProperties = {
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

const hoverKeyStyle: React.CSSProperties = {
  color: '#8fe7ad',
  fontWeight: 700,
}

const starLabelStyle: React.CSSProperties = {
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