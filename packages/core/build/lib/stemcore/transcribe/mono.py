"""
transcribe/mono.py — monophonic transcription (audio -> notes).

Extracted from the harmonica offline transcriber. Runs a YIN pitch track across
a clip, median-smooths it, and segments it into notes with a debounce so vocal
wobble doesn't split one held note into many. Returns domain `NoteEvent`s.
"""

import numpy as np

from ..model import NoteEvent, PitchFrame, PitchTrack
from ..pitch.yin import YinPitch, hz_to_midi

# analysis defaults
HOP = 512             # ~11.6 ms @ 44.1k
WIN = 2048            # ~46 ms
RMS_GATE = 0.008
CONF_GATE = 0.50
MEDIAN_K = 9          # pitch-track median filter (odd)
MIN_NOTE = 0.12       # discard notes shorter than this (s)
GAP_MERGE = 0.06      # bridge silences shorter than this between equal notes
DEBOUNCE_S = 0.07     # a new pitch must hold this long before ending a note


def pitch_track(audio, sr, hop=HOP, win=WIN,
                rms_gate=RMS_GATE, conf_gate=CONF_GATE) -> PitchTrack:
    """Frame-by-frame monophonic pitch of a clip -> PitchTrack."""
    y = np.asarray(audio, dtype=np.float32)
    yin = YinPitch(sr)
    frames = []
    for i in range(0, max(1, len(y) - win), hop):
        block = y[i:i + win]
        rms = float(np.sqrt(np.mean(block * block)) + 1e-12)
        t = i / sr
        if rms < rms_gate:
            frames.append(PitchFrame(t, None, 0.0))
            continue
        f0, conf = yin(block)
        if f0 is not None and conf >= conf_gate:
            frames.append(PitchFrame(t, float(f0), float(conf)))
        else:
            frames.append(PitchFrame(t, None, float(conf if f0 is not None else 0.0)))
    return PitchTrack(frames=frames, hop=hop / sr, sr=sr)


def _median_track(vals, k):
    half = k // 2
    out = []
    for i in range(len(vals)):
        window = [v for v in vals[max(0, i - half): i + half + 1] if v is not None]
        out.append(float(np.median(window)) if window else None)
    return out


def _segment_debounced(semis, hop_s):
    debounce = max(1, int(round(DEBOUNCE_S / hop_s)))

    def t(i):
        return i * hop_s

    events = []
    cur, cur_start = None, 0
    cand, cand_start, cand_n = None, 0, 0
    for i, s in enumerate(semis):
        if s == cur:
            cand, cand_n = None, 0
            continue
        if s == cand:
            cand_n += 1
        else:
            cand, cand_start, cand_n = s, i, 1
        if cand_n >= debounce:
            if cur is not None:
                dur = t(cand_start) - t(cur_start)
                if dur >= MIN_NOTE:
                    events.append(NoteEvent(start=t(cur_start), dur=dur, midi=cur))
            cur, cur_start = cand, cand_start
            cand, cand_n = None, 0
    if cur is not None:
        dur = t(len(semis)) - t(cur_start)
        if dur >= MIN_NOTE:
            events.append(NoteEvent(start=t(cur_start), dur=dur, midi=cur))
    return events


def transcribe_mono(audio, sr) -> list[NoteEvent]:
    """Audio -> list[NoteEvent] (monophonic)."""
    track = pitch_track(audio, sr)
    hop_s = track.hop
    raw = [f.f0 and hz_to_midi(f.f0) for f in track.frames]  # None stays None
    smoothed = _median_track(raw, MEDIAN_K)
    semis = [int(round(m)) if m is not None else None for m in smoothed]

    # bridge tiny silences between two equal notes (a brief consonant/breath)
    gap_frames = int(GAP_MERGE / hop_s)
    i = 0
    while i < len(semis):
        if semis[i] is None:
            j = i
            while j < len(semis) and semis[j] is None:
                j += 1
            left = semis[i - 1] if i > 0 else None
            right = semis[j] if j < len(semis) else None
            if left is not None and left == right and (j - i) <= gap_frames:
                for k in range(i, j):
                    semis[k] = left
            i = j
        else:
            i += 1

    return _segment_debounced(semis, hop_s)
