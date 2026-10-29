"""Score a performance against a reference melody with subsequence DTW.

Ported from the singing coach's scorer
(apps/coach/backend/app/services/scoring.py). The core algorithm is unchanged:
resample both contours to a uniform 50 ms grid, align the (shorter) take to the
best portion of the reference with subsequence DTW over absolute-semitone cost,
then derive an intonation score (median semitone error), a timing score (how
straight the warping path is), and a per-reference-note breakdown.

The original only accepted the coach's analyze() dicts. This version is
generalized to also accept the shared domain model — a ``PitchTrack`` (or list
of ``PitchFrame``), a ``list[NoteEvent]``, or a ``(times, midi)`` array tuple —
on either side. numpy + librosa are imported lazily.
"""

from __future__ import annotations

import numpy as np

from .model import NoteEvent, PitchFrame, PitchTrack, midi_to_name

GRID = 0.05  # 50 ms scoring grid — coarse enough to keep DTW cheap


def _hz_to_midi_scalar(hz: float) -> float:
    return 69.0 + 12.0 * np.log2(hz / 440.0)


def _points(obj) -> tuple[np.ndarray, np.ndarray]:
    """Reduce any accepted input to (times, midi) sample arrays (midi may be NaN).

    Accepts: PitchTrack, list[PitchFrame], list[NoteEvent], the coach's legacy
    analyze() dict, or a ``(times, midi)`` tuple of arrays.
    """
    # Legacy analyze() dict: {"contour": [{"t", "midi", ...}], "notes": [...]}
    if isinstance(obj, dict):
        c = obj.get("contour", [])
        t = np.array([p["t"] for p in c], dtype=float)
        m = np.array([np.nan if p["midi"] is None else p["midi"] for p in c], dtype=float)
        return t, m

    if isinstance(obj, PitchTrack):
        return _frames_to_points(obj.frames)

    if isinstance(obj, (list, tuple)):
        # (times, midi) array tuple
        if (
            len(obj) == 2
            and all(isinstance(x, (np.ndarray, list, tuple)) for x in obj)
        ):
            t = np.asarray(obj[0], dtype=float)
            m = np.asarray(obj[1], dtype=float)
            return t, m
        if obj and isinstance(obj[0], PitchFrame):
            return _frames_to_points(list(obj))
        if obj and isinstance(obj[0], NoteEvent):
            return _notes_to_points(list(obj))
        return np.array([]), np.array([])

    raise TypeError(f"Unsupported input to score(): {type(obj)!r}")


def _frames_to_points(frames: list[PitchFrame]) -> tuple[np.ndarray, np.ndarray]:
    t = np.array([f.t for f in frames], dtype=float)
    m = np.array(
        [np.nan if f.f0 is None else _hz_to_midi_scalar(f.f0) for f in frames],
        dtype=float,
    )
    return t, m


def _notes_to_points(notes: list[NoteEvent]) -> tuple[np.ndarray, np.ndarray]:
    """Sample a note list onto the scoring grid as a step contour."""
    if not notes:
        return np.array([]), np.array([])
    end = max(n.end for n in notes)
    grid = np.arange(0.0, float(end) + 1e-6, GRID)
    m = np.full(grid.shape, np.nan)
    for n in notes:
        active = (grid >= n.start) & (grid < n.end)
        m[active] = n.midi
    return grid, m


