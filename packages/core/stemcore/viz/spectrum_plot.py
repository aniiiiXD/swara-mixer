"""
viz/spectrum_plot.py — draw the frequency graphs.

Two clean views of a set of stems:
    plot_stem_spectrograms()  a stacked spectrogram per stem (frequency x time)
    plot_spectra()            one plot overlaying each stem's average spectrum
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..analysis.spectrum import spectrogram_db, average_spectrum

_COLORS = {
    "vocals": "#e05a8a", "drums": "#e0a53a", "bass": "#5a8ae0",
    "other": "#5ac08a", "piano": "#8a5ae0", "guitar": "#e07a3a", "clean": "#888",
}


def plot_stem_spectrograms(stems: dict, out_png, fmax=8000, title="frequency by stem"):
    """stems: {name: (y, sr)}. Stacked spectrograms sharing a time axis."""
    n = len(stems)
    fig, axes = plt.subplots(n, 1, figsize=(12, 2.4 * n + 0.6), sharex=True)
    if n == 1:
        axes = [axes]
    fig.suptitle(title, fontweight="bold")
    mesh = None
    for ax, (name, (y, sr)) in zip(axes, stems.items()):
        freqs, times, S_db = spectrogram_db(y, sr)
        fm = freqs <= fmax
        mesh = ax.pcolormesh(times, freqs[fm], S_db[fm], cmap="magma",
                             shading="auto", vmin=-80, vmax=0)
        ax.set_ylabel(f"{name}\nHz", fontsize=9)
        ax.set_ylim(0, fmax)
    axes[-1].set_xlabel("time (s)")
    fig.colorbar(mesh, ax=axes, label="dB", fraction=0.02, pad=0.01)
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


def plot_spectra(stems: dict, out_png, fmax=8000, title="average spectrum by stem"):
    """stems: {name: (y, sr)}. Overlay each stem's magnitude-vs-frequency curve
    on a log frequency axis — shows where each instrument lives."""
    fig, ax = plt.subplots(figsize=(12, 5))
    fig.suptitle(title, fontweight="bold")
    for name, (y, sr) in stems.items():
        freqs, mag = average_spectrum(y, sr)
        m = (freqs > 20) & (freqs <= fmax)
        db = 20 * np.log10(mag[m] / (mag.max() + 1e-12) + 1e-12)
        ax.semilogx(freqs[m], db, label=name, lw=1.4,
                    color=_COLORS.get(name, None))
    ax.set_xlabel("frequency (Hz, log)")
    ax.set_ylabel("magnitude (dB)")
    ax.set_ylim(-80, 2)
    ax.grid(True, which="both", alpha=0.25)
    ax.legend()
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png
