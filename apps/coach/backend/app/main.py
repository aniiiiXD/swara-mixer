"""Tonic — the single backend API.

One FastAPI app serving everything the frontend needs:
  • singing coach: live-pass pYIN analysis (/analyze) + take scoring (/score)
  • song library: search, separate, karaoke mix, reference melody (/songs/*)
  • separation engine: yt-dlp download + Demucs stems (/api/jobs, /api/stems, /api/search)

The /api/* routers ARE the old engine (no second process); the song endpoints
reuse them in-process. Real-time pitch is detected in the browser.
"""

import os

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.config import ALLOWED_ORIGINS, STEM_API
from app.routers import jobs, stems, search
from app.services import pitch, songs, scoring

app = FastAPI(title="Tonic API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)

# Separation engine — yt-dlp + Demucs (formerly a separate :8011 service)
app.include_router(jobs.router, prefix="/api")
app.include_router(stems.router, prefix="/api")
app.include_router(search.router, prefix="/api")


@app.get("/api/health")
async def api_health() -> dict:
    return {"status": "ok"}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)) -> dict:
    """Accurate pitch contour + note segmentation for a recorded clip."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")
    try:
        return pitch.analyze(data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"analysis failed: {exc}")


# ── Song-based coaching ──────────────────────────────────────────────

@app.get("/search")
async def search(q: str) -> dict:
    """Proxy YouTube search (yt-dlp) from the stem-studio engine."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{STEM_API}/api/search", params={"q": q})
        r.raise_for_status()
        return r.json()


@app.get("/songs")
def songs_list() -> dict:
    """Already-separated songs available as practice material."""
    return {"songs": songs.list_songs()}


@app.post("/songs")
async def songs_create(payload: dict) -> dict:
    """Kick off separation of a NEW song via the stem-studio pipeline.

    Accepts optional metadata (title/artist/duration/youtube_id/thumbnail) so the
    real song name is persisted instead of the generic 'audio' directory name.
    """
    url = (payload or {}).get("url")
    if not url:
        raise HTTPException(status_code=400, detail="missing url")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{STEM_API}/api/jobs", json={"url": url})
        r.raise_for_status()
        result = r.json()

    job_id = result.get("jobId")
    if job_id:
        songs.save_meta(
            job_id,
            {
                "title": payload.get("title"),
                "artist": payload.get("artist"),
                "duration": payload.get("duration"),
                "youtube_id": payload.get("youtube_id"),
                "thumbnail": payload.get("thumbnail"),
                "source_url": url,
            },
        )
    return result


@app.get("/songs/{job_id}")
def song_get(job_id: str) -> dict:
    """Single song's metadata."""
    return songs._song_entry(job_id)


@app.patch("/songs/{job_id}")
def song_rename(job_id: str, payload: dict) -> dict:
    """Rename / edit a song's metadata (e.g. give an untitled song a title)."""
    songs.save_meta(job_id, {"title": payload.get("title"), "artist": payload.get("artist")})
    return songs._song_entry(job_id)


@app.get("/songs/{job_id}/status")
async def songs_status(job_id: str) -> dict:
    """Proxy stem-studio job status (download/separate progress)."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{STEM_API}/api/jobs/{job_id}")
        if r.status_code == 404:
            raise HTTPException(status_code=404, detail="job not found")
        r.raise_for_status()
        return r.json()


@app.get("/songs/{job_id}/reference")
def songs_reference(job_id: str) -> dict:
    """Raw CREPE reference melody from the isolated vocal."""
    try:
        return songs.reference(job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/songs/{job_id}/karaoke")
def songs_karaoke(job_id: str, request: Request, vocals: bool = False):
    """Stream the backing track (with Range support for seeking).

    vocals=False -> instrumental karaoke. vocals=True -> full song with the
    original vocal (Learning mode).
    """
    try:
        path = songs.build_mix(job_id, include_vocals=vocals)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    size = path.stat().st_size
    range_header = request.headers.get("range")
    start, end = 0, size - 1
    status = 200
    if range_header:
        rng = range_header.strip().split("=")[-1]
        s, e = (rng.split("-") + [""])[:2]
        start = int(s) if s else 0
        end = int(e) if e else size - 1
        status = 206
    length = end - start + 1

    def stream():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Range": f"bytes {start}-{end}/{size}",
    }
    return StreamingResponse(stream(), status_code=status, media_type="audio/wav", headers=headers)


@app.post("/songs/{job_id}/score")
async def songs_score(job_id: str, file: UploadFile = File(...)) -> dict:
    """Score a recorded take against the song's reference vocal."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty upload")
    try:
        ref = await run_in_threadpool(songs.reference, job_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    try:
        user = await run_in_threadpool(pitch.analyze, data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"analysis failed: {exc}")
    return {"score": await run_in_threadpool(scoring.score, ref, user), "user": user}
