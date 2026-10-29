"""Render a MIDI file to real piano audio with fluidsynth + a soundfont.

The transcription is a .mid; to actually *hear* the cover you need a piano voice.
fluidsynth + a General-MIDI soundfont (program 0 = grand piano) does that. If
fluidsynth or the soundfont is missing we fall back to pretty_midi's built-in
sine synth — thin and buzzy, but it keeps the pipeline producing audio.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path

from app.config import FLUIDSYNTH_BIN, SOUNDFONT, RENDER_SR, MIDI_DIR

log = logging.getLogger("piano")


async def render_audio(midi_path: Path, job_id: str) -> Path:
    """MIDI → piano.wav. Returns the wav path (fluidsynth, or sine fallback)."""
    out = MIDI_DIR / job_id / "piano.wav"
    out.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which(FLUIDSYNTH_BIN) and SOUNDFONT.exists():
        proc = await asyncio.create_subprocess_exec(
            FLUIDSYNTH_BIN, "-ni", "-F", str(out), "-r", str(RENDER_SR), "-g", "0.9",
            str(SOUNDFONT), str(midi_path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        await proc.communicate()
        if proc.returncode == 0 and out.exists():
            log.info(f"[{job_id}] rendered piano audio -> {out}")
            return out
        log.warning(f"[{job_id}] fluidsynth failed (exit {proc.returncode}); sine fallback")
    else:
        log.warning(f"[{job_id}] fluidsynth/soundfont unavailable ({SOUNDFONT}); sine fallback")

    return await asyncio.to_thread(_sine_render, midi_path, out)


def _sine_render(midi_path: Path, out: Path) -> Path:
    import numpy as np
    import pretty_midi
    import soundfile as sf

    pm = pretty_midi.PrettyMIDI(str(midi_path))
    audio = pm.synthesize(fs=RENDER_SR)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = 0.9 * audio / peak
    sf.write(str(out), audio.astype("float32"), RENDER_SR)
    return out
