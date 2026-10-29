"""
analysis/spectrum.py — the Audio Processing module: turn audio into frequencies.

Deliberately simple: a plain windowed FFT (STFT). Given a mono signal it gives
you three views —
    stft()            frequency x time magnitude   (the spectrogram data)
    average_spectrum() one magnitude-vs-frequency curve for the whole clip
    band_energy()      how energy splits across named frequency bands

numpy only — no librosa, no torch. This is where filters/weighting will get
tuned later; for now it just reports the frequencies as they are.
"""

import numpy as np

# musical frequency bands (Hz)
BANDS = [
    ("sub-bass", 20, 60),
    ("bass", 60, 250),
    ("low-mid", 250, 500),
    ("mid", 500, 2000),
    ("high-mid", 2000, 4000),
    ("presence", 4000, 6000),
    ("brilliance", 6000, 20000),
]


def stft(y, sr, win=2048, hop=512):
    """Short-time Fourier transform magnitude.
    Returns (freqs[Hz], times[s], mag[freq, time])."""
    y = np.asarray(y, dtype=np.float64)
    if len(y) < win:
        y = np.pad(y, (0, win - len(y)))
    window = np.hanning(win)
    n_frames = 1 + (len(y) - win) // hop
    mag = np.empty((win // 2 + 1, n_frames), dtype=np.float64)
    for i in range(n_frames):
        frame = y[i * hop: i * hop + win] * window
        mag[:, i] = np.abs(np.fft.rfft(frame))
    freqs = np.fft.rfftfreq(win, 1.0 / sr)
    times = np.arange(n_frames) * hop / sr
    return freqs, times, mag


def spectrogram_db(y, sr, win=2048, hop=512, top_db=80.0):
    """STFT magnitude in dB, floored at -top_db and referenced to the peak.
    Returns (freqs, times, S_db)."""
    freqs, times, mag = stft(y, sr, win, hop)
    ref = mag.max() + 1e-12
    S_db = 20.0 * np.log10(mag / ref + 1e-12)
    S_db = np.maximum(S_db, -top_db)
    return freqs, times, S_db


def average_spectrum(y, sr, win=4096, hop=2048):
    """One magnitude-vs-frequency curve, averaged over the clip.
    Returns (freqs, mag)."""
    freqs, _times, mag = stft(y, sr, win, hop)
    return freqs, mag.mean(axis=1)


def band_energy(y, sr):
    """Fraction of spectral energy in each named band. Returns {band: 0..1}."""
    freqs, mag = average_spectrum(y, sr)
    power = mag ** 2
    out = {}
    for name, lo, hi in BANDS:
        m = (freqs >= lo) & (freqs < hi)
        out[name] = float(power[m].sum())
    total = sum(out.values()) + 1e-12
    return {k: v / total for k, v in out.items()}


def dominant_frequency(y, sr):
    """The single loudest frequency (Hz) of the clip — a crude 'what note is this'."""
    freqs, mag = average_spectrum(y, sr)
    return float(freqs[int(np.argmax(mag))])
