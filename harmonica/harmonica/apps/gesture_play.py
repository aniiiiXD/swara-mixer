"""
main.py — the conductor's podium (gesture control).

    webcam -> gestures.py -> mapping (here) -> synth.py -> speakers

Hybrid control of a real 10-hole harmonica (blow + draw):

    NOTE hand (left):
        x position   -> which hole (1..10)
        upper half   -> BLOW,   lower half -> DRAW
        fist         -> mute

    EXPRESSION hand (right):
        height       -> volume
        tilt         -> pitch bend
        pinch        -> vibrato

Run:   ./.venv/bin/python main.py     (press q or Esc to quit)
"""

import os
import time

import cv2

from ..core import layout
from ..vision.gestures import HandReader
from ..core.synth import HarmonicaSynth
from ..paths import SOUNDFONT

# ---- TUNING -------------------------------------------------------------
CAM_INDEX = 0
SMOOTHING = 0.4         # 0 = instant/jittery, 0.9 = very smooth/laggy
HOLE_HYSTERESIS = 0.03  # resist flicker at hole borders
DRAW_DEADZONE = 0.06    # neutral band around the middle before blow<->draw flips
# -------------------------------------------------------------------------


def lerp(a, b, t):
    return a + (b - a) * t


class Instrument:
    def __init__(self, synth):
        self.synth = synth
        self.volume = 0.8
        self.bend = 0.0
        self.vibrato = 0.0
        self.hole = None
        self.draw = False
        self.sounding = False

    def update(self, features):
        note = features['note']
        expr = features['expr']

        if note is None or note['fist']:
            if self.sounding:
                self.synth.note_off()
                self.sounding = False
            self.hole = None
        else:
            new_hole = layout.x_to_hole(note['x'])
            if self.hole is not None and new_hole != self.hole:
                border = max(new_hole, self.hole) / layout.NUM_HOLES
                if abs(note['x'] - border) < HOLE_HYSTERESIS:
                    new_hole = self.hole
            self.hole = new_hole

            # upper half = blow, lower half = draw, with a neutral deadzone
            if note['y'] < 0.5 - DRAW_DEADZONE:
                self.draw = False
            elif note['y'] > 0.5 + DRAW_DEADZONE:
                self.draw = True
            # else: keep previous direction

            self.synth.set_note(layout.note(self.hole, self.draw))
            self.sounding = True

        if expr is not None:
            self.volume = lerp(self.volume, expr['volume'], 1 - SMOOTHING)
            self.bend = lerp(self.bend, expr['bend'], 1 - SMOOTHING)
            self.vibrato = lerp(self.vibrato, expr['vibrato'], 1 - SMOOTHING)
        else:
            self.volume = lerp(self.volume, 0.8, 1 - SMOOTHING)
            self.bend = lerp(self.bend, 0.0, 1 - SMOOTHING)
            self.vibrato = lerp(self.vibrato, 0.0, 1 - SMOOTHING)

        self.synth.set_volume(self.volume)
        self.synth.set_bend(self.bend)
        self.synth.set_vibrato(self.vibrato)


# ---------------------------------------------------------------- overlay
WHITE = (255, 255, 255)
DIM = (120, 120, 120)
BLOW_COL = (245, 170, 90)    # note: OpenCV is BGR -> this renders blue-ish
DRAW_COL = (80, 150, 245)    # renders orange-ish
BAR_BG = (60, 60, 60)


def draw_overlay(frame, inst, fps):
    h, w = frame.shape[:2]
    mid = h // 2

    for hole in range(layout.NUM_HOLES):
        x0 = int(hole / layout.NUM_HOLES * w)
        x1 = int((hole + 1) / layout.NUM_HOLES * w)
        cv2.line(frame, (x1, 0), (x1, h), DIM, 1)

        active = (hole == inst.hole and inst.sounding)
        # highlight the active cell (top=blow, bottom=draw)
        if active:
            col = DRAW_COL if inst.draw else BLOW_COL
            y0, y1 = (mid, h) if inst.draw else (0, mid)
            overlay = frame.copy()
            cv2.rectangle(overlay, (x0, y0), (x1, y1), col, -1)
            cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)

        # note names: blow (top), draw (bottom)
        cv2.putText(frame, layout.note_name(hole, False), (x0 + 6, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    BLOW_COL if (active and not inst.draw) else WHITE, 1, cv2.LINE_AA)
        cv2.putText(frame, layout.note_name(hole, True), (x0 + 6, h - 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    DRAW_COL if (active and inst.draw) else WHITE, 1, cv2.LINE_AA)
        cv2.putText(frame, str(hole + 1), (x0 + 6, mid + 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, DIM, 1, cv2.LINE_AA)

    cv2.line(frame, (0, mid), (w, mid), DIM, 1)  # blow/draw divider

    # volume meter
    mx0, mx1 = w - 26, w - 12
    my0, my1 = 50, h - 50
    cv2.rectangle(frame, (mx0, my0), (mx1, my1), BAR_BG, -1)
    fill = int(my1 - (my1 - my0) * inst.volume)
    cv2.rectangle(frame, (mx0, fill), (mx1, my1), (80, 220, 120), -1)

    if inst.sounding and inst.hole is not None:
        status = f"{layout.note_name(inst.hole, inst.draw)}  {'DRAW' if inst.draw else 'BLOW'}  (hole {inst.hole + 1})"
    else:
        status = "-- (fist = mute)"
    lines = [status, f"bend {inst.bend:+.2f} st", f"vibr {inst.vibrato:0.2f}", f"fps {fps:4.1f}"]
    for i, t in enumerate(lines):
        cv2.putText(frame, t, (12, 60 + i * 22),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 1, cv2.LINE_AA)

    hint = "LEFT: x=hole, up=blow/down=draw, fist=mute   RIGHT: height=vol tilt=bend pinch=vibrato   [q]=quit"
    cv2.putText(frame, hint, (12, h - 6),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, DIM, 1, cv2.LINE_AA)


# ------------------------------------------------------------------- main
def main():
    if not os.path.exists(SOUNDFONT):
        raise SystemExit(f"Soundfont not found: {SOUNDFONT}")

    synth = HarmonicaSynth(SOUNDFONT)
    reader = HandReader()
    inst = Instrument(synth)

    cap = cv2.VideoCapture(CAM_INDEX)
    if not cap.isOpened():
        synth.close()
        reader.close()
        raise SystemExit(
            "Could not open the webcam. On macOS, grant Camera permission to your "
            "terminal app in System Settings > Privacy & Security > Camera, then retry."
        )

    print("Harmonica orchestrator running. Show your hands. Press 'q' to quit.")
    prev = time.time()
    fps = 0.0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame = cv2.flip(frame, 1)
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

            features, hands = reader.process(rgb)
            inst.update(features)
            reader.draw(frame, hands)

            now = time.time()
            fps = 0.9 * fps + 0.1 * (1.0 / max(now - prev, 1e-6))
            prev = now
            draw_overlay(frame, inst, fps)

            cv2.imshow("Harmonica Orchestrator", frame)
            if (cv2.waitKey(1) & 0xFF) in (ord('q'), 27):
                break
    finally:
        synth.close()
        reader.close()
        cap.release()
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
