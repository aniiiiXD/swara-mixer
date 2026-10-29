"""
storage.py — per-job on-disk layout (consolidated from coach + piano).

One place that knows the `<kind>/<job_id>/...` convention both apps re-declared.
"""

import json
import os
from pathlib import Path
from typing import Any

from . import config

_BASE = {
    "downloads": lambda: config.DOWNLOADS_DIR,
    "stems": lambda: config.STEMS_DIR,
    "midi": lambda: config.MIDI_DIR,
    "exports": lambda: config.EXPORTS_DIR,
}


def job_dir(kind: str, job_id: str) -> Path:
    """Return (creating if needed) the directory for one job's artifacts of a
    given kind, e.g. job_dir("stems", "2abd92cf")."""
    if kind not in _BASE:
        raise ValueError(f"unknown storage kind {kind!r}; expected one of {list(_BASE)}")
    d = _BASE[kind]() / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


class JsonArtifactStore:
    """Durable, atomic JSON sidecars for app-level job artifacts.

    Audio data remains in the deployment's filesystem or object store. This
    class owns compact metadata such as source details and cached analysis so
    multiple product surfaces can address the same prepared track.
    """

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, job_id: str, name: str) -> Path:
        safe_name = name.replace("/", "_").replace("\\", "_")
        return self.root / f"{job_id}.{safe_name}.json"

    def read(self, job_id: str, name: str, default: Any = None) -> Any:
        path = self.path(job_id, name)
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return default

    def write(self, job_id: str, name: str, value: Any) -> Path:
        path = self.path(job_id, name)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(value))
        os.replace(temporary, path)
        return path
