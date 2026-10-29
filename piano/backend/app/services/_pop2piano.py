"""pop2piano brain — pop song audio → musical piano COVER.

Pop2Piano (Choi & Lee, HuggingFace `sweetcocoa/pop2piano`) is a T5-style
transformer trained on synchronized pairs of pop songs and real human piano
covers. Unlike a transcriber it *reinterprets* the song the way a pianist would:

  • it beat-tracks the audio first (via essentia), then generates piano tokens
    ON the beat grid — so tempo/rhythm are structural, not an afterthought;
  • it emits real MIDI velocities learned from human performances (dynamics);
  • different "composer" styles (composer1..composer21) change the arrangement.

Pretrained — no training needed. Weights download from HuggingFace on first run.
"""

from __future__ import annotations

import logging
from pathlib import Path

import librosa

from app.config import MIDI_DIR, POP2PIANO_MODEL, POP2PIANO_COMPOSER, DYNAMICS_FROM_AUDIO
from app.services.transcriber import notes_from_pretty_midi

log = logging.getLogger("piano")

# Cache the model + processor across jobs — loading them is the expensive part.
_model = None
_processor = None


def _load():
    global _model, _processor
    if _model is None:
        from transformers import Pop2PianoForConditionalGeneration, Pop2PianoProcessor

        log.info(f"loading Pop2Piano ({POP2PIANO_MODEL}) — first run downloads weights…")
        _processor = Pop2PianoProcessor.from_pretrained(POP2PIANO_MODEL)
        _model = Pop2PianoForConditionalGeneration.from_pretrained(POP2PIANO_MODEL)
        _model.eval()
    return _model, _processor


def transcribe(audio_path: Path, job_id: str) -> tuple[Path, list[dict]]:
    """Generate a piano cover MIDI for a song. Returns (midi_path, notes)."""
    import torch

    model, processor = _load()

    # Pop2Piano is trained at 44.1 kHz mono.
    audio, sr = librosa.load(str(audio_path), sr=44100, mono=True)

    inputs = processor(audio=audio, sampling_rate=sr, return_tensors="pt")
    with torch.no_grad():
        token_ids = model.generate(
            input_features=inputs["input_features"],
            composer=POP2PIANO_COMPOSER,
        )
    decoded = processor.batch_decode(token_ids=token_ids, feature_extractor_output=inputs)
    pm = decoded["pretty_midi_objects"][0]

    # Pop2Piano emits flat velocity — paint real dynamics from the source loudness.
    if DYNAMICS_FROM_AUDIO:
        from app.services.dynamics import apply_dynamics
        apply_dynamics(pm, audio, sr)

    out_dir = MIDI_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    midi_path = out_dir / "piano.mid"
    pm.write(str(midi_path))

    notes = notes_from_pretty_midi(pm)
    log.info(f"[{job_id}] Pop2Piano cover [{POP2PIANO_COMPOSER}]: {len(notes)} notes -> {midi_path}")
    return midi_path, notes