def _to_grid(obj) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Resample any accepted input to a uniform grid.

    Returns (times, filled_midi, voiced_mask). ``filled_midi`` is interpolated
    across gaps for alignment; the mask records where pitch was actually present.
    """
    t, m = _points(obj)
    if t.size == 0:
        return np.array([]), np.array([]), np.array([])

    grid = np.arange(0.0, float(t[-1]) + 1e-6, GRID)
    valid = ~np.isnan(m)
    if valid.sum() < 2:
        return grid, np.full(grid.shape, np.nan), np.zeros(grid.shape, bool)

    filled = np.interp(grid, t[valid], m[valid])
    # voiced if the nearest source frame was voiced
    nearest = np.searchsorted(t, grid).clip(0, len(t) - 1)
    mask = valid[nearest]
    return grid, filled, mask


def _ref_notes(obj) -> list[dict]:
    """Reference notes for the per-note breakdown, as {midi,name,start,end} dicts."""
    if isinstance(obj, dict):
        return list(obj.get("notes", []))
    if isinstance(obj, (list, tuple)) and obj and isinstance(obj[0], NoteEvent):
        return [
            {"midi": n.midi, "name": n.name, "start": n.start, "end": n.end}
            for n in obj
        ]
    return []  # PitchTrack / arrays carry no note segmentation


def _note_base(n: dict) -> dict:
    name = n.get("name") or midi_to_name(n["midi"])
    return {"midi": n["midi"], "name": name, "start": n["start"], "end": n["end"]}


def score(reference, take) -> dict:
    """Compare ``take`` against ``reference`` and return scores + note breakdown.

    Both arguments accept a PitchTrack, list[PitchFrame], list[NoteEvent], the
    coach's legacy analyze() dict, or a (times, midi) array tuple.
    """
    import librosa

    rg, rf, rv = _to_grid(reference)
    ug, uf, uv = _to_grid(take)
    # A timeline can have many frames while still containing no voiced pitch.
    # Do not hand NaNs to librosa's DTW implementation for silent takes.
    if rf.size < 2 or uf.size < 2 or rv.sum() < 2 or uv.sum() < 2:
        return {"overall": 0, "intonation": 0, "timing": 0,
                "median_cents_error": None, "notes": []}

    # subsequence DTW: match the (shorter) take to the best portion of the
    # reference. Cost = absolute semitone distance (singers match the octave
    # they hear, so no octave folding).
    C = np.abs(uf[:, None] - rf[None, :]).astype(np.float64)
    _, wp = librosa.sequence.dtw(C=C, subseq=True)
    wp = wp[::-1]  # ascending (take_idx, ref_idx)

    errs = []
    for ui, ri in wp:
        if uv[ui] and rv[ri]:
            errs.append(abs(uf[ui] - rf[ri]))
    err = np.array(errs) if errs else np.array([99.0])
    median_err = float(np.median(err))
    intonation = max(0.0, 100.0 * (1.0 - median_err / 1.0))  # 1 semitone off -> 0

    # timing: how straight the warping path is (deviation from its own diagonal)
    wp_arr = np.array(wp, dtype=float)
    ui_n = (wp_arr[:, 0] - wp_arr[0, 0]) / max(wp_arr[-1, 0] - wp_arr[0, 0], 1)
    ri_n = (wp_arr[:, 1] - wp_arr[0, 1]) / max(wp_arr[-1, 1] - wp_arr[0, 1], 1)
    timing = max(0.0, 100.0 * (1.0 - float(np.mean(np.abs(ui_n - ri_n))) * 2.0))

    # per-reference-note breakdown via the alignment
    ref_to_usr: dict[int, int] = {}
    for ui, ri in wp:
        ref_to_usr.setdefault(int(ri), int(ui))
    notes_out = []
    for n in _ref_notes(reference):
        ris = np.where((rg >= n["start"]) & (rg <= n["end"]))[0]
        sung = [uf[ref_to_usr[ri]] for ri in ris if ri in ref_to_usr and uv[ref_to_usr[ri]]]
        if not sung:
            notes_out.append({**_note_base(n), "sung_midi": None, "cents_off": None, "hit": False})
            continue
        s = float(np.median(sung))
        cents = (s - n["midi"]) * 100.0
        notes_out.append(
            {**_note_base(n), "sung_midi": round(s, 2), "cents_off": round(cents, 1),
             "hit": abs(cents) <= 50}
        )

    overall = round(0.7 * intonation + 0.3 * timing, 1)
    return {
        "overall": overall,
        "intonation": round(intonation, 1),
        "timing": round(timing, 1),
        "median_cents_error": round(median_err * 100.0, 1),
        "notes": notes_out,
    }
