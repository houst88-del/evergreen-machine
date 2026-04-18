import { NextRequest } from 'next/server'

const BACKEND_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, '') ||
  'https://backend-fixed-production.up.railway.app'

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

  if (contentType) {
    headers.set('content-type', contentType)
  }

  if (authorization) {
    headers.set('authorization', authorization)
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const body = hasBody ? await request.text() : undefined

  const response = await fetch(target, {
    method: request.method,
    headers,
    body,
    cache: 'no-store',
    redirect: 'manual',
  })

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
