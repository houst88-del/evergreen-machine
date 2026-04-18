# Evergreen Worker Deployment

Evergreen expects two production processes:

- `web`: FastAPI API
- `worker`: background autopilot / refresh engine

The repo-level [Procfile](/Users/houstonfry/Downloads/evergreen_scaffold/Procfile) already defines both:

```procfile
web: bash -lc 'python3 -m pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m uvicorn app.main:app --host 0.0.0.0 --port $PORT'
worker: bash -lc 'python3 -m pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m app.workers.autopilot_worker'
```

## Railway checklist

Use the same repo for both services.

### 1. Keep the current API service as the web service

Its start command should remain:

```bash
bash -lc 'python3 -m pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m uvicorn app.main:app --host 0.0.0.0 --port $PORT'
```

### 2. Add a second Railway service for the worker

Use this exact start command:

```bash
bash -lc 'python3 -m pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m app.workers.autopilot_worker'
```

### 3. Copy backend env vars to the worker service

The worker should have the same operational env as the API service, especially:

- `DATABASE_URL`
- `X_API_KEY`
- `X_API_SECRET`
- `X_CALLBACK_URL`
- `EVERGREEN_DASHBOARD_URL`
- `EVERGREEN_INTERNAL_BOOTSTRAP_SECRET`
- any Bluesky/provider secrets
- optional email vars such as `RESEND_API_KEY` and `RESEND_FROM_EMAIL`

### 4. Optional tuning env vars

These are now worker-configurable by environment:

- `EVERGREEN_WORKER_POLL_SECONDS`
  Default: `10`
- `EVERGREEN_WORKER_STARTUP_X_LIMIT`
  Default: `200`
- `EVERGREEN_WORKER_STARTUP_BLUESKY_LIMIT`
  Default: `150`

You can leave them unset for now.

## What healthy looks like

Once the worker is live:

- `/api/system-status` should report `"worker": { "ok": true }`
- Mission Control should show `Worker Running`
- queued refresh jobs should move into processed/completed states
- X and Bluesky next-cycle timers should keep advancing naturally
- `backend/worker_heartbeat.json` should keep updating in the running environment

## If the worker is missing

The app will still load, but:

- Mission Control will show the worker as offline
- refresh jobs can sit in queued/running-looking states too long
- autopilot cycles will not actually execute in the background

## Optional email setup

Welcome emails are supported when these backend env vars are present:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- optional: `EVERGREEN_APP_URL`

If those are missing, auth still works and welcome email sending is safely skipped.
