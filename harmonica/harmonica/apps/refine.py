"""
refine.py — turn a raw transcription into a musically-proper one with ML.

Pipeline:
    take (.wav or transcript.txt)
      -> transcribe  (raw notes)
      -> NoteModel.viterbi_correct   (HMM cleanup: fix stray/unlikely notes)
      -> tempo.estimate + quantize   (auto-detected beat grid)
      -> play it, save it, graph before/after

The model is trained on the seed melodies + every take you've recorded, so it
learns your style over time.

Usage:
    ./.venv/bin/python refine.py                 # refine the most recent take
    ./.venv/bin/python refine.py recordings/take_XXXX.wav
    ./.venv/bin/python refine.py recordings/transcript_XXXX.txt
    ./.venv/bin/python refine.py --generate 16   # let the model play a NEW melody
"""

import glob
import os
import sys
import time

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from stemcore import seeds
from stemcore import tempo as tempo_mod
from . import transcribe as T
from stemcore.viz import pitchplot as pp
from stemcore.instruments.harmonica import harp_hole, snap_to_harp, tab_token
from stemcore.model import midi_to_name as midi_name
from stemcore.musicmodel import NoteModel
from stemcore.render.realtime import RealtimeSynth as HarmonicaSynth
from ..paths import SOUNDFONT, REC_DIR

OCTAVE_SHIFT = 1


# ------------------------------------------------------------------ model
def build_model():
    seqs = list(seeds.ALL)
    mine = 0
    for f in sorted(glob.glob(os.path.join(REC_DIR, "transcript_*.txt"))):
        parsed = pp.parse_transcript(f)
        if parsed:
            seqs.append([e["sung_midi"] for e in parsed])
            mine += 1
    model = NoteModel(k=0.5).train(seqs)
    return model, len(seeds.ALL), mine


# ------------------------------------------------------------------ load
def load_take(path):
    if path.lower().endswith(".wav"):
        y, sr = T.load_wav(path)
        return T.analyze(y, sr)
    parsed = pp.parse_transcript(path)
    return [{"midi": e["sung_midi"], "start": e["start"], "dur": e["dur"]} for e in parsed]


# ------------------------------------------------------------------ refine
def refine(events, model):
    corrected = model.viterbi_correct([e["midi"] for e in events])
    cev = [{"midi": c, "start": e["start"], "dur": e["dur"]}
           for c, e in zip(corrected, events)]
    bpm, phase = tempo_mod.estimate_tempo([e["start"] for e in cev])
    qev = tempo_mod.quantize(cev, bpm, phase)
    n_changed = sum(1 for a, b in zip(events, cev) if a["midi"] != b["midi"])
    return cev, qev, bpm, n_changed


def tab_of(events):
    return " ".join(tab_token(*harp_hole(snap_to_harp(e["midi"], OCTAVE_SHIFT))) for e in events)


# ------------------------------------------------------------------ output
def play(events):
    synth = HarmonicaSynth(SOUNDFONT); synth.set_volume(0.95)
    player = T.Player(synth)
    player.play(events, OCTAVE_SHIFT)
    while player._thread and player._thread.is_alive():
        time.sleep(0.1)
    synth.close()


def save_refined(events, bpm, stamp):
    path = os.path.join(REC_DIR, f"refined_{stamp}.txt")
    with open(path, "w") as fp:
        fp.write(f"# ML-refined transcription  (bpm~{bpm:.0f}, octave_shift={OCTAVE_SHIFT}). '-' = draw.\n")
        fp.write("tab: " + tab_of(events) + "\n")
        fp.write("notes: " + " ".join(midi_name(e["midi"]) for e in events) + "\n\n")
        for e in events:
            hole, draw = harp_hole(snap_to_harp(e["midi"], OCTAVE_SHIFT))
            fp.write(f"{e['start']:7.2f}  {e['dur']:5.2f}  {tab_token(hole, draw):>4}  {midi_name(e['midi'])}\n")
    return path


def graph(raw, refined, bpm, out_png, title):
    mids = [e["midi"] for e in raw] + [e["midi"] for e in refined] or [60]
    lo, hi = int(min(mids)) - 1, int(max(mids)) + 2
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(13, 8), sharex=True)
    fig.suptitle(title, fontweight="bold")

    def panel(ax, name, events, color, grid=None):
        for e in events:
            ax.hlines(e["midi"], e["start"], e["start"] + e["dur"], color=color, lw=6)
        if grid is not None:
            t = 0.0
            end = max(e["start"] + e["dur"] for e in events) if events else 1.0
            while t <= end:
                ax.axvline(t, color="#ccc", lw=0.6, zorder=0)
                t += grid
        ax.set_yticks(range(lo, hi))
        ax.set_yticklabels([midi_name(t) for t in range(lo, hi)], fontsize=7)
        ax.grid(True, axis="y", alpha=0.2)
        ax.set_ylim(lo - 0.5, hi - 0.5)
        ax.set_title(name, fontsize=10, loc="left")

    panel(a1, f"RAW transcription  ({len(raw)} notes, as-sung timing)", raw, "#d62728")
    panel(a2, f"ML-refined  (corrected notes + {bpm:.0f} bpm grid)", refined, "#1f77b4",
          grid=60.0 / bpm / 2)
    a2.set_xlabel("time (s)")
    fig.tight_layout(rect=[0, 0, 1, 0.96])
    fig.savefig(out_png, dpi=130)
    plt.close(fig)
    return out_png


# ------------------------------------------------------------------ modes
def run_refine(path):
    model, n_seed, n_mine = build_model()
    print(f"Trained note model on {n_seed} seed tunes + {n_mine} of your takes.")
    events = load_take(path)
    if not events:
        print("No notes found in", path); return
    cev, qev, bpm, changed = refine(events, model)
    print(f"\nRaw notes:      {len(events)}")
    print(f"Notes corrected by the grammar: {changed}")
    print(f"Auto tempo:     {bpm:.0f} bpm")
    print(f"\nraw tab:      {tab_of(events)}")
    print(f"refined tab:  {tab_of(qev)}")
    stamp = time.strftime("%Y%m%d_%H%M%S")
    txt = save_refined(qev, bpm, stamp)
    png = graph(events, qev, bpm, os.path.join(REC_DIR, f"refined_{stamp}.png"),
                f"ML refine - {os.path.basename(path)}")
    print(f"\nSaved: {txt}\n       {png}")
    print("\nPlaying the refined version on the harmonica...")
    play(qev)
    return png


def run_generate(n):
    model, n_seed, n_mine = build_model()
    print(f"Trained on {n_seed} seed tunes + {n_mine} of your takes. Generating {n} notes...")
    midis = model.generate(n)
    beat = 60.0 / 110 / 2  # eighth notes at 110 bpm
    events, t = [], 0.0
    for m in midis:
        events.append({"midi": m, "start": t, "dur": beat})
        t += beat
    print("generated tab:", tab_of(events))
    print("\nPlaying a NEW melody in your style...")
    play(events)


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == "--generate":
        run_generate(int(argv[1]) if len(argv) > 1 else 16)
        return
    if argv:
        path = argv[0]
    else:
        takes = sorted(glob.glob(os.path.join(REC_DIR, "take_*.wav")))
        if not takes:
            print("No take_*.wav found. Record one with transcribe.py first, "
                  "or pass a transcript path."); return
        path = takes[-1]
        print("Refining most recent take:", os.path.basename(path))
    run_refine(path)


if __name__ == "__main__":
    main()
