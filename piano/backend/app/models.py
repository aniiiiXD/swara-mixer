from enum import Enum
from pydantic import BaseModel


class JobStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    CLEANING = "cleaning"        # Demucs de-drum (optional stage)
    TRANSCRIBING = "transcribing"
    RENDERING = "rendering"      # MIDI → piano audio (fluidsynth)
    COMPLETE = "complete"
    ERROR = "error"


class Job(BaseModel):
    id: str
    url: str
    status: JobStatus = JobStatus.PENDING
    title: str | None = None
    duration: float | None = None
    progress: float = 0.0
    note_count: int | None = None
    clean: bool = True           # whether to run the Demucs de-mud stage
    error: str | None = None


class CreateJobRequest(BaseModel):
    url: str
    clean: bool | None = None    # de-mud before transcribing; None → server default


class CreateJobResponse(BaseModel):
    jobId: str
