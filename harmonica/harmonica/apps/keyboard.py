"""
keyboard_play.py — play the harmonica with your computer keyboard.

Models a real 10-hole diatonic harmonica: every hole has a BLOW note and a
DRAW note. The two keyboard rows are stacked to mirror a harp — the top row
is BLOW, the row right below it is DRAW, and each column is one hole:

    BLOW   Q  W  E  R  T  Y  U  I  O  P     (holes 1-10 blow)
    DRAW   A  S  D  F  G  H  J  K  L  ;     (holes 1-10 draw)

    VOLUME   up / down arrow    (hold)
    BEND     left / right arrow (hold, springs back)
    VIBRATO  space              (hold)
    QUIT     Esc

Monophonic (a single breath): the most recently pressed key that is still held
sounds; release it and the previously held note returns. On a real harp you
can't blow and draw the same breath — here, the newest key simply wins.

Run:  ./.venv/bin/python keyboard_play.py
"""

import os

import pygame as pg

from ..core import layout
from ..core.synth import HarmonicaSynth
from ..paths import SOUNDFONT

# key -> (hole index 0..9, draw?)  — columns line up physically on a QWERTY board
BLOW_ROW = [pg.K_q, pg.K_w, pg.K_e, pg.K_r, pg.K_t, pg.K_y, pg.K_u, pg.K_i, pg.K_o, pg.K_p]
DRAW_ROW = [pg.K_a, pg.K_s, pg.K_d, pg.K_f, pg.K_g, pg.K_h, pg.K_j, pg.K_k, pg.K_l, pg.K_SEMICOLON]
BLOW_LABELS = ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"]
DRAW_LABELS = ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";"]

NOTE_KEYS = {}
for h, k in enumerate(BLOW_ROW):
    NOTE_KEYS[k] = (h, False)
for h, k in enumerate(DRAW_ROW):
    NOTE_KEYS[k] = (h, True)

# feel
VOL_RATE = 1.6
BEND_SPRING = 12.0
VIB_SPRING = 10.0

BG = (18, 20, 24)
FG = (230, 230, 230)
DIM = (110, 110, 120)
BLOW_COL = (90, 170, 245)   # blue-ish = blow (out)
DRAW_COL = (245, 150, 80)   # orange-ish = draw (in)
CELL = (40, 44, 50)


def main():
    if not os.path.exists(SOUNDFONT):
        raise SystemExit(f"Soundfont not found: {SOUNDFONT}")

    synth = HarmonicaSynth(SOUNDFONT)

    pg.init()
    screen = pg.display.set_mode((760, 420))
    pg.display.set_caption("Harmonica — Keyboard (blow / draw)")
    clock = pg.time.Clock()
    font = pg.font.SysFont("menlo,consolas,monospace", 18)
    small = pg.font.SysFont("menlo,consolas,monospace", 14)
    big = pg.font.SysFont("menlo,consolas,monospace", 34, bold=True)

    held = []          # stack of (hole, draw)
    volume = 0.8
    bend = 0.0
    vibrato = 0.0
    current = None

    running = True
    while running:
        dt = clock.tick(120) / 1000.0

        for e in pg.event.get():
            if e.type == pg.QUIT:
                running = False
            elif e.type == pg.KEYDOWN:
                if e.key == pg.K_ESCAPE:
                    running = False
                elif e.key in NOTE_KEYS:
                    hd = NOTE_KEYS[e.key]
                    if hd in held:
                        held.remove(hd)
                    held.append(hd)
            elif e.type == pg.KEYUP:
                if e.key in NOTE_KEYS and NOTE_KEYS[e.key] in held:
                    held.remove(NOTE_KEYS[e.key])

        keys = pg.key.get_pressed()
        if keys[pg.K_UP]:
            volume = min(1.0, volume + VOL_RATE * dt)
        if keys[pg.K_DOWN]:
            volume = max(0.0, volume - VOL_RATE * dt)
        bend_target = (2.0 if keys[pg.K_RIGHT] else 0.0) - (2.0 if keys[pg.K_LEFT] else 0.0)
        bend += (bend_target - bend) * min(1.0, BEND_SPRING * dt)
        vib_target = 1.0 if keys[pg.K_SPACE] else 0.0
        vibrato += (vib_target - vibrato) * min(1.0, VIB_SPRING * dt)

        current = held[-1] if held else None
        note = layout.note(*current) if current else None
        synth.set_note(note)  # set_note() is legato — only re-triggers on change
        synth.set_volume(volume)
        synth.set_bend(bend)
        synth.set_vibrato(vibrato)

        # ---- draw ----
        screen.fill(BG)
        screen.blit(big.render("HARMONICA", True, FG), (24, 16))

        # direction indicator
        if current is not None:
            is_draw = current[1]
            dcol = DRAW_COL if is_draw else BLOW_COL
            screen.blit(big.render("DRAW" if is_draw else "BLOW", True, dcol), (560, 16))

        # two rows of 10 holes
        n = layout.NUM_HOLES
        cw, ch, gap = 64, 74, 8
        x0 = 24
        y_blow = 90
        y_draw = y_blow + ch + gap

        for h in range(n):
            x = x0 + h * (cw + gap)
            # blow cell (top)
            active_b = (current == (h, False))
            rb = pg.Rect(x, y_blow, cw, ch)
            pg.draw.rect(screen, BLOW_COL if active_b else CELL, rb, border_radius=8)
            cb = BG if active_b else FG
            screen.blit(small.render(BLOW_LABELS[h], True, cb), (x + 6, y_blow + 6))
            screen.blit(font.render(layout.note_name(h, False), True, cb), (x + 8, y_blow + 40))
            # draw cell (bottom)
            active_d = (current == (h, True))
            rd = pg.Rect(x, y_draw, cw, ch)
            pg.draw.rect(screen, DRAW_COL if active_d else CELL, rd, border_radius=8)
            cd = BG if active_d else FG
            screen.blit(small.render(DRAW_LABELS[h], True, cd), (x + 6, y_draw + 6))
            screen.blit(font.render(layout.note_name(h, True), True, cd), (x + 8, y_draw + 40))
            # hole number between rows
            screen.blit(small.render(str(h + 1), True, DIM), (x + cw // 2 - 4, y_blow + ch + gap // 2 - 8))

        # readouts
        note_txt = layout.note_name(*current) if current else "--"
        dir_txt = ("DRAW" if current[1] else "BLOW") if current else "--"
        y = y_draw + ch + 18
        lines = [
            f"note    {note_txt:>4}   ({dir_txt})",
            f"volume  {'#' * int(volume * 20):<20} {volume:0.2f}",
            f"bend    {bend:+0.2f} st",
            f"vibrato {'#' * int(vibrato * 20):<20} {vibrato:0.2f}",
        ]
        for i, t in enumerate(lines):
            screen.blit(small.render(t, True, FG), (24, y + i * 20))

        hint = "top row Q..P = BLOW   bottom row A..; = DRAW   up/down volume  left/right bend  space vibrato  Esc quit"
        screen.blit(small.render(hint, True, DIM), (24, 398))

        pg.display.flip()

    synth.close()
    pg.quit()


if __name__ == "__main__":
    main()
