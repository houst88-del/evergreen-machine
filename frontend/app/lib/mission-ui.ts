import type { CSSProperties } from 'react'

export type MissionBadgeTone = 'mint' | 'gold' | 'sky' | 'neutral' | 'danger'

const toneMap: Record<MissionBadgeTone, CSSProperties> = {
  mint: {
    border: '1px solid rgba(110,231,183,0.2)',
    background: 'rgba(16,185,129,0.10)',
    color: 'rgba(236,253,245,0.9)',
  },
  gold: {
    border: '1px solid rgba(250,228,120,0.24)',
    background: 'rgba(250,228,120,0.08)',
    color: 'rgba(255,248,210,0.95)',
  },
  sky: {
    border: '1px solid rgba(125,211,252,0.24)',
    background: 'rgba(125,211,252,0.10)',
    color: 'rgba(224,242,254,0.98)',
  },
  neutral: {
    border: '1px solid rgba(255,255,255,0.1)',
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(236,253,245,0.82)',
  },
  danger: {
    border: '1px solid rgba(248,113,113,0.24)',
    background: 'rgba(239,68,68,0.08)',
    color: 'rgba(254,226,226,0.95)',
  },
}

export function missionBadgeStyle(
  tone: MissionBadgeTone = 'mint',
  dense = false
): CSSProperties {
  return {
    borderRadius: 999,
    padding: dense ? '5px 9px' : '6px 10px',
    fontSize: dense ? 11 : 12,
    letterSpacing: dense ? '0.08em' : undefined,
    textTransform: dense ? 'uppercase' : undefined,
    ...toneMap[tone],
  }
}

export const missionEyebrowStyle: CSSProperties = {
  color: 'rgba(236,253,245,0.58)',
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
}
