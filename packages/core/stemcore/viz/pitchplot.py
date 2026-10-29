"""
pitchplot.py — render pitch graphs for the post-process pipeline.

Two views:
  plot_from_audio()  — the real thing: raw per-frame f0 (the wavering line) +
                       the median-smoothed track + the segmented note bars.
                       This is the diagnostic that shows over/under-segmentation.
  plot_transcript()  — when only a saved transcript exists (no audio): a
                       piano-roll of the notes (what you sang vs. what the harp plays).

Renders to PNG via the Agg backend (no window).
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from ..model import NAMES, midi_name
from ..instruments.harmonica import snap_to_harp, tab_token, harp_hole

RAW = "#9aa0a6"      # raw frame pitch
SMOOTH = "#1f77b4"   # smoothed track
NOTE = "#1f77b4"     # sung note bars
HARP = "#ff7f0e"     # harp-mapped notes


def name_to_midi(name):
    name = name.strip()
    i = len(name) - 1
    while i >= 0 and (name[i].isdigit() or name[i] == "-"):
        i -= 1
    return NAMES.index(name[:i + 1]) + (int(name[i + 1:]) + 1) * 12


def _note_yaxis(ax, mids):
    lo, hi = int(min(mids)) - 1, int(max(mids)) + 2
    ticks = list(range(lo, hi))
    ax.set_yticks(ticks)
    ax.set_yticklabels([midi_name(t) for t in ticks], fontsize=7)
    ax.grid(True, axis="y", alpha=0.25)
    ax.set_ylim(lo - 0.5, hi - 0.5)


def plot_from_audio(times, raw, smoothed, events, octave_shift, out_png, title="pitch graph"):
    xs = [t for t, m in zip(times, raw) if m is not None]
    ys = [m for m in raw if m is not None]
    sx = [t for t, m in zip(times, smoothed) if m is not None]
    sy = [m for m in smoothed if m is not None]

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 7), sharex=True,
                                   gridspec_kw={"height_ratios": [3, 2]})
    fig.suptitle(title, fontsize=12, fontweight="bold")

    # top: raw f0 + smoothed + note segments (the analysis diagnostic)
    ax1.plot(xs, ys, ".", ms=3, color=RAW, alpha=0.7, label="raw f0 (per frame)")
    ax1.plot(sx, sy, "-", lw=1, color=SMOOTH, alpha=0.4, label="median-smoothed")
    for ev in events:
        ax1.hlines(ev["midi"], ev["start"], ev["start"] + ev["dur"],
                   color=NOTE, lw=5)
    ax1.set_ylabel("your voice")
    allmids = ys + [ev["midi"] for ev in events] or [60]
    _note_yaxis(ax1, allmids)
    ax1.legend(loc="upper right", fontsize=8, framealpha=0.9)
    ax1.set_title(f"{len(events)} notes detected  (thick bars = segmented notes)",
                  fontsize=9, loc="left", color="#555")

    # bottom: what the harmonica plays, with tab labels
    hmids = []
    for ev in events:
        h = snap_to_harp(ev["midi"], octave_shift)
        hmids.append(h)
        hole, draw = harp_hole(h)
        ax2.hlines(h, ev["start"], ev["start"] + ev["dur"], color=HARP, lw=6,
                   )
        ax2.text(ev["start"], h + 0.35, tab_token(hole, draw), fontsize=7, color="#a05a00")
    ax2.set_ylabel("harmonica")
    ax2.set_xlabel("time (s)")
    _note_yaxis(ax2, hmids or [72])
    ax2.set_title(f"octave shift {octave_shift:+d}   ('-' = draw)", fontsize=9, loc="left", color="#555")

    fig.tight_layout(rect=[0, 0, 1, 0.97])
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


def plot_transcript(parsed, out_png, title="transcription"):
    """parsed: list of {start, dur, sung_midi, harp_midi, tab}."""
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 7), sharex=True)
    fig.suptitle(title, fontsize=12, fontweight="bold")

    for ev in parsed:
        ax1.hlines(ev["sung_midi"], ev["start"], ev["start"] + ev["dur"],
                   color=NOTE, lw=6)
    ax1.set_ylabel("you sang")
    _note_yaxis(ax1, [e["sung_midi"] for e in parsed] or [60])
    ax1.set_title(f"{len(parsed)} notes  (from saved transcript; no raw audio -> stepped, not continuous)",
                  fontsize=9, loc="left", color="#555")

    for ev in parsed:
        ax2.hlines(ev["harp_midi"], ev["start"], ev["start"] + ev["dur"],
                   color=HARP, lw=6)
        ax2.text(ev["start"], ev["harp_midi"] + 0.35, ev["tab"], fontsize=7, color="#a05a00")
    ax2.set_ylabel("harmonica")
    ax2.set_xlabel("time (s)")
    _note_yaxis(ax2, [e["harp_midi"] for e in parsed] or [72])

    fig.tight_layout(rect=[0, 0, 1, 0.97])
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


def parse_transcript(txt_path):
    """Read a transcript_*.txt back into a list of note dicts."""
    parsed = []
    with open(txt_path) as fp:
        for line in fp:
            line = line.strip()
            if not line or line.startswith("#") or line.startswith(("tab:", "you", "harp")):
                continue
            # "start dur tab sung -> harp"
            parts = line.split()
            if len(parts) >= 6 and parts[4] == "->":
                start, dur, tab, sung, _, harp = parts[:6]
                try:
                    parsed.append({
                        "start": float(start), "dur": float(dur), "tab": tab,
                        "sung_midi": name_to_midi(sung), "harp_midi": name_to_midi(harp),
                    })
                except (ValueError, KeyError):
                    continue
    return parsed
