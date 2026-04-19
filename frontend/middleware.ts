import { clerkMiddleware } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') || 'https://www.evergreenmachine.ai'

export default clerkMiddleware(async (_auth, req) => {
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
    currentHost !== '127.0.0.1' &&
    currentHost.endsWith('.vercel.app')
  ) {
    const redirectUrl = new URL(req.nextUrl.pathname + req.nextUrl.search, appUrl.origin)
    return NextResponse.redirect(redirectUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
