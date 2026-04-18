# Clerk Setup For Evergreen Machine

This repo now supports a Clerk-based auth layer while preserving the existing backend token flow.

## What was added

- Clerk provider support in the Next app layout
- Clerk middleware in `frontend/proxy.ts`
- Clerk-powered login and signup UI when Clerk env vars are present
- a secure frontend bootstrap route at `frontend/app/api/session/bootstrap/route.ts`
- a secure backend bootstrap endpoint at `backend/app/routes/auth.py`

When Clerk is configured:

1. a user signs in with Google, Apple, or email
2. the Next app verifies the Clerk session
3. the app calls the backend bootstrap endpoint with an internal secret
4. the backend creates or reuses the Evergreen user and returns the app token
5. the dashboard continues working on the existing backend APIs

## Quick verification checklist

- `clerkMiddleware()` exists in `frontend/proxy.ts`
- `ClerkProvider` is inside `<body>` in `frontend/app/layout.tsx`
- the shared layout uses `Show`, `SignInButton`, `SignUpButton`, and `UserButton`
- the app still uses the App Router
- the bootstrap route uses `auth()` with Clerk server utilities

## Required environment variables

### Frontend

Set these in Vercel for the frontend project:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `EVERGREEN_INTERNAL_BOOTSTRAP_SECRET`
- `NEXT_PUBLIC_API_BASE_URL`

### Backend

Set this in the backend environment. The current production API is on Railway:

- `EVERGREEN_INTERNAL_BOOTSTRAP_SECRET`

Important:

- the frontend and backend must use the exact same `EVERGREEN_INTERNAL_BOOTSTRAP_SECRET`
- use a long random value in production
- the Clerk keys should live only in Vercel for the frontend
- the backend does not need the Clerk keys for the current bootstrap flow

## Clerk dashboard setup

### 1. Create the app

- create a Clerk application for `evergreenmachine.ai`
- set the production domain to `www.evergreenmachine.ai`

### 2. Enable auth methods

Turn on:

- Email
- Google
- Apple

### 3. Configure redirect URLs

Use:

- sign-in URL: `/login`
- sign-up URL: `/signup`
- post-login redirect: `/dashboard`
- post-sign-up redirect: `/dashboard`

### 4. Google

In Clerk:

- enable Google as a social connection

You will likely need:

- a Google Cloud OAuth client
- your production callback URL from Clerk

### 5. Apple

In Clerk:

- enable Apple

You will need:

- an Apple Developer account
- a Services ID
- a private key
- Apple Sign In domain setup

Apple is the one piece that usually takes the most manual dashboard work.

## Email behavior

Right away, Clerk can provide the "locked in and pro" feeling through:

- email verification
- email-based sign-in
- polished auth messaging

That covers the most important signup email behavior immediately.

## Optional next step: custom welcome email

If you want a branded Evergreen Machine welcome email after signup, the next clean step is:

- add Resend
- create a welcome email template
- trigger it after first successful Clerk bootstrap or from a Clerk webhook

Recommended for that phase:

- Resend for delivery
- React Email for the template

## Current behavior if Clerk is not configured

The app falls back to the legacy email/password forms on `/login` and `/signup`.

That means we can deploy this scaffold safely before all Clerk keys are live.
