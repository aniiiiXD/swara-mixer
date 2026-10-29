"""
viz/pitch_player.py — play audio and watch the pitch scroll by.

The pitch is PRE-PROCESSED once, then replayed: a zoomed, horizontally
scrolling view where the melody flows past a fixed playhead (karaoke style).
Breath / consonant blips are denoised out (low voicing confidence + very short
runs are dropped) so only real sung pitch is drawn.

    from stemcore.viz.pitch_player import play
    play(track, "vocals.wav", title="...")

Controls:
    SPACE  pause/resume        Up/Down  zoom in / out (horizontal)
    Left/Right  scrub          R  restart        Esc  quit
"""

import bisect

import numpy as np
import pygame as pg

from ..model import midi_to_name
from ..pitch.yin import hz_to_midi
from ..pitch.postprocess import octave_guard, remove_short_runs

BG = (16, 18, 22)
FAINT = (66, 60, 74)
BRIGHT = (235, 90, 138)
DOT = (140, 240, 190)
HEAD = (120, 200, 255)
GRID = (40, 42, 48)
TXT = (230, 230, 235)
DIM = (120, 122, 130)

W, H = 1200, 540
ML, MR, MT, MB = 74, 20, 54, 44
PLAYHEAD_FRAC = 0.38          # where the playhead sits across the width


def _series(track, min_conf=0.5, min_run=0.09):
    """Octave-guarded, breath-denoised (t, midi-with-NaN)."""
    t = np.array([f.t for f in track.frames])
    raw = [hz_to_midi(f.f0) if (f.f0 is not None and f.confidence >= min_conf) else None
           for f in track.frames]
    raw = octave_guard(raw)
    raw = remove_short_runs(raw, track.hop, min_run)
    m = np.array([x if x is not None else np.nan for x in raw])
    return t, m


