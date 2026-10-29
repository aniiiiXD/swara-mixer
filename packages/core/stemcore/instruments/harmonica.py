"""
instruments/harmonica.py — the 10-hole diatonic C harmonica (Richter tuning).

Merges the old harmonica `layout` + `harp_map` modules into one instrument
definition: the note table plus how to place an arbitrary pitch onto the harp.

    Hole:  1   2   3   4   5   6   7   8   9   10
    Blow:  C   E   G   C   E   G   C   E   G   C
    Draw:  D   G   B   D   F   A   B   D   F   A
"""

from ..model import midi_to_name

# MIDI note numbers (60 = middle C). Index 0..9 = holes 1..10.
BLOW = [60, 64, 67, 72, 76, 79, 84, 88, 91, 96]   # C E G C E G C E G C
DRAW = [62, 67, 71, 74, 77, 81, 83, 86, 89, 93]   # D G B D F A B D F A
NUM_HOLES = len(BLOW)

# every distinct pitch the harp can make
AVAIL = sorted(set(BLOW) | set(DRAW))
LO, HI = AVAIL[0], AVAIL[-1]


def x_to_hole(x: float) -> int:
    """Map a normalized x in [0,1] (left->right) to a hole index 0..9."""
    x = min(max(x, 0.0), 0.999)
    return int(x * NUM_HOLES)


def note(hole: int, draw: bool) -> int:
    return (DRAW if draw else BLOW)[hole]


def note_name(hole: int, draw: bool) -> str:
    return midi_to_name(note(hole, draw))


def snap_to_harp(midi: int, octave_shift: int = 1) -> int:
    """Place a pitch on the harp: fold to pitch class in the bottom octave, then
    move up by `octave_shift` registers (0 = holes 1-3, 1 = 4-7, 2 = 7-10).
    Returns a MIDI note the harp can actually play."""
    pc = ((int(round(midi)) - LO) % 12) + LO
    placed = pc + 12 * octave_shift
    while placed > HI:
        placed -= 12
    while placed < LO:
        placed += 12
    return min(AVAIL, key=lambda m: abs(m - placed))


def harp_hole(midi: int):
    """(hole_index, draw?) for a playable harp note. Prefer blow."""
    if midi in BLOW:
        return BLOW.index(midi), False
    return DRAW.index(midi), True


def tab_token(hole: int, draw: bool) -> str:
    return ("-" if draw else "") + str(hole + 1)
