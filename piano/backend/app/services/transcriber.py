"""The transcription 'brain' dispatcher.

Turns audio into piano notes. Two interchangeable brains sit behind one
`transcribe(audio_path, job_id) -> (midi_path, notes)` contract, selected by
`config.BRAIN`, so the job pipeline never changes when you swap them:

  • pop2piano   — musical COVER: beat-aligned, real dynamics (torch + essentia)
  • basic_pitch — literal polyphonic transcription (light, no torch)

A piano is polyphonic, so both are multi-pitch — NOT the monophonic pYIN the
singing coach uses.
"""

from __future__ import annotations

from pathlib import Path

from app.config import BRAIN

_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _midi_name(m: int) -> str:
    """MIDI number → scientific pitch name, e.g. 60 -> 'C4'."""
    return f"{_NAMES[m % 12]}{m // 12 - 1}"


def notes_from_pretty_midi(pm) -> list[dict]:
    """Flatten a PrettyMIDI (all instruments) into sorted note-event dicts."""
    notes = [
        {
            "start": round(float(n.start), 4),
            "end": round(float(n.end), 4),
            "midi": int(n.pitch),
            "name": _midi_name(int(n.pitch)),
            "velocity": int(n.velocity),   # real MIDI velocity 0..127
        }
        for inst in pm.instruments
        for n in inst.notes
    ]
    notes.sort(key=lambda n: (n["start"], n["midi"]))
    return notes


def transcribe(audio_path: Path, job_id: str) -> tuple[Path, list[dict]]:
    """Dispatch to the configured brain. Imported lazily so we only pay the
    (heavy) import cost of the brain actually in use."""
    if BRAIN == "basic_pitch":
        from app.services._basic_pitch import transcribe as _fn
    else:
        from app.services._pop2piano import transcribe as _fn
    return _fn(audio_path, job_id)
