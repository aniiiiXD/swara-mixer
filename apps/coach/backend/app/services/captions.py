import asyncio
import logging
import re
import shutil
from pathlib import Path

from app.config import DOWNLOADS_DIR

log = logging.getLogger("karaoke-maker")


async def fetch_captions(url: str, job_id: str) -> list[dict] | None:
    """Download subtitles for the given URL via yt-dlp.

    Returns a list of {start, end, text} cues, or None if unavailable.
    """
    output_dir = DOWNLOADS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(output_dir / "captions")

    ytdlp = shutil.which("yt-dlp") or "/opt/homebrew/bin/yt-dlp"

    proc = await asyncio.create_subprocess_exec(
        ytdlp,
        "--write-subs", "--write-auto-subs",
        "--sub-langs", "en.*",
        "--sub-format", "vtt",
        "--skip-download",
        "-o", output_template,
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    await proc.communicate()

    vtt_files = sorted(output_dir.glob("captions*.vtt"))
    if not vtt_files:
        log.info(f"[{job_id}] No captions found for {url}")
        return None

    cues = _parse_vtt(vtt_files[0])
    log.info(f"[{job_id}] Parsed {len(cues)} caption cues from {vtt_files[0].name}")
    return cues


def _parse_vtt(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8", errors="replace")
    cues = []
    seen_texts: set[str] = set()

    # Match cue blocks: timestamp line followed by text lines
    pattern = re.compile(
        r"(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)[^\n]*\n((?:.+\n?)+?)(?=\n\n|\Z)",
        re.MULTILINE,
    )
    for m in pattern.finditer(text):
        start = _vtt_to_seconds(m.group(1))
        end = _vtt_to_seconds(m.group(2))
        raw = m.group(3).strip()
        # Strip inline VTT tags (<c>, timestamps, etc.)
        clean = re.sub(r"<[^>]+>", "", raw).strip()
        # Deduplicate consecutive identical lines (auto-captions repeat a lot)
        if clean and clean not in seen_texts:
            seen_texts.add(clean)
            cues.append({"start": start, "end": end, "text": clean})
        elif clean and cues and cues[-1]["text"] != clean:
            seen_texts.add(clean)
            cues.append({"start": start, "end": end, "text": clean})

    return cues


def _vtt_to_seconds(t: str) -> float:
    parts = t.split(":")
    h, m, s = int(parts[0]), int(parts[1]), float(parts[2])
    return h * 3600 + m * 60 + s
