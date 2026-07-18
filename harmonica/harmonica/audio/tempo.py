"""
tempo.py — auto-detect tempo and quantize note timing to a beat grid.

This is the "proper timing" half. It is a search, not ML: try many tempos, and
for each, find the phase that best lines your note onsets up to a grid; keep the
tempo with the smallest snap error. Then round every onset and duration to that
grid so the rhythm becomes musical (eighths / sixteenths) instead of raw seconds.
"""

import numpy as np


def estimate_tempo(onsets, bpm_lo=60, bpm_hi=180, subdiv=2):
    """Return (bpm, phase). subdiv=2 -> eighth-note grid, 4 -> sixteenths.
    phase is the grid's time offset (seconds)."""
    onsets = np.asarray(onsets, dtype=float)
    if len(onsets) < 3:
        return 120.0, float(onsets[0]) if len(onsets) else 0.0

    best = None
    for bpm in range(bpm_lo, bpm_hi + 1):
        grid = 60.0 / bpm / subdiv
        # best phase = circular mean of (onset mod grid)
        ang = (onsets % grid) / grid * 2 * np.pi
        phase = (np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()) / (2 * np.pi)) * grid
        snapped = np.round((onsets - phase) / grid) * grid + phase
        err = np.mean(np.abs(onsets - snapped)) / grid            # 0 (perfect) .. 0.5
        # mild bias toward moderate tempos so we don't pick a needlessly fast grid
        penalty = 0.02 * abs(bpm - 110) / 110
        score = err + penalty
        if best is None or score < best[0]:
            best = (score, bpm, float(phase))
    return float(best[1]), best[2]


def quantize(events, bpm, phase, subdiv=2, min_units=1):
    """Snap each event's onset and duration to the grid. Returns new events."""
    grid = 60.0 / bpm / subdiv
    out = []
    for ev in events:
        start = round((ev["start"] - phase) / grid) * grid + phase
        units = max(min_units, int(round(ev["dur"] / grid)))
        out.append({"midi": ev["midi"], "start": max(0.0, start), "dur": units * grid})
    return out
