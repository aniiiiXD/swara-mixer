"""
harmonica — play a software (and one day robotic) harmonica with your keyboard,
hand gestures, or your singing voice, then clean it up and generate with ML.

The audio/ML engine now lives in the shared `stemcore` package; harmonica is a
thin app on top of it (its own hand-tracking + the pygame/CLI front-ends).

Quick API (re-exported from stemcore for convenience):

    from harmonica import HarmonicaSynth, YinPitch, NoteModel

The runnable apps live in `harmonica.apps` (keyboard, gesture_play, sing,
transcribe, refine) and are exposed as console scripts (see pyproject.toml).
"""

__version__ = "0.2.0"

from stemcore.render.realtime import RealtimeSynth as HarmonicaSynth
from stemcore.instruments.harmonica import snap_to_harp, harp_hole, tab_token
from stemcore.model import midi_to_name as midi_name
from stemcore.pitch.yin import YinPitch, hz_to_midi
from stemcore.tempo import estimate_tempo, quantize
from stemcore.musicmodel import NoteModel

__all__ = [
    "HarmonicaSynth",
    "YinPitch",
    "hz_to_midi",
    "NoteModel",
    "estimate_tempo",
    "quantize",
    "snap_to_harp",
    "harp_hole",
    "tab_token",
    "midi_name",
    "__version__",
]
