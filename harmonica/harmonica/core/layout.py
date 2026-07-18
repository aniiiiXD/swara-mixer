"""
layout.py — the musical layout of a real harmonica.

Models a standard 10-hole diatonic harmonica in C (Richter tuning). Every hole
has TWO notes: one when you BLOW (exhale) and a different one when you DRAW
(inhale) — that's what makes it a harmonica and not just a scale.

    Hole:  1   2   3   4   5   6   7   8   9   10
    Blow:  C   E   G   C   E   G   C   E   G   C
    Draw:  D   G   B   D   F   A   B   D   F   A

When you build the physical robot, THIS is the file that maps to reality:
a blow note = push air through that hole, a draw note = pull air through it.
"""

# MIDI note numbers (60 = middle C). Index 0..9 = holes 1..10.
BLOW = [60, 64, 67, 72, 76, 79, 84, 88, 91, 96]   # C E G C E G C E G C
DRAW = [62, 67, 71, 74, 77, 81, 83, 86, 89, 93]   # D G B D F A B D F A

NUM_HOLES = len(BLOW)

_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_to_name(m: int) -> str:
    return _NAMES[m % 12] + str(m // 12 - 1)


def note(hole: int, draw: bool) -> int:
    """MIDI note for a given hole (0-based) and direction (draw=True / blow=False)."""
    return (DRAW if draw else BLOW)[hole]


def note_name(hole: int, draw: bool) -> str:
    return midi_to_name(note(hole, draw))


def x_to_hole(x: float) -> int:
    """Map a normalized x in [0,1] (left->right) to a hole index 0..9."""
    x = min(max(x, 0.0), 0.999)
    return int(x * NUM_HOLES)
