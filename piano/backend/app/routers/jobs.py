"""Job pipeline: YouTube URL → piano MIDI.

  download (yt-dlp) → [optional de-drum (Demucs)] → transcribe (basic-pitch)

Mirrors the coach engine's in-memory job store + SSE progress stream so the
frontend can reuse the same polling/streaming shape.
"""

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, FileResponse

from app.models import Job, JobStatus, CreateJobRequest, CreateJobResponse
from app.services.downloader import download_audio
from app.services.transcriber import transcribe
from app.services.renderer import render_audio

log = logging.getLogger("piano")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S")

router = APIRouter()

# In-memory stores.
jobs: dict[str, Job] = {}
job_events: dict[str, list[dict]] = {}
job_done: dict[str, asyncio.Event] = {}
job_midi: dict[str, Path] = {}
job_notes: dict[str, list[dict]] = {}
job_audio: dict[str, Path] = {}


async def _process_job(job: Job):
    events = job_events[job.id]
    done = job_done[job.id]
    try:
        # 1) Download
        log.info(f"[{job.id}] download: {job.url}")
        job.status = JobStatus.DOWNLOADING
        job.progress = 0.0
        events.append({"phase": "downloading", "progress": 0})

        async def on_dl(pct: float):
            job.progress = pct
            events.append({"phase": "downloading", "progress": pct})

        audio_path, title, duration = await download_audio(job.url, job.id, on_dl)
        job.title, job.duration = title, duration
        log.info(f'[{job.id}] downloaded "{title}" ({(duration or 0):.0f}s)')

        # 2) De-mud (best-effort — skipped if demucs isn't installed): drop bass +
        #    drums so Pop2Piano doesn't cram them onto the low keys.
        if job.clean:
            try:
                from app.services.separator import clean_mix
                from app.config import CLEAN_KEEP_STEMS

                log.info(f"[{job.id}] de-mud: separating, keeping {CLEAN_KEEP_STEMS}")
                job.status = JobStatus.CLEANING
                job.progress = 0.0
                events.append({"phase": "cleaning", "progress": 0})

                async def on_clean(pct: float):
                    job.progress = pct
                    events.append({"phase": "cleaning", "progress": pct})

                audio_path = await clean_mix(audio_path, job.id, CLEAN_KEEP_STEMS, on_clean)
            except ImportError:
                log.warning(f"[{job.id}] demucs not installed — skipping de-mud")
                events.append({"phase": "cleaning", "skipped": True})

        # 3) Transcribe (basic-pitch is CPU-bound → run off the event loop)
        log.info(f"[{job.id}] transcribing...")
        job.status = JobStatus.TRANSCRIBING
        job.progress = 0.0
        events.append({"phase": "transcribing", "progress": 0})

        midi_path, notes = await asyncio.to_thread(transcribe, audio_path, job.id)
        job_midi[job.id] = midi_path
        job_notes[job.id] = notes
        job.note_count = len(notes)

        # 4) Render MIDI → real piano audio (fluidsynth, sine fallback)
        log.info(f"[{job.id}] rendering audio...")
        job.status = JobStatus.RENDERING
        events.append({"phase": "rendering", "progress": 0})
        job_audio[job.id] = await render_audio(midi_path, job.id)

        job.status = JobStatus.COMPLETE
        job.progress = 100.0
        events.append({"phase": "complete", "progress": 100, "noteCount": len(notes)})
        log.info(f"[{job.id}] COMPLETE — {len(notes)} notes")

    except Exception as e:  # noqa: BLE001
        job.status = JobStatus.ERROR
        job.error = str(e)
        events.append({"phase": "error", "error": str(e)})
        log.error(f"[{job.id}] FAILED: {e}")
    finally:
        done.set()


@router.post("/jobs", response_model=CreateJobResponse)
async def create_job(req: CreateJobRequest):
    from app.config import CLEAN_DEFAULT

    job_id = str(uuid.uuid4())[:8]
    clean = req.clean if req.clean is not None else CLEAN_DEFAULT
    job = Job(id=job_id, url=req.url, clean=clean)
    jobs[job_id] = job
    job_events[job_id] = []
    job_done[job_id] = asyncio.Event()

    log.info(f"[{job_id}] created (clean={req.clean}) for {req.url}")
    asyncio.create_task(_process_job(job))
    return CreateJobResponse(jobId=job_id)


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/progress")
async def job_progress(job_id: str):
    events = job_events.get(job_id)
    done = job_done.get(job_id)
    if events is None or done is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_stream() -> AsyncGenerator[str, None]:
        cursor = 0
        while True:
            while cursor < len(events):
                event = events[cursor]
                cursor += 1
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("phase") in ("complete", "error"):
                    return
            if done.is_set():
                return
            await asyncio.sleep(0.3)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.get("/jobs/{job_id}/notes")
async def get_notes(job_id: str):
    """Note events for a falling-notes / piano-roll UI."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job_id not in job_notes:
        raise HTTPException(status_code=409, detail="Transcription not ready")
    return {
        "title": job.title,
        "duration": job.duration,
        "noteCount": job.note_count,
        "notes": job_notes[job_id],
    }


@router.get("/jobs/{job_id}/midi")
async def get_midi(job_id: str):
    """Download the transcribed .mid file."""
    path = job_midi.get(job_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="MIDI not ready")
    return FileResponse(str(path), media_type="audio/midi", filename="piano.mid")


@router.get("/jobs/{job_id}/audio")
async def get_audio(job_id: str):
    """Rendered piano audio (WAV) — the listenable cover."""
    path = job_audio.get(job_id)
    if not path or not path.exists():
        raise HTTPException(status_code=404, detail="Audio not ready")
    return FileResponse(str(path), media_type="audio/wav", filename="piano.wav")