def play(track, audio_path, title="pitch player", view_sec=10.0,
         min_conf=0.5, min_run=0.09):
    t, m = _series(track, min_conf, min_run)
    total = float(t[-1]) if len(t) else 1.0
    valid = m[~np.isnan(m)]
    if len(valid) == 0:
        raise SystemExit("no voiced pitch to show after denoising")
    lo = int(np.floor(valid.min())) - 2
    hi = int(np.ceil(valid.max())) + 2
    tlist = t.tolist()
    voiced_t = t[~np.isnan(m)]
    voiced_m = m[~np.isnan(m)]

    pw, ph = W - ML - MR, H - MT - MB

    def ym(mm):
        return MT + ph - (mm - lo) / (hi - lo) * ph

    pg.init()
    screen = pg.display.set_mode((W, H))
    pg.display.set_caption(title)
    clock = pg.time.Clock()
    font = pg.font.SysFont("menlo,consolas,monospace", 14)
    big = pg.font.SysFont("menlo,consolas,monospace", 40, bold=True)

    try:
        pg.mixer.quit()
        pg.mixer.init(frequency=track.sr)
        pg.mixer.music.load(audio_path)
        pg.mixer.music.play(loops=-1)
        have_audio = True
    except Exception:
        have_audio = False

    start = pg.time.get_ticks()
    pause_off = 0
    pause_at = None
    playing = True
    reason = "unknown"
    loop_start = pg.time.get_ticks()
    frames = 0

    def now_ms():
        return pause_at if not playing else pg.time.get_ticks()

    def draw_curve(color, win_start, i0, i1, tmax=None):
        seg = []
        for i in range(i0, i1):
            if np.isnan(m[i]) or (tmax is not None and t[i] > tmax):
                if len(seg) > 1:
                    pg.draw.aalines(screen, color, False, seg)
                seg = []
                continue
            x = ML + (t[i] - win_start) / view_sec * pw
            seg.append((x, ym(m[i])))
        if len(seg) > 1:
            pg.draw.aalines(screen, color, False, seg)

    running = True
    while running:
        clock.tick(60)
        frames += 1
        for e in pg.event.get():
            if e.type == pg.QUIT:
                running = False; reason = "window closed (QUIT)"
            elif e.type == pg.KEYDOWN:
                if e.key == pg.K_ESCAPE:
                    running = False; reason = "Esc pressed"
                elif e.key == pg.K_SPACE:
                    if playing:
                        if have_audio:
                            pg.mixer.music.pause()
                        pause_at = pg.time.get_ticks(); playing = False
                    else:
                        if have_audio:
                            pg.mixer.music.unpause()
                        pause_off += pg.time.get_ticks() - pause_at; playing = True
                elif e.key == pg.K_r:
                    start = pg.time.get_ticks(); pause_off = 0; playing = True
                    if have_audio:
                        pg.mixer.music.play(loops=-1)
                elif e.key in (pg.K_UP, pg.K_EQUALS, pg.K_PLUS):
                    view_sec = max(3.0, view_sec - 2.0)
                elif e.key in (pg.K_DOWN, pg.K_MINUS):
                    view_sec = min(40.0, view_sec + 2.0)
                elif e.key in (pg.K_LEFT, pg.K_RIGHT):
                    start -= int((3.0 if e.key == pg.K_RIGHT else -3.0) * 1000)
                    h = ((now_ms() - start - pause_off) / 1000.0) % total
                    if have_audio:
                        try:
                            pg.mixer.music.set_pos(h)
                        except Exception:
                            pass

        head = ((now_ms() - start - pause_off) / 1000.0) % total
        win_start = head - view_sec * PLAYHEAD_FRAC
        win_end = win_start + view_sec

        screen.fill(BG)
        # octave gridlines + labels
        for c in range(((lo + 11) // 12) * 12, hi + 1, 12):
            y = int(ym(c))
            pg.draw.line(screen, GRID, (ML, y), (W - MR, y), 1)
            screen.blit(font.render(midi_to_name(c), True, DIM), (8, y - 9))
        # second gridlines within the window
        first_s = int(np.ceil(win_start))
        for s in range(first_s, int(np.floor(win_end)) + 1):
            x = int(ML + (s - win_start) / view_sec * pw)
            pg.draw.line(screen, GRID, (x, MT), (x, MT + ph), 1)
            screen.blit(font.render(f"{s}", True, DIM), (x - 6, H - 26))

        i0 = max(0, bisect.bisect_left(tlist, win_start) - 1)
        i1 = min(len(t), bisect.bisect_right(tlist, win_end) + 1)
        draw_curve(FAINT, win_start, i0, i1)             # whole window, faint
        draw_curve(BRIGHT, win_start, i0, i1, tmax=head)  # played portion, bright

        # fixed playhead
        hx = int(ML + PLAYHEAD_FRAC * pw)
        pg.draw.line(screen, HEAD, (hx, MT), (hx, MT + ph), 2)

        # current note dot + label
        idx = bisect.bisect_left(voiced_t.tolist(), head)
        note_txt = "--"
        if 0 <= idx < len(voiced_t) and abs(voiced_t[idx] - head) < 0.12:
            cm = voiced_m[idx]
            pg.draw.circle(screen, DOT, (hx, int(ym(cm))), 6)
            note_txt = midi_to_name(cm)

        screen.blit(big.render(note_txt, True, TXT), (ML, 6))
        screen.blit(font.render(f"{head:5.1f}/{total:.0f}s  zoom {view_sec:.0f}s", True, DIM), (W - 250, 12))
        screen.blit(font.render("SPACE pause  Up/Down zoom  ←/→ scrub  R restart  Esc", True, DIM),
                    (ML + 110, 16))
        pg.display.flip()

    elapsed = (pg.time.get_ticks() - loop_start) / 1000.0
    print(f"[player] exited after {elapsed:.1f}s, {frames} frames — reason: {reason}", flush=True)
    pg.mixer.quit()
    pg.quit()
