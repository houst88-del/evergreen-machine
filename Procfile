web: bash -lc 'python -m pip install -r backend/requirements.txt && PYTHONPATH=backend python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT'
worker: bash -lc 'python -m pip install -r backend/requirements.txt && PYTHONPATH=backend python -m app.workers.autopilot_worker'
