import asyncio
import json

from fastapi import APIRouter, Query

router = APIRouter()


@router.get("/search")
async def search_youtube(q: str = Query(..., min_length=1)):
    """Search YouTube via yt-dlp and return top results."""
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        f"ytsearch10:{q}",
        "--dump-json",
        "--no-download",
        "--flat-playlist",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()

    results = []
    for line in stdout.decode("utf-8", errors="replace").strip().split("\n"):
        if not line:
            continue
        try:
            data = json.loads(line)
            results.append({
                "id": data.get("id", ""),
                "title": data.get("title", "Unknown"),
                "url": data.get("url") or f"https://www.youtube.com/watch?v={data.get('id', '')}",
                "duration": data.get("duration"),
                "channel": data.get("channel") or data.get("uploader", ""),
                "thumbnail": data.get("thumbnail") or data.get("thumbnails", [{}])[-1].get("url", ""),
                "view_count": data.get("view_count"),
            })
        except json.JSONDecodeError:
            continue

    return {"results": results}
