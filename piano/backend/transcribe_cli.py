"""Quick end-to-end smoke test, no server needed.

    python transcribe_cli.py "https://www.youtube.com/watch?v=..."
    python transcribe_cli.py path/to/local.wav

Downloads (if a URL) then transcribes to storage/midi/<id>/piano.mid.
"""

import asyncio
import sys
import uuid
from pathlib import Path

from app.services.downloader import download_audio
from app.services.transcriber import transcribe


async def main(src: str):
    job_id = str(uuid.uuid4())[:8]

    if src.startswith("http"):
        async def on_progress(pct: float):
            print(f"\r  download {pct:5.1f}%", end="", flush=True)

        audio_path, title, duration = await download_audio(src, job_id, on_progress)
        print(f"\n  → {title} ({(duration or 0):.0f}s)")
    else:
        audio_path = Path(src)
        if not audio_path.exists():
            sys.exit(f"no such file: {src}")

    from app.config import BRAIN
    print(f"  transcribing (brain: {BRAIN})…")
    midi_path, notes = transcribe(audio_path, job_id)
    print(f"  ✓ {len(notes)} notes → {midi_path}")
    if notes:
        first = notes[0]
        print(f"    first note: {first['name']} @ {first['start']}s")

    print("  rendering piano audio…")
    from app.services.renderer import render_audio
    wav = await render_audio(midi_path, job_id)
    print(f"  ✓ audio → {wav}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python transcribe_cli.py <youtube-url | audio-file>")
    asyncio.run(main(sys.argv[1]))
