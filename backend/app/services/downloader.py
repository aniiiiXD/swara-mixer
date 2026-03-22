import asyncio
import json
import logging
import re
import shutil
from pathlib import Path

from app.config import DOWNLOADS_DIR

log = logging.getLogger("swara-mixer")


async def download_audio(url: str, job_id: str, on_progress=None) -> tuple[Path, str | None, float | None]:
    """Download audio from YouTube URL using yt-dlp.

    Returns (audio_path, title, duration).
    """
    output_dir = DOWNLOADS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "audio.%(ext)s")

    # Find yt-dlp binary — check brew path explicitly
    ytdlp = shutil.which("yt-dlp") or "/opt/homebrew/bin/yt-dlp"
    ffmpeg_dir = shutil.which("ffmpeg")
    ffmpeg_location = str(Path(ffmpeg_dir).parent) if ffmpeg_dir else "/opt/homebrew/bin"

    log.info(f"[{job_id}] Using yt-dlp: {ytdlp}, ffmpeg dir: {ffmpeg_location}")

    # First get metadata
    meta_proc = await asyncio.create_subprocess_exec(
        ytdlp, "--dump-json", "--no-download", url,
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
        log.warning(f"[{job_id}] yt-dlp metadata fetch failed: {stderr.decode(errors='replace')[:200]}")

    # Download audio
    proc = await asyncio.create_subprocess_exec(
        ytdlp,
        "-x", "--audio-format", "wav",
        "--ffmpeg-location", ffmpeg_location,
        "--newline",
        "-o", output_template,
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    output_lines = []
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        text = line.decode("utf-8", errors="replace").strip()
        output_lines.append(text)
        match = re.search(r"\[download\]\s+([\d.]+)%", text)
        if match and on_progress:
            await on_progress(float(match.group(1)))

    await proc.wait()
    if proc.returncode != 0:
        # Log last few lines for debugging
        tail = "\n".join(output_lines[-10:])
        log.error(f"[{job_id}] yt-dlp failed (exit {proc.returncode}):\n{tail}")
        raise RuntimeError(f"yt-dlp failed with exit code {proc.returncode}: {output_lines[-1] if output_lines else 'no output'}")

    # Find the output file
    output_path = output_dir / "audio.wav"
    if not output_path.exists():
        wav_files = list(output_dir.glob("*.wav"))
        if wav_files:
            output_path = wav_files[0]
        else:
            all_files = [f for f in output_dir.iterdir() if f.is_file()]
            if all_files:
                output_path = all_files[0]
            else:
                raise RuntimeError("No audio file found after download")

    log.info(f"[{job_id}] Download saved: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f}MB)")
    return output_path, title, duration
