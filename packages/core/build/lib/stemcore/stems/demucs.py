"""Demucs stem separation (+ optional selective recombination).

Reconciled from the two near-identical separators in the coach engine
(apps/coach/backend/app/services/separator.py) and the piano service
(piano/backend/app/services/separator.py). Both ran ``python -m demucs`` as a
subprocess with the MPS high-watermark env var, scraped tqdm's ``NN%|`` output
(which uses carriage returns, not newlines) for progress, and located stems
under ``<out_dir>/<model>/<track>/<stem>.wav``. The piano side additionally had
a recombine / ``clean.wav`` helper — carried over here as ``recombine`` and
``clean_mix``.

Demucs (and torch) are invoked as an external process, so importing this module
never requires them. ``recombine`` needs numpy + soundfile, imported lazily.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
import re
import sys
from pathlib import Path

log = logging.getLogger("stemcore.stems.demucs")

DEFAULT_STEMS = ["vocals", "drums", "bass", "other"]
_PROGRESS_RE = re.compile(r"(\d+)%\|")


async def _emit(on_progress, value: float) -> None:
    """Call the progress callback, awaiting it if it is a coroutine."""
    if on_progress is None:
        return
    res = on_progress(value)
    if inspect.isawaitable(res):
        await res


async def separate(
    audio_path: str | Path,
    out_dir: str | Path,
    model: str = "htdemucs",
    stems: list[str] | None = None,
    on_progress=None,
    python_bin: str | None = None,
    two_stems: str | None = None,
) -> dict[str, Path]:
    """Run Demucs over ``audio_path`` and return ``{stem_name: wav_path}``.

    ``stems`` selects which stem names to return (default vocals/drums/bass/
    other). ``on_progress`` (optional) receives a 0..100 percentage scraped from
    Demucs' tqdm bar; it may be a plain or coroutine function.

    ``python_bin`` picks the interpreter that has Demucs installed (defaults to
    this process's, or the ``STEMCORE_DEMUCS_PYTHON`` env var) — so a caller in a
    torch-less venv can delegate separation to one that has it. ``two_stems``
    (e.g. ``"vocals"``) runs the faster vocals/no-vocals split.
    """
    audio_path = Path(audio_path)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stems = stems or (["vocals", "no_vocals"] if two_stems else DEFAULT_STEMS)

    env = os.environ.copy()
    env["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.0"

    interpreter = python_bin or os.environ.get("STEMCORE_DEMUCS_PYTHON") or sys.executable
    cmd = [interpreter, "-m", "demucs", "-n", model, "-o", str(out_dir)]
    if two_stems:
        cmd += ["--two-stems", two_stems]
    cmd += [str(audio_path)]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=env,
    )

    # tqdm writes progress using \r (carriage return), not \n. Read raw bytes
    # and split on both \r and \n to catch each progress update.
    buf = b""
    last_pct = -1
    while True:
        chunk = await proc.stdout.read(256)
        if not chunk:
            break
        buf += chunk
        while b"\r" in buf or b"\n" in buf:
            r_idx = buf.find(b"\r")
            n_idx = buf.find(b"\n")
            idx = min(i for i in (r_idx, n_idx) if i != -1)
            line = buf[:idx].decode("utf-8", errors="replace").strip()
            buf = buf[idx + 1:]
            match = _PROGRESS_RE.search(line)
            if match:
                pct = int(match.group(1))
                if pct != last_pct:
                    last_pct = pct
                    await _emit(on_progress, float(pct))

    await proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"Demucs failed (exit {proc.returncode})")

    # Demucs outputs to: <out_dir>/<model>/<track>/<stem>.wav
    model_dir = out_dir / model
    if not model_dir.exists():
        raise RuntimeError(f"Demucs output directory not found: {model_dir}")

    track_dirs = [d for d in model_dir.iterdir() if d.is_dir()]
    if not track_dirs:
        raise RuntimeError("No Demucs track directory found")
    track_dir = track_dirs[0]

    found: dict[str, Path] = {}
    for name in stems:
        for ext in (".wav", ".mp3", ".flac"):
            candidate = track_dir / f"{name}{ext}"
            if candidate.exists():
                found[name] = candidate
                break

    if not found:
        raise RuntimeError(f"No stem files found in {track_dir}")
    return found


def recombine(stems: dict[str, Path], keep: list[str], out_path: str | Path) -> Path:
    """Sum the chosen stems sample-for-sample into one WAV at ``out_path``."""
    import numpy as np  # noqa: F401  (kept for clarity / future use)
    import soundfile as sf

    out_path = Path(out_path)
    mix = None
    sr = None
    for name in keep:
        p = stems.get(name)
        if not p or not Path(p).exists():
            continue
        data, sr = sf.read(str(p))
        mix = data if mix is None else mix + data
    if mix is None:
        raise RuntimeError("No stems to recombine")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), mix, sr)
    return out_path


async def clean_mix(
    audio_path: str | Path,
    out_dir: str | Path,
    keep: list[str],
    model: str = "htdemucs",
    on_progress=None,
) -> Path:
    """Separate ``audio_path``, then recombine only the ``keep`` stems.

    Produces ``<out_dir>/clean.wav`` — a de-mudded mix that drops unwanted stems
    (e.g. keep only ``["vocals", "other"]`` to strip bass + drums before piano
    transcription).
    """
    out_dir = Path(out_dir)
    stems = await separate(audio_path, out_dir, model=model, on_progress=on_progress)
    out = out_dir / "clean.wav"
    path = recombine(stems, keep, out)
    log.info("cleaned mix (kept %s) -> %s", "+".join(keep), path)
    return path
