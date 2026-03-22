from enum import Enum
from pydantic import BaseModel


class JobStatus(str, Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    SEPARATING = "separating"
    COMPLETE = "complete"
    ERROR = "error"


class Job(BaseModel):
    id: str
    url: str
    status: JobStatus = JobStatus.PENDING
    title: str | None = None
    duration: float | None = None
    progress: float = 0.0
    error: str | None = None


class CreateJobRequest(BaseModel):
    url: str


class CreateJobResponse(BaseModel):
    jobId: str


class ExportRequest(BaseModel):
    mix: dict[str, dict]
