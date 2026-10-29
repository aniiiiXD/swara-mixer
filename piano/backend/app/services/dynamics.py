"""Ground note velocities in the SOURCE audio's loudness.

Pop2Piano models only binary note on/off — its token vocabulary has no dynamics
— so every note it emits comes out at a flat velocity. But music *is* intensity,
so we paint dynamics back on from the original track: each note takes its
velocity from how loud the song actually is at that instant (RMS → dB →
velocity). Choruses hit harder, verses pull back — using the real performance's
energy contour instead of a model's guess.
"""

from __future__ import annotations

import librosa
import numpy as np


def apply_dynamics(pm, audio: np.ndarray, sr: int, vmin: int = 45, vmax: int = 122, hop: int = 512):
    """Rewrite every note's velocity from the audio loudness at its onset. In place."""
    notes = [n for inst in pm.instruments for n in inst.notes]
    if not notes:
        return pm

    rms = librosa.feature.rms(y=audio, hop_length=hop)[0]
    db = librosa.amplitude_to_db(rms, ref=np.max)              # perceptual, <= 0 dB
    times = librosa.times_like(rms, sr=sr, hop_length=hop)

    # Normalise against the loudness actually seen at note onsets (robust to
    # outliers) so we use the song's full dynamic range, not the whole file's.
    onset_idx = np.clip(np.searchsorted(times, [n.start for n in notes]), 0, len(db) - 1)
    onset_db = db[onset_idx]
    lo, hi = np.percentile(onset_db, 5), np.percentile(onset_db, 95)
    span = max(float(hi - lo), 1e-3)

    for n, j in zip(notes, onset_idx):
        frac = float(np.clip((db[j] - lo) / span, 0.0, 1.0))
        n.velocity = int(round(vmin + frac * (vmax - vmin)))
    return pm
