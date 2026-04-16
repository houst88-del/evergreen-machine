#!/bin/zsh
set -e

ROOT="$HOME/Downloads/evergreen_scaffold"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

if [ -f "$BACKEND/.env" ]; then
  set -a
  source "$BACKEND/.env"
  set +a
fi

osascript <<OSA
tell application "Terminal"
  do script "cd '$BACKEND'; source .venv/bin/activate; python3 -m uvicorn app.main:app --reload --port 8000"
  do script "cd '$BACKEND'; source .venv/bin/activate; while true; do python3 -m app.workers.autopilot_worker; echo '[evergreen] worker exited, restarting in 2s...'; sleep 2; done"
  do script "cd '$FRONTEND'; rm -rf .next; npm run dev"
  activate
end tell
OSA

echo "Evergreen launch commands sent."
echo "Dashboard: http://127.0.0.1:3000/dashboard"
