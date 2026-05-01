const isProduction = process.env.NODE_ENV === 'production'

const DEFAULT_API_BASE = isProduction
  ? 'https://backend-fixed-production.up.railway.app'
  : 'http://127.0.0.1:8000'

const DEFAULT_APP_BASE = isProduction
  ? 'https://www.evergreenmachine.ai'
  : 'http://127.0.0.1:3000'

export function getPublicApiBase() {
  return process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') || DEFAULT_API_BASE
}

export function getPublicAppBase() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || DEFAULT_APP_BASE
}
