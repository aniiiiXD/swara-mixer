"""
harmonica — play a software (and one day robotic) harmonica with your keyboard,
hand gestures, or your singing voice, then clean it up and generate with ML.

Quick API:

    from harmonica import HarmonicaSynth, YinPitch, NoteModel
    from harmonica.core import layout, harp_map

The runnable apps live in `harmonica.apps` (keyboard, gesture_play, sing,
transcribe, refine) and are exposed as console scripts (see pyproject.toml).
"""

__version__ = "0.1.0"

from .core.synth import HarmonicaSynth
from .core.harp_map import snap_to_harp, harp_hole, tab_token, midi_name
from .audio.pitch import YinPitch, hz_to_midi
from .audio.tempo import estimate_tempo, quantize
from .ml.notemodel import NoteModel

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
