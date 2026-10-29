"""Load a local audio file to a mono/stereo float32 numpy array.

Adapted from how the piano brain loads audio (``librosa.load(path, sr=44100,
mono=True)`` in piano/backend/app/services/_pop2piano.py) and the stdlib ``wave``
fallback in the harmonica transcriber (harmonica/harmonica/apps/transcribe.py::
load_wav / load_audio), which decodes .wav without any third-party deps and
shells out to ffmpeg for other containers.

numpy is a hard dependency; librosa is imported lazily and only used when
present. When librosa is unavailable the .wav path is handled by ``wave`` and
other formats are converted to a temp .wav via ffmpeg (if installed).
"""

from __future__ import annotations

import logging
import io
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

log = logging.getLogger("stemcore.ingest.audiofile")


def _load_wav_stdlib(path: str, mono: bool) -> tuple[np.ndarray, int]:
    """Decode a PCM .wav with the stdlib ``wave`` module. Returns (y, native_sr)."""
    with wave.open(path, "rb") as w:
        native_sr = w.getframerate()
        n, ch, sw = w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)

    dtype = {2: np.int16, 4: np.int32}.get(sw)
    if dtype is None:  # 8-bit or unusual: coarse unsigned fallback
        y = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    else:
        y = np.frombuffer(raw, dtype=dtype).astype(np.float32) / np.iinfo(dtype).max

    if ch > 1:
        y = y.reshape(-1, ch)
        if mono:
            y = y.mean(axis=1)
    return y.astype(np.float32), native_sr


def load_audio(path: str | Path, sr: int | None = 44100, mono: bool = True) -> tuple[np.ndarray, int]:
    """Load ``path`` to (float32 samples, sample_rate).

    Prefers librosa (which resamples to ``sr`` and mixes to mono for us). If
    librosa is not installed, .wav files are decoded with the stdlib ``wave``
    module (returning their *native* sample rate — pass ``sr=None`` or match the
    file's rate to avoid a mismatch), and other formats are transcoded to a temp
    .wav with ffmpeg first. ``sr=None`` keeps the file's native rate.
    """
    path = str(path)

    try:
        import librosa  # lazy: heavy optional dep
    except ImportError:
        librosa = None

    if librosa is not None:
        y, out_sr = librosa.load(path, sr=sr, mono=mono)
        return np.asarray(y, dtype=np.float32), int(out_sr)

    # ---- librosa-free fallbacks ----
    if path.lower().endswith(".wav"):
        y, native_sr = _load_wav_stdlib(path, mono)
        if sr is not None and sr != native_sr:
            log.warning(
                "librosa not installed; cannot resample %s from %d Hz to %d Hz — "
                "returning native rate", path, native_sr, sr,
            )
        return y, native_sr

    # Non-wav without librosa: convert to a temp wav via ffmpeg if available.
    if shutil.which("ffmpeg"):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_wav = str(Path(tmp) / "converted.wav")
            cmd = ["ffmpeg", "-y", "-i", path]
            if mono:
                cmd += ["-ac", "1"]
            if sr is not None:
                cmd += ["-ar", str(sr)]
            cmd.append(tmp_wav)
            subprocess.run(cmd, check=True, capture_output=True)
            return _load_wav_stdlib(tmp_wav, mono)

    raise RuntimeError(
        f"Cannot load {path!r}: install librosa (or ffmpeg for non-wav formats)."
    )


def decode_audio_bytes(data: bytes) -> tuple[np.ndarray, int]:
    """Decode an uploaded audio container to native-rate mono float32 samples.

    Browser recordings are commonly WebM/Opus rather than files that the
    lightweight local loader can inspect directly. PyAV keeps this boundary in
    the shared engine, so API adapters do not each reimplement it.
    """
    import av

    with av.open(io.BytesIO(data)) as container:
        if not container.streams.audio:
            raise ValueError("no audio stream")
        stream = container.streams.audio[0]
        sr = stream.rate or 44100
        resampler = av.AudioResampler(format="flt", layout="mono", rate=sr)
        chunks: list[np.ndarray] = []
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("no audio frames decoded")
    return np.concatenate(chunks).astype(np.float32), int(sr)
