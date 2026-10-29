#!/usr/bin/env bash
# Launch Pitch Studio (FastAPI over stemcore) on :8010
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$HERE/backend"
exec "$ROOT/packages/core/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8010
