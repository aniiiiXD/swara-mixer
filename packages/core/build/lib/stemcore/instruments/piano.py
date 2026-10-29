"""Piano instrument constants & helpers.

Extracted from the piano app (`backend/app/config.py`), where the 88-key
range, GM program and piano-range clamps lived as loose config values. Gathered
here as a small, dependency-free instrument module (stdlib/numpy only) that
mirrors the harmonica layout module: constants up top, pure helpers below.

A standard acoustic piano has 88 keys spanning A0..C8 (MIDI 21..108) and, in
General MIDI, is program 0 (Acoustic Grand Piano).

    Lowest key : A0  (MIDI 21,  ~27.50 Hz)
    Middle C   : C4  (MIDI 60, ~261.63 Hz)
    Highest key: C8  (MIDI 108, ~4186.01 Hz)
"""

from __future__ import annotations

# --- range (88 keys, A0..C8) -------------------------------------------------
A0_MIDI = 21          # lowest key, A0
C8_MIDI = 108         # highest key, C8
NUM_KEYS = C8_MIDI - A0_MIDI + 1   # 88

# Fundamental-frequency clamps used to keep a transcription inside a real
# keyboard and drop sub/ultrasonic noise that pollutes the note list.
PIANO_FMIN = 27.5      # A0, Hz
PIANO_FMAX = 4186.01   # C8, Hz

# General MIDI program for the grand-piano voice.
GM_PROGRAM = 0         # Acoustic Grand Piano

_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_name(m: int) -> str:
    """MIDI number → scientific pitch name, e.g. 60 -> 'C4'."""
    m = int(round(m))
    return _NAMES[m % 12] + str(m // 12 - 1)


def midi_to_hz(m: float) -> float:
    """Equal-tempered frequency of a MIDI note (A4 = 69 = 440 Hz)."""
    return 440.0 * 2.0 ** ((float(m) - 69.0) / 12.0)


def in_range(m: int) -> bool:
    """True when a MIDI note lies on a real 88-key keyboard (A0..C8)."""
    return A0_MIDI <= int(round(m)) <= C8_MIDI


def clamp_to_piano(m: int) -> int:
    """Clamp a MIDI note into the playable 88-key range [A0, C8]."""
    return max(A0_MIDI, min(C8_MIDI, int(round(m))))
