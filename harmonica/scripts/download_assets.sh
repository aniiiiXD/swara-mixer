#!/usr/bin/env bash
# Download the large binary assets that aren't checked into git:
#   - FluidR3_GM soundfont (~148 MB) — the harmonica sound
#   - MediaPipe hand landmarker model (~7.8 MB) — for gesture control
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$here/assets/soundfonts" "$here/assets/models"

sf="$here/assets/soundfonts/FluidR3_GM.sf2"
model="$here/assets/models/hand_landmarker.task"

if [ ! -f "$sf" ]; then
  echo "Downloading FluidR3_GM soundfont (~148 MB)..."
  curl -fSL -o "$sf" \
    "https://github.com/Jacalz/fluid-soundfont/raw/master/original-files/FluidR3_GM.sf2"
else
  echo "Soundfont already present."
fi

if [ ! -f "$model" ]; then
  echo "Downloading MediaPipe hand landmarker model..."
  curl -fSL -o "$model" \
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task"
else
  echo "Hand model already present."
fi

echo "Assets ready in $here/assets"
