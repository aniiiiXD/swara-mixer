"""
viz/pitch_contour.py — draw the singer's pitch over time.

Takes a PitchTrack (from stemcore.transcribe.mono.pitch_track or pitch.pyin) and
plots the vocal melody line: pitch (note) vs time, with gaps where the voice is
unvoiced (breaths, consonants, silence). Optionally overlaid on the vocal
spectrogram so you can see the pitch line riding the fundamental.
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..model import midi_to_name
from ..pitch.yin import hz_to_midi
from ..pitch.postprocess import octave_guard
from ..analysis.spectrum import spectrogram_db

LINE = "#e05a8a"


def _midi_series(track, smooth=5):
    """Return (times, midi_with_nan) — voiced frames as MIDI, octave-guarded to
    remove half/double-frequency spikes, then lightly median-smoothed."""
    t = np.array([f.t for f in track.frames])
    midi = [hz_to_midi(f.f0) if f.f0 is not None else None for f in track.frames]
    midi = octave_guard(midi)                     # fold octave errors onto the melody
    # median smooth, ignoring None
    half = smooth // 2
    out = np.full(len(midi), np.nan)
    for i in range(len(midi)):
        w = [m for m in midi[max(0, i - half): i + half + 1] if m is not None]
        if w:
            out[i] = float(np.median(w))
    return t, out


def _note_yaxis(ax, midi):
    valid = midi[~np.isnan(midi)]
    if len(valid) == 0:
        return
    lo = int(np.floor(valid.min())) - 1
    hi = int(np.ceil(valid.max())) + 1
    ax.set_ylim(lo, hi)
    # label only octave C's (readable); faint gridline every semitone
    first_c = ((lo + 11) // 12) * 12
    labels = list(range(first_c, hi + 1, 12))
    ax.set_yticks(labels)
    ax.set_yticklabels([midi_to_name(t) for t in labels], fontsize=9)
    ax.set_yticks(range(lo, hi + 1), minor=True)
    ax.grid(True, axis="y", which="major", alpha=0.4)
    ax.grid(True, axis="y", which="minor", alpha=0.12)


def plot_pitch(track, out_png, title="vocal pitch", smooth=5):
    """Clean pitch contour: the melody the singer sang."""
    t, midi = _midi_series(track, smooth)
    fig, ax = plt.subplots(figsize=(12, 4.5))
    fig.suptitle(title, fontweight="bold")
    ax.plot(t, midi, color=LINE, lw=1.8)          # NaNs break the line at gaps
    ax.set_xlabel("time (s)")
    ax.set_ylabel("pitch")
    _note_yaxis(ax, midi)
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


def plot_pitch_over_spectrogram(audio, sr, track, out_png,
                                title="vocal pitch over spectrogram", fmax=2000, smooth=5):
    """The pitch line drawn on top of the vocal spectrogram (in Hz)."""
    freqs, times, S_db = spectrogram_db(audio, sr)
    fm = freqs <= fmax
    t = np.array([f.t for f in track.frames])
    hz = np.array([f.f0 if f.f0 is not None else np.nan for f in track.frames])
    # smooth in the midi domain, convert back for display
    _, midi = _midi_series(track, smooth)
    hz_s = np.where(np.isnan(midi), np.nan, 440.0 * 2 ** ((midi - 69) / 12))

    fig, ax = plt.subplots(figsize=(12, 5))
    fig.suptitle(title, fontweight="bold")
    ax.pcolormesh(times, freqs[fm], S_db[fm], cmap="magma", shading="auto", vmin=-80, vmax=0)
    ax.plot(t, hz_s, color="#8ef0c0", lw=1.6, label="detected pitch")
    ax.set_xlabel("time (s)")
    ax.set_ylabel("frequency (Hz)")
    ax.set_ylim(0, fmax)
    ax.legend(loc="upper right")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png
