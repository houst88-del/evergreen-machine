"use client";

import React, { useEffect, useMemo, useState } from "react";
import { apiFetch, me } from "../lib/auth";
import { missionBadgeStyle, missionEyebrowStyle } from "../lib/mission-ui";

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

const BACKEND =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "https://backend-fixed-production.up.railway.app";

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

const providerLabel = (provider?: string) => {
  const p = (provider || "").toLowerCase();
  if (p === "bluesky" || p === "bsky") return "Bluesky";
  if (p === "x" || p === "twitter") return "X";
  return provider || "Provider";
};

const providerTheme = (provider?: string) => {
  const p = (provider || "").toLowerCase();
  if (p === "bluesky" || p === "bsky") {
    return {
      glow: "rgba(125,211,252,0.28)",
      border: "rgba(125,211,252,0.48)",
      fill: "rgba(125,211,252,0.10)",
      text: "rgba(224,242,254,0.98)",
    };
  }
  if (p === "x" || p === "twitter") {
    return {
      glow: "rgba(187,247,208,0.28)",
      border: "rgba(167,243,208,0.44)",
      fill: "rgba(16,185,129,0.10)",
      text: "rgba(220,252,231,0.98)",
    };
  }
  return {
    glow: "rgba(196,181,253,0.24)",
    border: "rgba(196,181,253,0.38)",
    fill: "rgba(196,181,253,0.08)",
    text: "rgba(243,232,255,0.98)",
  };
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
  if (mode === "revival") {
    return safeNum(node.revival_score, 0) * 10 + safeNum(node.refresh_count, 0) * 8;
  }
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
    border:
      node.provider?.toLowerCase() === "bluesky"
        ? "rgba(125,211,252,0.76)"
        : "rgba(187,247,208,0.82)",
    aura:
      node.provider?.toLowerCase() === "bluesky"
        ? "rgba(125,211,252,0.16)"
        : "rgba(187,247,208,0.16)",
    tag: "Standard",
  };
};

