"""Piano API — turn a YouTube song into a piano transcription (MIDI + notes).

Pipeline: yt-dlp download → optional Demucs de-drum → basic-pitch polyphonic
transcription. Polyphonic on purpose: a piano plays chords, so this uses a
multi-pitch model, NOT the monophonic pYIN the singing coach uses.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import jobs

app = FastAPI(title="Piano API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs.router, prefix="/api")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
