"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://127.0.0.1:8000";

type LoginResponse =
  | {
      token?: string;
      access_token?: string;
      user?: {
        id: number;
        email?: string;
        x_handle?: string;
        handle?: string;
      };
      id?: number;
      email?: string;
      x_handle?: string;
      handle?: string;
      message?: string;
    }
  | Record<string, any>;

function normalizeUser(data: LoginResponse) {
  if (data?.user && typeof data.user.id === "number") {
    return {
      id: data.user.id,
      email: data.user.email,
      x_handle: data.user.x_handle || data.user.handle,
    };
  }

  if (typeof data?.id === "number") {
    return {
      id: data.id,
      email: data.email,
      x_handle: data.x_handle || data.handle,
    };
  }

  return null;
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      let data: LoginResponse = {};
      try {
        data = await response.json();
      } catch {
      }

      if (!response.ok) {
        const message =
          (typeof data?.message === "string" && data.message) ||
          "Invalid credentials";
        throw new Error(message);
      }

      const token =
        (typeof data?.token === "string" && data.token) ||
        (typeof data?.access_token === "string" && data.access_token) ||
        "";

      const user = normalizeUser(data);

      if (token) {
        localStorage.setItem("evergreen_token", token);
      }

      if (user) {
        localStorage.setItem("evergreen_user", JSON.stringify(user));
      } else {
        localStorage.setItem(
          "evergreen_user",
          JSON.stringify({
            id: 1,
            email,
          })
        );
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.header}>
          <h1 style={styles.title}>Evergreen</h1>
          <p style={styles.subtitle}>Log in and continue your mission control.</p>
        </div>

        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Log In</h2>

          <form onSubmit={handleSubmit} style={styles.form}>
            <label style={styles.label}>
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                required
              />
            </label>

            <label style={styles.label}>
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={styles.input}
                required
              />
            </label>

            {error ? <div style={styles.error}>{error}</div> : null}

            <button type="submit" disabled={busy} style={styles.primaryButton}>
              {busy ? "Logging in..." : "Log In"}
            </button>
          </form>

          <div style={styles.footerText}>
            Don&apos;t have an account? <Link href="/signup" style={styles.link}>Sign up</Link>
          </div>
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
    padding: "24px",
  },
  shell: {
    maxWidth: 1180,
    margin: "0 auto",
  },
  header: {
    marginBottom: 28,
  },
  title: {
    margin: 0,
    fontSize: 56,
    lineHeight: 1,
    fontWeight: 800,
    letterSpacing: "-0.03em",
  },
  subtitle: {
    margin: "12px 0 0",
    fontSize: 18,
    color: "rgba(236,253,245,0.82)",
  },
  card: {
    maxWidth: 760,
    borderRadius: 28,
    border: "1px solid rgba(167,243,208,0.18)",
    background: "rgba(0,0,0,0.16)",
    padding: 46,
    boxShadow: "0 0 0 1px rgba(6,95,70,0.08) inset",
  },
  cardTitle: {
    margin: "0 0 28px",
    fontSize: 28,
    fontWeight: 800,
    color: "rgba(236,253,245,0.82)",
  },
  form: {
    display: "grid",
    gap: 20,
  },
  label: {
    display: "grid",
    gap: 12,
    fontSize: 16,
    fontWeight: 600,
  },
  input: {
    height: 78,
    borderRadius: 24,
    border: "1px solid rgba(167,243,208,0.18)",
    background: "rgba(0,0,0,0.18)",
    color: "#ecfdf5",
    padding: "0 26px",
    fontSize: 18,
    outline: "none",
  },
  error: {
    borderRadius: 18,
    border: "1px solid rgba(248,113,113,0.55)",
    background: "rgba(127,29,29,0.22)",
    color: "#fecaca",
    padding: "14px 16px",
    fontSize: 16,
    fontWeight: 600,
  },
  primaryButton: {
    height: 84,
    borderRadius: 24,
    border: "none",
    background: "#9ae6b4",
    color: "#052e1b",
    fontSize: 22,
    fontWeight: 800,
    cursor: "pointer",
  },
  footerText: {
    marginTop: 28,
    fontSize: 16,
    color: "rgba(236,253,245,0.86)",
  },
  link: {
    color: "#ecfdf5",
    fontWeight: 700,
    textDecoration: "none",
  },
};
