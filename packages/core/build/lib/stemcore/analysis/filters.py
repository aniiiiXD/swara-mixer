"""
analysis/filters.py — simple audio filters.

bandpass(): keep only a frequency range before analysis. For vocal pitch we
band-pass to roughly the singing range (~80-1000 Hz) so the detector isn't
tempted by low rumble / instrument bleed or high sibilance — which is where a
lot of the octave errors came from.
"""

import numpy as np


def bandpass(y, sr, lo=80.0, hi=1000.0, order=4):
    """Zero-phase Butterworth band-pass. Lazy-imports scipy."""
    from scipy.signal import butter, sosfiltfilt

    nyq = sr / 2.0
    lo_n = max(1e-4, lo / nyq)
    hi_n = min(0.999, hi / nyq)
    sos = butter(order, [lo_n, hi_n], btype="band", output="sos")
    return sosfiltfilt(sos, np.asarray(y, dtype=np.float64)).astype(np.float32)
