"""
stemcore — the shared music engine for stem-studio.

Layered so a lightweight consumer (e.g. the harmonica desktop app) can use the
base install (numpy only) while the heavy capabilities live behind extras:

    ingest   → yt-dlp            (stemcore.ingest.youtube)
    stems    → demucs + torch    (stemcore.stems.demucs)
    poly     → basic-pitch/pop2piano  (stemcore.transcribe.poly)
    audio    → librosa           (stemcore.pitch.pyin, stemcore.score, ...)
    realtime → pyfluidsynth      (stemcore.render.realtime)
    render   → fluidsynth binary (stemcore.render.offline)
    viz      → matplotlib        (stemcore.viz.pitchplot)

Importing `stemcore` itself only pulls the base (numpy) API below; the modules
above are imported explicitly by callers that have the relevant extra.
"""

__version__ = "0.1.0"

# --- base (numpy-only) public API ---
from .model import (
    NoteEvent, PitchFrame, PitchTrack, Job, JobStatus, NAMES, midi_to_name,
)
from . import config, storage, jobs, tempo, seeds
from .musicmodel import NoteModel
from .transcribe.mono import transcribe_mono, pitch_track
from .pitch.yin import YinPitch, hz_to_midi
from .instruments import harmonica, piano

__all__ = [
    "NoteEvent", "PitchFrame", "PitchTrack", "Job", "JobStatus", "NAMES", "midi_to_name",
    "config", "storage", "jobs", "tempo", "seeds",
    "NoteModel", "transcribe_mono", "pitch_track", "YinPitch", "hz_to_midi",
    "harmonica", "piano", "__version__",
]
