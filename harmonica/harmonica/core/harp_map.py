"""
harp_map.py — shared logic for placing an arbitrary pitch onto a C harmonica.

Used by both the live tool (sing.py) and the offline transcriber (transcribe.py)
so the voice->harp mapping is identical everywhere.
"""

from . import layout

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# every distinct pitch the harp can make, and how to make it (prefer blow)
AVAIL = sorted(set(layout.BLOW) | set(layout.DRAW))
LO, HI = AVAIL[0], AVAIL[-1]


def midi_name(m) -> str:
    return NAMES[int(round(m)) % 12] + str(int(round(m)) // 12 - 1)


def snap_to_harp(midi, octave_shift=1) -> int:
    """Place a pitch on the harp. First fold the note to its pitch class in the
    harp's bottom octave, THEN move it up by `octave_shift` registers, so the
    shift is reliable: 0 = low holes (1-3), 1 = mid (4-7), 2 = high (7-10).
    Returns a MIDI note the harp can actually play."""
    pc = ((int(round(midi)) - LO) % 12) + LO       # fold into [LO, LO+11]
    placed = pc + 12 * octave_shift
    while placed > HI:
        placed -= 12
    while placed < LO:
        placed += 12
    return min(AVAIL, key=lambda m: abs(m - placed))


def harp_hole(midi):
    """Return (hole_index, draw?) for a playable harp note. Prefer blow."""
    if midi in layout.BLOW:
        return layout.BLOW.index(midi), False
    return layout.DRAW.index(midi), True


def tab_token(hole, draw) -> str:
    return ("-" if draw else "") + str(hole + 1)
