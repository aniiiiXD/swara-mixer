#!/bin/bash
set -e

echo "=== Tonic Setup (one API + one web app) ==="

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Check for Homebrew
if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install system dependencies
echo "Installing system dependencies..."
brew install python@3.11 ffmpeg yt-dlp 2>/dev/null || true

# Get python3.11 path
PYTHON=$(brew --prefix python@3.11)/bin/python3.11
if [ ! -f "$PYTHON" ]; then
    PYTHON=$(brew --prefix)/bin/python3.11
fi
if [ ! -f "$PYTHON" ]; then
    echo "ERROR: python3.11 not found after brew install"
    exit 1
fi
echo "Using Python: $($PYTHON --version)"

# ── Tonic API venv (analysis + separation, one process) ─────────────
echo "Setting up Tonic API venv..."
cd "$ROOT/apps/coach/backend"
$PYTHON -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
echo "Checking MPS (Metal) support..."
.venv/bin/python -c "import torch; print('MPS available:', torch.backends.mps.is_available())" || echo "MPS check failed"

# ── Tonic frontend (one app: coach + studio) ────────────────────────
echo "Setting up Tonic frontend..."
cd "$ROOT/apps/coach/frontend" && npm install

echo ""
echo "=== Setup Complete ==="
echo "Run ./scripts/dev.sh (or 'make dev') to start Tonic."
