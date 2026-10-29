"""Bridge to the shared stem-studio output: list separated songs, extract the
reference vocal melody, and build a vocals-muted karaoke mix."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import soundfile as sf

from app.config import STEMS_DIR, DEMUCS_MODEL, STEM_NAMES, KARAOKE_STEMS, KARAOKE_CACHE
from app.services import pitch
from stemcore.storage import JsonArtifactStore

# CREPE consumes mono 16 kHz audio and returns one raw estimate every 10 ms.
REF_SR = 16000
REF_HOP = 160
REFERENCE_ARTIFACT = "reference-raw-v1"
artifacts = JsonArtifactStore(KARAOKE_CACHE)


def _track_dir(job_id: str) -> Path:
    model_dir = STEMS_DIR / job_id / DEMUCS_MODEL
    if not model_dir.exists():
        raise FileNotFoundError(f"no stems for job {job_id}")
    subdirs = [d for d in model_dir.iterdir() if d.is_dir()]
    if not subdirs:
        raise FileNotFoundError(f"no track dir for job {job_id}")
    return subdirs[0]


def _stem_path(job_id: str, stem: str) -> Path | None:
    track = _track_dir(job_id)
    for ext in (".wav", ".flac", ".mp3"):
        p = track / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def get_meta(job_id: str) -> dict:
    value = artifacts.read(job_id, "meta")
    if value is not None:
        return value
    # One-time read compatibility for caches created before JsonArtifactStore.
    legacy = KARAOKE_CACHE / f"{job_id}.meta.json"
    if legacy.exists():
        try:
            return json.loads(legacy.read_text())
        except json.JSONDecodeError:
            pass
    return {}


def save_meta(job_id: str, meta: dict) -> dict:
    """Merge non-empty fields into the song's metadata sidecar."""
    current = get_meta(job_id)
    for k, v in meta.items():
        if v is not None and v != "":
            current[k] = v
    artifacts.write(job_id, "meta", current)
    return current


def _song_entry(job_id: str) -> dict:
    meta = get_meta(job_id)
    return {
        "jobId": job_id,
        "title": meta.get("title") or "Untitled song",
        "artist": meta.get("artist", ""),
        "duration": meta.get("duration"),
        "thumbnail": meta.get("thumbnail", ""),
        "named": bool(meta.get("title")),
    }


def list_songs() -> list[dict]:
    """All jobs on disk that have a separated vocals stem."""
    if not STEMS_DIR.exists():
        return []
    out: list[dict] = []
    for job_dir in sorted(STEMS_DIR.iterdir()):
        if not job_dir.is_dir():
            continue
        try:
            v = _stem_path(job_dir.name, "vocals")
        except FileNotFoundError:
            continue
        if v:
            out.append(_song_entry(job_dir.name))
    return out


@lru_cache(maxsize=32)
def reference(job_id: str) -> dict:
    """Independent pitch estimates from the unfiltered isolated vocal stem.

    A separate cache version prevents reusing previously smoothed references.
    """
    cached = artifacts.read(job_id, REFERENCE_ARTIFACT)
    if cached is not None:
        return cached
    v = _stem_path(job_id, "vocals")
    if v is None:
        raise FileNotFoundError(f"no vocals stem for job {job_id}")
    result = pitch.analyze(v.read_bytes(), target_sr=REF_SR, hop=REF_HOP, raw=True)
    artifacts.write(job_id, REFERENCE_ARTIFACT, result)
    return result


def build_mix(job_id: str, include_vocals: bool) -> Path:
    """Sum stems into a single WAV (cached).

    include_vocals=False -> karaoke (instrumental, for Karaoke mode).
    include_vocals=True  -> full song with original vocals (for Learning mode).
    """
    out = KARAOKE_CACHE / (f"{job_id}_full.wav" if include_vocals else f"{job_id}.wav")
    if out.exists():
        return out

    stems = STEM_NAMES if include_vocals else KARAOKE_STEMS
    mixed: np.ndarray | None = None
    sr = None
    for stem in stems:
        p = _stem_path(job_id, stem)
        if p is None:
            continue
        data, sr = sf.read(str(p), dtype="float32")
        if data.ndim == 1:
            data = np.column_stack([data, data])
        if mixed is None:
            mixed = np.zeros_like(data)
        n = min(len(mixed), len(data))
        if len(data) > len(mixed):
            mixed = np.pad(mixed, ((0, len(data) - len(mixed)), (0, 0)))
        mixed[:n] += data[:n]

    if mixed is None or sr is None:
        raise FileNotFoundError(f"no stems for job {job_id}")
    sf.write(str(out), np.clip(mixed, -1.0, 1.0), sr)
    return out
