import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(BASE_DIR / "storage")))
DOWNLOADS_DIR = STORAGE_DIR / "downloads"
STEMS_DIR = STORAGE_DIR / "stems"
EXPORTS_DIR = STORAGE_DIR / "exports"

# Ensure directories exist
for d in [DOWNLOADS_DIR, STEMS_DIR, EXPORTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

DEMUCS_MODEL = "htdemucs"
STEM_NAMES = ["vocals", "drums", "bass", "other"]

# CORS origins (comma-separated)
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
