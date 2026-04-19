'use client'

declare global {
  interface Window {
    Clerk?: {
      signOut?: () => Promise<unknown>
    }
  }
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'
const APP_BASE =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ||
  'https://www.evergreenmachine.ai'

const TOKEN_KEY = 'evergreen_auth_token'
const USER_KEY = 'evergreen_auth_user'
const AUTH_EVENT = 'evergreen-auth-changed'

export type AuthUser = {
  id: number
  email: string
  handle: string
  subscription_status?: string
  trial_started_at?: string | null
  trial_ends_at?: string | null
  can_run_autopilot?: boolean
  stripe_price_id?: string | null
  stripe_billing_email?: string | null
  current_period_end?: string | null
  created_at?: string | null
  welcome_email_sent_at?: string | null
}

export type AuthResponse = {
  user: AuthUser
  token?: string
}

let bootstrapPromise: Promise<AuthResponse | null> | null = null
let lastBootstrapError: string | null = null

export function getApiBase() {
  return API_BASE
}

export function getAppBase() {
  return APP_BASE
}

export function getLastBootstrapError() {
  return lastBootstrapError
}

function emitAuthChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(AUTH_EVENT))
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

async function bootstrapBackendSession(): Promise<AuthResponse | null> {
  if (typeof window === 'undefined') return null

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  bootstrapPromise = fetchWithTimeout('/api/session/bootstrap', {
    method: 'POST',
    cache: 'no-store',
  })
    .then(async (res) => {
      let json: any = null
      try {
        json = await res.json()
      } catch {
        json = null
      }

      if (res.status === 401 || res.status === 404) {
        lastBootstrapError = json?.detail || null
        return null
      }

      if (!res.ok) {
        lastBootstrapError =
          json?.detail || `Evergreen session bootstrap failed (${res.status})`
        return null
      }

      if (json.token) {
        setToken(json.token)
      }

      if (json.user) {
        setStoredUser(json.user)
      }

      lastBootstrapError = null

      return json as AuthResponse
    })
    .catch((error) => {
      lastBootstrapError =
        error instanceof Error ? error.message : 'Evergreen session bootstrap failed'
      return null
    })
    .finally(() => {
      bootstrapPromise = null
    })

  return bootstrapPromise
}

export function getToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_KEY, token)
  emitAuthChanged()
}

export function clearToken() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
  emitAuthChanged()
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(USER_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export function setStoredUser(user: AuthUser) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(USER_KEY, JSON.stringify(user))
  emitAuthChanged()
}

export function clearStoredUser() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(USER_KEY)
  emitAuthChanged()
}

export async function resetAuthState(options?: { includeClerk?: boolean }) {
  clearToken()
  clearStoredUser()
  bootstrapPromise = null
  lastBootstrapError = null

  if (options?.includeClerk && typeof window !== 'undefined' && typeof window.Clerk?.signOut === 'function') {
    try {
      await window.Clerk.signOut()
    } catch {
      // ignore Clerk sign-out failures during hard reset
    }
  }

  emitAuthChanged()
}

export async function apiFetch(path: string, init: RequestInit = {}, timeoutMs = 8000) {
  const token = getToken()
  const headers = new Headers(init.headers || {})

  if (!headers.has('Content-Type') && init.method && init.method !== 'GET') {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetchWithTimeout(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  }, timeoutMs)
}

export async function signup(email: string, password: string, handle: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, handle }),
    cache: 'no-store',
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Signup failed')
  }

  if (json.token) {
    setToken(json.token)
  }

  if (json.user) {
    setStoredUser(json.user)
  }

  return json
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(json.detail || 'Login failed')
  }

  if (json.token) {
    setToken(json.token)
  }

  if (json.user) {
    setStoredUser(json.user)
  }

  return json
}

export async function me(): Promise<AuthResponse | null> {
  const token = getToken()

  if (!token) {
    const bootstrapped = await bootstrapBackendSession()
    if (bootstrapped?.user) {
      return bootstrapped
    }
  }

  const freshToken = getToken()

  if (!freshToken) return null

  let res: Response
  try {
    res = await apiFetch('/api/auth/me', {}, 8000)
  } catch (error) {
    lastBootstrapError =
      error instanceof Error ? error.message : 'Evergreen session verification failed'
    return null
  }

  if (res.status === 401 || res.status === 404) {
    clearToken()
    clearStoredUser()

    const bootstrapped = await bootstrapBackendSession()
    return bootstrapped?.user ? bootstrapped : null
  }

  let json: any = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  if (!res.ok) {
    lastBootstrapError =
      json?.detail || `Evergreen session verification failed (${res.status})`
    return null
  }

  if (json.user) {
    setStoredUser(json.user)
  }

  lastBootstrapError = null

  return json
}

export async function logout() {
  await resetAuthState({ includeClerk: true })
}
