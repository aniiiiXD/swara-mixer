import asyncio
import json
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models import Job, JobStatus, CreateJobRequest, CreateJobResponse, ExportRequest
from app.services.downloader import download_audio
from app.services.separator import separate_stems
from app.services.exporter import mixdown
from app.config import STEMS_DIR, DEMUCS_MODEL

log = logging.getLogger("karaoke-maker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S")

router = APIRouter()

# In-memory job store
jobs: dict[str, Job] = {}
# Broadcast: multiple consumers can read the same events
job_events: dict[str, list[dict]] = {}  # job_id -> list of all events
job_done: dict[str, asyncio.Event] = {}  # signals when job is finished


async def _process_job(job: Job):
    """Background task: download audio then separate stems."""
    events = job_events[job.id]
    done = job_done[job.id]

    try:
        # Phase 1: Download
        log.info(f"[{job.id}] Starting download: {job.url}")
        job.status = JobStatus.DOWNLOADING
        job.progress = 0.0
        events.append({"phase": "downloading", "progress": 0})

        async def on_download_progress(pct: float):
            job.progress = pct
            events.append({"phase": "downloading", "progress": pct})

        audio_path, title, duration = await download_audio(job.url, job.id, on_download_progress)
        job.title = title
        job.duration = duration
        log.info(f"[{job.id}] Download complete: \"{title}\" ({duration:.0f}s) -> {audio_path}")

        # Phase 2: Separate
        log.info(f"[{job.id}] Starting Demucs separation...")
        job.status = JobStatus.SEPARATING
        job.progress = 0.0
        events.append({"phase": "separating", "progress": 0})

        async def on_separate_progress(pct: float):
            job.progress = pct
            events.append({"phase": "separating", "progress": pct})
            if int(pct) % 25 == 0 and int(pct) > 0:
                log.info(f"[{job.id}] Demucs progress: {int(pct)}%")

        await separate_stems(audio_path, job.id, on_separate_progress)

        # Done
        job.status = JobStatus.COMPLETE
        job.progress = 100.0
        events.append({"phase": "complete", "progress": 100})
        log.info(f"[{job.id}] Job COMPLETE — {len(events)} total events emitted")

    except Exception as e:
        job.status = JobStatus.ERROR
        job.error = str(e)
        events.append({"phase": "error", "error": str(e)})
        log.error(f"[{job.id}] Job FAILED: {e}")
    finally:
        done.set()


@router.post("/jobs", response_model=CreateJobResponse)
async def create_job(req: CreateJobRequest):
    job_id = str(uuid.uuid4())[:8]
    job = Job(id=job_id, url=req.url)
    jobs[job_id] = job
    job_events[job_id] = []
    job_done[job_id] = asyncio.Event()

    log.info(f"[{job_id}] Job created for URL: {req.url}")
    asyncio.create_task(_process_job(job))
    return CreateJobResponse(jobId=job_id)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        log.warning(f"[{job_id}] Job not found (GET /jobs)")
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/progress")
async def job_progress(job_id: str):
    job = jobs.get(job_id)
    if not job:
        log.warning(f"[{job_id}] Job not found (GET /progress)")
        raise HTTPException(status_code=404, detail="Job not found")

    events = job_events.get(job_id)
    done = job_done.get(job_id)
    if events is None or done is None:
        raise HTTPException(status_code=404, detail="No event stream for job")

    log.info(f"[{job_id}] SSE client connected — {len(events)} events buffered, done={done.is_set()}")

    async def event_stream() -> AsyncGenerator[str, None]:
        cursor = 0
        sent = 0
        while True:
            # Yield any new events since our cursor
            while cursor < len(events):
                event = events[cursor]
                cursor += 1
                sent += 1
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("phase") in ("complete", "error"):
                    log.info(f"[{job_id}] SSE stream ended ({event.get('phase')}) — sent {sent} events to client")
                    return

            # If job is done and we've read everything, stop
            if done.is_set():
                log.info(f"[{job_id}] SSE stream closing (job done, all events sent) — sent {sent} events")
                return

            # Poll for new events
            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/jobs/{job_id}/export")
async def export_mix(job_id: str, req: ExportRequest):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.COMPLETE:
        raise HTTPException(status_code=400, detail="Job not complete")

    # Find stems directory
    model_dir = STEMS_DIR / job_id / DEMUCS_MODEL
    if not model_dir.exists():
        raise HTTPException(status_code=500, detail="Stems not found")

    track_dirs = [d for d in model_dir.iterdir() if d.is_dir()]
    if not track_dirs:
        raise HTTPException(status_code=500, detail="Track directory not found")

    stems_path = track_dirs[0]

    log.info(f"[{job_id}] Exporting mix with config: {req.mix}")
    try:
        output = mixdown(job_id, stems_path, req.mix)
        log.info(f"[{job_id}] Export complete: {output}")
        return {"downloadUrl": f"/api/exports/{job_id}/mix.wav"}
    except Exception as e:
        log.error(f"[{job_id}] Export failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
