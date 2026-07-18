"""
gestures.py — hand tracking + feature extraction (Layer 2/3).

Uses MediaPipe's current *Tasks* HandLandmarker API. Turns raw landmarks into
the two "roles" of the hybrid instrument:

    NOTE hand      (the hand further LEFT on screen)
        - x position  -> which note (zone)
        - fist        -> silence (stop sounding)

    EXPRESSION hand (the hand further RIGHT on screen)
        - height      -> volume
        - tilt        -> pitch bend
        - pinch       -> vibrato

Roles are assigned by screen position, NOT by handedness label — more robust,
and a single hand simply becomes the NOTE hand so you can start with one hand.

Tweak the mappings here freely; the sound engine never changes.
"""

import math
import os

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

from ..paths import HAND_MODEL as MODEL_PATH

# Landmark indices
WRIST = 0
THUMB_TIP = 4
INDEX_TIP = 8
INDEX_PIP = 6
MIDDLE_MCP = 9   # stable "center of hand"
MIDDLE_TIP = 12
MIDDLE_PIP = 10
RING_TIP = 16
RING_PIP = 14
PINKY_TIP = 20
PINKY_PIP = 18

# 21-point hand skeleton for drawing
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),            # thumb
    (0, 5), (5, 6), (6, 7), (7, 8),            # index
    (5, 9), (9, 10), (10, 11), (11, 12),       # middle
    (9, 13), (13, 14), (14, 15), (15, 16),     # ring
    (13, 17), (17, 18), (18, 19), (19, 20),    # pinky
    (0, 17),                                   # palm base
]


def _dist(a, b):
    return math.hypot(a.x - b.x, a.y - b.y)


def _extended_fingers(lm):
    """Count extended fingers (ignores thumb): a finger is 'extended' when its
    tip is further from the wrist than its middle knuckle (pip)."""
    wrist = lm[WRIST]
    count = 0
    for tip, pip in ((INDEX_TIP, INDEX_PIP), (MIDDLE_TIP, MIDDLE_PIP),
                     (RING_TIP, RING_PIP), (PINKY_TIP, PINKY_PIP)):
        if _dist(lm[tip], wrist) > _dist(lm[pip], wrist) * 1.05:
            count += 1
    return count


class HandReader:
    def __init__(self):
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Hand model not found: {MODEL_PATH}")
        options = vision.HandLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=2,
            min_hand_detection_confidence=0.6,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.landmarker = vision.HandLandmarker.create_from_options(options)
        self._t = 0  # monotonically increasing timestamp (ms) for VIDEO mode

    def process(self, rgb_frame):
        """Returns (features, hand_landmark_lists) for one frame.

        features = {
          'note':  {'x','y','fist'} or None,
          'expr':  {'volume','bend','vibrato','y'} or None,
        }
        """
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        self._t += 33  # ~30fps; just needs to strictly increase
        result = self.landmarker.detect_for_video(mp_image, self._t)

        hands = result.hand_landmarks or []
        if not hands:
            return {'note': None, 'expr': None}, hands

        # Leftmost hand (smallest x) = note hand.
        hands_sorted = sorted(hands, key=lambda h: h[MIDDLE_MCP].x)
        note_hand = hands_sorted[0]
        expr_hand = hands_sorted[1] if len(hands_sorted) > 1 else None

        features = {
            'note': self._note_features(note_hand),
            'expr': self._expr_features(expr_hand) if expr_hand else None,
        }
        return features, hands

    def _note_features(self, lm):
        center = lm[MIDDLE_MCP]
        return {'x': center.x, 'y': center.y, 'fist': _extended_fingers(lm) <= 1}

    def _expr_features(self, lm):
        center = lm[MIDDLE_MCP]

        # Volume: higher hand -> louder (y grows downward, so invert).
        volume = 1.0 - center.y

        # Bend: tilt of wrist->middle-knuckle vector from straight up.
        dx = lm[MIDDLE_MCP].x - lm[WRIST].x
        dy = lm[MIDDLE_MCP].y - lm[WRIST].y
        angle = math.degrees(math.atan2(dx, -dy))       # 0 = straight up
        bend = max(-2.0, min(2.0, angle / 30.0 * 2.0))   # +/-30deg -> +/-2 semis

        # Vibrato: thumb+index pinch, normalized by hand size. Tighter = more.
        hand_size = _dist(lm[WRIST], lm[MIDDLE_MCP]) + 1e-6
        pinch = _dist(lm[THUMB_TIP], lm[INDEX_TIP]) / hand_size
        vibrato = max(0.0, min(1.0, 1.0 - pinch / 0.9))

        return {'volume': volume, 'bend': bend, 'vibrato': vibrato, 'y': center.y}

    def draw(self, bgr_frame, hand_landmark_lists):
        h, w = bgr_frame.shape[:2]
        for lm in hand_landmark_lists:
            pts = [(int(p.x * w), int(p.y * h)) for p in lm]
            for a, b in HAND_CONNECTIONS:
                cv2.line(bgr_frame, pts[a], pts[b], (200, 200, 200), 2, cv2.LINE_AA)
            for (x, y) in pts:
                cv2.circle(bgr_frame, (x, y), 4, (80, 220, 120), -1, cv2.LINE_AA)

    def close(self):
        self.landmarker.close()
