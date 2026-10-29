import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models import Job, JobStatus, CreateJobRequest, CreateJobResponse, ExportRequest
from app.services.downloader import download_audio
from app.services.separator import separate_stems
from app.services.exporter import mixdown
from app.services.captions import fetch_captions
from app.services import songs
from app.config import STEMS_DIR, DEMUCS_MODEL, JOB_DATABASE
from stemcore.jobs import JobRunner
from stemcore.model import JobStatus as CoreJobStatus

log = logging.getLogger("karaoke-maker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S")

router = APIRouter()

# HTTP response metadata remains application-owned; shared runtime state and
# the replayable event stream are held by stemcore's framework-agnostic runner.
jobs: dict[str, Job] = {}
runtime = JobRunner(JOB_DATABASE)


def _get_job(job_id: str) -> Job | None:
    """Return job metadata, preferring the shared runtime record.

    The API and the worker are separate processes, so the module-level ``jobs``
    dict only ever reflects what *this* process did. The worker does all the
    processing, so a job cached here by ``create_job`` would otherwise be
    reported as pending forever, however far along the worker actually is.
    stemcore's SQLite runtime is the cross-process source of truth; the dict is
    only a fallback for records the runtime does not hold.
    """
    core_job = runtime.get(job_id)
    if core_job is None or "url" not in core_job.meta:
        return jobs.get(job_id)
    current = Job(
        id=core_job.id,
        url=core_job.meta["url"],
        status=JobStatus(core_job.status.value),
        title=core_job.meta.get("title"),
        duration=core_job.meta.get("duration"),
        progress=core_job.progress,
        error=core_job.meta.get("error") or core_job.error,
    )
    jobs[job_id] = current
    return current


async def process_job(job: Job):
    """Background task: download audio then separate stems."""
    try:
        # Phase 1: Download
        log.info(f"[{job.id}] Starting download: {job.url}")
        job.status = JobStatus.DOWNLOADING
        job.progress = 0.0
        runtime.emit(job.id, "downloading", 0, CoreJobStatus.downloading)

        async def on_download_progress(pct: float):
            job.progress = pct
            runtime.emit(job.id, "downloading", pct, CoreJobStatus.downloading)

        audio_path, title, duration = await download_audio(job.url, job.id, on_download_progress)
        job.title = title
        job.duration = duration
        runtime.update_meta(job.id, title=title, duration=duration)
        songs.save_meta(job.id, {"title": title, "duration": duration, "source_url": job.url})
        log.info(f"[{job.id}] Download complete: \"{title}\" ({(duration or 0):.0f}s) -> {audio_path}")

        # Phase 2: Separate
        log.info(f"[{job.id}] Starting Demucs separation...")
        job.status = JobStatus.SEPARATING
        job.progress = 0.0
        runtime.emit(job.id, "separating", 0, CoreJobStatus.separating)

        async def on_separate_progress(pct: float):
            job.progress = pct
            runtime.emit(job.id, "separating", pct, CoreJobStatus.separating)
            if int(pct) % 25 == 0 and int(pct) > 0:
                log.info(f"[{job.id}] Demucs progress: {int(pct)}%")

        await separate_stems(audio_path, job.id, on_separate_progress)

        # Done
        job.status = JobStatus.COMPLETE
        job.progress = 100.0
        runtime.emit(job.id, "complete", 100, CoreJobStatus.complete)
        log.info(f"[{job.id}] Job COMPLETE")

    except Exception as e:
        job.status = JobStatus.ERROR
        job.error = str(e)
        runtime.update_meta(job.id, error=str(e))
        runtime.emit(job.id, "error", job.progress, CoreJobStatus.error)
        log.error(f"[{job.id}] Job FAILED: {e}")


@router.post("/jobs", response_model=CreateJobResponse)
async def create_job(req: CreateJobRequest):
    core_job = runtime.create(meta={"url": req.url, "kind": "mix"})
    job_id = core_job.id
    job = Job(id=job_id, url=req.url)
    jobs[job_id] = job

    log.info(f"[{job_id}] Job created for URL: {req.url}")
    return CreateJobResponse(jobId=job_id)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = _get_job(job_id)
    if not job:
        log.warning(f"[{job_id}] Job not found (GET /jobs)")
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/progress")
async def job_progress(job_id: str):
    job = _get_job(job_id)
    if not job:
        log.warning(f"[{job_id}] Job not found (GET /progress)")
        raise HTTPException(status_code=404, detail="Job not found")

    if runtime.get(job_id) is None:
        raise HTTPException(status_code=404, detail="No event stream for job")

    log.info(f"[{job_id}] SSE client connected")

    async def event_stream():
        async for event in runtime.events(job_id):
            import json
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/jobs/{job_id}/captions")
async def get_captions(job_id: str):
    job = _get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    cues = await fetch_captions(job.url, job_id)
    if cues is None:
        raise HTTPException(status_code=404, detail="No captions available")
    return {"cues": cues}


@router.post("/jobs/{job_id}/export")
async def export_mix(job_id: str, req: ExportRequest):
    job = _get_job(job_id)
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
