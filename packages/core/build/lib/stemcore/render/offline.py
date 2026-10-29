"""Render notes/MIDI to real piano audio with fluidsynth + a soundfont.

Extracted from the piano app (`services/renderer.py`). To actually *hear* a
transcription you need a piano voice: fluidsynth + a General-MIDI soundfont
(program 0 = grand piano) does that. If fluidsynth or the soundfont is missing
we fall back to pretty_midi's built-in sine synth — thin and buzzy, but it keeps
the pipeline producing audio.

Unlike the app original this is a plain synchronous function (no asyncio / job
plumbing) and accepts either a list of ``NoteEvent`` (converted to MIDI in
memory via pretty_midi) or an existing ``.mid`` path.

Heavy deps (pretty_midi, numpy, soundfile) are imported lazily; fluidsynth is an
external binary invoked via subprocess.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..model import NoteEvent
from ..instruments.piano import GM_PROGRAM

log = logging.getLogger("stemcore")


def render_to_wav(
    notes: "list[NoteEvent] | str | Path",
    out_wav: str | Path,
    soundfont: str | Path,
    program: int = GM_PROGRAM,
    render_sr: int = 44100,
    fluidsynth_bin: str = "fluidsynth",
) -> Path:
    """Render notes (or a MIDI file) to a piano ``.wav``.

    Args:
        notes:     a list of ``NoteEvent`` (rendered to MIDI in memory) OR a
                   path to an existing ``.mid``/``.midi`` file.
        out_wav:   destination wav path.
        soundfont: path to a GM soundfont (.sf2/.sf3) for fluidsynth.
        program:   General MIDI program for the notes (default grand piano).
        render_sr: render sample rate.
        fluidsynth_bin: fluidsynth executable name/path.

    Returns the wav path (fluidsynth, or the sine fallback).
    """
    out_wav = Path(out_wav)
    out_wav.parent.mkdir(parents=True, exist_ok=True)

    midi_path, is_tmp = _resolve_midi(notes, program)
    try:
        soundfont = Path(soundfont)
        if shutil.which(fluidsynth_bin) and soundfont.exists():
            proc = subprocess.run(
                [
                    fluidsynth_bin, "-ni",
                    "-F", str(out_wav),
                    "-r", str(render_sr),
                    "-g", "0.9",
                    str(soundfont), str(midi_path),
                ],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            )
            if proc.returncode == 0 and out_wav.exists():
                log.info("rendered piano audio -> %s", out_wav)
                return out_wav
            log.warning("fluidsynth failed (exit %s); sine fallback", proc.returncode)
        else:
            log.warning("fluidsynth/soundfont unavailable (%s); sine fallback", soundfont)

        return _sine_render(midi_path, out_wav, render_sr)
    finally:
        if is_tmp:
            try:
                os.unlink(midi_path)
            except OSError:
                pass


def _resolve_midi(notes, program: int) -> tuple[Path, bool]:
    """Return (midi_path, is_temporary). Writes a temp .mid for a NoteEvent list."""
    if isinstance(notes, (str, Path)):
        return Path(notes), False

    pm = _notes_to_pretty_midi(notes, program)
    fd, tmp = tempfile.mkstemp(suffix=".mid")
    os.close(fd)
    pm.write(tmp)
    return Path(tmp), True


def _notes_to_pretty_midi(notes: "list[NoteEvent]", program: int):
    import pretty_midi

    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=int(program))
    for n in notes:
        inst.notes.append(
            pretty_midi.Note(
                velocity=int(n.velocity),
                pitch=int(n.midi),
                start=float(n.start),
                end=float(n.end),
            )
        )
    pm.instruments.append(inst)
    return pm


def _sine_render(midi_path: Path, out: Path, render_sr: int) -> Path:
    import numpy as np
    import pretty_midi
    import soundfile as sf

    pm = pretty_midi.PrettyMIDI(str(midi_path))
    audio = pm.synthesize(fs=render_sr)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = 0.9 * audio / peak
    sf.write(str(out), audio.astype("float32"), render_sr)
    return out
