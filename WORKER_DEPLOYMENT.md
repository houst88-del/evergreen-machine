# Evergreen Worker Deployment

Evergreen now expects two production processes:

- `web`: FastAPI API
- `worker`: autopilot/background refresh worker

The repo `Procfile` already defines both:

```procfile
web: bash -lc 'pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m uvicorn app.main:app --host 0.0.0.0 --port $PORT'
worker: bash -lc 'pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m app.workers.autopilot_worker'
```

## Railway setup

Use the same codebase and environment variables for both the web service and the worker service.

Recommended shape:

1. Keep the existing API service running the `web` command.
2. Add a second Railway service for the same repo.
3. Point that second service at the `worker` command from the `Procfile`.
4. Copy the same env vars used by the backend service:
   - `DATABASE_URL`
   - `X_API_KEY`
   - `X_API_SECRET`
   - `X_CALLBACK_URL`
   - `EVERGREEN_DASHBOARD_URL`
   - `EVERGREEN_INTERNAL_BOOTSTRAP_SECRET`
   - any Bluesky/provider secrets
   - optional email vars such as `RESEND_API_KEY` and `RESEND_FROM_EMAIL`

## What healthy looks like

Once the worker is live:

- `/api/system-status` should report `"worker": { "ok": true }`
- Mission Control should show `Worker Running`
- queued refresh jobs should move into processed/completed states
- X and Bluesky next-cycle timers should keep advancing naturally

## If the worker is missing

The app will still load, but:

- Mission Control will show the worker as offline
- refresh jobs can sit in a running/queued-looking state longer than expected
- autopilot cycles will not actually execute in the background

## Optional email setup

Welcome emails are now supported when these backend env vars are present:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- optional: `EVERGREEN_APP_URL`

If those are missing, auth still works and welcome email sending is safely skipped.
