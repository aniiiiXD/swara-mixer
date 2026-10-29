"""basic_pitch brain — literal polyphonic transcription (light, no torch).

Emits every note it hears as-is. Fast and dependency-light, but flat: weak
velocity, no phrasing, no beat awareness. Good for a faithful note dump; for a
musical cover use the pop2piano brain instead.
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import MIDI_DIR, PIANO_FMIN, PIANO_FMAX
from app.services.transcriber import _midi_name

log = logging.getLogger("piano")


def transcribe(audio_path: Path, job_id: str) -> tuple[Path, list[dict]]:
    """Run basic-pitch over an audio file. Returns (midi_path, note_events)."""
    from basic_pitch.inference import predict

    out_dir = MIDI_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    _model_output, midi_data, note_events = predict(
        str(audio_path),
        onset_threshold=0.5,
        frame_threshold=0.3,
        minimum_note_length=58.0,       # ms — suppress machine-gun ghost notes
        minimum_frequency=PIANO_FMIN,
        maximum_frequency=PIANO_FMAX,
        melodia_trick=True,
    )

    midi_path = out_dir / "piano.mid"
    midi_data.write(str(midi_path))

    # note_events tuples: (start_s, end_s, pitch_midi, amplitude, pitch_bends)
    notes = [
        {
            "start": round(float(s), 4),
            "end": round(float(e), 4),
            "midi": int(p),
            "name": _midi_name(int(p)),
            "velocity": round(float(a), 4),
        }
        for (s, e, p, a, *_rest) in note_events
    ]
    notes.sort(key=lambda n: (n["start"], n["midi"]))

    log.info(f"[{job_id}] basic-pitch: {len(notes)} notes -> {midi_path}")
    return midi_path, notes
