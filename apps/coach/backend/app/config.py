"""Tonic config — one backend: pYIN/scoring + song library + the Demucs/yt-dlp engine."""

import os
from pathlib import Path

# apps/coach/backend/app/config.py -> parents[4] = monorepo root (shared storage/)
BASE_DIR = Path(os.environ.get("STEM_STUDIO_ROOT", str(Path(__file__).resolve().parents[4])))
STEM_STUDIO_ROOT = BASE_DIR

STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(BASE_DIR / "storage")))
DOWNLOADS_DIR = STORAGE_DIR / "downloads"
STEMS_DIR = STORAGE_DIR / "stems"
EXPORTS_DIR = STORAGE_DIR / "exports"
for d in (DOWNLOADS_DIR, STEMS_DIR, EXPORTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Defaults next to the source, but must be overridable: inside the packaged Mac
# app the source tree lives in a code-signed bundle, so caches have to be written
# to the user's Application Support directory instead.
KARAOKE_CACHE = Path(os.environ.get("KARAOKE_CACHE", str(Path(__file__).resolve().parents[1] / ".karaoke_cache")))
KARAOKE_CACHE.mkdir(parents=True, exist_ok=True)
JOB_DATABASE = Path(os.environ.get("JOB_DATABASE", str(STORAGE_DIR / "jobs.sqlite3")))

DEMUCS_MODEL = "htdemucs"
STEM_NAMES = ["vocals", "drums", "bass", "other"]
KARAOKE_STEMS = ["drums", "bass", "other"]  # everything but vocals

# The song-library endpoints reuse the in-process /api job + search routes over
# HTTP (a self-call) — points at this same single server.
STEM_API = os.environ.get("STEM_API", "http://127.0.0.1:8008")

# Comma-separated browser origins for the hosted Tonic frontend. Local Next
# development remains enabled by the regex in main.py; production must opt in
# explicitly rather than reflecting arbitrary origins.
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
