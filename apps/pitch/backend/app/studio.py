"""
studio.py — the Learning & Karaoke Studio.

Splits a song into vocals + instrumental, extracts the (clean, pYIN) vocal pitch
as the reference melody to sing, and returns the karaoke backing track. The
frontend scrolls the reference pitch past a playhead while the instrumental
plays — sing along to hit the notes. (Live mic scoring is the next stage.)
"""

import asyncio

from stemcore.pipeline import _job_dir, _load_wav_mono, _write_wav, _pick_window
from stemcore.ingest.youtube import download_audio
from stemcore.stems.demucs import separate
from stemcore.analysis.filters import bandpass
from stemcore.pitch.pyin import pyin_track

from .daw import _clean_points   # reuse the octave-guard + denoise cleaner


async def _prep2(url, log):
    """Ensure a 2-stem (vocals / no_vocals) split exists, cached per URL."""
    job = _job_dir(url)
    song = job / "audio.wav"
    if song.exists():
        log("cached audio")
    else:
        log("downloading...")
        res = await download_audio(url, job)
        song = res.audio_path
        log(f"  {(res.title or '')[:50]} ({res.duration or 0:.0f}s)")

    tdir = job / "demucs" / "htdemucs" / song.stem
    have = tdir.exists() and (tdir / "vocals.wav").exists() and (tdir / "no_vocals.wav").exists()
    if have:
        log("cached vocals/instrumental")
    else:
        log("separating vocals...")
        await separate(song, job / "demucs", model="htdemucs", two_stems="vocals")
    return job, song, tdir / "vocals.wav", tdir / "no_vocals.wav"


def build_studio(url, window, log):
    job, song, vox, inst = asyncio.run(_prep2(url, log))

    yv, sr = _load_wav_mono(vox)
    off, dur = _pick_window(yv, sr, window)          # centre on where the singing is
    ys, _ = _load_wav_mono(vox, off, dur)

    log("extracting reference vocal pitch (pYIN)...")
    yb = bandpass(ys, sr, 80, 1000)
    tr = pyin_track(yb, sr, fmin=80, fmax=1000, hop=512)
    pts, lo, hi = _clean_points(tr)

    # karaoke backing (instrumental) + the guide vocal, both for the same window
    yk, _ = _load_wav_mono(inst, off, dur)
    kpath = job / "karaoke_slice.wav"
    vpath = job / "vguide_slice.wav"
    _write_wav(yk, sr, kpath)
    _write_wav(ys, sr, vpath)

    data = {"duration": dur, "window": [off, off + dur], "lo": lo, "hi": hi,
            "points": pts}
    slices = {"karaoke": str(kpath), "vguide": str(vpath)}
    log("done")
    return data, slices