const highlightOpacity = (
  node: GalaxyNode,
  mode: "off" | "strong" | "viral" | "conversion"
) => {
  if (mode === "off") return 1;
  if (mode === "strong") {
    return safeNum(node.normalized_score ?? node.score, 0) >= 120 ? 1 : 0.16;
  }
  if (mode === "viral") {
    return safeNum(node.predicted_velocity, 0) >= 0.65 || !!node.current_cycle ? 1 : 0.12;
  }
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

const isFreshPulse = (value?: string | null) => {
  if (!value) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() <= 1000 * 60 * 45;
};

export default function GalaxyPage() {
  const [userId, setUserId] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selected, setSelected] = useState<string>("unified");
  const [galaxy, setGalaxy] = useState<GalaxyResponse>({ nodes: [], meta: {} });
  const [statusMap, setStatusMap] = useState<Record<number, DashboardStatus>>({});
  const [hovered, setHovered] = useState<GalaxyNode | null>(null);
  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [liveTick, setLiveTick] = useState(0);
  const [error, setError] = useState("");
  const [flashTick, setFlashTick] = useState(0);
  const [timeWarp, setTimeWarp] = useState(0);
  const [timeLapseOn, setTimeLapseOn] = useState(true);
  const [timeLapseSpeed, setTimeLapseSpeed] = useState(0.25);
  const [timeTravel, setTimeTravel] = useState(0);
  const [intelligenceView, setIntelligenceView] = useState<
    "balanced" | "forecast" | "revival" | "gravity"
  >("balanced");
  const [highlightMode, setHighlightMode] = useState<
    "off" | "strong" | "viral" | "conversion"
  >("off");
  const [motionFactor, setMotionFactor] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [cameraDriftTick, setCameraDriftTick] = useState(0);
  const [parallaxTick, setParallaxTick] = useState(0);
  const [waveTick, setWaveTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveTick((v) => v + motionFactor);
      setCameraDriftTick((v) => v + motionFactor);
      setParallaxTick((v) => v + motionFactor);
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
    const id = window.setInterval(
      () => setFlashTick((v) => v + (motionFactor > 0.02 ? 1 : 0)),
      1800
    );
    return () => window.clearInterval(id);
  }, [motionFactor]);

  useEffect(() => {
    const id = window.setInterval(
      () => setWaveTick((v) => v + (motionFactor > 0.02 ? 1 : 0)),
      1400
    );
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
    async function loadSession() {
      const session = await me();
      if (cancelled) return;
      setUserId(session?.user?.id ?? null);
      if (!session?.user?.id) {
        setError("No active login found.");
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    async function loadAccounts() {
      try {
        const res = await apiFetch(`/api/connected-accounts?user_id=${userId}`);
        const json = await res.json();
        if (!cancelled) {
          const next = Array.isArray(json.accounts) ? json.accounts : [];
          setAccounts(next);
          if (
            selected !== "unified" &&
            !next.some((a: ConnectedAccount) => String(a.id) === selected)
          ) {
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
  }, [selected, userId]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    async function loadStatuses() {
      try {
        const out: Record<number, DashboardStatus> = {};
        for (const account of accounts) {
          const res = await apiFetch(
            `/api/status?user_id=${userId}&connected_account_id=${account.id}`
          );
          if (!res.ok) continue;
          out[account.id] = await res.json();
        }
        if (!cancelled) setStatusMap(out);
      } catch {
        // ignore
      }
    }
    if (accounts.length) loadStatuses();
    const id = window.setInterval(loadStatuses, 12000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [accounts, userId]);

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    async function loadGalaxy() {
      try {
        const qs =
          selected === "unified"
            ? `?user_id=${encodeURIComponent(String(userId))}&unified=true`
            : `?user_id=${encodeURIComponent(String(userId))}&connected_account_id=${encodeURIComponent(selected)}`;
        const res = await apiFetch(`/api/galaxy${qs}`);
        const json: GalaxyResponse = await res.json();
        if (!cancelled) {
          setGalaxy({
            nodes: Array.isArray(json.nodes) ? json.nodes : [],
            meta: json.meta || {},
          });
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
  }, [selected, userId]);

  const engine = useMemo(() => parseMeta(galaxy.meta), [galaxy.meta]);

  const workingNodes = useMemo(() => {
    const nodes = [...galaxy.nodes].sort((a, b) => rankGravity(b) - rankGravity(a));
    const wells = nodes.slice(0, 5);
    const centerX = 50;
    const centerY = 54;
    const warp = timeWarp * 0.03;
    const temporalShift = timeTravel * 0.08;

    return nodes.map((node, index) => {
      const phase = index * 0.17;
      const orbitBreathe =
        0.5 + mv(0.018, liveTick + timeWarp * 2 + temporalShift, phase) * 0.8;
      const t = index * 0.42 + liveTick * 0.01 + warp + temporalShift * 0.03;
      const temporalRadiusBias = Math.max(-8, Math.min(14, (timeTravel - 50) * 0.08));
      const contentAgeBias = Math.max(
        -10,
        Math.min(
          10,
          safeNum(node.refresh_count, 0) * 0.35 - safeNum(node.archive_signal, 0) * 5
        )
      );
      const spiralR =
        8 +
        Math.min(38, Math.sqrt(index) * 2.55) +
        orbitBreathe +
        temporalRadiusBias +
        contentAgeBias;

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
          0.72,
          0.12 +
            safeNum(node.gravity_score, 0) * 0.0015 +
            safeNum(node.normalized_score ?? node.score, 0) * 0.0008 +
            safeNum(node.predicted_velocity, 0) * 0.04
        );
        px = px * (1 - pull) + wx * pull;
        py = py * (1 - pull) + wy * pull;
      }

      px +=
        mv(0.03, liveTick + timeWarp + temporalShift, phase) *
        (node.candidate ? 0.55 : 0.28);
      py +=
        mv(0.026, liveTick + timeWarp + temporalShift, phase + 1.2) *
        (node.current_cycle ? 0.72 : 0.34);

      if (node.cold_archive || safeNum(node.archive_signal, 0) > 0.75) {
        px += (index % 2 === 0 ? 1 : -1) * 6;
        py += 6 + (index % 7);
      }

      const drift =
        safeNum(node.archive_signal, 0) * 10 +
        (node.cold_archive ? 8 : 0) +
        Math.max(0, (50 - timeTravel) * 0.08);
      px += Math.cos(index) * drift * 0.08;
      py += Math.sin(index) * drift * 0.08;

      px = Math.max(4, Math.min(96, px));
      py = Math.max(12, Math.min(92, py));

      return { ...node, _phase: phase, _px: px, _py: py, _r: computeRadius(node) };
    });
  }, [galaxy.nodes, liveTick, timeWarp, timeTravel]);

  const gravityWells = useMemo(
    () =>
      [...workingNodes]
        .sort((a, b) => rankGravity(b) - rankGravity(a))
        .slice(0, 4)
        .map((node, index) => {
          const pulse = 1 + mv(0.03, liveTick, index * 0.9) * 0.08;
          return {
            node,
            size: (18 + index * 7 + (node as any)._r * 3.2) * pulse,
            opacity: Math.max(0.12, 0.28 - index * 0.04),
            index,
          };
        }),
    [workingNodes, liveTick]
  );

  const heatNebulae = useMemo(() => {
    const hubs = [...workingNodes]
      .sort(
        (a, b) =>
          intelligenceScore(b, intelligenceView) - intelligenceScore(a, intelligenceView)
      )
      .slice(0, 8);
    return hubs.map((node, i) => ({
      x: (node as any)._px,
      y: (node as any)._py,
      rx: 140 + i * 16 + safeNum(node.gravity_score, 0) * 32,
      ry: 82 + i * 9 + safeNum(node.predicted_velocity, 0) * 48,
      o: Math.max(0.07, 0.15 - i * 0.01),
    }));
  }, [workingNodes, intelligenceView]);

  const currentStatus = useMemo(
    () => (selected === "unified" ? null : statusMap[Number(selected)] || null),
    [selected, statusMap]
  );

  const selectedLabel = useMemo(() => {
    if (selected === "unified") return "Unified Galaxy";
    const found = accounts.find((a) => String(a.id) === selected);
    return found ? `${found.provider} · ${found.handle}` : "Galaxy";
  }, [accounts, selected]);

  const counts = useMemo(() => {
    const gravityStars = workingNodes.filter((n) => rankGravity(n) >= 250).length;
    const strongStars = workingNodes.filter(
      (n) => safeNum(n.normalized_score ?? n.score, 0) >= 120
    ).length;
    const candidates = workingNodes.filter((n) => !!n.candidate).length;
    const currentCycle = workingNodes.filter((n) => !!n.current_cycle).length;
    const recent = workingNodes.filter((n) =>
      minutesAgo(n.last_resurfaced_at).includes("m ago")
    ).length;
    return { gravityStars, strongStars, candidates, currentCycle, recent };
  }, [workingNodes]);

  const supernovaNode = useMemo(() => {
    const candidates = [...workingNodes]
      .filter(
        (n) =>
          safeNum(n.predicted_velocity, 0) > 0.7 || !!n.current_cycle || rankGravity(n) > 300
      )
      .sort((a, b) => rankGravity(b) - rankGravity(a));
    return candidates[0] || null;
  }, [workingNodes]);

  useEffect(() => {
    if (!selectedStarId && supernovaNode) setSelectedStarId(supernovaNode.id);
  }, [supernovaNode, selectedStarId]);

  const selectedStar = useMemo(
    () => workingNodes.find((n) => n.id === selectedStarId) || null,
    [workingNodes, selectedStarId]
  );

  const forecastNodes = useMemo(
    () =>
      [...workingNodes]
        .filter((n) => !n.cold_archive)
        .sort(
          (a, b) =>
            intelligenceScore(b, intelligenceView) - intelligenceScore(a, intelligenceView)
        )
        .slice(0, 5),
    [workingNodes, intelligenceView]
  );

  const labeledStarIds = useMemo(() => {
    const picked = [...workingNodes]
      .sort(
        (a, b) =>
          intelligenceScore(b, intelligenceView) - intelligenceScore(a, intelligenceView)
      )
      .filter(
        (node, index) =>
          index < 10 &&
          (safeNum(node.predicted_velocity, 0) >= 0.55 ||
            rankGravity(node) >= 240 ||
            !!node.current_cycle)
      )
      .map((node) => node.id);
    return new Set(picked);
  }, [workingNodes, intelligenceView]);

  const providerCounts = useMemo(() => {
    return workingNodes.reduce(
      (acc, node) => {
        const key =
          node.provider?.toLowerCase() === "bluesky" || node.provider?.toLowerCase() === "bsky"
            ? "bluesky"
            : node.provider?.toLowerCase() === "x" || node.provider?.toLowerCase() === "twitter"
              ? "x"
              : "other";
        acc[key] += 1;
        return acc;
      },
      { bluesky: 0, x: 0, other: 0 }
    );
  }, [workingNodes]);

  const nodeCount = workingNodes.length;
  const densityScale =
    nodeCount > 700 ? 0.84 : nodeCount > 450 ? 0.9 : nodeCount > 250 ? 0.96 : 1;
  const sceneScale =
    zoom * densityScale * (highlightMode === "strong" || highlightMode === "viral" ? 1.05 : 1);
  const baseShiftX = selectedStar ? (50 - (selectedStar as any)._px) * 0.12 : 0;
  const baseShiftY = selectedStar ? (52 - (selectedStar as any)._py) * 0.12 : 0;
  const driftX =
    Math.sin(cameraDriftTick * 0.01) * 2.2 + Math.cos(parallaxTick * 0.008) * 1.2;
  const driftY = Math.cos(cameraDriftTick * 0.009) * 1.6;
  const sceneTransform = `translate(${baseShiftX + driftX}px, ${
    baseShiftY + driftY
  }px) scale(${sceneScale})`;
  const paneHeight = nodeCount > 700 ? "58vh" : "calc(100vh - 340px)";

  return (
    <div
      style={{
        minHeight: "100vh",
        color: "rgba(236,253,245,0.98)",
        background:
          "radial-gradient(circle at 50% 0%, rgba(16,185,129,0.13), transparent 28%), linear-gradient(90deg, #010707 0%, #03130f 35%, #03130f 65%, #010707 100%)",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 2600, margin: "0 auto", padding: 28 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 18,
          }}
        >
          <div>
            <h1 style={{ fontSize: 54, lineHeight: 1, margin: 0, fontWeight: 700 }}>
              Evergreen Galaxy
            </h1>
            <p
              style={{
                marginTop: 10,
                color: "rgba(236,253,245,0.72)",
                fontSize: 14,
              }}
            >
              Gravity wells now reveal where your strongest resurfacing pull concentrates.
            </p>
          </div>

          <div
            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
          >
            <button
              onClick={() => (window.location.href = "/dashboard")}
              style={{
                borderRadius: 999,
                border: "1px solid rgba(52,211,153,0.28)",
                background: "rgba(16,185,129,0.08)",
                color: "white",
                padding: "10px 16px",
                cursor: "pointer",
              }}
            >
              ← Dashboard
            </button>
            <div
              style={{
                borderRadius: 999,
                border: "1px solid rgba(52,211,153,0.18)",
                background: "rgba(0,0,0,0.28)",
                color: "rgba(236,253,245,0.78)",
                padding: "10px 14px",
                fontSize: 12,
              }}
            >
              Galaxy View
            </div>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                borderRadius: 999,
                border: "1px solid rgba(125,211,252,0.38)",
                background: "#031110",
                color: "white",
                padding: "10px 14px",
              }}
            >
              <option value="unified">Unified Galaxy</option>
              {accounts.map((account) => (
                <option key={account.id} value={String(account.id)}>
                  {account.provider}: {account.handle}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div
            style={{
              marginBottom: 16,
              borderRadius: 18,
              border: "1px solid rgba(248,113,113,0.35)",
              background: "rgba(239,68,68,0.12)",
              padding: "12px 16px",
              color: "rgba(254,226,226,0.95)",
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          {[
            ["Total Stars", String(workingNodes.length)],
            ["Gravity Stars", String(counts.gravityStars)],
            ["Strong Stars", String(counts.strongStars)],
            ["Standard Stars", String(Math.max(0, workingNodes.length - counts.strongStars))],
            ["Candidates", String(counts.candidates)],
            ["Current Cycle", String(counts.currentCycle)],
            ["Recent Pulses", String(counts.recent)],
          ].map(([label, value]) => (
            <div key={label} style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                {label}
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 42,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "0.75fr 3.1fr 0.75fr",
            gap: 16,
            marginBottom: 14,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                Command Deck
              </div>
              <div
                style={{
                  marginTop: 10,
                  fontSize: 13,
                  lineHeight: 1.8,
                  color: "rgba(236,253,245,0.74)",
                }}
              >
                <div>View: {selectedLabel}</div>
                <div>Mode: {intelligenceView}</div>
                <div>
                  Travel: {timeTravel < 34 ? "Past" : timeTravel > 66 ? "Future" : "Present"}
                </div>
                <div>Zoom: {zoom.toFixed(1)}x</div>
                <div>Focus: {highlightMode === "off" ? "Balanced" : highlightMode}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {[
                  `X ${providerCounts.x}`,
                  `Bluesky ${providerCounts.bluesky}`,
                  counts.currentCycle ? `${counts.currentCycle} active now` : "Standby sweep",
                ].map((label, index) => (
                      <span
                        key={label}
                        style={
                          index === 0
                            ? missionBadgeStyle("mint", true)
                            : index === 1
                              ? missionBadgeStyle("sky", true)
                              : missionBadgeStyle("gold", true)
                        }
                      >
                        {label}
                      </span>
                ))}
              </div>
            </div>

            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                Autopilot Signal
              </div>
              <div style={{ marginTop: 10, fontSize: 40, fontWeight: 700 }}>
                {currentStatus?.running ? "Running" : "Idle"}
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: "rgba(236,253,245,0.7)" }}>
                {engine.strategy || "Standard circulation"}
              </div>
            </div>

            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                Time Travel
              </div>
              <div style={{ marginTop: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={timeTravel}
                  onChange={(e) => setTimeTravel(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div style={{ marginTop: 8, fontSize: 12, color: "rgba(236,253,245,0.7)" }}>
                  {timeTravel < 34 ? "Past bias" : timeTravel > 66 ? "Future bias" : "Present"}
                </div>
              </div>
            </div>

            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                Replay
              </div>
              <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
                <button
                  onClick={() => setTimeLapseOn((v) => !v)}
                  style={{
                    borderRadius: 999,
                    border: "1px solid rgba(110,231,183,0.2)",
                    background: "rgba(16,185,129,0.08)",
                    color: "white",
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  {timeLapseOn ? "Pause" : "Play"}
                </button>
                <input
                  type="range"
                  min={0.25}
                  max={2}
                  step={0.25}
                  value={timeLapseSpeed}
                  onChange={(e) => setTimeLapseSpeed(Number(e.target.value))}
                />
                <div style={{ fontSize: 12, color: "rgba(236,253,245,0.7)" }}>
                  Speed {timeLapseSpeed.toFixed(1)}x
                </div>
                <div style={{ fontSize: 12, color: "rgba(236,253,245,0.7)" }}>Zoom</div>
                <input
                  type="range"
                  min={0.8}
                  max={1.4}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </div>
            </div>

            <div style={{ ...cardStyle(), padding: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                  marginBottom: 6,
                }}
              >
                Follow the Star
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(236,253,245,0.94)" }}>
                {selectedStar ? shortText(selectedStar.label || selectedStar.id, 36) : "No star selected"}
              </div>
              <div style={{ fontSize: 12, color: "rgba(236,253,245,0.58)", marginTop: 6 }}>
                {selectedStar
                  ? `${providerLabel(selectedStar.provider)} · intelligence ${intelligenceScore(
                      selectedStar,
                      intelligenceView
                    ).toFixed(0)}`
                  : "Click any star to lock focus."}
              </div>
              {selectedStar ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {[
                    selectedStar.current_cycle ? "Current cycle" : "",
                    isFreshPulse(selectedStar.last_resurfaced_at) ? "Fresh pulse" : "",
                    safeNum(selectedStar.predicted_velocity, 0) >= 0.65 ? "Likely next" : "",
                  ]
                    .filter(Boolean)
                    .map((label) => (
                      <span
                        key={label}
                        style={missionBadgeStyle("gold", true)}
                      >
                        {label}
                      </span>
                    ))}
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 12 }}>
              <div style={cardStyle()}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {(
                    [
                      ["Gravity wells", true],
                      ["Strong", false],
                      ["Standard", false],
                      ["Glow", false],
                      ["Inline labels", false],
                      ["Live motion", false],
                      ["Constellations", false],
                      ["Forecast", false],
                      ["Nebulae", false],
                    ] as [string, boolean][]
                  ).map(([label, accent]) => (
                    <span
                      key={label}
                      style={missionBadgeStyle(accent ? "gold" : "mint")}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: "rgba(236,253,245,0.64)" }}>
                  Nebula heat zones now reveal where forecast pressure and engagement density are
                  building. Forecast stars get faint pre-pull halos before they explode.
                </div>
              </div>

              <div style={cardStyle()}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                  {[
                    "Score",
                    "Gravity",
                    "Gravity score",
                    "Velocity",
                    "Archive",
                    "Archetype",
                    "Revival",
                    "Refreshes",
                    "Strategy",
                    "Reason",
                    "State",
                  ].map((label) => (
                    <span
                      key={label}
                      style={missionBadgeStyle("mint")}
                    >
                      {label}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.8, color: "rgba(236,253,245,0.64)" }}>
                  Hover cards foreground engine reasons so the galaxy mirrors what the worker is
                  most likely to choose next.
                </div>
              </div>
            </div>

            <div
              style={{
                position: "relative",
                height: paneHeight,
                overflow: "hidden",
                borderRadius: 30,
                border: "1px solid rgba(52,211,153,0.18)",
                background:
                  "radial-gradient(circle at 50% 50%, rgba(253,224,71,0.10), transparent 58%), linear-gradient(180deg, #03100f 0%, #010707 100%)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: sceneTransform,
                  transformOrigin: "center center",
                  transition: "transform 220ms ease-out",
                }}
              >
                {supernovaNode
                  ? [0, 1, 2].map((i) => {
                      const r = 40 + ((waveTick + i * 20) % 120) * 2;
                      const o = Math.max(0, 0.25 - r / 400);
                      return (
                        <div
                          key={`viralwave-${i}`}
                          style={{
                            position: "absolute",
                            left: `${(supernovaNode as any)._px}%`,
                            top: `${(supernovaNode as any)._py}%`,
                            width: `${r * 2}px`,
                            height: `${r * 2}px`,
                            transform: "translate(-50%,-50%)",
                            borderRadius: "9999px",
                            border: `1px solid rgba(255,240,170,${o})`,
                            pointerEvents: "none",
                          }}
                        />
                      );
                    })
                  : null}

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
                      background:
                        i < 3
                          ? "radial-gradient(circle, rgba(250,228,120,0.18) 0%, rgba(250,228,120,0.06) 38%, transparent 72%)"
                          : "radial-gradient(circle, rgba(125,211,252,0.12) 0%, rgba(125,211,252,0.04) 38%, transparent 72%)",
                      opacity: n.o,
                      pointerEvents: "none",
                    }}
                  />
                ))}

                {gravityWells.map(({ node, size, opacity }, i) => (
                  <div
                    key={`well-${node.id}-${i}`}
                    style={{
                      position: "absolute",
                      left: `${(node as any)._px}%`,
                      top: `${(node as any)._py}%`,
                      width: `${size * 8}px`,
                      height: `${size * 8}px`,
                      transform: "translate(-50%, -50%)",
                      borderRadius: "9999px",
                      background:
                        "radial-gradient(circle, rgba(255,246,190,0.16) 0%, rgba(255,246,190,0.06) 30%, transparent 72%)",
                      opacity,
                      pointerEvents: "none",
                    }}
                  />
                ))}

                {workingNodes.map((node, index) => {
                  const accent = rarityAccent(node);
                  const selectedNow = selectedStarId === node.id;
                  const freshPulse = isFreshPulse(node.last_resurfaced_at);
                  const opacity = highlightOpacity(node, highlightMode);
                  const starScale =
                    selectedNow
                      ? 1.26
                      : freshPulse
                        ? 1.14
                        : node.current_cycle
                          ? 1.1
                          : node.candidate
                            ? 1.04
                            : 1;
                  const twinkle = 1 + Math.sin(liveTick * 0.04 + index * 0.8) * 0.08;
                  const size = ((node as any)._r || 6) * starScale * twinkle;
                  const glow = Math.max(10, size * (selectedNow ? 7.6 : freshPulse ? 6.4 : 5.2));
                  const theme = providerTheme(node.provider);

                  return (
                    <React.Fragment key={node.id}>
                      {(selectedNow || freshPulse) && (
                        <>
                          <span
                            style={{
                              position: "absolute",
                              left: `${(node as any)._px}%`,
                              top: `${(node as any)._py}%`,
                              width: `${size * (selectedNow ? 6.8 : 5.2)}px`,
                              height: `${size * (selectedNow ? 6.8 : 5.2)}px`,
                              transform: "translate(-50%, -50%)",
                              borderRadius: "9999px",
                              border: `1px solid ${
                                selectedNow ? "rgba(255,240,170,0.42)" : theme.border
                              }`,
                              boxShadow: `0 0 30px ${
                                selectedNow ? "rgba(255,240,170,0.18)" : theme.glow
                              }`,
                              opacity: 0.9 - ((flashTick + index * 7) % 14) * 0.045,
                              pointerEvents: "none",
                              zIndex: selectedNow ? 5 : 4,
                            }}
                          />
                          <span
                            style={{
                              position: "absolute",
                              left: `${(node as any)._px}%`,
                              top: `${(node as any)._py}%`,
                              width: `${size * (selectedNow ? 9.4 : 7.2)}px`,
                              height: `${size * (selectedNow ? 9.4 : 7.2)}px`,
                              transform: "translate(-50%, -50%)",
                              borderRadius: "9999px",
                              border: `1px solid ${
                                selectedNow ? "rgba(255,248,210,0.18)" : "rgba(255,255,255,0.12)"
                              }`,
                              opacity: 0.42 - ((flashTick + index * 11) % 16) * 0.02,
                              pointerEvents: "none",
                              zIndex: selectedNow ? 5 : 4,
                            }}
                          />
                        </>
                      )}
                      <button
                        onClick={() => setSelectedStarId(node.id)}
                        onMouseEnter={() => setHovered(node)}
                        onMouseLeave={() =>
                          setHovered((current) => (current?.id === node.id ? null : current))
                        }
                        style={{
                          position: "absolute",
                          left: `${(node as any)._px}%`,
                          top: `${(node as any)._py}%`,
                          width: `${size * 2}px`,
                          height: `${size * 2}px`,
                          transform: "translate(-50%, -50%)",
                          borderRadius: "9999px",
                          border: `1px solid ${accent.border}`,
                          background: accent.fill,
                          boxShadow: `0 0 ${glow}px ${accent.aura}, 0 0 ${glow * 1.7}px ${accent.aura}`,
                          cursor: "pointer",
                          opacity,
                          zIndex: selectedNow ? 6 : node.current_cycle ? 4 : 3,
                        }}
                        aria-label={shortText(node.label || node.id, 64)}
                      >
                        {node.current_cycle ? (
                          <span
                            style={{
                              position: "absolute",
                              inset: -8,
                              borderRadius: "9999px",
                              border: "1px solid rgba(255,240,170,0.38)",
                            }}
                          />
                        ) : null}
                        {node.provider?.toLowerCase() === "bluesky" ? (
                          <span
                            style={{
                              position: "absolute",
                              inset: 2,
                              borderRadius: "9999px",
                              border: "1px solid rgba(125,211,252,0.28)",
                            }}
                          />
                        ) : node.provider?.toLowerCase() === "x" ||
                          node.provider?.toLowerCase() === "twitter" ? (
                          <span
                            style={{
                              position: "absolute",
                              inset: 2,
                              borderRadius: "9999px",
                              borderTop: "1px solid rgba(187,247,208,0.34)",
                              borderLeft: "1px solid rgba(187,247,208,0.18)",
                              borderRight: "1px solid transparent",
                              borderBottom: "1px solid transparent",
                            }}
                          />
                        ) : null}
                      </button>
                      {labeledStarIds.has(node.id) ? (
                        <div
                          style={{
                            position: "absolute",
                            left: `calc(${(node as any)._px}% + 12px)`,
                            top: `calc(${(node as any)._py}% - 10px)`,
                            padding: "4px 8px",
                            borderRadius: 999,
                            border: `1px solid ${theme.border}`,
                            background: "rgba(1,10,10,0.72)",
                            color: theme.text,
                            fontSize: 11,
                            lineHeight: 1.2,
                            whiteSpace: "nowrap",
                            pointerEvents: "none",
                            zIndex: 6,
                          }}
                        >
                          {shortText(node.label || node.id, 24)}
                        </div>
                      ) : null}
                    </React.Fragment>
                  );
                })}

                <div
                  style={{
                    position: "absolute",
                    left: 14,
                    top: 4,
                    fontSize: 13,
                    color: "rgba(236,253,245,0.82)",
                    pointerEvents: "none",
                    zIndex: 3,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    Cinematic Spiral Galaxy · centered view tuned for dense unified mode
                  </div>
                </div>

                <div
                  style={{
                    position: "absolute",
                    right: 14,
                    top: 4,
                    fontSize: 13,
                    color: "rgba(236,253,245,0.75)",
                    pointerEvents: "none",
                    zIndex: 3,
                  }}
                >
                  {workingNodes.length} visible stars ·{" "}
                  {currentStatus?.running ? "Autopilot running" : "Autopilot idle"}
                </div>
              </div>

              {hovered ? (
                <div
                  style={{
                    position: "absolute",
                    bottom: 20,
                    left: 20,
                    maxWidth: 470,
                    borderRadius: 28,
                    border: "1px solid rgba(110,231,183,0.2)",
                    background: "rgba(1,10,10,0.88)",
                    padding: 20,
                    boxShadow: "0 25px 50px rgba(0,0,0,0.35)",
                    backdropFilter: "blur(10px)",
                    zIndex: 5,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <div>
                      <div
                        style={missionEyebrowStyle}
                      >
                        Mission Brief · {providerLabel(hovered.provider)} · {hovered.handle || "handle"}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 22,
                          fontWeight: 700,
                          lineHeight: 1.35,
                        }}
                      >
                        {shortText(hovered.label || hovered.url || hovered.id, 90)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div
                        style={{
                          ...missionBadgeStyle(
                            hovered.provider?.toLowerCase() === "bluesky" ? "sky" : "mint"
                          ),
                          background: providerColor(hovered.provider).replace("0.95", "0.14"),
                          border: `1px solid ${providerColor(hovered.provider).replace("0.95", "0.28")}`,
                        }}
                      >
                        {hovered.gravity || "standard"}
                      </div>
                      <div
                        style={missionBadgeStyle("gold")}
                      >
                        {rarityAccent(hovered).tag}
                      </div>
                      <div
                        style={{
                          ...missionBadgeStyle(
                            safeNum(hovered.predicted_velocity, 0) >= 0.65 ? "gold" : "neutral"
                          ),
                          background:
                            safeNum(hovered.predicted_velocity, 0) >= 0.65
                              ? "rgba(250,228,120,0.1)"
                              : "rgba(255,255,255,0.05)",
                          border:
                            safeNum(hovered.predicted_velocity, 0) >= 0.65
                              ? "1px solid rgba(250,228,120,0.22)"
                              : "1px solid rgba(255,255,255,0.1)",
                          color:
                            safeNum(hovered.predicted_velocity, 0) >= 0.65
                              ? "rgba(255,248,210,0.94)"
                              : "rgba(236,253,245,0.8)",
                        }}
                      >
                        {safeNum(hovered.predicted_velocity, 0) >= 0.65 ? "Likely next" : "Monitoring"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                    {[
                      hovered.current_cycle ? "Current cycle" : "",
                      hovered.candidate ? "Candidate" : "",
                      isFreshPulse(hovered.last_resurfaced_at) ? "Fresh pulse" : "",
                      `Account ${hovered.connected_account_id ?? "—"}`,
                    ]
                      .filter(Boolean)
                      .map((label) => (
                        <span
                          key={label}
                          style={missionBadgeStyle("mint", true)}
                        >
                          {label}
                        </span>
                      ))}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 10,
                      fontSize: 13,
                      color: "rgba(236,253,245,0.72)",
                    }}
                  >
                    <div>Score: {safeNum(hovered.normalized_score ?? hovered.score, 0)}</div>
                    <div>Gravity score: {safeNum(hovered.gravity_score, 0)}</div>
                    <div>Velocity: {safeNum(hovered.predicted_velocity, 0).toFixed(2)}</div>
                    <div>Revival: {safeNum(hovered.revival_score, 0)}</div>
                    <div>Refreshes: {safeNum(hovered.refresh_count, 0)}</div>
                    <div>Last pulse: {minutesAgo(hovered.last_resurfaced_at)}</div>
                    <div>State: {hovered.state || "active"}</div>
                    <div>Archetype: {hovered.archetype || "unclassified"}</div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "rgba(236,253,245,0.54)",
                          marginBottom: 4,
                        }}
                      >
                        Strategy
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          lineHeight: 1.65,
                          color: "rgba(236,253,245,0.9)",
                        }}
                      >
                        {hovered.selection_strategy || "Standard circulation"}
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: "rgba(236,253,245,0.54)",
                          marginBottom: 4,
                        }}
                      >
                        Why It Stands Out
                      </div>
                      <div
                        style={{
                          fontSize: 14,
                          lineHeight: 1.7,
                          color: "rgba(236,253,245,0.78)",
                        }}
                      >
                        {hovered.selection_reason || "No selection reason recorded."}
                      </div>
                    </div>
                    {hovered.url ? (
                      <div style={{ marginTop: 8 }}>
                        <a
                          href={hovered.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "rgba(186,230,253,1)", textDecoration: "underline" }}
                        >
                          Open post
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                  marginBottom: 10,
                }}
              >
                Intelligence Window
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {forecastNodes.map((n, i) => (
                  <div
                    key={n.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "20px 1fr auto",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 12,
                      padding: "8px 10px",
                      borderRadius: 14,
                      border:
                        i === 0
                          ? "1px solid rgba(250,228,120,0.26)"
                          : "1px solid rgba(255,255,255,0.06)",
                      background:
                        i === 0 ? "rgba(250,228,120,0.08)" : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div style={{ color: "rgba(255,248,210,0.95)", fontWeight: 700 }}>
                      {i + 1}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          color: "rgba(236,253,245,0.9)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {shortText(n.label || n.id, 34)}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          color: "rgba(236,253,245,0.58)",
                        }}
                      >
                        <span>{providerLabel(n.provider)}</span>
                        <span>v {safeNum(n.predicted_velocity, 0).toFixed(2)}</span>
                        <span>{n.current_cycle ? "active now" : n.candidate ? "candidate" : "watch"}</span>
                      </div>
                      <div
                        style={{
                          marginTop: 7,
                          height: 5,
                          borderRadius: 999,
                          background: "rgba(255,255,255,0.08)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(12, safeNum(n.predicted_velocity, 0) * 100)
                            )}%`,
                            height: "100%",
                            borderRadius: 999,
                            background:
                              "linear-gradient(90deg, rgba(125,211,252,0.9), rgba(250,228,120,0.95))",
                          }}
                        />
                      </div>
                    </div>
                    <div style={{ color: "rgba(236,253,245,0.58)" }}>
                      {intelligenceScore(n, intelligenceView).toFixed(0)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                Momentum + Pair
              </div>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.75 }}>
                <div>Momentum: {engine.momentum > 0 ? `${engine.momentum} stack` : "Inactive"}</div>
                <div>Velocity: {engine.velocity ? "Active" : "Inactive"}</div>
                <div>Queued pair: {engine.pairTarget || "None"}</div>
                <div>Last action: {minutesAgo(engine.lastSelectedAt)}</div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {[
                  engine.strategy ? `Strategy ${engine.strategy}` : "",
                  engine.reason ? "Reason logged" : "",
                  engine.velocity ? "Velocity stack" : "",
                ]
                  .filter(Boolean)
                  .map((label) => (
                    <span
                      key={label}
                      style={missionBadgeStyle("gold", true)}
                    >
                      {label}
                    </span>
                  ))}
              </div>
            </div>

            <div style={cardStyle()}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "rgba(236,253,245,0.58)",
                }}
              >
                Next Cycle
              </div>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.8 }}>
                <div>When: {fmtWhen(engine.nextRefreshAt)}</div>
                <div>Exact: {engine.nextRefreshAt || "—"}</div>
                <div>Scope: {selectedLabel}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
