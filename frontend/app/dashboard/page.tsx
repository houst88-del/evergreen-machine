"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type User = {
  id: number;
  email?: string;
  x_handle?: string;
};

type ConnectedAccount = {
  id: number;
  provider: string;
  handle?: string | null;
  username?: string | null;
  display_name?: string | null;
  connected?: boolean;
  is_connected?: boolean;
};

type StatusResponse = {
  provider?: string;
  connected?: boolean;
  account_handle?: string | null;
  last_action?: string | null;
  next_refresh_timestamp?: string | null;
  last_post_text?: string | null;
  autopilot?: string | null;
  posts_in_rotation?: number | null;
  next_refresh?: string | null;
  refresh_mode?: string | null;
};

type SystemStatusResponse = {
  backend?: string;
  worker?: string;
  worker_state?: string;
  last_heartbeat?: string | null;
  importer?: string | null;
  autopilot?: string | null;
};

type Job = {
  id: string;
  type?: string;
  status?: string;
  created_at?: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:8000";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;

  const possibleKeys = [
    "token",
    "auth_token",
    "access_token",
    "evergreen_token",
    "evergreen_auth_token",
  ];

  for (const key of possibleKeys) {
    const value = window.localStorage.getItem(key);
    if (value) return value;
  }

  return null;
}

