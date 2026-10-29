import numpy as np
import soundfile as sf
from pathlib import Path

from app.config import EXPORTS_DIR, STEM_NAMES


def mixdown(job_id: str, stems_dir: Path, mix_config: dict, fmt: str = "wav") -> Path:
    """Mix stems according to config and export to file.

    mix_config example:
    {
        "vocals": {"gain": 0.8, "pan": -0.3, "mute": false},
        "drums": {"gain": 1.0, "pan": 0.0, "mute": false},
        ...
    }
    """
    output_dir = EXPORTS_DIR / job_id
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"mix.{fmt}"

    mixed = None
    sample_rate = None

    for stem_name in STEM_NAMES:
        config = mix_config.get(stem_name, {"gain": 1.0, "pan": 0.0, "mute": False})
        if config.get("mute", False):
            continue

        # Find stem file
        stem_path = None
        for ext in [".wav", ".mp3", ".flac"]:
            candidate = stems_dir / f"{stem_name}{ext}"
            if candidate.exists():
                stem_path = candidate
                break

        if stem_path is None:
            continue

        data, sr = sf.read(str(stem_path), dtype="float32")
        sample_rate = sr

        # Ensure stereo
        if data.ndim == 1:
            data = np.column_stack([data, data])

        # Apply gain
        gain = config.get("gain", 1.0)
        data *= gain

        # Apply pan (-1 = full left, 0 = center, +1 = full right)
        pan = config.get("pan", 0.0)
        left_gain = np.cos((pan + 1) * np.pi / 4)
        right_gain = np.sin((pan + 1) * np.pi / 4)
        data[:, 0] *= left_gain
        data[:, 1] *= right_gain

        if mixed is None:
            mixed = np.zeros_like(data)
            # Ensure mixed is long enough
            mixed = np.zeros((len(data), 2), dtype="float32")

        # Handle different lengths
        min_len = min(len(mixed), len(data))
        if len(data) > len(mixed):
            mixed = np.pad(mixed, ((0, len(data) - len(mixed)), (0, 0)))
        mixed[:min_len] += data[:min_len]

    if mixed is None or sample_rate is None:
        raise RuntimeError("No stems to mix")

    # Clip to prevent distortion
    mixed = np.clip(mixed, -1.0, 1.0)

    sf.write(str(output_path), mixed, sample_rate)
    return output_path
