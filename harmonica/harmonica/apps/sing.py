"""
sing.py — sing or hum, and the harmonica plays what you sing.

    mic -> YIN pitch detector -> snap to nearest C-harmonica note -> synth.py
                                                                   -> live tab

Your voice is quantized to notes a real C diatonic harp can actually play, and
octave-folded into its range so a low hum still lands melodically. As you sing,
it plays the harmonica live AND builds a transcription in harmonica tab
(e.g.  4 -4 5 6  where -4 = draw hole 4). Press Esc to quit; the tab is saved.

Run:  ./.venv/bin/python sing.py

macOS: the first run needs Microphone permission for your terminal app
(System Settings > Privacy & Security > Microphone).
"""

import collections
import os
import time

import numpy as np
import pygame as pg
import sounddevice as sd

from stemcore.model import NAMES, midi_name
from stemcore.instruments.harmonica import AVAIL, LO, HI, snap_to_harp, harp_hole, tab_token
from stemcore.pitch.yin import YinPitch, hz_to_midi
from stemcore.render.realtime import RealtimeSynth as HarmonicaSynth
from ..paths import SOUNDFONT, REC_DIR

# ---- TUNING ----
SR = 44100
BLOCK = 2048          # ~46 ms analysis window
DEVICE = None         # None = system default mic; or an index from `sing.py --devices`
RMS_GATE = 0.010      # below this loudness = silence (no note)
CONF_GATE = 0.55      # minimum YIN confidence to trust a pitch
MEDIAN_LEN = 5        # frames of median smoothing (kills octave jitter)
STABLE_FRAMES = 2     # a note must persist this many frames before it commits
# ----------------

# harp-mapping helpers (NAMES, AVAIL, snap_to_harp, harp_hole, tab_token, ...)
# now live in harp_map.py so sing.py and transcribe.py share identical mapping.

# ---- shared audio buffer (filled by the PortAudio thread) ----
_latest = np.zeros(BLOCK, dtype=np.float32)
_seq = 0


def _callback(indata, frames, time_info, status):
    global _latest, _seq
    _latest = indata[:, 0].copy()
    _seq += 1


