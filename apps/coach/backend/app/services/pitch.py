"""High-accuracy vocal-pitch analysis for Tonic.

CREPE is the primary tracker for recorded takes because its neural, waveform
model is materially more robust to vocal timbre and background noise than a
single DSP estimator. pYIN remains an intentional no-surprises fallback.
"""

from __future__ import annotations

import numpy as np

from stemcore.ingest.audiofile import decode_audio_bytes
from stemcore.model import midi_to_name
from stemcore.pitch.pyin import HOP, pyin_notes, pyin_track

CREPE_SR = 16_000
CREPE_HOP = 160  # 10 ms at CREPE's required 16 kHz input rate
CREPE_MIN_HZ = 50.0
CREPE_MAX_HZ = 1_100.0
CREPE_PERIODICITY = 0.21


def _crepe_analyze(y: np.ndarray, sr: int, *, raw: bool = False) -> tuple[list[dict], list[dict], int]:
    """Raw references use independent frames; recorded takes retain gating."""
    import librosa
    import torch
    import torchcrepe

    if sr != CREPE_SR:
        y = librosa.resample(y, orig_sr=sr, target_sr=CREPE_SR)
        sr = CREPE_SR
    y = np.asarray(y, dtype=np.float32)
    if not len(y):
        return [], [], sr

    audio = torch.from_numpy(y).unsqueeze(0)
    with torch.inference_mode():
        f0, periodicity = torchcrepe.predict(
            audio,
            sr,
            hop_length=CREPE_HOP,
            fmin=CREPE_MIN_HZ,
            fmax=CREPE_MAX_HZ,
            model="full",
            return_periodicity=True,
            # Full CREPE's CPU convolution workspace scales with this batch.
            # 512 frames can exceed 16 GB on Apple Silicon and force swapping.
            batch_size=64,
            device="mps" if torch.backends.mps.is_available() else "cpu",
            decoder=torchcrepe.decode.weighted_argmax if raw else torchcrepe.decode.viterbi,
        )
        if not raw:
            periodicity = torchcrepe.filter.median(periodicity, 3)

    hz = f0.squeeze(0).cpu().numpy()
    confidence = periodicity.squeeze(0).cpu().numpy()
    contour: list[dict] = []
    voiced: list[tuple[float, float, float]] = []
    for index, (frequency, conf) in enumerate(zip(hz, confidence, strict=True)):
        t = index * CREPE_HOP / sr
        if not np.isfinite(frequency) or frequency <= 0 or (not raw and conf < CREPE_PERIODICITY):
            contour.append({"t": round(t, 4), "hz": None, "midi": None, "conf": round(float(conf), 4)})
            continue
        midi = 69.0 + 12.0 * np.log2(float(frequency) / 440.0)
        contour.append({"t": round(t, 4), "hz": round(float(frequency), 4), "midi": round(float(midi), 3), "conf": round(float(conf), 4)})
        voiced.append((t, float(midi), float(conf)))

    # Note segmentation is deliberately conservative: CREPE's continuous
    # contour remains visible while a note starts only after 40ms and a phrase
    # changes only after a semitone has actually settled.
    notes: list[dict] = []
    run_start: float | None = None
    run_midi: int | None = None
    run_values: list[float] = []
    gap = 0

    def flush(end: float) -> None:
        nonlocal run_start, run_midi, run_values
        if run_start is not None and run_midi is not None and end - run_start >= 0.04:
            cents = float(np.median([(value - run_midi) * 100 for value in run_values])) if run_values else 0.0
            notes.append({"midi": run_midi, "name": midi_to_name(run_midi), "start": round(run_start, 3), "end": round(end, 3), "cents_offset": round(cents, 1)})
        run_start, run_midi, run_values = None, None, []

    for item in contour:
        t = float(item["t"])
        midi = item["midi"]
        if midi is None:
            gap += 1
            if gap >= 3:
                flush(t - (gap - 1) * CREPE_HOP / sr)
            continue
        gap = 0
        quantized = int(round(float(midi)))
        if run_midi is None:
            run_start, run_midi, run_values = t, quantized, [float(midi)]
        elif quantized == run_midi:
            run_values.append(float(midi))
        else:
            flush(t)
            run_start, run_midi, run_values = t, quantized, [float(midi)]
    flush(len(y) / sr)
    return contour, notes, sr


def analyze(audio_bytes: bytes, target_sr: int | None = None, hop: int = HOP, *, raw: bool = False) -> dict:
    """Return the legacy HTTP shape using neural CREPE with pYIN fallback."""
    y, sr = decode_audio_bytes(audio_bytes)
    source_duration = round(float(len(y) / sr), 3)
    try:
        contour, notes, analysis_sr = _crepe_analyze(y, sr, raw=raw)
        return {"engine": "crepe", "processing": "raw-v1" if raw else "tracked", "sr": analysis_sr, "duration": source_duration, "hop": CREPE_HOP, "contour": contour, "notes": notes}
    except Exception:  # noqa: BLE001 - the fallback is part of the API contract
        if raw:
            # A temporally smoothed fallback would violate the raw reference.
            raise
        if target_sr and target_sr != sr:
            import librosa
            y = librosa.resample(y, orig_sr=sr, target_sr=target_sr)
            sr = target_sr
        track = pyin_track(y, sr, hop=hop)
        notes = pyin_notes(y, sr, hop=hop)
        contour = []
        for frame in track.frames:
            midi = None if frame.f0 is None else 69.0 + 12.0 * np.log2(frame.f0 / 440.0)
            contour.append({"t": frame.t, "hz": frame.f0, "midi": None if midi is None else round(float(midi), 3), "conf": frame.confidence})
        return {"engine": "pyin-fallback", "sr": sr, "duration": source_duration, "hop": hop, "contour": contour, "notes": [{"midi": note.midi, "name": midi_to_name(note.midi), "start": note.start, "end": note.end, "cents_offset": 0.0} for note in notes]}
