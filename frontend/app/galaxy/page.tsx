"use client";

import React, { useEffect, useMemo, useState } from "react";

type ConnectedAccount = { id: number; provider: string; handle: string };

type GalaxyNode = {
  id: string;
  post_id?: number;
  provider_post_id?: string;
  url?: string;
  label?: string;
  score?: number;
  normalized_score?: number;
  gravity?: string;
  gravity_score?: number | null;
  predicted_velocity?: number | null;
  archive_signal?: number | null;
  tier?: string;
  cold_archive?: boolean;
  archetype?: string;
  revival_score?: number;
  refresh_count?: number;
  state?: string;
  connected_account_id?: number;
  provider?: string;
  handle?: string;
  candidate?: boolean;
  current_cycle?: boolean;
  last_resurfaced_at?: string | null;
  pair_partner_id?: string | null;
  selection_strategy?: string | null;
  selection_reason?: string | null;
};

type GalaxyMeta = {
  connected_account_id?: number | null;
  count?: number;
  running?: boolean;
  connected?: boolean;
  last_action_at?: string | null;
  next_cycle_at?: string | null;
  mode?: "single" | "unified";
  account_count?: number;
  metadata?: Record<string, unknown>;
};

type GalaxyResponse = { nodes: GalaxyNode[]; meta: GalaxyMeta };

type DashboardStatus = {
  connected_account_id?: number | null;
  running?: boolean;
  connected?: boolean;
  provider?: string;
  account_handle?: string;
  posts_in_rotation?: number;
  last_post_text?: string | null;
  last_action_at?: string | null;
  next_cycle_at?: string | null;
  metadata?: Record<string, unknown>;
};

const BACKEND = "https://evergreen-machine-production.up.railway.app";

const safeNum = (v: unknown, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const fmtWhen = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
};

