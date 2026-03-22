#!/bin/bash
set -e

echo "=== Stem Studio Setup ==="

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
    # Try alternate path
    PYTHON=$(brew --prefix)/bin/python3.11
fi

if [ ! -f "$PYTHON" ]; then
    echo "ERROR: python3.11 not found after brew install"
    exit 1
fi

echo "Using Python: $($PYTHON --version)"

# Setup Python venv
echo "Setting up Python virtual environment..."
cd "$(dirname "$0")/../backend"
$PYTHON -m venv .venv
source .venv/bin/activate

echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Verify MPS
echo "Checking MPS (Metal) support..."
python -c "import torch; print('MPS available:', torch.backends.mps.is_available())" || echo "MPS check failed"

deactivate

# Setup frontend
echo "Setting up frontend..."
cd "$(dirname "$0")/../frontend"
bun install

echo ""
echo "=== Setup Complete ==="
echo "Run ./scripts/dev.sh to start the development servers"
