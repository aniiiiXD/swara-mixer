from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from app.config import STEMS_DIR, EXPORTS_DIR, DEMUCS_MODEL

router = APIRouter()


def _find_stem_path(job_id: str, stem: str) -> Path:
    model_dir = STEMS_DIR / job_id / DEMUCS_MODEL
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail="Stems not found")

    track_dirs = [d for d in model_dir.iterdir() if d.is_dir()]
    if not track_dirs:
        raise HTTPException(status_code=404, detail="Track not found")

    track_dir = track_dirs[0]
    for ext in [".wav", ".mp3", ".flac"]:
        path = track_dir / f"{stem}{ext}"
        if path.exists():
            return path

    raise HTTPException(status_code=404, detail=f"Stem '{stem}' not found")


@router.get("/stems/{job_id}/{stem}")
async def get_stem(job_id: str, stem: str, request: Request):
    path = _find_stem_path(job_id, stem)
    file_size = path.stat().st_size

    # Handle Range requests for audio seeking
    range_header = request.headers.get("range")
    if range_header:
        range_match = range_header.strip().split("=")[-1]
        start_str, end_str = range_match.split("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        content_length = end - start + 1

        def iter_file():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = content_length
                while remaining > 0:
                    chunk = f.read(min(8192, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type="audio/wav",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            },
        )

    return FileResponse(path, media_type="audio/wav")


@router.get("/exports/{job_id}/{filename}")
async def get_export(job_id: str, filename: str):
    path = EXPORTS_DIR / job_id / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export not found")
    return FileResponse(path, media_type="audio/wav", filename=filename)
