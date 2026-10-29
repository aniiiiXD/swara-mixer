"""
pipeline.py — connect the parts: a YouTube URL to a live pitch graph.

    URL ─▶ ingest.youtube ─▶ stems.demucs (vocals) ─▶ analysis.vocal_pitch ─▶ viz.pitch_player

Everything is cached per-URL under the data root, so a second run of the same
link skips download + separation and goes straight to the player.

    python -m stemcore.pipeline "<youtube-url>" [window_seconds]

Demucs (torch) may live in a different venv than this one; point at it with the
STEMCORE_DEMUCS_PYTHON env var (or pass demucs_python=...).
"""

import asyncio
import hashlib
import sys
import wave
from pathlib import Path

import numpy as np

from . import config
from .ingest.youtube import download_audio
from .stems.demucs import separate
from .analysis.vocal_pitch import vocal_pitch


SIX_STEMS = ["vocals", "drums", "bass", "other", "piano", "guitar"]

# per-instrument pitch band (Hz) for detection
BANDS = {
    "vocals": (80, 1000),
    "piano": (60, 2000),
    "guitar": (70, 1200),
    "bass": (30, 400),
    "other": (60, 2000),
    "drums": (60, 4000),
}


def _job_dir(url: str) -> Path:
    h = hashlib.md5(url.encode()).hexdigest()[:10]
    d = Path(config.DATA_ROOT) / "jobs" / h
    d.mkdir(parents=True, exist_ok=True)
    return d


def _load_wav_mono(path, off=0.0, dur=None):
    w = wave.open(str(path), "rb")
    sr, ch = w.getframerate(), w.getnchannels()
    w.setpos(int(off * sr))
    n = int(dur * sr) if dur else w.getnframes() - int(off * sr)
    raw = w.readframes(n)
    w.close()
    y = np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        y = y.reshape(-1, ch).mean(1)
    return y, sr


def _write_wav(y, sr, path):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())


def _mix_playback(song, off, dur, target_sr, out):
    """Slice the full-mix song at [off, off+dur], resample to target_sr (the
    pitch timeline's rate) so playback stays in sync, and write it out."""
    y, sr = _load_wav_mono(song, off, dur)
    if sr != target_sr:
        import librosa
        y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
    _write_wav(y, target_sr, out)
    return out


def _pick_window(y, sr, win):
    """Return (offset, dur) of the most vocal-energetic `win`-second window."""
    dur = len(y) / sr
    if win is None or dur <= win:
        return 0.0, dur
    hop = sr // 2
    rms = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
    wf = int(win / 0.5)
    off = (int(np.argmax(np.convolve(rms, np.ones(wf), "valid"))) * 0.5) if len(rms) > wf else 0.0
    return min(off, max(0.0, dur - win)), win


async def _prepare(url, model, two_stems, stem, stems_wanted, demucs_python, log):
    job = _job_dir(url)
    song = job / "audio.wav"
    if song.exists():
        log("cached audio")
    else:
        log("downloading...")
        res = await download_audio(url, job)
        song = res.audio_path
        log(f"  {(res.title or '')[:60]}  ({res.duration or 0:.0f}s)")

    demucs_out = job / "demucs"
    expected = demucs_out / model / song.stem / f"{stem}.wav"
    if expected.exists():
        log(f"cached {stem} ({model})")
        return job, song, expected
    log(f"separating (demucs {model})...")
    stems = await separate(song, demucs_out, model=model, stems=stems_wanted,
                           two_stems=two_stems, python_bin=demucs_python)
    return job, song, stems.get(stem)


def analyze(url, stem="vocals", window=60.0, model=None, playback="mix",
            demucs_python=None, play_live=True, log=None):
    """Full chain from a URL, targeting one stem. Returns dict with paths + track.

    stem:     vocals | piano | guitar | bass | other | drums
    playback: "mix" (hear the full song, the stem's pitch overlaid) or "stem"
              (hear only that isolated instrument)."""
    if log is None:
        def log(m):
            print(m, flush=True)   # flush so progress shows live under a pipe

    # vocals: fast 2-stem split on htdemucs. any other stem: full 6-stem model.
    if stem == "vocals":
        model = model or "htdemucs"
        two_stems, stems_wanted = "vocals", None
    else:
        model = model or "htdemucs_6s"
        two_stems, stems_wanted = None, SIX_STEMS

    job, song, stem_path = asyncio.run(
        _prepare(url, model, two_stems, stem, stems_wanted, demucs_python, log))
    if not stem_path or not Path(stem_path).exists():
        raise SystemExit(f"no '{stem}' stem produced")

    lo, hi = BANDS.get(stem, (60, 2000))
    log(f"preprocessing {stem} pitch (band {lo}-{hi} Hz, pYIN)...")
    y, sr = _load_wav_mono(stem_path)
    off, dur = _pick_window(y, sr, window)
    ys, _ = _load_wav_mono(stem_path, off, dur)
    track = vocal_pitch(ys, sr, lo=lo, hi=hi)
    voiced = sum(1 for f in track.frames if f.f0)
    log(f"  window {off:.0f}-{off + dur:.0f}s, pitched {100 * voiced // max(1, len(track.frames))}%")

    if playback == "mix":
        play_wav = job / "mix_slice.wav"
        _mix_playback(song, off, dur, track.sr, play_wav)   # hear the full song
    else:
        play_wav = job / f"{stem}_slice.wav"
        _write_wav(ys, sr, play_wav)

    result = {"job": str(job), "song": str(song), "stem": str(stem_path),
              "playback": str(play_wav), "track": track, "window": (off, off + dur)}

    if play_live:
        from .viz.pitch_player import play
        log("opening player...")
        play(track, str(play_wav),
             title=f"{stem} pitch  ({playback})  {off:.0f}-{off + dur:.0f}s")
    return result


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser(prog="stemcore-analyze",
                                description="YouTube URL -> isolated stem -> live pitch player")
    p.add_argument("url")
    p.add_argument("--stem", default="vocals",
                   choices=["vocals", "piano", "guitar", "bass", "other", "drums"],
                   help="which instrument's pitch to graph (default: vocals)")
    p.add_argument("--playback", default="mix", choices=["mix", "stem"],
                   help="hear the full 'mix' or the isolated 'stem' (default: mix)")
    p.add_argument("--window", type=float, default=60.0,
                   help="seconds to analyze (0 = whole song)")
    a = p.parse_args(sys.argv[1:] if argv is None else argv)
    analyze(a.url, stem=a.stem, playback=a.playback,
            window=a.window if a.window > 0 else None)


if __name__ == "__main__":
    main()
