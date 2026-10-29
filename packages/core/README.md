# stemcore

**The shared music engine for stem-studio.** One headless, modular Python library that consolidates the reusable pieces the apps kept re-implementing: audio ingest, stem separation, pitch detection, transcription (mono + poly), tempo, rendering, scoring, and note-grammar ML.

No web framework, no UI, no app — just the engine. The apps (coach, piano, harmonica, …) become thin layers on top of this.

## The idea

Every module speaks one shared domain model (`stemcore.model`) — `NoteEvent`, `PitchTrack`, `Job` — so a note from the harmonica transcriber, the piano transcriber, or the coach analyzer is the *same* note. That's what makes four apps into one product.

```
INGEST ──▶ SEPARATE ──▶ TRANSCRIBE ──▶ (correct · tempo) ──▶ RENDER / SCORE
(yt/file)   (demucs)     (mono|poly)     (musicmodel)          (instrument/practice)
```

## Layered dependencies

The base install is **numpy only**, so a lightweight consumer never drags in torch. Heavy capabilities live behind extras:

```bash
pip install -e packages/core                 # base: model, jobs, tempo, mono transcribe, musicmodel, instruments
pip install -e "packages/core[ingest]"       # + yt-dlp
pip install -e "packages/core[stems]"        # + demucs, torch
pip install -e "packages/core[poly]"         # + basic-pitch / pop2piano
pip install -e "packages/core[audio]"        # + librosa (pyin, scoring, dynamics)
pip install -e "packages/core[realtime]"     # + pyfluidsynth (live playback)
pip install -e "packages/core[viz]"          # + matplotlib
pip install -e "packages/core[all]"          # everything
```

## Module map

| Module | Does | Extra | From |
|---|---|---|---|
| `model` | `NoteEvent`, `PitchTrack`, `Job`, note-naming | — (base) | new |
| `config` · `storage` · `jobs` | paths · per-job layout · async job runner + SSE | — | coach+piano |
| `ingest.youtube` | yt-dlp download | `ingest` | coach+piano |
| `ingest.audiofile` | load/decode audio → np array | `audio`(opt) | piano+harmonica |
| `stems.demucs` | Demucs separation + recombine | `stems` | coach+piano |
| `pitch.yin` | YIN f0 (numpy) | — | harmonica |
| `pitch.pyin` | pYIN contour + notes | `audio` | coach |
| `transcribe.mono` | audio → notes (segment + debounce) | — | harmonica |
| `transcribe.poly` | basic-pitch / Pop2Piano → notes | `poly` | piano |
| `tempo` | auto-BPM + quantize | — | harmonica |
| `render.realtime` | live FluidSynth playback | `realtime` | harmonica |
| `render.offline` | notes/MIDI → WAV | `render` | piano |
| `render.dynamics` | velocity from loudness | `audio` | piano |
| `score` | DTW compare (intonation/timing) | `audio` | coach |
| `musicmodel` · `seeds` | note-grammar bigram/HMM (correct + generate) | — | harmonica |
| `instruments.harmonica` · `instruments.piano` | note ↔ playability mappings | — | harmonica / piano |
| `viz.pitchplot` | pitch-track / transcript graphs | `viz` | harmonica |

## Example

```python
from stemcore.transcribe.mono import transcribe_mono
from stemcore import tempo, seeds
from stemcore.musicmodel import NoteModel
from stemcore.instruments import harmonica as harp

notes = transcribe_mono(audio, sr)                     # list[NoteEvent]
bpm, phase = tempo.estimate_tempo([n.start for n in notes])
notes = tempo.quantize(notes, bpm, phase)              # snapped to a beat grid
fixed = NoteModel().train(seeds.ALL).viterbi_correct([n.midi for n in notes])
tab = [harp.tab_token(*harp.harp_hole(harp.snap_to_harp(m))) for m in fixed]
```

## Status

- **Base (numpy-only) modules are tested** — `python packages/core/tests/test_core.py` (6/6): domain model, mono transcription, tempo, musicmodel, instruments, and a guard that base import stays lightweight.
- **Heavy modules** (`stems`, `poly`, `pyin`, `score`, `render.offline`, `ingest`) are faithful ports of the apps' real source with lazy imports; they need their extras installed to run and haven't been exercised end-to-end here.

Apps are intentionally **not** built on top yet — this is the engine only.