function getStoredUser(): User | null {
  if (typeof window === "undefined") return null;

  const possibleKeys = ["evergreen_user", "user", "auth_user", "me"];

  for (const key of possibleKeys) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === "number") {
        return {
          id: parsed.id,
          email: parsed.email,
          x_handle: parsed.x_handle || parsed.handle,
        };
      }
    } catch {
    }
  }

  return null;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function fetchJson<T>(
  path: string,
  options?: RequestInit & { skipAuth?: boolean }
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options?.headers || {});

  if (!options?.skipAuth && token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const text = await response.text();
      if (text) message = text;
    } catch {
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

async function resolveUser(): Promise<User | null> {
  try {
    const me = await fetchJson<any>("/api/me");
    if (me?.id) {
      const resolved = {
        id: me.id,
        email: me.email,
        x_handle: me.x_handle || me.handle,
      };
      if (typeof window !== "undefined") {
        window.localStorage.setItem("evergreen_user", JSON.stringify(resolved));
      }
      return resolved;
    }
  } catch {
  }

  return getStoredUser();
}

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState<"" | "refresh" | "analytics" | "connect-x">("");
  const [error, setError] = useState<string>("");

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  const loadAccounts = useCallback(
    async (userId: number) => {
      const data = await fetchJson<ConnectedAccount[]>(
        `/api/connected-accounts?user_id=${userId}`
      );

      setAccounts(Array.isArray(data) ? data : []);

      setSelectedAccountId((current) => {
        if (current && data.some((a) => a.id === current)) return current;
        if (data.length > 0) return data[0].id;
        return null;
      });

      return data;
    },
    []
  );

  const loadStatus = useCallback(
    async (userId: number, connectedAccountId: number) => {
      const data = await fetchJson<StatusResponse>(
        `/api/status?user_id=${userId}&connected_account_id=${connectedAccountId}`
      );
      setStatus(data);
    },
    []
  );

  const loadJobs = useCallback(async (connectedAccountId: number) => {
    const data = await fetchJson<Job[]>(
      `/api/jobs?connected_account_id=${connectedAccountId}`
    );
    setJobs(Array.isArray(data) ? data : []);
  }, []);

  const loadSystemStatus = useCallback(async () => {
    const data = await fetchJson<SystemStatusResponse>("/api/system-status", {
      skipAuth: true,
    });
    setSystemStatus(data);
  }, []);

  const fullReload = useCallback(async () => {
    setError("");

    const resolvedUser = await resolveUser();
    setUser(resolvedUser);

    if (!resolvedUser) {
      setLoading(false);
      return;
    }

    await loadSystemStatus();

    const connectedAccounts = await loadAccounts(resolvedUser.id);
    const accountId =
      selectedAccountId && connectedAccounts.some((a) => a.id === selectedAccountId)
        ? selectedAccountId
        : connectedAccounts[0]?.id ?? null;

    if (accountId) {
      await Promise.all([
        loadStatus(resolvedUser.id, accountId),
        loadJobs(accountId),
      ]);
    } else {
      setStatus(null);
      setJobs([]);
    }

    setLoading(false);
  }, [loadAccounts, loadJobs, loadStatus, loadSystemStatus, selectedAccountId]);

  useEffect(() => {
    fullReload().catch((err) => {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to load dashboard.");
    });
  }, [fullReload]);

  useEffect(() => {
    if (!user?.id || !selectedAccountId) return;

    loadStatus(user.id, selectedAccountId).catch(() => {});
    loadJobs(selectedAccountId).catch(() => {});
  }, [user?.id, selectedAccountId, loadJobs, loadStatus]);

  useEffect(() => {
    if (!user?.id) return;

    const interval = window.setInterval(() => {
      loadSystemStatus().catch(() => {});
      loadAccounts(user.id).catch(() => {});
      if (selectedAccountId) {
        loadStatus(user.id, selectedAccountId).catch(() => {});
        loadJobs(selectedAccountId).catch(() => {});
      }
    }, 8000);

    return () => window.clearInterval(interval);
  }, [user?.id, selectedAccountId, loadAccounts, loadJobs, loadStatus, loadSystemStatus]);

  const runAction = useCallback(
    async (kind: "refresh" | "analytics") => {
      if (!user?.id) {
        setError("No logged-in user found.");
        return;
      }

      if (!selectedAccountId) {
        setError("No connected account selected.");
        return;
      }

      setError("");
      setActionBusy(kind);

      const endpoint = kind === "refresh" ? "/api/refresh-now" : "/api/run-analytics";
      const query = `?user_id=${user.id}&connected_account_id=${selectedAccountId}`;

      try {
        try {
          await fetchJson<any>(`${endpoint}${query}`, {
            method: "POST",
            body: JSON.stringify({
              user_id: user.id,
              connected_account_id: selectedAccountId,
            }),
          });
        } catch (firstErr) {
          const msg = firstErr instanceof Error ? firstErr.message : "";
          if (msg.includes("(405)")) {
            await fetchJson<any>(`${endpoint}${query}`, { method: "GET" });
          } else {
            throw firstErr;
          }
        }

        await Promise.all([
          loadStatus(user.id, selectedAccountId),
          loadJobs(selectedAccountId),
          loadSystemStatus(),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to ${kind}.`);
      } finally {
        setActionBusy("");
      }
    },
    [loadJobs, loadStatus, loadSystemStatus, selectedAccountId, user]
  );

  const connectX = useCallback(() => {
    if (!user?.id) {
      setError("No logged-in user found.");
      return;
    }
    setActionBusy("connect-x");
    window.location.href = `${API_BASE}/api/providers/x/connect?user_id=${user.id}`;
  }, [user]);

  const logout = useCallback(() => {
    if (typeof window !== "undefined") {
      [
        "token",
        "auth_token",
        "access_token",
        "evergreen_token",
        "evergreen_auth_token",
        "evergreen_user",
        "user",
        "auth_user",
        "me",
      ].forEach((key) => window.localStorage.removeItem(key));
    }
    router.push("/login");
  }, [router]);

  const currentHandle =
    status?.account_handle ||
    selectedAccount?.handle ||
    selectedAccount?.username ||
    user?.x_handle ||
    "@unknown";

  const currentProvider =
    (status?.provider || selectedAccount?.provider || "x").toUpperCase();

  const isConnected =
    !!selectedAccount &&
    (selectedAccount.connected === true || selectedAccount.is_connected === true || status?.connected);

  if (loading) {
    return (
      <main style={styles.page}>
        <div style={styles.shell}>
          <h1 style={styles.title}>Evergreen Dashboard</h1>
          <p style={styles.subtitle}>Loading dashboard…</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main style={styles.page}>
        <div style={styles.shell}>
          <h1 style={styles.title}>Evergreen Dashboard</h1>
          <p style={styles.subtitle}>No active login found.</p>
          <button style={styles.primaryButton} onClick={() => router.push("/login")}>
            Go to Login
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.topRow}>
          <div>
            <h1 style={styles.title}>Evergreen Dashboard</h1>
            <p style={styles.subtitle}>Mission control for your resurfacing system.</p>
          </div>

          <div style={styles.topControls}>
            <div style={styles.pill}>@{user.x_handle || user.email?.split("@")[0] || "user"}</div>
            <div style={{ color: "rgba(236,253,245,0.82)" }}>Galaxy</div>

            <select
              value={selectedAccountId ?? ""}
              onChange={(e) => setSelectedAccountId(e.target.value ? Number(e.target.value) : null)}
              style={styles.select}
            >
              {accounts.length === 0 ? (
                <option value="">No accounts yet</option>
              ) : (
                accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {(account.provider || "x").toUpperCase()} · @{account.handle || account.username || "unknown"}
                  </option>
                ))
              )}
            </select>

            <button style={styles.button} onClick={() => router.push("/galaxy")}>
              Open Galaxy
            </button>
            <button style={styles.button} onClick={() => router.push("/")}>
              Home
            </button>
            <button style={styles.button} onClick={logout}>
              Log out
            </button>
          </div>
        </header>

        {error ? <div style={styles.errorBanner}>{error}</div> : null}

        <section style={styles.grid2}>
          <div style={styles.card}>
            <div style={styles.cardLabel}>Current Galaxy</div>
            <div style={styles.currentGalaxyRow}>
              <div style={styles.providerBadge}>{currentProvider[0] || "X"}</div>
              <div>
                <div style={styles.bigProvider}>{currentProvider}</div>
                <div style={styles.handleText}>{currentHandle}</div>
              </div>
              <div style={{ marginLeft: "auto", display: "grid", gap: 10 }}>
                <div style={styles.statusPill}>
                  {isConnected ? "Connected" : "Disconnected"}
                </div>
                <div style={styles.statusPill}>
                  {status?.autopilot || systemStatus?.autopilot || "Autopilot idle"}
                </div>
              </div>
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardLabel}>Quick Connect</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
              <button
                style={styles.button}
                onClick={connectX}
                disabled={actionBusy === "connect-x"}
              >
                {actionBusy === "connect-x" ? "Connecting X…" : "Connect X"}
              </button>
              <button
                style={{ ...styles.button, opacity: 0.7, cursor: "not-allowed" }}
                disabled
                title="Use your current Bluesky flow here if already wired."
              >
                Connect Bluesky
              </button>
            </div>
            <div style={styles.helpText}>
              X uses OAuth redirect. Bluesky uses an app-password flow for now, and can be upgraded later.
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>System Status</div>
          <div style={styles.metricGrid4}>
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>Backend</div>
              <div style={styles.metricValue}>{systemStatus?.backend || "Online"}</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>Worker</div>
              <div style={styles.metricValue}>{systemStatus?.worker || "Waiting"}</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>Worker State</div>
              <div style={styles.metricValue}>{systemStatus?.worker_state || "running"}</div>
            </div>
            <div style={styles.metricCard}>
              <div style={styles.metricLabel}>Last Heartbeat</div>
              <div style={styles.metricValue}>{formatDateTime(systemStatus?.last_heartbeat)}</div>
            </div>
          </div>

          <div style={styles.inlineStrip}>
            Importer: {systemStatus?.importer || "inactive"} &nbsp;&nbsp; Autopilot:{" "}
            {systemStatus?.autopilot || "idle"}
          </div>
        </section>

        <section style={styles.metricGrid5}>
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>Autopilot</div>
            <div style={styles.metricHero}>{status?.autopilot || "Idle"}</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>Provider</div>
            <div style={styles.metricHero}>{currentProvider}</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>Connected</div>
            <div style={styles.metricHero}>{isConnected ? "Yes" : "No"}</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>Posts in Rotation</div>
            <div style={styles.metricHero}>{status?.posts_in_rotation ?? 0}</div>
          </div>
          <div style={styles.metricCard}>
            <div style={styles.metricLabel}>Next refresh</div>
            <div style={styles.metricHero}>{status?.next_refresh || "—"}</div>
          </div>
        </section>

        <section style={styles.grid2}>
          <div style={styles.card}>
            <div style={styles.sectionTitle}>Live Status</div>

            <div style={styles.infoBox}>
              <div style={styles.metricLabel}>Account Handle</div>
              <div style={styles.infoValue}>{status?.account_handle || currentHandle}</div>
            </div>

            <div style={styles.infoBox}>
              <div style={styles.metricLabel}>Last Action</div>
              <div style={styles.infoValue}>{status?.last_action || "—"}</div>
            </div>

            <div style={styles.infoBox}>
              <div style={styles.metricLabel}>Next Refresh Timestamp</div>
              <div style={styles.infoValue}>
                {formatDateTime(status?.next_refresh_timestamp)}
              </div>
            </div>

            <div style={styles.infoBox}>
              <div style={styles.metricLabel}>Last Post Text</div>
              <div style={styles.infoValue}>{status?.last_post_text || "No recent post text recorded"}</div>
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.sectionTitle}>Controls</div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
              <button
                style={styles.button}
                disabled={!selectedAccountId || actionBusy === "refresh"}
                onClick={() => runAction("refresh")}
              >
                {actionBusy === "refresh" ? "Refreshing…" : "Refresh now"}
              </button>

              <button
                style={styles.button}
                disabled={!selectedAccountId || actionBusy === "analytics"}
                onClick={() => runAction("analytics")}
              >
                {actionBusy === "analytics" ? "Running…" : "Run analytics"}
              </button>
            </div>

            <div style={styles.infoBox}>
              <div style={styles.sectionTitle}>Refresh Frequency</div>
              <div style={styles.helpText}>
                This page is account-scoped. X and Bluesky each keep separate posts, timing, analytics, and refresh cycles.
              </div>
            </div>
          </div>
        </section>

        <section style={styles.card}>
          <div style={styles.sectionTitle}>Recent Jobs</div>
          {jobs.length === 0 ? (
            <div style={styles.emptyText}>No jobs found yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {jobs.map((job) => (
                <div key={job.id} style={styles.jobRow}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{job.type || "Job"}</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>ID: {job.id}</div>
                  </div>
                  <div style={styles.jobStatus}>{job.status || "Queued"}</div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    {formatDateTime(job.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at 50% 10%, rgba(52,211,153,0.18), rgba(0,0,0,0) 35%), linear-gradient(180deg, #021a12 0%, #00120d 100%)",
    color: "#ecfdf5",
    padding: "22px 24px 48px",
  },
  shell: {
    maxWidth: 1320,
    margin: "0 auto",
  },
  topRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 18,
    flexWrap: "wrap",
    alignItems: "flex-start",
    marginBottom: 22,
  },
  title: {
    fontSize: 56,
    lineHeight: 1,
    fontWeight: 800,
    margin: 0,
    letterSpacing: "-0.03em",
  },
  subtitle: {
    margin: "10px 0 0",
    fontSize: 16,
    color: "rgba(236,253,245,0.78)",
  },
  topControls: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  },
  pill: {
    border: "1px solid rgba(167,243,208,0.22)",
    background: "rgba(6,95,70,0.3)",
    padding: "10px 14px",
    borderRadius: 999,
    fontWeight: 700,
  },
  select: {
    minWidth: 220,
    height: 44,
    borderRadius: 14,
    background: "rgba(0,0,0,0.18)",
    color: "#ecfdf5",
    border: "1px solid rgba(167,243,208,0.22)",
    padding: "0 14px",
    outline: "none",
  },
  button: {
    height: 44,
    borderRadius: 999,
    border: "1px solid rgba(167,243,208,0.22)",
    background: "rgba(0,0,0,0.18)",
    color: "#ecfdf5",
    padding: "0 18px",
    fontWeight: 700,
    cursor: "pointer",
  },
  primaryButton: {
    height: 46,
    borderRadius: 999,
    border: "1px solid rgba(167,243,208,0.22)",
    background: "#9ae6b4",
    color: "#052e1b",
    padding: "0 20px",
    fontWeight: 800,
    cursor: "pointer",
  },
  errorBanner: {
    marginBottom: 18,
    padding: "14px 16px",
    borderRadius: 16,
    background: "rgba(127,29,29,0.22)",
    border: "1px solid rgba(248,113,113,0.55)",
    color: "#fecaca",
  },
  grid2: {
    display: "grid",
    gridTemplateColumns: "1.6fr 1fr",
    gap: 16,
    marginBottom: 16,
  },
  card: {
    borderRadius: 22,
    border: "1px solid rgba(167,243,208,0.16)",
    background: "rgba(0,0,0,0.15)",
    padding: 18,
    boxShadow: "0 0 0 1px rgba(6,95,70,0.08) inset",
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 14,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    opacity: 0.75,
    marginBottom: 14,
  },
  currentGalaxyRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
  },
  providerBadge: {
    width: 58,
    height: 58,
    borderRadius: 18,
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
    fontSize: 28,
    background: "rgba(16,185,129,0.18)",
    border: "1px solid rgba(167,243,208,0.18)",
  },
  bigProvider: {
    fontSize: 48,
    fontWeight: 800,
    lineHeight: 1,
  },
  handleText: {
    marginTop: 4,
    fontSize: 18,
    color: "rgba(236,253,245,0.85)",
  },
  statusPill: {
    border: "1px solid rgba(167,243,208,0.22)",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: 700,
    textAlign: "center",
  },
  helpText: {
    color: "rgba(236,253,245,0.72)",
    lineHeight: 1.5,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: 800,
    marginBottom: 14,
  },
  metricGrid4: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 14,
    marginBottom: 14,
  },
  metricGrid5: {
    display: "grid",
    gridTemplateColumns: "repeat(5, 1fr)",
    gap: 14,
    marginBottom: 16,
  },
  metricCard: {
    borderRadius: 20,
    border: "1px solid rgba(167,243,208,0.16)",
    background: "rgba(0,0,0,0.12)",
    padding: 16,
    minHeight: 94,
  },
  metricLabel: {
    fontSize: 14,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: 0.72,
    marginBottom: 10,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: 700,
  },
  metricHero: {
    fontSize: 34,
    fontWeight: 800,
    lineHeight: 1,
  },
  inlineStrip: {
    borderRadius: 18,
    border: "1px solid rgba(167,243,208,0.12)",
    padding: "14px 16px",
    color: "rgba(236,253,245,0.82)",
  },
  infoBox: {
    borderRadius: 18,
    border: "1px solid rgba(167,243,208,0.12)",
    background: "rgba(0,0,0,0.08)",
    padding: "16px 16px",
    marginBottom: 14,
  },
  infoValue: {
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.35,
    wordBreak: "break-word",
  },
  emptyText: {
    color: "rgba(236,253,245,0.72)",
  },
  jobRow: {
    borderRadius: 18,
    border: "1px solid rgba(167,243,208,0.12)",
    padding: "14px 16px",
    display: "grid",
    gridTemplateColumns: "1.5fr 180px 220px",
    gap: 16,
    alignItems: "center",
  },
  jobStatus: {
    borderRadius: 999,
    background: "rgba(22,101,52,0.45)",
    border: "1px solid rgba(134,239,172,0.22)",
    padding: "8px 12px",
    textAlign: "center",
    fontWeight: 700,
  },
};
