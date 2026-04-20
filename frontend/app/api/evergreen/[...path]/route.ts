import { NextRequest } from 'next/server'

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function requestTimeoutMs(path: string[]) {
  const joined = path.join('/').toLowerCase()
  if (joined.startsWith('galaxy')) return 20000
  if (joined.startsWith('jobs')) return 15000
  if (joined.startsWith('status')) return 15000
  return 8000
}

function buildTargetUrl(request: NextRequest, path: string[]) {
  const suffix = path.join('/')
  const target = new URL(`${BACKEND_BASE}/api/${suffix}`)
  target.search = request.nextUrl.search
  return target
}

async function forward(request: NextRequest, path: string[]) {
  const target = buildTargetUrl(request, path)
  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  const authorization = request.headers.get('authorization')
  const evergreenEmail = request.headers.get('x-evergreen-email')
  const evergreenHandle = request.headers.get('x-evergreen-handle')

  if (contentType) {
    headers.set('content-type', contentType)
  }

  if (authorization) {
    headers.set('authorization', authorization)
  }

  if (evergreenEmail) {
    headers.set('x-evergreen-email', evergreenEmail)
  }

  if (evergreenHandle) {
    headers.set('x-evergreen-handle', evergreenHandle)
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const body = hasBody ? await request.text() : undefined

  let response: Response
  try {
    response = await fetchWithTimeout(
      target,
      {
        method: request.method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'manual',
      },
      requestTimeoutMs(path)
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        detail: error instanceof Error ? error.message : 'Evergreen proxy request timed out',
      }),
      {
        status: 504,
        headers: {
          'content-type': 'application/json',
        },
      }
    )
  }

  const responseHeaders = new Headers()
  const responseContentType = response.headers.get('content-type')
  const responseLocation = response.headers.get('location')

  if (responseContentType) {
    responseHeaders.set('content-type', responseContentType)
  }

  if (responseLocation) {
    responseHeaders.set('location', responseLocation)
  }

  return new Response(await response.text(), {
    status: response.status,
    headers: responseHeaders,
  })
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  return forward(request, path)
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  return forward(request, path)
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  return forward(request, path)
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  return forward(request, path)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  return forward(request, path)
}
