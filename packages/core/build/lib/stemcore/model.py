"""
model.py — the shared domain model (Layer 0).

The whole point of the core package: every module speaks these types instead of
each app inventing its own note/pitch/job shapes. A `NoteEvent` from the
harmonica transcriber, the piano transcriber, or the coach analyzer is the same
`NoteEvent`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_to_name(m: int | float) -> str:
    m = int(round(m))
    return NAMES[m % 12] + str(m // 12 - 1)


# alias kept for readers that expect the "midi_name" spelling
midi_name = midi_to_name


@dataclass
class NoteEvent:
    """A single note: onset + duration in seconds, MIDI pitch, velocity 0-127."""
    start: float
    dur: float
    midi: int
    velocity: int = 100

    @property
    def end(self) -> float:
        return self.start + self.dur

    @property
    def name(self) -> str:
        return midi_to_name(self.midi)


@dataclass
class PitchFrame:
    """One analysis frame of a monophonic pitch track."""
    t: float                       # seconds
    f0: Optional[float]            # Hz, or None when unvoiced
    confidence: float = 0.0        # 0..1


@dataclass
class PitchTrack:
    """A frame-by-frame monophonic pitch estimate over a clip."""
    frames: list[PitchFrame]
    hop: float                     # seconds between frames
    sr: int

    def voiced(self) -> list[PitchFrame]:
        return [f for f in self.frames if f.f0 is not None]


# ---- job runtime types (used by the async job runner + any future service) ----
class JobStatus(str, Enum):
    pending = "pending"
    downloading = "downloading"
    separating = "separating"
    transcribing = "transcribing"
    rendering = "rendering"
    complete = "complete"
    error = "error"


@dataclass
class Job:
    id: str
    status: JobStatus = JobStatus.pending
    progress: float = 0.0          # 0..1 within the current phase
    phase: str = ""
    error: Optional[str] = None
    meta: dict = field(default_factory=dict)
