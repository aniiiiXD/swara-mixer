#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start FastAPI backend
echo "Starting FastAPI backend on port 8000..."
cd "$DIR/backend"
source .venv/bin/activate
PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 uvicorn app.main:app --reload --port 8000 &
BACKEND_PID=$!

# Start Next.js frontend
echo "Starting Next.js frontend on port 3000..."
cd "$DIR/frontend"
bun dev --port 3000 &
FRONTEND_PID=$!

echo ""
echo "=== Stem Studio Running ==="
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""

wait
