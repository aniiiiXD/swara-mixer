"""
pitch/postprocess.py — clean up a monophonic pitch track.

octave_guard(): the big one for vocals. YIN/pYIN occasionally report a frame an
octave off (a sub-harmonic → half frequency, or a harmonic → double). Since the
error is almost exactly ±12 semitones, we fold each voiced frame to the octave
nearest the local (running-median) melody center. Real notes stay put; stray
octave jumps snap back onto the line.
"""

import numpy as np


def octave_guard(midis, backbone_win=151, max_correct=24):
    """midis: list of MIDI floats or None (unvoiced). Fold each voiced frame to
    the octave nearest a robust "melody backbone" — a WIDE median of the raw
    track. Brief octave-error spikes are a minority inside the window so they
    don't move the backbone, yet genuine (sustained) melody movement does. This
    avoids the drift a causal running-median anchor suffers from.

    backbone_win ≈ frames spanning ~1.5s at hop 512 / 44.1kHz."""
    n = len(midis)
    half = backbone_win // 2

    backbone = [None] * n
    for i in range(n):
        w = [m for m in midis[max(0, i - half): i + half + 1] if m is not None]
        if w:
            backbone[i] = float(np.median(w))

    voiced = [m for m in midis if m is not None]
    fallback = float(np.median(voiced)) if voiced else 60.0

    out = list(midis)
    for i, m in enumerate(midis):
        if m is None:
            continue
        center = backbone[i] if backbone[i] is not None else fallback
        best = m
        for k in range(-max_correct, max_correct + 1, 12):
            if abs((m + k) - center) < abs(best - center):
                best = m + k
        out[i] = best
    return out


def remove_short_runs(midis, hop_s, min_run=0.09):
    """Set voiced runs shorter than `min_run` seconds to None. Removes the brief
    spurious pitch blips that breaths / consonants produce."""
    out = list(midis)
    n = len(midis)
    i = 0
    while i < n:
        if midis[i] is None:
            i += 1
            continue
        j = i
        while j < n and midis[j] is not None:
            j += 1
        if (j - i) * hop_s < min_run:
            for k in range(i, j):
                out[k] = None
        i = j
    return out
