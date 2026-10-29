#!/bin/zsh
set -eu
STUDIO_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
STUDIO_PYTHON="${STUDIO_PYTHON:-$STUDIO_DIR/../coach/backend/.venv/bin/python}"
if [[ ! -x "$STUDIO_PYTHON" ]]; then
  print -u2 "Set STUDIO_PYTHON to the Python interpreter with the coach backend dependencies installed."
  exit 1
fi
cd "$STUDIO_DIR/frontend"
[[ -d node_modules ]] || npm ci
npm run build
cd "$STUDIO_DIR/backend"
"$STUDIO_PYTHON" -m uvicorn studio_api:app --host 127.0.0.1 --port 8010 &
STUDIO_API_PID=$!
cd "$STUDIO_DIR/frontend"
"$STUDIO_PYTHON" -m http.server 3010 --bind 127.0.0.1 --directory "$STUDIO_DIR/frontend/out" &
STUDIO_WEB_PID=$!
trap 'kill "$STUDIO_API_PID" "$STUDIO_WEB_PID" 2>/dev/null || true' EXIT INT TERM
print "Tonic Studio: http://localhost:3010"
wait
