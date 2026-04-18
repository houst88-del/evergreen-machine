web: bash -lc 'python3 -m pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m uvicorn app.main:app --host 0.0.0.0 --port $PORT'
worker: bash -lc 'python3 -m pip install -r backend/requirements.txt && PYTHONPATH=backend python3 -m app.workers.autopilot_worker'
