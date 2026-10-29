# Piano backend — YouTube → piano MIDI

Batch conversion service. Give it a YouTube URL, get back a piano transcription
as a `.mid` file plus note events for a falling-notes UI. No recording, no mic,
no MIDI keyboard — pure audio → piano.

## Why not pYIN (like the singing coach)?

The singing coach uses **pYIN**, a *monophonic* pitch tracker — one voice at a
time. A piano plays **chords**, so this uses **[basic-pitch]** (Spotify's
ICASSP-2022 multi-pitch model): polyphonic audio → MIDI.

## Pipeline

```
yt-dlp  →  [Demucs de-drum]  →  Pop2Piano  →  source-grounded  →  fluidsynth  →  piano.mid
download    optional, cleaner    piano cover    dynamics           real piano      + piano.wav
                                                                                   + notes.json
```

- **Pop2Piano** (default brain) makes a *musical cover*: it beat-tracks the audio
  and generates on the beat grid, so tempo/rhythm are real. Swap to `basic_pitch`
  (literal transcription) with `PIANO_BRAIN=basic_pitch`.
- **Dynamics** — Pop2Piano only models note on/off (flat velocity), so we paint
  velocity from the *source* audio's loudness envelope (`dynamics.py`). The cover
  breathes with the real song. Disable with `PIANO_DYNAMICS=0`.
- **Render** — fluidsynth + a grand-piano soundfont turns the MIDI into
  listenable `piano.wav`. Falls back to a sine synth if either is missing.
- **De-drum** (optional, off) — dropping the Demucs drums stem before
  transcription cleans up ghost notes. Needs the torch/demucs deps.

## Setup

```bash
cd piano/backend
make setup          # py3.11 venv + deps + downloads the soundfont
```

System deps on PATH: `yt-dlp`, `ffmpeg`, `fluidsynth`
(`brew install yt-dlp ffmpeg fluid-synth`).

> Uses **Python 3.11** (not 3.13/3.14 — no wheels for the numpy<2/onnx stack) and
> pins **setuptools<81** (resampy still imports the removed `pkg_resources`).

## Run

```bash
make cli URL="https://www.youtube.com/watch?v=..."   # smoke test, no server
make run                                             # API server on :8009
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/jobs` | `{url, clean?}` → `{jobId}` — start conversion |
| GET  | `/api/jobs/{id}` | job status / progress |
| GET  | `/api/jobs/{id}/progress` | SSE stream of phase+progress |
| GET  | `/api/jobs/{id}/notes` | `{notes:[{start,end,midi,name,velocity}], …}` |
| GET  | `/api/jobs/{id}/midi` | download `piano.mid` |
| GET  | `/api/jobs/{id}/audio` | rendered `piano.wav` (the listenable cover) |

[basic-pitch]: https://github.com/spotify/basic-pitch
[Pop2Piano]: https://huggingface.co/sweetcocoa/pop2piano
