"""
daw.py — build a multitrack view of a song: separate every stem, and for each
return waveform peaks (for the lane) + a pitch contour (for melodic stems).

Uses fast YIN (not pYIN) since there are several stems to analyze; the pitch
overlay is a guide, the waveform is the anchor.
"""

import asyncio
from pathlib import Path

import numpy as np

from stemcore.pipeline import (_job_dir, _load_wav_mono, _write_wav,
                               _pick_window, SIX_STEMS, BANDS)
from stemcore.ingest.youtube import download_audio
from stemcore.stems.demucs import separate
from stemcore.analysis.filters import bandpass
from stemcore.pitch.pyin import pyin_track
from stemcore.pitch.yin import hz_to_midi
from stemcore.pitch.postprocess import octave_guard, remove_short_runs

# lane order (melodic first), and which get a pitch line
ORDER = ["vocals", "guitar", "piano", "other", "bass", "drums"]
NO_PITCH = {"drums"}


async def _prep(url, model, log):
    job = _job_dir(url)
    song = job / "audio.wav"
    if song.exists():
        log("cached audio")
    else:
        log("downloading...")
        res = await download_audio(url, job)
        song = res.audio_path
        log(f"  {(res.title or '')[:50]} ({res.duration or 0:.0f}s)")

    tdir = job / "demucs" / model / song.stem
    have = tdir.exists() and all((tdir / f"{n}.wav").exists() for n in SIX_STEMS)
    if have:
        log(f"cached stems ({model})")
    else:
        log(f"separating 6 stems (demucs {model})...")
        await separate(song, job / "demucs", model=model, stems=SIX_STEMS)
    stems = {n: tdir / f"{n}.wav" for n in SIX_STEMS if (tdir / f"{n}.wav").exists()}
    return job, song, stems


def _peaks(y, bins):
    n = len(y)
    step = max(1, n // bins)
    return [round(float(np.max(np.abs(y[i:i + step]))) if i < n else 0.0, 4)
            for i in range(0, n, step)]


def _clean_points(track, min_conf=0.55, min_run=0.14):
    midi = [hz_to_midi(f.f0) if (f.f0 is not None and f.confidence >= min_conf) else None
            for f in track.frames]
    midi = octave_guard(midi)
    midi = remove_short_runs(midi, track.hop, min_run)
    pts = [[round(f.t, 3), (round(m, 2) if m is not None else None)]
           for f, m in zip(track.frames, midi)]
    valid = [m for m in midi if m is not None]
    lo = int(np.floor(min(valid))) - 2 if valid else 48
    hi = int(np.ceil(max(valid))) + 2 if valid else 72
    return pts, lo, hi


def build_daw(url, window, model, log):
    job, song, stems = asyncio.run(_prep(url, model, log))
    ymix, sr = _load_wav_mono(song)
    off, dur = _pick_window(ymix, sr, window)
    log(f"window {off:.0f}-{off + dur:.0f}s; analyzing {len(stems)} tracks...")

    tracks, slices = [], {}
    for name in ORDER:
        p = stems.get(name)
        if not p:
            continue
        y, _ = _load_wav_mono(p, off, dur)
        rms = float(np.sqrt(np.mean(y * y)))
        # DAW is a MIXING view: waveforms only. Pitch lives in the karaoke studio.
        entry = {"name": name, "rms": round(rms, 4), "peaks": _peaks(y, 1600)}
        sp = job / f"daw_{name}.wav"
        _write_wav(y, sr, sp)
        slices[name] = str(sp)
        tracks.append(entry)
        log(f"  {name}")
    return {"duration": dur, "sr": sr, "window": [off, off + dur], "tracks": tracks}, slices
