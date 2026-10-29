"""Piano adapters for shared stemcore Demucs and recombination primitives."""

from pathlib import Path

from app.config import DEMUCS_MODEL, STEMS_DIR
from stemcore.stems.demucs import clean_mix as _clean_mix
from stemcore.stems.demucs import separate as _separate


async def separate(audio_path: Path, job_id: str, on_progress=None) -> dict[str, Path]:
    return await _separate(audio_path, STEMS_DIR / job_id, model=DEMUCS_MODEL, on_progress=on_progress)


async def clean_mix(audio_path: Path, job_id: str, keep: list[str], on_progress=None) -> Path:
    return await _clean_mix(audio_path, STEMS_DIR / job_id, keep, model=DEMUCS_MODEL, on_progress=on_progress)
