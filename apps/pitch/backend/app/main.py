"""
Pitch Studio — web frontend over stemcore.

A thin FastAPI app: POST a YouTube URL + stem, it runs the stemcore pipeline
(download -> demucs -> pitch) in a background thread, streams progress over SSE,
and serves the cleaned pitch contour as JSON plus the audio slice for playback.
The Canvas player lives in the frontend and syncs to the <audio> element.
"""

import json
import threading
import time
import uuid
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from stemcore.pipeline import analyze
from stemcore.pitch.yin import hz_to_midi
from stemcore.pitch.postprocess import octave_guard, remove_short_runs

from .daw import build_daw
from .studio import build_studio

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"

app = FastAPI(title="Pitch Studio")
JOBS: dict[str, dict] = {}


class AnalyzeReq(BaseModel):
    url: str
    stem: str = "vocals"
    window: float = 60.0


def _clean_points(track, min_conf=0.5, min_run=0.09):
    """Octave-guarded, breath-denoised (t, midi|null) points + note range."""
    midi = [hz_to_midi(f.f0) if (f.f0 is not None and f.confidence >= min_conf) else None
            for f in track.frames]
    midi = octave_guard(midi)
    midi = remove_short_runs(midi, track.hop, min_run)
    pts = [[round(f.t, 4), (round(m, 3) if m is not None else None)]
           for f, m in zip(track.frames, midi)]
    valid = [m for m in midi if m is not None]
    lo = int(np.floor(min(valid))) - 2 if valid else 48
    hi = int(np.ceil(max(valid))) + 2 if valid else 72
    return pts, lo, hi


def _run_job(job_id: str, req: AnalyzeReq):
    job = JOBS[job_id]

    def log(m):
        job["events"].append(str(m))
        job["phase"] = str(m)

    try:
        res = analyze(req.url, stem=req.stem,
                      window=req.window if req.window > 0 else None,
                      playback="mix", play_live=False, log=log)
        pts, lo, hi = _clean_points(res["track"])
        w0, w1 = res["window"]
        job["result"] = {
            "stem": req.stem,
            "window": [w0, w1],
            "duration": w1 - w0,
            "lo": lo, "hi": hi,
            "points": pts,
            "audio": f"/api/jobs/{job_id}/audio",
            "_playback": res["playback"],
        }
        job["status"] = "done"
        log("done")
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(e)
        log(f"error: {e}")


@app.post("/api/analyze")
def start(req: AnalyzeReq):
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"status": "running", "phase": "queued", "events": [], "result": None}
    threading.Thread(target=_run_job, args=(jid, req), daemon=True).start()
    return {"jobId": jid}


@app.get("/api/jobs/{jid}/progress")
def progress(jid: str):
    def gen():
        cur = 0
        while True:
            job = JOBS.get(jid)
            if not job:
                break
            evs = job["events"]
            while cur < len(evs):
                yield f"data: {json.dumps({'phase': evs[cur], 'status': job['status']})}\n\n"
                cur += 1
            if job["status"] in ("done", "error"):
                break
            time.sleep(0.2)
    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/api/jobs/{jid}/result")
def result(jid: str):
    job = JOBS.get(jid)
    if not job or not job.get("result"):
        return JSONResponse({"error": "not ready"}, status_code=409)
    r = {k: v for k, v in job["result"].items() if k != "_playback"}
    return r


@app.get("/api/jobs/{jid}/audio")
def audio(jid: str):
    job = JOBS.get(jid)
    if not job or not job.get("result"):
        return JSONResponse({"error": "not ready"}, status_code=409)
    return FileResponse(job["result"]["_playback"], media_type="audio/wav")


# ---------------- DAW (multitrack) ----------------
def _run_daw(job_id: str, req: AnalyzeReq):
    job = JOBS[job_id]

    def log(m):
        job["events"].append(str(m))
        job["phase"] = str(m)

    try:
        data, slices = build_daw(req.url, req.window if req.window > 0 else 45,
                                 "htdemucs_6s", log)
        job["result"] = data
        job["slices"] = slices
        job["status"] = "done"
        log("done")
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(e)
        log(f"error: {e}")


@app.post("/api/daw")
def start_daw(req: AnalyzeReq):
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"status": "running", "phase": "queued", "events": [],
                 "result": None, "slices": None}
    threading.Thread(target=_run_daw, args=(jid, req), daemon=True).start()
    return {"jobId": jid}


@app.get("/api/jobs/{jid}/daw")
def daw_result(jid: str):
    job = JOBS.get(jid)
    if not job or not job.get("result"):
        return JSONResponse({"error": "not ready"}, status_code=409)
    r = dict(job["result"])
    r["tracks"] = [{**t, "audio": f"/api/jobs/{jid}/stem/{t['name']}"} for t in r["tracks"]]
    return r


@app.get("/api/jobs/{jid}/stem/{name}")
def stem_audio(jid: str, name: str):
    job = JOBS.get(jid)
    if not job or not job.get("slices") or name not in job["slices"]:
        return JSONResponse({"error": "not ready"}, status_code=409)
    return FileResponse(job["slices"][name], media_type="audio/wav")


# ---------------- Studio (karaoke / learning) ----------------
def _run_studio(job_id: str, req: AnalyzeReq):
    job = JOBS[job_id]

    def log(m):
        job["events"].append(str(m))
        job["phase"] = str(m)

    try:
        data, slices = build_studio(req.url, req.window if req.window > 0 else 45, log)
        job["result"] = data
        job["slices"] = slices
        job["status"] = "done"
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(e)
        log(f"error: {e}")


@app.post("/api/studio")
def start_studio(req: AnalyzeReq):
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"status": "running", "phase": "queued", "events": [],
                 "result": None, "slices": None}
    threading.Thread(target=_run_studio, args=(jid, req), daemon=True).start()
    return {"jobId": jid}


@app.get("/api/jobs/{jid}/studio")
def studio_result(jid: str):
    job = JOBS.get(jid)
    if not job or not job.get("result"):
        return JSONResponse({"error": "not ready"}, status_code=409)
    r = dict(job["result"])
    r["karaoke"] = f"/api/jobs/{jid}/karaoke"
    r["vguide"] = f"/api/jobs/{jid}/vguide"
    return r


@app.get("/api/jobs/{jid}/karaoke")
def karaoke_audio(jid: str):
    job = JOBS.get(jid)
    if not job or not job.get("slices"):
        return JSONResponse({"error": "not ready"}, status_code=409)
    return FileResponse(job["slices"]["karaoke"], media_type="audio/wav")


@app.get("/api/jobs/{jid}/vguide")
def vguide_audio(jid: str):
    job = JOBS.get(jid)
    if not job or not job.get("slices"):
        return JSONResponse({"error": "not ready"}, status_code=409)
    return FileResponse(job["slices"]["vguide"], media_type="audio/wav")


@app.get("/")
def index():
    return FileResponse(str(FRONTEND / "index.html"))


app.mount("/static", StaticFiles(directory=str(FRONTEND)), name="static")
