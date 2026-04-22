import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'

const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || 'https://www.evergreenmachine.ai'
const CLERK_PUBLISHABLE_KEY = String(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '').trim()
const CLERK_ENABLED =
  CLERK_PUBLISHABLE_KEY.startsWith('pk_') && !CLERK_PUBLISHABLE_KEY.includes('replace_me')

const middlewareHandler = async (_auth: unknown, req: NextRequest) => {
  const currentHost = req.nextUrl.hostname.toLowerCase()

  let appUrl: URL | null = null
  try {
    appUrl = new URL(APP_ORIGIN)
  } catch {
    appUrl = null
  }

  if (
    appUrl &&
    currentHost !== appUrl.hostname.toLowerCase() &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1'
  ) {
    const redirectUrl = new URL(req.nextUrl.pathname + req.nextUrl.search, appUrl.origin)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.next()
}

export default CLERK_ENABLED
  ? clerkMiddleware(middlewareHandler)
  : ((req: NextRequest) => middlewareHandler(null, req))

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
