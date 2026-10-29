"""Coach adapter for the shared stemcore YouTube downloader."""

from pathlib import Path

from app.config import DOWNLOADS_DIR
from stemcore.ingest.youtube import download_audio as _download_audio


async def download_audio(url: str, job_id: str, on_progress=None) -> tuple[Path, str | None, float | None]:
    result = await _download_audio(url, DOWNLOADS_DIR / job_id, on_progress)
    return result.audio_path, result.title, result.duration
