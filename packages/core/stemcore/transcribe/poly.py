"""Polyphonic transcription — audio → piano notes.

Extracted and merged from the piano app's transcription layer: the dispatcher
(`services/transcriber.py`) plus its two interchangeable "brains"
(`services/_basic_pitch.py`, `services/_pop2piano.py`). A piano is polyphonic,
so both brains are multi-pitch — NOT the monophonic pYIN a singing coach uses.

Two backends sit behind one `transcribe_poly(...) -> list[NoteEvent]` contract:

  • "basic_pitch" — literal polyphonic transcription. Light, no torch. Emits
    every note it hears as-is: fast, but flat (weak velocity, no phrasing).
  • "pop2piano"   — musical COVER. A T5-style transformer (HuggingFace
    `sweetcocoa/pop2piano`) that beat-tracks the audio and generates piano
    tokens on the beat grid, with real learned velocities and selectable
    "composer" arranger styles. Needs torch + transformers.

All heavy libraries (basic_pitch, torch, transformers, librosa, pretty_midi)
are imported lazily inside the functions, so importing this module is cheap.
The app-specific bits — writing a .mid to a per-job directory — are dropped:
this returns note events only; use ``stemcore.render`` to emit MIDI/audio.
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..model import NoteEvent
from ..instruments.piano import PIANO_FMIN, PIANO_FMAX

log = logging.getLogger("stemcore")

# Defaults preserved from the piano app's config.
DEFAULT_POP2PIANO_MODEL = "sweetcocoa/pop2piano"
DEFAULT_POP2PIANO_COMPOSER = "composer1"

# Cache the pop2piano model + processor across calls — loading them (and, on
# first run, downloading weights from HuggingFace) is the expensive part.
_model = None
_processor = None
_model_name: str | None = None


def transcribe_poly(
    audio_path: str | Path,
    backend: str = "basic_pitch",
    **opts,
) -> list[NoteEvent]:
    """Transcribe an audio file to polyphonic piano notes.

    Args:
        audio_path: path to an audio file.
        backend:    "basic_pitch" (literal, light) or "pop2piano" (cover).
        **opts:     backend-specific options (see the two ``_transcribe_*``
                    helpers below).

    Returns a list of ``NoteEvent`` sorted by (start, midi).
    """
    if backend == "basic_pitch":
        return _transcribe_basic_pitch(Path(audio_path), **opts)
    elif backend == "pop2piano":
        return _transcribe_pop2piano(Path(audio_path), **opts)
    raise ValueError(f"unknown backend {backend!r} (expected 'basic_pitch' or 'pop2piano')")


# --- basic_pitch brain -------------------------------------------------------
def _transcribe_basic_pitch(
    audio_path: Path,
    onset_threshold: float = 0.5,
    frame_threshold: float = 0.3,
    minimum_note_length: float = 58.0,   # ms — suppress machine-gun ghost notes
    minimum_frequency: float = PIANO_FMIN,
    maximum_frequency: float = PIANO_FMAX,
    melodia_trick: bool = True,
) -> list[NoteEvent]:
    """Run basic-pitch (light, no torch) over an audio file."""
    from basic_pitch.inference import predict

    _model_output, _midi_data, note_events = predict(
        str(audio_path),
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
        minimum_note_length=minimum_note_length,
        minimum_frequency=minimum_frequency,
        maximum_frequency=maximum_frequency,
        melodia_trick=melodia_trick,
    )

    # note_events tuples: (start_s, end_s, pitch_midi, amplitude, pitch_bends).
    # basic-pitch reports a 0..1 amplitude rather than a MIDI velocity, so scale
    # it into the 0..127 velocity range NoteEvent expects.
    notes = [
        NoteEvent(
            start=round(float(s), 4),
            dur=round(float(e) - float(s), 4),
            midi=int(p),
            velocity=max(1, min(127, int(round(float(a) * 127)))),
        )
        for (s, e, p, a, *_rest) in note_events
    ]
    notes.sort(key=lambda n: (n.start, n.midi))
    log.info("basic-pitch: %d notes", len(notes))
    return notes


# --- pop2piano brain ---------------------------------------------------------
def _load_pop2piano(model_name: str):
    """Lazily load + cache the pop2piano model and processor."""
    global _model, _processor, _model_name
    if _model is None or _model_name != model_name:
        from transformers import (
            Pop2PianoForConditionalGeneration,
            Pop2PianoProcessor,
        )

        log.info("loading Pop2Piano (%s) — first run downloads weights…", model_name)
        _processor = Pop2PianoProcessor.from_pretrained(model_name)
        _model = Pop2PianoForConditionalGeneration.from_pretrained(model_name)
        _model.eval()
        _model_name = model_name
    return _model, _processor


def _transcribe_pop2piano(
    audio_path: Path,
    model: str = DEFAULT_POP2PIANO_MODEL,
    composer: str = DEFAULT_POP2PIANO_COMPOSER,
    dynamics_from_audio: bool = True,
) -> list[NoteEvent]:
    """Generate a musical piano cover for a song via pop2piano."""
    import librosa
    import torch

    mdl, processor = _load_pop2piano(model)

    # Pop2Piano is trained at 44.1 kHz mono.
    audio, sr = librosa.load(str(audio_path), sr=44100, mono=True)

    inputs = processor(audio=audio, sampling_rate=sr, return_tensors="pt")
    with torch.no_grad():
        token_ids = mdl.generate(
            input_features=inputs["input_features"],
            composer=composer,
        )
    decoded = processor.batch_decode(token_ids=token_ids, feature_extractor_output=inputs)
    pm = decoded["pretty_midi_objects"][0]

    notes = _notes_from_pretty_midi(pm)

    # Pop2Piano only models note on/off (flat velocity) — paint real dynamics
    # back on from the source audio's loudness envelope.
    if dynamics_from_audio:
        from ..render.dynamics import apply_dynamics

        apply_dynamics(notes, audio, sr)

    log.info("Pop2Piano cover [%s]: %d notes", composer, len(notes))
    return notes


def _notes_from_pretty_midi(pm) -> list[NoteEvent]:
    """Flatten a PrettyMIDI (all instruments) into sorted NoteEvents."""
    notes = [
        NoteEvent(
            start=round(float(n.start), 4),
            dur=round(float(n.end) - float(n.start), 4),
            midi=int(n.pitch),
            velocity=int(n.velocity),   # real MIDI velocity 0..127
        )
        for inst in pm.instruments
        for n in inst.notes
    ]
    notes.sort(key=lambda n: (n.start, n.midi))
    return notes
