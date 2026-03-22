import asyncio
import os
import re
from pathlib import Path

from app.config import STEMS_DIR, DEMUCS_MODEL, STEM_NAMES


async def separate_stems(audio_path: Path, job_id: str, on_progress=None) -> dict[str, Path]:
    """Run Demucs to separate audio into stems.

    Returns dict mapping stem name to file path.
    """
    output_dir = STEMS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.0"

    proc = await asyncio.create_subprocess_exec(
        "python", "-m", "demucs",
        "-n", DEMUCS_MODEL,
        "-o", str(output_dir),
        str(audio_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=env,
    )

    # tqdm writes progress using \r (carriage return), not \n.
    # We read raw bytes and split on both \r and \n to catch progress updates.
    buf = b""
    last_pct = -1
    while True:
        chunk = await proc.stdout.read(256)
        if not chunk:
            break
        buf += chunk
        # Split on \r or \n
        while b"\r" in buf or b"\n" in buf:
            # Find the earliest delimiter
            r_idx = buf.find(b"\r")
            n_idx = buf.find(b"\n")
            if r_idx == -1:
                idx = n_idx
            elif n_idx == -1:
                idx = r_idx
            else:
                idx = min(r_idx, n_idx)
            line = buf[:idx].decode("utf-8", errors="replace").strip()
            buf = buf[idx + 1:]
            match = re.search(r"(\d+)%\|", line)
            if match and on_progress:
                pct = int(match.group(1))
                if pct != last_pct:
                    last_pct = pct
                    await on_progress(float(pct))

    await proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"Demucs failed with exit code {proc.returncode}")

    # Find stem files - Demucs outputs to: output_dir/htdemucs/<filename>/stem.wav
    model_dir = output_dir / DEMUCS_MODEL
    if not model_dir.exists():
        raise RuntimeError(f"Demucs output directory not found: {model_dir}")

    # Find the track directory (named after input file without extension)
    track_dirs = [d for d in model_dir.iterdir() if d.is_dir()]
    if not track_dirs:
        raise RuntimeError("No track directory found in Demucs output")

    track_dir = track_dirs[0]

    stems = {}
    for stem_name in STEM_NAMES:
        stem_path = track_dir / f"{stem_name}.wav"
        if stem_path.exists():
            stems[stem_name] = stem_path
        else:
            # Also check for .mp3 or other formats
            for ext in [".wav", ".mp3", ".flac"]:
                alt = track_dir / f"{stem_name}{ext}"
                if alt.exists():
                    stems[stem_name] = alt
                    break

    if not stems:
        raise RuntimeError(f"No stem files found in {track_dir}")

    return stems
