"""
config.py — env-driven paths and defaults (consolidated from coach + piano config.py).

All output lives under one data root (default ~/.stemcore, override with
STEMCORE_DATA). Soundfonts/models are assets referenced by path, never vendored
into the package.
"""

import os
from pathlib import Path

DATA_ROOT = Path(os.environ.get("STEMCORE_DATA", Path.home() / ".stemcore"))

DOWNLOADS_DIR = DATA_ROOT / "downloads"
STEMS_DIR = DATA_ROOT / "stems"
MIDI_DIR = DATA_ROOT / "midi"
EXPORTS_DIR = DATA_ROOT / "exports"

DEMUCS_MODEL = os.environ.get("STEMCORE_DEMUCS_MODEL", "htdemucs")

# Optional asset paths (set via env or pass explicitly to render functions).
SOUNDFONT = os.environ.get("STEMCORE_SOUNDFONT", "")


def ensure_dirs():
    for d in (DOWNLOADS_DIR, STEMS_DIR, MIDI_DIR, EXPORTS_DIR):
        d.mkdir(parents=True, exist_ok=True)
