"""Download audio from a YouTube (or any yt-dlp-supported) URL.

Reconciled from the near-identical downloaders in the coach engine
(apps/coach/backend/app/services/downloader.py) and the piano service
(piano/backend/app/services/downloader.py). Both shelled out to yt-dlp,
extracted to WAV, resolved the ffmpeg location the same way, and scraped
``[download] NN%`` lines for progress — this is the single merged version.

yt-dlp is invoked as an external process (async subprocess), so importing this
module never requires yt-dlp or ffmpeg to be installed.
"""

from __future__ import annotations

import asyncio
import inspect
import importlib.util
import json
import logging
import re
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("stemcore.ingest.youtube")

_PROGRESS_RE = re.compile(r"\[download\]\s+([\d.]+)%")


@dataclass
class DownloadResult:
    """Outcome of a download: the audio file plus whatever metadata yt-dlp gave."""
    audio_path: Path
    title: str | None
    duration: float | None


async def _emit(on_progress, value: float) -> None:
    """Call the progress callback, awaiting it if it is a coroutine."""
    if on_progress is None:
        return
    res = on_progress(value)
    if inspect.isawaitable(res):
        await res


async def download_audio(url: str, dest_dir: str | Path, on_progress=None) -> DownloadResult:
    """Download ``url`` as a WAV into ``dest_dir``.

    Returns a :class:`DownloadResult` of (audio_path, title, duration).
    ``on_progress`` (optional) is called with a 0..100 percentage as the
    download proceeds; it may be a plain function or a coroutine function.
    """
    output_dir = Path(dest_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "audio.%(ext)s")

    # Use this application's dependency, not an unrelated (possibly stale)
    # Homebrew executable. Keep the CLI fallback for lightweight core installs.
    ytdlp = ([sys.executable, "-m", "yt_dlp"] if importlib.util.find_spec("yt_dlp")
             else [shutil.which("yt-dlp") or "/opt/homebrew/bin/yt-dlp"])
    ffmpeg_dir = shutil.which("ffmpeg")
    ffmpeg_location = str(Path(ffmpeg_dir).parent) if ffmpeg_dir else "/opt/homebrew/bin"

    log.info("yt-dlp: %s, ffmpeg dir: %s", ytdlp, ffmpeg_location)

    # Metadata first (title / duration). --no-playlist is critical: without it a
    # radio/playlist URL (…&list=RD…&start_radio=1) makes --dump-json try to
    # enumerate the whole (effectively infinite) queue and hang.
    meta_proc = await asyncio.create_subprocess_exec(
        *ytdlp, "--dump-json", "--no-download", "--no-playlist", url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await meta_proc.communicate()
    title = None
    duration = None
    if stdout:
        try:
            meta = json.loads(stdout)
            title = meta.get("title")
            duration = meta.get("duration")
        except json.JSONDecodeError:
            pass
    if meta_proc.returncode != 0:
        log.warning("metadata fetch failed: %s", stderr.decode(errors="replace")[:200])

    # Download + extract to WAV.
    proc = await asyncio.create_subprocess_exec(
        *ytdlp,
        "-x", "--audio-format", "wav",
        "--no-playlist",                     # a single video, never a whole radio/playlist
        "--ffmpeg-location", ffmpeg_location,
        "--newline",
        "-o", output_template,
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    output_lines: list[str] = []
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", errors="replace").strip()
        output_lines.append(text)
        match = _PROGRESS_RE.search(text)
        if match:
            await _emit(on_progress, float(match.group(1)))

    await proc.wait()
    if proc.returncode != 0:
        tail = "\n".join(output_lines[-10:])
        log.error("yt-dlp failed (exit %s):\n%s", proc.returncode, tail)
        raise RuntimeError(
            f"yt-dlp failed (exit {proc.returncode}): "
            f"{output_lines[-1] if output_lines else 'no output'}"
        )

    # Locate the output file. yt-dlp should have written audio.wav; fall back to
    # any wav, then any file, in the output directory.
    output_path = output_dir / "audio.wav"
    if not output_path.exists():
        wav_files = list(output_dir.glob("*.wav"))
        if wav_files:
            output_path = wav_files[0]
        else:
            all_files = [f for f in output_dir.iterdir() if f.is_file()]
            if not all_files:
                raise RuntimeError("No audio file found after download")
            output_path = all_files[0]

    log.info(
        "downloaded: %s (%.1fMB)",
        output_path, output_path.stat().st_size / 1024 / 1024,
    )
    return DownloadResult(audio_path=output_path, title=title, duration=duration)
