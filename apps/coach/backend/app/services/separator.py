"""Coach adapter for the shared stemcore Demucs runner."""

from pathlib import Path

from app.config import DEMUCS_MODEL, STEMS_DIR
from stemcore.stems.demucs import separate


async def separate_stems(audio_path: Path, job_id: str, on_progress=None) -> dict[str, Path]:
    return await separate(audio_path, STEMS_DIR / job_id, model=DEMUCS_MODEL, on_progress=on_progress)
