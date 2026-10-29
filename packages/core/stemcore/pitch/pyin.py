"""Monophonic pitch analysis via librosa's pYIN (probabilistic YIN).

Ported from the singing coach's offline pitch analyzer
(apps/coach/backend/app/services/pitch.py) — the same continuous-contour
smoothing and same note segmentation the coach used for its /analyze endpoint.
The original decoded raw upload bytes and returned a plain dict; here the input
is an already-decoded mono float32 array + sample rate, and the output is the
shared domain model (PitchTrack / NoteEvent).

librosa (and scipy, for median smoothing) are imported lazily, so importing this
module never requires them.
"""

from __future__ import annotations

import numpy as np

from ..model import NoteEvent, PitchFrame, PitchTrack

# Vocal range we trust. Anything outside is treated as noise / not a pitch.
# (librosa.note_to_hz: C2 ~= 65.41 Hz, C7 ~= 2093.00 Hz.)
FMIN = 65.40639132514966    # C2
FMAX = 2093.004522404789    # C7

HOP = 256          # ~5.8 ms at 44.1k — fine temporal resolution for a contour
MAX_GAP_S = 0.18   # bridge unvoiced gaps shorter than this (keeps the line flowing)
SMOOTH_MS = 45     # median-smoothing window over the contour


def _hz_to_midi(freq: np.ndarray) -> np.ndarray:
    """Vectorised Hz -> fractional MIDI, NaN-safe."""
    out = np.full_like(freq, np.nan, dtype=float)
    valid = freq > 0
    out[valid] = 69.0 + 12.0 * np.log2(freq[valid] / 440.0)
    return out


def _midi_to_hz(midi: np.ndarray) -> np.ndarray:
    out = np.full_like(midi, np.nan, dtype=float)
    v = ~np.isnan(midi)
    out[v] = 440.0 * 2.0 ** ((midi[v] - 69.0) / 12.0)
    return out


def _continuous(times: np.ndarray, midi: np.ndarray) -> np.ndarray:
    """Turn pYIN's gappy per-frame MIDI into a smooth, continuous contour.

    Interpolates across short unvoiced gaps, median-smooths to kill jitter, and
    re-opens the line only for genuine silence (gaps longer than MAX_GAP_S) and
    before/after the first/last voiced frame.
    """
    from scipy.ndimage import median_filter

    n = len(midi)
    valid = ~np.isnan(midi)
    if valid.sum() < 2:
        return midi.copy()

    idx = np.arange(n)
    vi = idx[valid]
    interp = np.interp(idx, vi, midi[valid])  # fill every gap linearly

    frame_dur = float(times[1] - times[0]) if n > 1 else 0.01
    k = max(3, int(round((SMOOTH_MS / 1000.0) / frame_dur)))
    if k % 2 == 0:
        k += 1
    out = median_filter(interp, size=k, mode="nearest")

    # mask edges + re-open long internal gaps as true silence
    first, last = int(vi[0]), int(vi[-1])
    out[:first] = np.nan
    out[last + 1:] = np.nan
    max_gap = max(1, int(round(MAX_GAP_S / frame_dur)))
    run: int | None = None
    for i in range(first, last + 1):
        if not valid[i]:
            if run is None:
                run = i
        elif run is not None:
            if i - run > max_gap:
                out[run:i] = np.nan
            run = None
    return out


def _pyin_contour(
    audio: np.ndarray,
    sr: int,
    hop: int,
    fmin: float,
    fmax: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Run pYIN and return (times, continuous_midi, voiced_prob).

    ``continuous_midi`` is the smoothed/gap-bridged contour (NaN where unvoiced),
    matching the coach's analyze() behaviour.
    """
    import librosa

    y = np.asarray(audio, dtype=np.float32)
    f0, _voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=float(fmin),
        fmax=float(fmax),
        sr=sr,
        hop_length=hop,
        fill_na=np.nan,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    midi = _continuous(times, _hz_to_midi(f0))
    return times, midi, voiced_prob


def pyin_track(
    audio: np.ndarray,
    sr: int,
    hop: int = HOP,
    fmin: float = FMIN,
    fmax: float = FMAX,
) -> PitchTrack:
    """Estimate a continuous monophonic pitch contour as a :class:`PitchTrack`.

    Each frame's ``f0`` is the smoothed contour in Hz (``None`` where unvoiced)
    and ``confidence`` is pYIN's voiced probability.
    """
    times, midi, voiced_prob = _pyin_contour(audio, sr, hop, fmin, fmax)
    hz = _midi_to_hz(midi)

    frames = [
        PitchFrame(
            t=round(float(t), 4),
            f0=None if np.isnan(h) else round(float(h), 2),
            confidence=round(float(c), 3),
        )
        for t, h, c in zip(times, hz, voiced_prob)
    ]
    return PitchTrack(frames=frames, hop=hop / float(sr), sr=int(sr))


def pyin_notes(
    audio: np.ndarray,
    sr: int,
    hop: int = HOP,
    fmin: float = FMIN,
    fmax: float = FMAX,
    min_dur: float = 0.1,
    merge_gap: float = 0.12,
) -> list[NoteEvent]:
    """Segment the pYIN contour into discrete notes as a list of NoteEvents.

    Consecutive frames that quantise to the same semitone become one note; short
    same-pitch notes separated by a tiny gap are merged.
    """
    times, midi, _voiced_prob = _pyin_contour(audio, sr, hop, fmin, fmax)
    return _segment_notes(times, midi, min_dur=min_dur, merge_gap=merge_gap)


def _segment_notes(
    times: np.ndarray,
    midi: np.ndarray,
    min_dur: float = 0.1,
    merge_gap: float = 0.12,
) -> list[NoteEvent]:
    """Group consecutive frames that quantise to the same semitone into notes."""
    rounded = np.round(midi)  # NaN stays NaN
    raw: list[tuple[int, float, float]] = []  # (midi, start, end)

    start_idx: int | None = None
    cur_pitch = np.nan

    def flush(end_idx: int) -> None:
        nonlocal start_idx
        if start_idx is None:
            return
        seg = midi[start_idx:end_idx]
        seg = seg[~np.isnan(seg)]
        if seg.size and times[end_idx - 1] - times[start_idx] >= min_dur:
            m = int(round(float(np.mean(np.round(seg)))))
            raw.append((m, round(float(times[start_idx]), 3), round(float(times[end_idx - 1]), 3)))
        start_idx = None

    for i, p in enumerate(rounded):
        if np.isnan(p):
            flush(i)
            cur_pitch = np.nan
            continue
        if start_idx is None:
            start_idx = i
            cur_pitch = p
        elif p != cur_pitch:
            flush(i)
            start_idx = i
            cur_pitch = p

    flush(len(rounded))

    # merge adjacent notes of the same pitch separated by a tiny gap
    merged: list[list[float]] = []  # [midi, start, end]
    for m, start, end in raw:
        if merged and int(merged[-1][0]) == m and start - merged[-1][2] <= merge_gap:
            merged[-1][2] = end
        else:
            merged.append([m, start, end])

    return [
        NoteEvent(start=start, dur=round(end - start, 3), midi=int(m))
        for m, start, end in merged
    ]
