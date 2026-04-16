# Evergreen Scaffold

A minimal full-stack starter for **Evergreen** — a simple web app that lets a user sign up, connect an account, turn on autopilot, and monitor a tiny status dashboard.

## What is included

- `frontend/` — Next.js App Router app
- `backend/` — FastAPI API
- `backend/app/workers/autopilot_worker.py` — polling worker stub for the Evergreen engine
- simple SQLite storage for local development
- placeholder provider adapter interfaces for X and Bluesky

## What is intentionally still a stub

This scaffold is **not yet wired to live X or Bluesky credentials**. The engine, routes, dashboard, job loop, and provider interfaces are in place, but real OAuth, live imports, and live posting still need your app credentials and provider-specific scopes.

## Where to put it

1. Unzip this folder anywhere you like.
2. Open the root folder in VS Code, Cursor, or Windsurf.
3. Start the backend and frontend in two terminals.
4. Optionally start the worker in a third terminal.

## Quick start

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

### Worker

```bash
cd backend
source .venv/bin/activate
python -m app.workers.autopilot_worker
```

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Frontend runs at `http://localhost:3000`
Backend runs at `http://localhost:8000`

## Current flow

- Landing page at `/`
- Dashboard at `/dashboard`
- Connects to the local backend
- Status toggle starts/stops Evergreen autopilot
- Dashboard shows:
  - running / paused
  - connected account name
  - posts in rotation
  - last resurfaced post
  - last action time

## Suggested next steps

1. Replace the mock `x_adapter.py` methods with real OAuth + API calls.
2. Add real user auth (Clerk/Auth.js/etc.).
3. Replace the single demo user with real user accounts.
4. Move SQLite to Postgres for production.
5. Add Stripe billing.

## Handy build prompt

Put this prompt into Cursor/Windsurf/ChatGPT when you want to keep extending the scaffold:

"Continue building Evergreen as a clean, minimal web app. Keep the UI extremely simple. The landing page should say 'Set it and forget it.' The dashboard should mainly show whether Evergreen is running, the last post resurfaced, and the last action time. Keep all scoring and scheduling logic server-side. Do not add complex user controls unless explicitly requested. Prefer clear file-by-file edits and preserve the existing architecture: Next.js frontend, FastAPI backend, worker-based autopilot engine, provider adapters for social platforms."