const minutesAgo = (value?: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const mins = Math.max(0, Math.round(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const shortText = (text?: string | null, max = 90) => {
  const raw = (text || "").trim();
  if (!raw) return "Untitled post";
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
};

const providerColor = (provider?: string) => {
  const p = (provider || "").toLowerCase();
  if (p === "bluesky" || p === "bsky") return "rgba(125, 211, 252, 0.95)";
  if (p === "x" || p === "twitter") return "rgba(187, 247, 208, 0.96)";
  return "rgba(196, 181, 253, 0.95)";
};

const parseMeta = (meta?: GalaxyMeta) => {
  const m = (meta?.metadata || {}) as Record<string, unknown>;
  return {
    momentum: safeNum(m.momentum_stack_remaining, 0),
    velocity: !!m.velocity_stack_active,
    pairTarget: String(m.pending_pair_post_id || ""),
    strategy: String(m.last_strategy || ""),
    reason: String(m.last_selection_reason || ""),
    nextRefreshAt: String(m.next_refresh_at || meta?.next_cycle_at || ""),
    lastSelectedAt: String(m.last_selected_at || meta?.last_action_at || ""),
  };
};

const computeRadius = (node: GalaxyNode) => {
  const score = safeNum(node.normalized_score ?? node.score, 0);
  const gravityScore = safeNum(node.gravity_score, 0);
  const velocity = safeNum(node.predicted_velocity, 0);
  const base = 2.2 + Math.sqrt(Math.max(score, 0)) * 0.13;
  const gravityLift = Math.sqrt(Math.max(gravityScore, 0)) * 0.18;
  const velocityLift = Math.min(5, Math.max(0, velocity) * 1.3);
  return Math.max(2, Math.min(18, base + gravityLift + velocityLift));
};

const rankGravity = (node: GalaxyNode) =>
  safeNum(node.gravity_score, 0) * 2.2 +
  safeNum(node.predicted_velocity, 0) * 30 +
  safeNum(node.normalized_score ?? node.score, 0) +
  safeNum(node.revival_score, 0) * 0.7;

const forecastStrength = (node: GalaxyNode) =>
  safeNum(node.predicted_velocity, 0) * 100 +
  safeNum(node.gravity_score, 0) * 12 +
  safeNum(node.revival_score, 0) * 3 +
  (node.candidate ? 24 : 0);

const intelligenceScore = (
  node: GalaxyNode,
  mode: "balanced" | "forecast" | "revival" | "gravity"
) => {
  if (mode === "forecast") return forecastStrength(node);
  if (mode === "revival") return safeNum(node.revival_score, 0) * 10 + safeNum(node.refresh_count, 0) * 8;
  if (mode === "gravity") return rankGravity(node);
  return (
    forecastStrength(node) * 0.45 +
    rankGravity(node) * 0.4 +
    safeNum(node.refresh_count, 0) * 9 +
    safeNum(node.revival_score, 0) * 6
  );
};

const cardStyle = (): React.CSSProperties => ({
  border: "1px solid rgba(52, 211, 153, 0.18)",
  background: "rgba(16, 185, 129, 0.06)",
  borderRadius: 22,
  padding: 8,
  boxShadow: "0 0 0 1px rgba(16,185,129,0.02)",
  backdropFilter: "blur(10px)",
});

const mv = (speed: number, tick: number, phase: number) => Math.sin(tick * speed + phase);

const rarityAccent = (node: GalaxyNode) => {
  const g = rankGravity(node);
  if (g >= 420) {
    return {
      fill: "rgba(255,250,210,0.98)",
      border: "rgba(250,228,120,0.95)",
      aura: "rgba(250,228,120,0.34)",
      tag: "Gravity",
    };
  }
  if (safeNum(node.normalized_score ?? node.score, 0) >= 120) {
    return {
      fill: "rgba(220,245,205,0.97)",
      border: "rgba(230,210,110,0.86)",
      aura: "rgba(230,210,110,0.24)",
      tag: "Strong",
    };
  }
  return {
    fill: providerColor(node.provider).replace("0.95", "0.9").replace("0.96", "0.9"),
    border: node.provider?.toLowerCase() === "bluesky" ? "rgba(125,211,252,0.76)" : "rgba(187,247,208,0.82)",
    aura: node.provider?.toLowerCase() === "bluesky" ? "rgba(125,211,252,0.16)" : "rgba(187,247,208,0.16)",
    tag: "Standard",
  };
};

const archetypeColor = (name?: string | null) => {
  const n = String(name || "").toLowerCase();
  if (n.includes("viral")) return "rgba(255,235,160,0.9)";
  if (n.includes("revival")) return "rgba(187,247,208,0.9)";
  if (n.includes("sleeper")) return "rgba(125,211,252,0.9)";
  if (n.includes("reliable")) return "rgba(196,181,253,0.9)";
  if (n.includes("conversation")) return "rgba(220,245,205,0.9)";
  return "rgba(220,245,205,0.72)";
};

const highlightOpacity = (
  node: GalaxyNode,
  mode: "off" | "strong" | "viral" | "conversion"
) => {
  if (mode === "off") return 1;
  if (mode === "strong") return safeNum(node.normalized_score ?? node.score, 0) >= 120 ? 1 : 0.16;
  if (mode === "viral") return safeNum(node.predicted_velocity, 0) >= 0.65 || !!node.current_cycle ? 1 : 0.12;
  if (mode === "conversion") {
    const label = String(node.label || "").toLowerCase();
    const arche = String(node.archetype || "").toLowerCase();
    const hit =
      label.includes("link") ||
      label.includes("subscribe") ||
      label.includes("dm") ||
      label.includes("onlyfans") ||
      arche.includes("showcase");
    return hit ? 1 : 0.14;
  }
  return 1;
};

export default function GalaxyPage() {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selected, setSelected] = useState<string>("unified");
  const [galaxy, setGalaxy] = useState<GalaxyResponse>({ nodes: [], meta: {} });
  const [statusMap, setStatusMap] = useState<Record<number, DashboardStatus>>({});
  const [hovered, setHovered] = useState<any | null>(null);
  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const [error, setError] = useState("");
  const [flashTick, setFlashTick] = useState(0);
  const [timeWarp, setTimeWarp] = useState(0);
  const [timeLapseOn, setTimeLapseOn] = useState(true);
  const [timeLapseSpeed, setTimeLapseSpeed] = useState(0.25);
  const [timeTravel, setTimeTravel] = useState(0);
  const [intelligenceView, setIntelligenceView] = useState<"balanced" | "forecast" | "revival" | "gravity">("balanced");
  const [highlightMode, setHighlightMode] = useState<"off" | "strong" | "viral" | "conversion">("off");
  const [motionFactor, setMotionFactor] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [cameraDriftTick, setCameraDriftTick] = useState(0);
  const [parallaxTick, setParallaxTick] = useState(0);
  const [waveTick, setWaveTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveTick((v) => v + motionFactor);
    }, 60);
    return () => window.clearInterval(id);
  }, [motionFactor]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMotionFactor((current) => {
        const target = timeLapseOn ? 1 : 0;
        const next = current + (target - current) * 0.18;
        if (Math.abs(next - target) < 0.01) return target;
        return next;
      });
    }, 60);
    return () => window.clearInterval(id);
  }, [timeLapseOn]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setFlashTick((v) => v + (motionFactor > 0.02 ? 1 : 0));
    }, 1800);
    return () => window.clearInterval(id);
  }, [motionFactor]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setWaveTick((v) => v + (motionFactor > 0.02 ? 1 : 0));
    }, 1400);
    return () => window.clearInterval(id);
  }, [motionFactor]);

  useEffect(() => {
    if (!timeLapseOn) return;
    const id = window.setInterval(
      () => setTimeWarp((v) => (v + timeLapseSpeed) % 100),
      360
    );
    return () => window.clearInterval(id);
  }, [timeLapseOn, timeLapseSpeed]);

  useEffect(() => {
    let cancelled = false;
    async function loadAccounts() {
      try {
        const res = await fetch(`${BACKEND}/api/connected-accounts?user_id=1`);
        const json = await res.json();
        if (!cancelled) {
          const next = Array.isArray(json.accounts) ? json.accounts : [];
          setAccounts(next);
          if (selected !== "unified" && !next.some((a: ConnectedAccount) => String(a.id) === selected)) {
            setSelected("unified");
          }
        }
      } catch {
        if (!cancelled) setError("Could not load connected accounts.");
      }
    }
    loadAccounts();
    const id = window.setInterval(loadAccounts, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    async function loadStatuses() {
      try {
        const out: Record<number, DashboardStatus> = {};
        for (const account of accounts) {
          const res = await fetch(`${BACKEND}/api/status?user_id=1&connected_account_id=${account.id}`, { cache: "no-store" });
          if (!res.ok) continue;
          out[account.id] = await res.json();
        }
        if (!cancelled) setStatusMap(out);
      } catch {}
    }
    if (accounts.length) loadStatuses();
    const id = window.setInterval(loadStatuses, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [accounts]);

  useEffect(() => {
    let cancelled = false;
    async function loadGalaxy() {
      try {
        const qs = selected === "unified" ? "?unified=true" : `?connected_account_id=${encodeURIComponent(selected)}`;
        const res = await fetch(`${BACKEND}/api/galaxy${qs}`, { cache: "no-store" });
        const json: GalaxyResponse = await res.json();
        if (!cancelled) {
          setGalaxy({ nodes: Array.isArray(json.nodes) ? json.nodes : [], meta: json.meta || {} });
          setError("");
        }
      } catch {
        if (!cancelled) setError("Could not load galaxy.");
      }
    }
    loadGalaxy();
    const id = window.setInterval(loadGalaxy, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selected]);

  const engine = useMemo(() => parseMeta(galaxy.meta), [galaxy.meta]);

  const workingNodes = useMemo(() => {
    const nodes = [...galaxy.nodes].sort((a, b) => rankGravity(b) - rankGravity(a));
    const wells = nodes.slice(0, 5);
    const centerX = 50;
    const centerY = 57;
    const warp = timeWarp * 0.03;
    const temporalShift = timeTravel * 0.08;

    return nodes.map((node, index) => {
      const phase = index * 0.17;
      const orbitBreathe = 0.5 + mv(0.018, liveTick + timeWarp * 2 + temporalShift, phase) * 0.8;
      const t = index * 0.42 + liveTick * 0.01 + warp + temporalShift * 0.03;
      const temporalRadiusBias = Math.max(-8, Math.min(14, (timeTravel - 50) * 0.08));
      const contentAgeBias = Math.max(-10, Math.min(10, safeNum(node.refresh_count, 0) * 0.35 - safeNum(node.archive_signal, 0) * 5));
      const spiralR = 8 + Math.min(38, Math.sqrt(index) * 2.55) + orbitBreathe + temporalRadiusBias + contentAgeBias;

      let px = centerX + Math.cos(t) * spiralR;
      let py = centerY + Math.sin(t) * (spiralR * 0.58);

      const primaryWell = wells[index % Math.max(1, wells.length)];
      if (primaryWell) {
        const wellIndex = wells.findIndex((w) => w.id === primaryWell.id);
        const wellT = wellIndex * 1.37 + 0.7 + liveTick * 0.004 + warp * 0.6;
        const wellR = 10 + wellIndex * 7.5;
        const wx = centerX + Math.cos(wellT) * wellR;
        const wy = centerY + Math.sin(wellT) * (wellR * 0.5);
        const pull = Math.min(
          0.78,
          0.16 +
            safeNum(node.gravity_score, 0) * 0.002 +
            safeNum(node.normalized_score ?? node.score, 0) * 0.001 +
            safeNum(node.predicted_velocity, 0) * 0.045
        );
        px = px * (1 - pull) + wx * pull;
        py = py * (1 - pull) + wy * pull;
      }

      px += mv(0.03, liveTick + timeWarp + temporalShift, phase) * (node.candidate ? 0.7 : 0.35);
      py += mv(0.026, liveTick + timeWarp + temporalShift, phase + 1.2) * (node.current_cycle ? 0.9 : 0.4);

      if (node.cold_archive || safeNum(node.archive_signal, 0) > 0.75) {
        px += (index % 2 === 0 ? 1 : -1) * 8;
        py += 8 + (index % 7);
      }

      // peripheral drift for archival or low‑score posts
      const drift = (safeNum(node.archive_signal,0) * 10) + (node.cold_archive ? 8 : 0) + Math.max(0, (50 - timeTravel) * 0.08);
      px += Math.cos(index) * drift * 0.1;
      py += Math.sin(index) * drift * 0.1;

      px = Math.max(3, Math.min(97, px));
      py = Math.max(12, Math.min(94, py));

      return { ...node, _phase: phase, _px: px, _py: py, _r: computeRadius(node) };
    });
  }, [galaxy.nodes, liveTick, timeWarp]);

  const gravityWells = useMemo(
    () =>
      [...workingNodes]
        .sort((a, b) => rankGravity(b) - rankGravity(a))
        .slice(0, 4)
        .map((node, index) => {
          const pulse = 1 + mv(0.03, liveTick, index * 0.9) * 0.08;
          return {
            node,
            size: (18 + index * 7 + node._r * 3.2) * pulse,
            opacity: Math.max(0.12, 0.3 - index * 0.045),
            index,
          };
        }),
    [workingNodes, liveTick]
  );

  const heatNebulae = useMemo(() => {
    const hubs = [...workingNodes]
      .sort((a, b) => intelligenceScore(b, intelligenceView) - intelligenceScore(a, intelligenceView))
      .slice(0, 9);
    return hubs.map((node, i) => ({
      x: node._px,
      y: node._py,
      rx: 160 + i * 18 + safeNum(node.gravity_score, 0) * 40,
      ry: 90 + i * 10 + safeNum(node.predicted_velocity, 0) * 60,
      o: Math.max(0.08, 0.18 - i * 0.012),
    }));
  }, [workingNodes, intelligenceView]);

  const gravityFlows = useMemo(() => {
    return gravityWells.flatMap(({ node }, wellIndex) => {
      const particles = [];
      const count = 16 + wellIndex * 4;
      for (let i = 0; i < count; i++) {
        const phase = i * 0.48 + wellIndex * 0.9;
        const lane = 20 + wellIndex * 8 + (i % 3) * 3.2;
        const t = liveTick * 0.018 + phase + timeWarp * 0.04;
        const x = 50 + Math.cos(t + wellIndex * 0.3) * lane;
        const y = 58 + Math.sin(t + wellIndex * 0.3) * (lane * 0.34);
        const wx = node._px;
        const wy = node._py;
        const pull = 0.15 + (i % 5) * 0.035;
        particles.push({
          x: x * (1 - pull) + wx * pull,
          y: y * (1 - pull) + wy * pull,
          o: 0.14 + (i % 4) * 0.05,
          r: 1.2 + (i % 2) * 0.45,
        });
      }
      return particles;
    });
  }, [gravityWells, liveTick, timeWarp]);

  const pairLinks = useMemo(() => {
    const byId = new Map(workingNodes.map((n) => [String(n.provider_post_id || n.id), n]));
    return workingNodes
      .filter((n) => n.pair_partner_id)
      .map((n) => {
        const target = byId.get(String(n.pair_partner_id || ""));
        if (!target) return null;
        return { from: n, to: target };
      })
      .filter(Boolean) as Array<{ from: any; to: any }>;
  }, [workingNodes]);

  const constellationLinks = useMemo(() => {
    const links: Array<{ a: any; b: any; strength: number }> = [];
    const nodes = [...workingNodes].filter((n) => !n.cold_archive && safeNum(n.archive_signal, 0) < 0.9).slice(0, 220);

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      let best: { node: any; strength: number } | null = null;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if ((a.provider || "") !== (b.provider || "")) continue;
        const dx = safeNum(a._px, 0) - safeNum(b._px, 0);
        const dy = safeNum(a._py, 0) - safeNum(b._py, 0);
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 9.5) continue;
        const scoreGap = Math.abs(safeNum(a.normalized_score ?? a.score, 0) - safeNum(b.normalized_score ?? b.score, 0));
        if (scoreGap > 120) continue;
        const gravityGap = Math.abs(safeNum(a.gravity_score, 0) - safeNum(b.gravity_score, 0));
        const strength = 1 / Math.max(1.25, dist) + 1 / Math.max(4, scoreGap / 20 + gravityGap * 3);
        if (!best || strength > best.strength) best = { node: b, strength };
      }
      if (best) links.push({ a, b: best.node, strength: best.strength });
    }

    return links.slice(0, 90);
  }, [workingNodes]);

  const revivalTrails = useMemo(() => {
    return workingNodes
      .filter((n) => safeNum(n.refresh_count, 0) >= 2 || safeNum(n.revival_score, 0) >= 14)
      .slice(0, 70)
      .map((node, i) => {
        const steps = 6;
        const trail = [];
        for (let s = 1; s <= steps; s++) {
          trail.push({
            x: node._px - Math.cos(node._phase + liveTick * 0.01) * s * 1.25,
            y: node._py - Math.sin(node._phase + liveTick * 0.01) * s * 0.72,
            r: Math.max(0.55, node._r * (0.28 - s * 0.03)),
            o: Math.max(0.04, 0.22 - s * 0.03),
          });
        }
        return { node, trail, key: `revival-${i}` };
      });
  }, [workingNodes, liveTick]);

  const counts = useMemo(() => {
    const gravityStars = workingNodes.filter((n) => rankGravity(n) >= 250).length;
    const strongStars = workingNodes.filter((n) => safeNum(n.normalized_score ?? n.score, 0) >= 120).length;
    const candidates = workingNodes.filter((n) => !!n.candidate).length;
    const currentCycle = workingNodes.filter((n) => !!n.current_cycle).length;
    const recent = workingNodes.filter((n) => minutesAgo(n.last_resurfaced_at).includes("m ago")).length;
    return { gravityStars, strongStars, candidates, currentCycle, recent };
  }, [workingNodes]);

  const selectedLabel = useMemo(() => {
    if (selected === "unified") return "Unified Galaxy";
    const found = accounts.find((a) => String(a.id) === selected);
    return found ? `${found.provider} · ${found.handle}` : "Galaxy";
  }, [accounts, selected]);

  const currentStatus = useMemo(
    () => (selected === "unified" ? null : statusMap[Number(selected)] || null),
    [selected, statusMap]
  );

  const supernovaNode = useMemo(() => {
    const candidates = [...workingNodes]
      .filter((n) => safeNum(n.predicted_velocity, 0) > 0.7 || !!n.current_cycle || rankGravity(n) > 300)
      .sort((a, b) => rankGravity(b) - rankGravity(a));
    return candidates[0] || null;
  }, [workingNodes]);

  useEffect(() => {
    if (!selectedStarId && supernovaNode) {
      setSelectedStarId(supernovaNode.id);
    }
  }, [supernovaNode, selectedStarId]);

  const waveRadius = useMemo(() => 40 + (flashTick % 6) * 90 + (liveTick % 20) * 1.2, [flashTick, liveTick]);

  const forecastNodes = useMemo(
    () => [...workingNodes].filter((n) => !n.cold_archive).sort((a, b) => intelligenceScore(b, intelligenceView) - intelligenceScore(a, intelligenceView)).slice(0, 5),
    [workingNodes, intelligenceView]
  );

  const archetypeGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const node of workingNodes) {
      const key = (node.archetype || "unclassified").toString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(node);
    }
    return [...groups.entries()]
      .filter(([, nodes]) => nodes.length >= 3)
      .slice(0, 8)
      .map(([name, nodes]) => ({ name, nodes }));
  }, [workingNodes]);

  const selectedStar = useMemo(
    () => workingNodes.find((n) => n.id === selectedStarId) || null,
    [workingNodes, selectedStarId]
  );

  const intelligenceSummary = useMemo(() => {
    const top = [...workingNodes]
      .filter((n) => !n.cold_archive)
      .sort((a, b) => intelligenceScore(b, intelligenceView) - intelligenceScore(a, intelligenceView))
      .slice(0, 3);
    return top;
  }, [workingNodes, intelligenceView]);

  const clusterHulls = useMemo(() => {
    return archetypeGroups.slice(0, 4).map((group) => {
      const xs = group.nodes.map((n) => safeNum(n._px, 0));
      const ys = group.nodes.map((n) => safeNum(n._py, 0));
      const minX = Math.max(4, Math.min(...xs) - 3);
      const maxX = Math.min(96, Math.max(...xs) + 3);
      const minY = Math.max(10, Math.min(...ys) - 3);
      const maxY = Math.min(96, Math.max(...ys) + 3);
      return {
        name: group.name,
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        w: maxX - minX,
        h: maxY - minY,
        count: group.nodes.length,
      };
    });
  }, [archetypeGroups]);

  const shockwaves = useMemo(() => {
    if (!supernovaNode) return [];
    return [0, 1, 2].map((k) => {
      const phase = ((liveTick * (0.9 + k * 0.12)) % 220);
      return {
        x: supernovaNode._px,
        y: supernovaNode._py,
        r: 24 + phase * (0.9 + k * 0.08),
        o: Math.max(0, 0.22 - phase / 1300),
      };
    });
  }, [supernovaNode, liveTick]);

  return (
    <div style={{ minHeight: "100vh", color: "rgba(236,253,245,0.98)", background: "radial-gradient(circle at 50% 0%, rgba(16,185,129,0.13), transparent 28%), linear-gradient(90deg, #010707 0%, #03130f 35%, #03130f 65%, #010707 100%)", fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: 2600, margin: "0 auto", padding: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 54, lineHeight: 1, margin: 0, fontWeight: 700 }}>Evergreen Galaxy</h1>
            <p style={{ marginTop: 10, color: "rgba(236,253,245,0.72)", fontSize: 14 }}>Gravity wells now reveal where your strongest resurfacing pull concentrates.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => (window.location.href = "/dashboard")} style={{ borderRadius: 999, border: "1px solid rgba(52,211,153,0.28)", background: "rgba(16,185,129,0.08)", color: "white", padding: "10px 16px", cursor: "pointer" }}>← Dashboard</button>
            <div style={{ borderRadius: 999, border: "1px solid rgba(52,211,153,0.18)", background: "rgba(0,0,0,0.28)", color: "rgba(236,253,245,0.78)", padding: "10px 14px", fontSize: 12 }}>Galaxy View</div>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ borderRadius: 999, border: "1px solid rgba(125,211,252,0.38)", background: "#031110", color: "white", padding: "10px 14px" }}>
              <option value="unified">Unified Galaxy</option>
              {accounts.map((account) => <option key={account.id} value={String(account.id)}>{account.provider}: {account.handle}</option>)}
            </select>
          </div>
        </div>

        {error ? <div style={{ marginBottom: 16, borderRadius: 18, border: "1px solid rgba(248,113,113,0.35)", background: "rgba(239,68,68,0.12)", padding: "12px 16px", color: "rgba(254,226,226,0.95)" }}>{error}</div> : null}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 12, marginBottom: 14 }}>
          {[["Total Stars", String(workingNodes.length)], ["Gravity Stars", String(counts.gravityStars)], ["Strong Stars", String(counts.strongStars)], ["Standard Stars", String(Math.max(0, workingNodes.length - counts.strongStars))], ["Candidates", String(counts.candidates)], ["Current Cycle", String(counts.currentCycle)], ["Recent Pulses", String(counts.recent)]].map(([label, value]) => (
            <div key={label} style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>{label}</div>
              <div style={{ marginTop: 10, fontSize: 42, fontWeight: 700, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>



        <div style={{ display: "grid", gridTemplateColumns: "0.75fr 3.1fr 0.75fr", gap: 16, marginBottom: 14, alignItems: "start" }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Command Deck</div>
              <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.8, color: "rgba(236,253,245,0.74)" }}>
                <div>View: {selectedLabel}</div>
                <div>Mode: {intelligenceView}</div>
                <div>Travel: {timeTravel < 34 ? "Past" : timeTravel > 66 ? "Future" : "Present"}</div>
                <div>Zoom: {zoom.toFixed(1)}x</div>
                <div>Focus: {highlightMode === "off" ? "Balanced" : highlightMode}</div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Autopilot Signal</div>
              <div style={{ marginTop: 10, fontSize: 40, fontWeight: 700 }}>{currentStatus?.running ? "Running" : "Idle"}</div>
              <div style={{ marginTop: 8, fontSize: 14, color: "rgba(236,253,245,0.7)" }}>{engine.strategy || "Standard circulation"}</div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Time Travel</div>
              <div style={{ marginTop: 10 }}>
                <input type="range" min={0} max={100} value={timeTravel} onChange={(e) => setTimeTravel(Number(e.target.value))} style={{ width: "100%" }} />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(236,253,245,0.7)" }}>
                  {timeTravel < 34 ? "Past bias" : timeTravel > 66 ? "Future bias" : "Present"}
                </div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Replay</div>
              <div style={{ display: "grid", gap: 7, marginTop: 10, alignContent: "start" }}>
                <button onClick={() => setTimeLapseOn((v) => !v)} style={{ borderRadius: 999, border: "1px solid rgba(110,231,183,0.2)", background: "rgba(16,185,129,0.08)", color: "white", padding: "8px 10px", cursor: "pointer" }}>{timeLapseOn ? "Pause" : "Play"}</button>
                <input type="range" min={0.25} max={2} step={0.25} value={timeLapseSpeed} onChange={(e) => setTimeLapseSpeed(Number(e.target.value))} />
                <div style={{ fontSize: 12, color: "rgba(236,253,245,0.7)" }}>Speed {timeLapseSpeed.toFixed(1)}x</div>
                <div style={{ fontSize:12,color:"rgba(236,253,245,0.7)" }}>Zoom</div>
                <input type="range" min={0.6} max={1.6} step={0.1} value={zoom} onChange={(e)=>setZoom(Number(e.target.value))}/>
              </div>
            </div>

            <div style={{ ...cardStyle(), padding: 12 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)", marginBottom: 6 }}>
                Follow the Star
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(236,253,245,0.94)" }}>
                {selectedStar ? shortText(selectedStar.label || selectedStar.id, 36) : "No star selected"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(236,253,245,0.58)", marginTop: 6 }}>
                {selectedStar ? `${selectedStar.provider || "provider"} · intelligence ${intelligenceScore(selectedStar, intelligenceView).toFixed(0)}` : "Click any star to lock focus."}
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 12, alignItems: "stretch" }}>
              <div style={cardStyle()}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {([
  ["Gravity wells", true],
  ["Strong", false],
  ["Standard", false],
  ["Glow", false],
  ["Inline labels", false],
  ["Live motion", false],
  ["Constellations", false],
  ["Forecast", false],
  ["Nebulae", false],
] as [string, boolean][]).map(([label, accent]) => (
                    <span key={label} style={{ borderRadius: 999, padding: "6px 12px", fontSize: 12, border: accent ? "1px solid rgba(253,224,71,0.35)" : "1px solid rgba(110,231,183,0.2)", background: accent ? "rgba(253,224,71,0.12)" : "rgba(16,185,129,0.10)", color: accent ? "rgba(254,249,195,1)" : "rgba(236,253,245,0.9)" }}>{label}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: "rgba(236,253,245,0.64)" }}>
                  Nebula heat zones now reveal where forecast pressure and engagement density are building. Forecast stars get faint pre-pull halos before they explode.
                </div>
              </div>

              <div style={cardStyle()}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {["Score", "Gravity", "Gravity score", "Velocity", "Archive", "Archetype", "Revival", "Refreshes", "Strategy", "Reason", "State"].map((label) => (
                    <span key={label} style={{ borderRadius: 999, padding: "6px 12px", fontSize: 12, border: "1px solid rgba(110,231,183,0.2)", background: "rgba(16,185,129,0.10)", color: "rgba(236,253,245,0.9)" }}>{label}</span>
                  ))}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: "rgba(236,253,245,0.64)" }}>
                  Hover cards foreground engine reasons so the galaxy mirrors what the worker is most likely to choose next.
                </div>
              </div>
            </div>

        <div style={{ position: "relative", height: "calc(100vh - 340px)", overflow: "hidden", borderRadius: 30, border: "1px solid rgba(52,211,153,0.18)", background: "radial-gradient(circle at 50% 40%, rgba(253,224,71,0.10), transparent 58%), linear-gradient(180deg, #03100f 0%, #010707 100%)" }}>
          <div style={{ position: "absolute", inset: 0, transform: `translate(${selectedStar ? `${(50 - selectedStar._px) * 0.42 + Math.sin(cameraDriftTick * 0.012) * 4 + Math.cos(parallaxTick * 0.01) * 2}px, ${-118 + (50 - selectedStar._py) * 0.22 + Math.cos(cameraDriftTick * 0.011) * 2.0}px` : `${Math.sin(cameraDriftTick * 0.012) * 4 + Math.cos(parallaxTick * 0.01) * 2}px, ${-118 + Math.cos(cameraDriftTick * 0.011) * 2.0}px`}) scale(${zoom * (highlightMode === "strong" || highlightMode === "viral" ? 1.14 : 1.11)})`, transformOrigin: "center top", transition: "transform 220ms ease-out", paddingBottom: 8 }}>
          {/* Viral propagation waves */}
          {supernovaNode ? [0, 1, 2].map((i) => {
            const r = 40 + ((waveTick + i * 20) % 120) * 2;
            const o = Math.max(0, 0.25 - r / 400);
            return (
              <div
                key={"viralwave" + i}
                style={{
                  position: "absolute",
                  left: `${supernovaNode._px}%`,
                  top: `${supernovaNode._py}%`,
                  width: `${r * 2}px`,
                  height: `${r * 2}px`,
                  transform: "translate(-50%,-50%)",
                  borderRadius: "9999px",
                  border: `1px solid rgba(255,240,170,${o})`,
                  pointerEvents: "none",
                }}
              />
            );
          }) : null}

          {/* nebula heat map */}
          {heatNebulae.map((n, i) => (
            <div
              key={`nebula-${i}`}
              style={{
                position: "absolute",
                left: `${n.x}%`,
                top: `${n.y}%`,
                width: `${n.rx}px`,
                height: `${n.ry}px`,
                transform: "translate(-50%, -50%)",
                borderRadius: "9999px",
                filter: "blur(34px)",
                background: i < 3
                  ? `radial-gradient(circle, rgba(255,244,180,${n.o}) 0%, rgba(220,255,230,${n.o * 0.55}) 40%, rgba(16,185,129,0) 78%)`
                  : `radial-gradient(circle, rgba(220,255,230,${n.o}) 0%, rgba(125,211,252,${n.o * 0.4}) 42%, rgba(16,185,129,0) 78%)`,
                pointerEvents: "none",
              }}
            />
          ))}

          {gravityWells.map(({ node, size, opacity, index }) => (
            <div key={`well-${node.id}-${index}`} style={{ position: "absolute", left: `${node._px}%`, top: `${node._py}%`, width: `${size}rem`, height: `${size}rem`, transform: "translate(-50%, -50%)", borderRadius: "9999px", filter: "blur(48px)", background: index === 0 ? `radial-gradient(circle, rgba(250,245,170,${opacity}) 0%, rgba(250,245,170,${opacity * 0.42}) 35%, rgba(16,185,129,0) 72%)` : `radial-gradient(circle, rgba(187,247,208,${opacity}) 0%, rgba(187,247,208,${opacity * 0.38}) 35%, rgba(16,185,129,0) 72%)`, pointerEvents: "none" }} />
          ))}

          {supernovaNode ? (
            <>
              <div style={{ position: "absolute", left: `${supernovaNode._px}%`, top: `${supernovaNode._py}%`, width: `${waveRadius}px`, height: `${waveRadius}px`, transform: "translate(-50%, -50%)", borderRadius: "9999px", border: "1px solid rgba(255,240,170,0.18)", boxShadow: "0 0 24px rgba(255,240,170,0.08)", pointerEvents: "none" }} />
              <div style={{ position: "absolute", left: `${supernovaNode._px}%`, top: `${supernovaNode._py}%`, width: `${Math.max(40, waveRadius - 65)}px`, height: `${Math.max(40, waveRadius - 65)}px`, transform: "translate(-50%, -50%)", borderRadius: "9999px", border: "1px solid rgba(255,240,170,0.1)", pointerEvents: "none" }} />
            </>
          ) : null}

          {shockwaves.map((w, i) => (
            <div
              key={`shock-${i}`}
              style={{
                position: "absolute",
                left: `${w.x}%`,
                top: `${w.y}%`,
                width: `${w.r * 2}px`,
                height: `${w.r * 2}px`,
                transform: "translate(-50%, -50%)",
                borderRadius: "9999px",
                border: `1px solid rgba(255,244,180,${w.o})`,
                boxShadow: `0 0 18px rgba(255,244,180,${w.o * 0.35})`,
                pointerEvents: "none",
              }}
            />
          ))}

          <div style={{ position: "absolute", right: "6%", bottom: "10%", width: "140px", height: "140px", transform: "translate(50%,50%)", borderRadius: "9999px", background: "radial-gradient(circle at center, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.95) 40%, rgba(16,185,129,0.05) 70%, transparent 100%)", boxShadow: "0 0 80px rgba(0,0,0,0.9), inset 0 0 40px rgba(0,0,0,1)", pointerEvents: "none" }} />

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {/* constellation-route-layer */}
            {workingNodes.slice(0,120).map((node,i)=>{
              const next = workingNodes[(i+7)%workingNodes.length];
              if(!next) return null;
              return (
                <line
                  key={`route-${i}`}
                  x1={`${node._px}%`}
                  y1={`${node._py}%`}
                  x2={`${next._px}%`}
                  y2={`${next._py}%`}
                  stroke="rgba(255,245,200,0.06)"
                  strokeWidth="1"
                />
              );
            })}
        
            {pairLinks.map((link, i) => {
              const dashPulse = 3 + ((i + liveTick) % 8);
              return <line key={`pair-${i}`} x1={`${link.from._px}%`} y1={`${link.from._py}%`} x2={`${link.to._px}%`} y2={`${link.to._py}%`} stroke="rgba(250,245,170,0.24)" strokeDasharray={`${dashPulse} 5`} strokeWidth="1.15" />;
            })}
          </svg>

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {constellationLinks.map((link, i) => {
              const providerStroke = (link.a.provider || "").toLowerCase() === "bluesky" ? "rgba(125,211,252,0.16)" : "rgba(187,247,208,0.16)";
              const width = 0.45 + Math.min(0.8, link.strength * 0.18);
              return <line key={`constellation-${i}`} x1={`${link.a._px}%`} y1={`${link.a._py}%`} x2={`${link.b._px}%`} y2={`${link.b._py}%`} stroke={providerStroke} strokeWidth={width} strokeLinecap="round" />;
            })}
          </svg>

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {[0, 1, 2, 3, 4].map((lane) => {
              const points: string[] = [];
              const baseR = 22 + lane * 8;
              const start = lane * 0.8 + liveTick * 0.002 + timeWarp * 0.03;
              const segments = 150;
              for (let i = 0; i < segments; i++) {
                const t = start + i * 0.07;
                const r = baseR + Math.sin(t * 1.7 + lane) * 1.7;
                const x = 50 + Math.cos(t) * r;
                const y = 58 + Math.sin(t) * (r * 0.34);
                if (x > 8 && x < 92 && y > 42 && y < 96) points.push(`${x},${y}`);
              }
              return <polyline key={`lane-${lane}`} points={points.join(" ")} fill="none" stroke="rgba(187,247,208,0.14)" strokeWidth={lane % 2 === 0 ? 1.0 : 0.82} strokeDasharray="1 10" strokeLinecap="round" />;
            })}
          </svg>

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {gravityFlows.map((p, i) => <circle key={`flow-${i}`} cx={`${p.x}%`} cy={`${p.y}%`} r={p.r} fill={`rgba(220,255,230,${p.o})`} />)}
          </svg>

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {revivalTrails.map((trail) => trail.trail.map((p, idx) => <circle key={`${trail.key}-${idx}`} cx={`${p.x}%`} cy={`${p.y}%`} r={p.r} fill={`rgba(255,245,180,${p.o})`} />))}
          </svg>

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {forecastNodes.map((node, i) => {
              const pulse = 1 + mv(0.045, liveTick, i * 0.6) * 0.08;
              const radius = 22 + i * 4 + pulse * 6;
              return <circle key={`forecast-${node.id}`} cx={`${node._px}%`} cy={`${node._py}%`} r={radius} fill="none" stroke="rgba(220,255,230,0.12)" strokeWidth="1" />;
            })}
          </svg>

          {selectedStar ? (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              <path
                d={`M ${selectedStar._px} ${selectedStar._py} C ${Math.max(8, selectedStar._px - 10)} ${Math.max(10, selectedStar._py - 8)}, ${Math.min(92, selectedStar._px + 8)} ${Math.max(8, selectedStar._py - 16)}, ${Math.min(94, selectedStar._px + 16)} ${Math.max(8, selectedStar._py - 6)}`}
                fill="none"
                stroke="rgba(255,244,180,0.28)"
                strokeWidth="1.4"
                strokeDasharray="4 6"
              />
            </svg>
          ) : null}

          {archetypeGroups.map((group, i) => {
            const xs = group.nodes.map((n) => safeNum(n._px, 0));
            const ys = group.nodes.map((n) => safeNum(n._py, 0));
            const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
            const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
            const spread = Math.min(16, Math.max(6, Math.sqrt(xs.map((x) => (x - cx) ** 2).reduce((a, b) => a + b, 0) / xs.length + ys.map((y) => (y - cy) ** 2).reduce((a, b) => a + b, 0) / ys.length) * 1.6));
            return (
              <React.Fragment key={`arch-${group.name}-${i}`}>
                <div style={{ position: "absolute", left: `${cx}%`, top: `${cy}%`, width: `${spread * 18}px`, height: `${spread * 11}px`, transform: "translate(-50%, -50%)", borderRadius: "9999px", border: `1px solid ${archetypeColor(group.name).replace("0.9", "0.18").replace("0.72", "0.18")}`, pointerEvents: "none" }} />
              </React.Fragment>
            );
          })}

          {selectedStar ? (
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              {forecastNodes.slice(0, 3).filter((n) => n.id !== selectedStar.id).map((n, i) => (
                <line
                  key={`route-${n.id}-${i}`}
                  x1={`${selectedStar._px}%`}
                  y1={`${selectedStar._py}%`}
                  x2={`${n._px}%`}
                  y2={`${n._py}%`}
                  stroke="rgba(255,244,180,0.18)"
                  strokeWidth="1.1"
                  strokeDasharray="5 7"
                />
              ))}
            </svg>
          ) : null}


          {(supernovaNode || selectedStar) ? [0, 1, 2, 3, 4].map((i) => {
            const focus = selectedStar || supernovaNode;
            if (!focus) return null;
            const radius = 36 + ((liveTick * 2.3 + i * 24) % 190) * 1.65;
            const opacity = Math.max(0, 0.16 - radius / 1500);
            return (
              <div
                key={`viral-shockwave-premium-${i}`}
                style={{
                  position: "absolute",
                  left: `${focus._px}%`,
                  top: `${focus._py}%`,
                  width: `${radius * 2}px`,
                  height: `${radius * 2}px`,
                  transform: "translate(-50%, -50%)",
                  borderRadius: "9999px",
                  border: `1px solid rgba(255,244,180,${opacity})`,
                  boxShadow: `0 0 20px rgba(255,244,180,${opacity * 0.34})`,
                  pointerEvents: "none",
                }}
              />
            );
          }) : null}

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {workingNodes.slice(0, 140).map((node, i) => {
              const opacity = 0.08 * highlightOpacity(node, highlightMode);
              const points = Array.from({ length: 5 }).map((_, k) => {
                const tx = node._px - Math.cos(node._phase + liveTick * 0.01) * (k + 1) * 1.6;
                const ty = node._py - Math.sin(node._phase + liveTick * 0.01) * (k + 1) * 0.9;
                return `${tx}% ${ty}%`;
              });
              return (
                <polyline
                  key={`trail-${node.id}-${i}`}
                  points={points.join(" ")}
                  fill="none"
                  stroke={`rgba(220,255,230,${opacity})`}
                  strokeWidth="0.8"
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {workingNodes.map((node, idx) => {
            const isHovered = hovered?.id === node.id;
            const momentumRing = engine.momentum > 0 && !!node.current_cycle;
            const velocityRing = engine.velocity && !!node.candidate;
            const breathe = 1 + mv(0.05, liveTick, idx * 0.18) * (node.candidate ? 0.08 : 0.03);
            const accent = rarityAccent(node);
            const isSupernova = !!supernovaNode && supernovaNode.id === node.id;
            const isForecast = forecastNodes.some((n) => n.id === node.id);
            return (
              <button key={node.id} type="button" onClick={() => setSelectedStarId((v) => (v === node.id ? null : node.id))} onDoubleClick={() => node.url && window.open(node.url, "_blank", "noopener,noreferrer")} onMouseEnter={() => setHovered(node)} onMouseLeave={() => setHovered((h: any) => (h?.id === node.id ? null : h))} style={{ position: "absolute", left: `${node._px}%`, top: `${node._py}%`, width: `${node._r * 2}px`, height: `${node._r * 2}px`, transform: `translate(-50%, -50%) scale(${((isHovered || selectedStarId === node.id) ? 1.16 : 1) * breathe})`, borderRadius: "9999px", border: "none", padding: 0, cursor: "pointer", background: "transparent", boxShadow: `0 0 ${Math.max(12, node._r * 4)}px ${accent.aura}`, transition: "transform 90ms linear" }}>
                {node.candidate ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: `scale(${1.55 + mv(0.05, liveTick, idx * 0.4) * 0.12})`, border: "1px solid rgba(253,224,71,0.55)", boxShadow: "0 0 20px rgba(253,224,71,0.18)" }} /> : null}
                {momentumRing ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: `scale(${2.05 + mv(0.06, liveTick, idx * 0.25) * 0.12})`, border: "1px solid rgba(255,255,255,0.35)" }} /> : null}
                {velocityRing ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: `scale(${2.4 + mv(0.065, liveTick, idx * 0.3) * 0.12})`, border: "1px solid rgba(125,211,252,0.55)" }} /> : null}
                {isForecast ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: `scale(${2.85 + mv(0.07, liveTick, idx * 0.21) * 0.16})`, border: "1px solid rgba(220,255,230,0.16)" }} /> : null}
                {isSupernova ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: `scale(${2.95 + mv(0.09, liveTick, idx * 0.5) * 0.2})`, border: "1px solid rgba(255,244,180,0.42)", boxShadow: "0 0 30px rgba(255,244,180,0.26)" }} /> : null}
                {selectedStarId === node.id ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: "scale(3.35)", border: "1px solid rgba(220,255,230,0.32)" }} /> : null}
                {safeNum(node.refresh_count, 0) <= 1 ? <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", transform: `scale(${2.2 + mv(0.06, liveTick, idx * 0.31) * 0.14})`, border: "1px solid rgba(187,247,208,0.16)" }} /> : null}
                <span style={{ position: "absolute", inset: 0, borderRadius: "9999px", background: accent.fill, border: `1px solid ${accent.border}` }} />
                {isHovered ? <span style={{ position: "absolute", left: "50%", top: "100%", transform: "translateX(-50%)", marginTop: 10, whiteSpace: "nowrap", borderRadius: 999, border: "1px solid rgba(110,231,183,0.2)", background: "rgba(0,0,0,0.72)", padding: "6px 12px", fontSize: 10, color: "rgba(236,253,245,0.88)" }}>{node.provider} · {shortText(node.label, 44)}</span> : null}
              </button>
            );
          })}

          </div>

          <div style={{ position: "absolute", left: 14, top: 4, fontSize: 13, color: "rgba(236,253,245,0.82)", pointerEvents: "none", zIndex: 3 }}>
            <div style={{ fontWeight: 600 }}>Cinematic Spiral Galaxy · gravity wells reveal the engine’s strongest pull</div>
          </div>

          <div style={{ position: "absolute", right: 14, top: 4, fontSize: 13, color: "rgba(236,253,245,0.75)", pointerEvents: "none", zIndex: 3 }}>
            {workingNodes.length} visible stars · {currentStatus?.running ? "Autopilot running" : "Autopilot idle"}
          </div>

          {hovered ? (
            <div style={{ position: "absolute", bottom: 20, left: 20, maxWidth: 470, borderRadius: 28, border: "1px solid rgba(110,231,183,0.2)", background: "rgba(1,10,10,0.88)", padding: 20, boxShadow: "0 25px 50px rgba(0,0,0,0.35)", backdropFilter: "blur(10px)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>{hovered.provider || "provider"} · {hovered.handle || "handle"}</div>
                  <div style={{ marginTop: 6, fontSize: 22, fontWeight: 700, lineHeight: 1.35 }}>{shortText(hovered.label || hovered.url || hovered.id, 90)}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <div style={{ borderRadius: 999, padding: "6px 12px", fontSize: 12, background: providerColor(hovered.provider).replace("0.95", "0.14"), border: `1px solid ${providerColor(hovered.provider).replace("0.95", "0.28")}` }}>{hovered.gravity || "standard"}</div>
                  <div style={{ borderRadius: 999, padding: "6px 12px", fontSize: 12, background: "rgba(250,228,120,0.1)", border: "1px solid rgba(250,228,120,0.22)", color: "rgba(255,248,210,0.94)" }}>{rarityAccent(hovered).tag}</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 16, fontSize: 14, color: "rgba(236,253,245,0.9)" }}>
                <div>Score: {safeNum(hovered.normalized_score ?? hovered.score, 0).toFixed(0)}</div>
                <div>Gravity score: {safeNum(hovered.gravity_score, 0).toFixed(2)}</div>
                <div>Velocity: {safeNum(hovered.predicted_velocity, 0).toFixed(2)}</div>
                <div>Archive: {safeNum(hovered.archive_signal, 0).toFixed(2)}</div>
                <div>Archetype: {hovered.archetype || "—"}</div>
                <div>Revival: {safeNum(hovered.revival_score, 0).toFixed(1)}</div>
                <div>Refreshes: {safeNum(hovered.refresh_count, 0)}</div>
                <div>State: {hovered.state || "—"}</div>
              </div>

              <div style={{ marginTop: 18, fontSize: 14, lineHeight: 1.8 }}>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Strategy:</span> <span>{hovered.selection_strategy || engine.strategy || "—"}</span></div>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Reason:</span> <span>{hovered.selection_reason || engine.reason || "—"}</span></div>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Last resurfaced:</span> <span>{fmtWhen(hovered.last_resurfaced_at)}</span></div>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Gravity well notes:</span> <span>Core wells concentrate score clusters, velocity pull, and revival density.</span></div>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Constellation tendency:</span> <span>Nearby posts of similar score and provider now form faint strategic link-lines.</span></div>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Forecasting:</span> <span>Forecast halos mark stars the engine sees as likely upcoming movers.</span></div>
                <div><span style={{ color: "rgba(236,253,245,0.58)" }}>Temporal view:</span> <span>The time travel slider shifts the galaxy toward older outer drift or future inward pressure.</span></div>
                {hovered.url ? <div style={{ marginTop: 8 }}><a href={hovered.url} target="_blank" rel="noreferrer" style={{ color: "rgba(186,230,253,1)", textDecoration: "underline" }}>Open post</a></div> : null}
              </div>
            </div>
          ) : null}
        </div>

          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)", marginBottom: 10 }}>Intelligence Window</div>
              <div style={{ display: "grid", gap: 8 }}>
                {forecastNodes.map((n, i) => (
                  <div key={n.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <div style={{ color: "rgba(255,248,210,0.95)", fontWeight: 700 }}>{i + 1}</div>
                    <div style={{ color: "rgba(236,253,245,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortText(n.label || n.id, 34)}</div>
                    <div style={{ color: "rgba(236,253,245,0.58)" }}>{intelligenceScore(n, intelligenceView).toFixed(0)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Momentum + Pair</div>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.75 }}>
                <div>Momentum: {engine.momentum > 0 ? `${engine.momentum} stack` : "Inactive"}</div>
                <div>Velocity: {engine.velocity ? "Active" : "Inactive"}</div>
                <div>Queued pair: {engine.pairTarget || "None"}</div>
                <div>Last action: {minutesAgo(engine.lastSelectedAt)}</div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Next Cycle</div>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.75 }}>
                <div>When: {fmtWhen(engine.nextRefreshAt)}</div>
                <div>Exact: {engine.nextRefreshAt || "—"}</div>
                <div>Scope: {selectedLabel}</div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Intelligence</div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <select value={intelligenceView} onChange={(e) => setIntelligenceView(e.target.value as any)} style={{ borderRadius: 12, border: "1px solid rgba(110,231,183,0.2)", background: "#031110", color: "white", padding: "8px 10px" }}>
                  <option value="balanced">Balanced</option>
                  <option value="forecast">Forecast</option>
                  <option value="revival">Revival</option>
                  <option value="gravity">Gravity</option>
                </select>
                <div style={{ fontSize: 12, color: "rgba(236,253,245,0.58)" }}>
                  Top star: {intelligenceSummary[0] ? shortText(intelligenceSummary[0].label || intelligenceSummary[0].id, 24) : "—"}
                </div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Time Warp</div>
              <div style={{ marginTop: 10 }}>
                <input type="range" min={0} max={100} value={timeWarp} onChange={(e) => setTimeWarp(Number(e.target.value))} style={{ width: "100%" }} />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(236,253,245,0.7)" }}>Phase shift: {timeWarp}</div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div style={{ fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(236,253,245,0.58)" }}>Gravity Focus</div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <select value={highlightMode} onChange={(e) => setHighlightMode(e.target.value as any)} style={{ borderRadius: 12, border: "1px solid rgba(110,231,183,0.2)", background: "#031110", color: "white", padding: "8px 10px" }}>
                  <option value="off">Off</option>
                  <option value="strong">Strong</option>
                  <option value="viral">Viral</option>
                  <option value="conversion">Conversion</option>
                </select>
                <div style={{ fontSize: 12, color: "rgba(236,253,245,0.58)" }}>
                  Scan mode dims low-priority stars so target clusters pop.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
