"""
analysis/vocal_pitch.py — the tuned "singer's pitch" pipeline in one call.

Band-pass to the singing range, then pYIN (falling back to the numpy YIN if
librosa isn't installed). This is the polished path behind the clean pitch
graphs: bleed/rumble removed, octave errors minimized, voiced-only.
"""

from .filters import bandpass


def vocal_pitch(audio, sr, lo=80.0, hi=1000.0, use_pyin=True):
    """Audio (a vocals stem) -> PitchTrack of the singer's melody."""
    y = bandpass(audio, sr, lo, hi)
    if use_pyin:
        try:
            from ..pitch.pyin import pyin_track
            return pyin_track(y, sr, fmin=lo, fmax=hi)
        except Exception:
            pass  # librosa missing -> fall back to numpy YIN
    from ..transcribe.mono import pitch_track
    return pitch_track(y, sr)
