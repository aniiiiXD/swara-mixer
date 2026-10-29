#!/usr/bin/env bash
# Tonic — a studio to learn singing. ONE API + ONE web app (two processes total).
#
#   apps/coach/backend  — Tonic API (:8008): pYIN analysis + scoring + song APIs.
#   apps/coach/backend worker — claims queued download/Demucs work from SQLite.
#   apps/coach/frontend — the Tonic UI (singing coach + studio), one Next.js app.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

API_PORT=8008   # the single Tonic API
WEB_PORT=3001   # Tonic frontend (3000 is taken by another project)

cleanup() { echo; echo "Shutting down..."; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "→ tonic api   http://localhost:$API_PORT  (analysis + song APIs)"
( cd "$ROOT/apps/coach/backend" \
  && PYTHONPATH="$ROOT/packages/core${PYTHONPATH:+:$PYTHONPATH}" PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 \
     .venv/bin/python -m uvicorn app.main:app --reload --port "$API_PORT" ) &

echo "→ tonic worker (download + separation queue)"
( cd "$ROOT/apps/coach/backend" && PYTHONPATH="$ROOT/packages/core${PYTHONPATH:+:$PYTHONPATH}" .venv/bin/python -m app.worker ) &

echo "→ tonic web   http://localhost:$WEB_PORT  (Tonic)"
( cd "$ROOT/apps/coach/frontend" \
  && NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" \
     npm run dev -- --port "$WEB_PORT" ) &

echo
echo "=== Tonic running ==="
echo "  App:  http://localhost:$WEB_PORT"
echo "  API:  http://localhost:$API_PORT   (queue-backed)"
echo "  Ctrl+C stops everything."
echo

wait
