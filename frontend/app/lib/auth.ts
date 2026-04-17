'use client'

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

const TOKEN_KEY = 'evergreen_auth_token'
const USER_KEY = 'evergreen_auth_user'

export type AuthUser = {
  id: number
  email: string
  handle: string
  subscription_status?: string
}

export type AuthResponse = {
  user: AuthUser
  token?: string
}

export function getApiBase() {
  return API_BASE
}

export function getToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
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
}

export function clearStoredUser() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(USER_KEY)
}

export async function apiFetch(path: string, init: RequestInit = {}) {
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
  const storedUser = getStoredUser()

  if (!token && !storedUser) return null

  const res = await apiFetch('/api/auth/me')

  if (res.status === 404) {
    return storedUser ? { user: storedUser, token: token || undefined } : null
  }

  if (res.status === 401) {
    clearToken()
    clearStoredUser()
    return null
  }

  const json = await res.json()

  if (!res.ok) {
    return storedUser ? { user: storedUser, token: token || undefined } : null
  }

  if (json.user) {
    setStoredUser(json.user)
  }

  return json
}

export function logout() {
  clearToken()
  clearStoredUser()
}
