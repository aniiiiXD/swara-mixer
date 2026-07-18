"""
paths.py — single source of truth for where assets and output live, so no module
has to guess paths relative to its own file.
"""

import os
from pathlib import Path

_PKG = Path(__file__).resolve().parent      # .../harmonica (the package)
ROOT = _PKG.parent                          # project root

ASSETS = ROOT / "assets"
SOUNDFONT = str(ASSETS / "soundfonts" / "FluidR3_GM.sf2")
HAND_MODEL = str(ASSETS / "models" / "hand_landmarker.task")
REC_DIR = str(ROOT / "recordings")


def ensure_recordings():
    os.makedirs(REC_DIR, exist_ok=True)
    return REC_DIR