def main():
    if not os.path.exists(SOUNDFONT):
        raise SystemExit(f"Soundfont not found: {SOUNDFONT}")
    os.makedirs(REC_DIR, exist_ok=True)

    synth = HarmonicaSynth(SOUNDFONT)
    synth.set_volume(0.95)
    yin = YinPitch(SR)

    pg.init()
    screen = pg.display.set_mode((760, 420))
    pg.display.set_caption("Sing -> Harmonica")
    clock = pg.time.Clock()
    f_small = pg.font.SysFont("menlo,consolas,monospace", 15)
    f_med = pg.font.SysFont("menlo,consolas,monospace", 22)
    f_big = pg.font.SysFont("menlo,consolas,monospace", 40, bold=True)

    hist = collections.deque(maxlen=MEDIAN_LEN)
    tab = []                     # list of (token, note_name, t) — the transcription
    current_note = None          # midi currently sounding
    desired_prev = None
    stable = 0
    last_seq = -1
    octave_shift = 1             # where your voice lands on the harp; +/- with Up/Down

    # live display state
    sung_hz = 0.0
    sung_note = "--"
    conf = 0.0
    rms = 0.0

    BG = (18, 20, 24); FG = (230, 230, 230); DIM = (110, 110, 120)
    BLOW_C = (90, 170, 245); DRAW_C = (245, 150, 80); GREEN = (80, 220, 120)

    try:
        stream = sd.InputStream(channels=1, samplerate=SR, blocksize=BLOCK,
                                dtype="float32", device=DEVICE, callback=_callback)
        stream.start()
    except Exception as e:
        synth.close(); pg.quit()
        raise SystemExit(
            f"Could not open the microphone ({e!r}).\nOn macOS grant Microphone "
            "permission to your terminal in System Settings > Privacy & Security > Microphone."
        )

    running = True
    while running:
        clock.tick(120)
        for e in pg.event.get():
            if e.type == pg.QUIT or (e.type == pg.KEYDOWN and e.key == pg.K_ESCAPE):
                running = False
            elif e.type == pg.KEYDOWN and e.key == pg.K_UP:
                octave_shift = min(octave_shift + 1, 2)   # 0 low, 1 mid, 2 high
            elif e.type == pg.KEYDOWN and e.key == pg.K_DOWN:
                octave_shift = max(octave_shift - 1, 0)

        # process only when a fresh audio block has arrived
        if _seq != last_seq:
            last_seq = _seq
            block = _latest
            rms = float(np.sqrt(np.mean(block * block)) + 1e-12)

            voiced = False
            if rms >= RMS_GATE:
                f0, conf = yin(block)
                if f0 is not None and conf >= CONF_GATE:
                    voiced = True
                    sung_hz = f0
                    m = hz_to_midi(f0)
                    sung_note = midi_name(m)
                    hist.append(m)
            if not voiced:
                conf = conf if rms >= RMS_GATE else 0.0
                hist.clear()

            # smoothed target note
            if voiced and hist:
                target = snap_to_harp(int(round(float(np.median(hist)))), octave_shift)
            else:
                target = None

            # commit only after the target is stable for a few frames (debounce)
            if target == desired_prev:
                stable += 1
            else:
                stable = 0
            desired_prev = target

            if stable >= STABLE_FRAMES and target != current_note:
                current_note = target
                if current_note is None:
                    synth.note_off()
                else:
                    synth.set_note(current_note)
                    hole, draw = harp_hole(current_note)
                    tab.append((tab_token(hole, draw), midi_name(current_note), time.time()))

        # ---- draw ----
        screen.fill(BG)
        screen.blit(f_med.render("SING  ->  HARMONICA", True, FG), (24, 18))

        # what you're singing
        screen.blit(f_small.render("you sing", True, DIM), (24, 70))
        screen.blit(f_big.render(f"{sung_note:>4}", True, FG), (24, 90))
        screen.blit(f_small.render(f"{sung_hz:7.1f} Hz", True, DIM), (170, 108))

        # what the harp plays
        screen.blit(f_small.render("harmonica plays", True, DIM), (24, 160))
        if current_note is not None:
            hole, draw = harp_hole(current_note)
            col = DRAW_C if draw else BLOW_C
            screen.blit(f_big.render(tab_token(hole, draw), True, col), (24, 180))
            txt = f"{midi_name(current_note)}   hole {hole + 1}   {'DRAW' if draw else 'BLOW'}"
            screen.blit(f_med.render(txt, True, col), (120, 192))
        else:
            screen.blit(f_big.render("--", True, DIM), (24, 180))

        # meters
        def meter(x, label, val, col):
            screen.blit(f_small.render(label, True, DIM), (x, 250))
            pg.draw.rect(screen, (45, 48, 54), (x, 270, 180, 14), border_radius=4)
            pg.draw.rect(screen, col, (x, 270, int(180 * max(0, min(1, val))), 14), border_radius=4)
        meter(24, "volume", min(1.0, rms / 0.1), GREEN)
        meter(230, "confidence", conf, GREEN)

        # rolling tab transcription
        screen.blit(f_small.render("transcription (harmonica tab):", True, DIM), (24, 306))
        recent = " ".join(t[0] for t in tab[-26:]) or "(sing something...)"
        screen.blit(f_med.render(recent, True, GREEN), (24, 328))

        # octave placement indicator (top-right)
        oct_txt = f"octave shift  {octave_shift:+d}   (Up/Down)"
        screen.blit(f_small.render(oct_txt, True, FG), (470, 74))
        screen.blit(f_small.render("higher = reaches higher holes", True, DIM), (470, 94))

        hint = f"{len(tab)} notes captured   |   Up/Down = octave   |   Esc to quit + save tab"
        screen.blit(f_small.render(hint, True, DIM), (24, 396))
        pg.display.flip()

    # ---- shutdown + save transcription ----
    stream.stop(); stream.close()
    synth.close(); pg.quit()

    if tab:
        stamp = time.strftime("%Y%m%d_%H%M%S")
        path = os.path.join(REC_DIR, f"vocal_{stamp}.txt")
        t0 = tab[0][2]
        with open(path, "w") as fp:
            fp.write("# Sing->Harmonica transcription (C diatonic). '-' = draw.\n")
            fp.write("tab:   " + " ".join(t[0] for t in tab) + "\n")
            fp.write("notes: " + " ".join(t[1] for t in tab) + "\n\n")
            fp.write("# onset_seconds  tab  note\n")
            for tok, note, ts in tab:
                fp.write(f"{ts - t0:7.2f}  {tok:>4}  {note}\n")
        print(f"Saved {len(tab)} notes -> {path}")
    else:
        print("No notes captured.")


if __name__ == "__main__":
    import sys
    if "--devices" in sys.argv:
        print(sd.query_devices())
    else:
        main()
