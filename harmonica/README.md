# 🎵 harmonica

**Play a harmonica with your keyboard, your hands, or your voice — then let ML clean it up and jam with you.**

`harmonica` is a small music toolkit built around one real diatonic harmonica (10 holes, blow + draw, key of C). You can drive it four ways — typing, hand gestures over a webcam, or *singing* — and it plays a real harmonica sound back at you. Everything you play can be transcribed to harmonica tab, and a lightweight ML model can correct, re-time, and even generate melodies in your style.

It's designed so that one day the sound engine can be swapped for a **physical pump-and-valve robot** and nothing else has to change.

---

## Why it's built this way (the one big idea)

Every input method funnels into the **same tiny sound API**:

```
set_note(midi) · note_off() · set_volume(0..1) · set_bend(±semis) · set_vibrato(0..1)
```

```
   keyboard ┐
   gestures ┤
   singing  ┼──▶  note logic  ──▶  synth (FluidSynth today, a valve-robot tomorrow)
   ML model ┘
```

Because the inputs and the output are decoupled, the keyboard, gesture, voice, and AI front-ends are interchangeable, and the day you build the physical harmonica you only write **one** new class with those five methods (open/close solenoids instead of MIDI). Nothing above it changes.

---

## Features

| Front-end | What it does | Command |
|-----------|--------------|---------|
| ⌨️ **Keyboard** | Two rows = blow/draw, columns = holes. Play it like a real harp. | `harmonica-keyboard` |
| ✋ **Gestures** | Left hand picks the hole (x) + blow/draw (height); right hand shapes volume, bend, vibrato. | `harmonica-gestures` |
| 🎤 **Sing** | Hum a melody live and the harp mirrors it, snapping your voice to real harp notes. | `harmonica-sing` |
| 📝 **Transcribe** | Record a take, analyze it **offline** into clean notes + harmonica tab + a pitch graph. | `harmonica-transcribe` |
| 🧠 **Refine / Generate** | ML: correct off-key notes, auto-detect tempo & quantize, or generate new melodies in your style. | `harmonica-refine` |

---

## Install

Requires **Python 3.9–3.12** (MediaPipe doesn't support 3.13+ yet) and system **FluidSynth**.

```bash
# 1. system audio synth
brew install fluid-synth          # macOS   (Linux: apt install fluidsynth)

# 2. project
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e .                  # installs the package + the harmonica-* commands

# 3. large assets (soundfont + hand model, not in git)
bash scripts/download_assets.sh
```

> **macOS permissions:** the gesture app needs **Camera** and the sing app needs **Microphone** access for your terminal (System Settings → Privacy & Security). Grant them on first run.

---

## Usage

### ⌨️ Keyboard
```bash
harmonica-keyboard
```
```
BLOW   Q W E R T Y U I O P     (holes 1-10)
DRAW   A S D F G H J K L ;      (holes 1-10)
↑/↓ volume · ←/→ bend · space vibrato · Esc quit
```
Columns line up on a QWERTY board (Q above A…), so moving between a hole's blow and draw is one row up/down — the same motion as changing breath on a real harp.

### ✋ Gestures
```bash
harmonica-gestures
```
Left hand: slide **x** = hole, **up** = blow / **down** = draw, **fist** = mute. Right hand: **height** = volume, **tilt** = bend, **pinch** = vibrato.

### 🎤 Sing → harmonica
```bash
harmonica-sing
```
Hum a steady note; it detects your pitch, snaps it to the harp, plays it, and builds live tab. `↑/↓` move which register of the harp your voice lands on (your voice is ~1 octave, the harp is 3). `Esc` saves the tab.

### 📝 Transcribe (the good, offline route)
```bash
harmonica-transcribe                    # record interactively (SPACE to start/stop)
harmonica-transcribe hum.wav            # or transcribe a file (.m4a/.mp3 need ffmpeg)
```
Each take saves three things to `recordings/`: `take_*.wav` (raw audio), `transcript_*.txt` (tab + timing), and `pitch_*.png` (a pitch graph — raw f0, smoothed track, and the segmented notes).

### 🧠 Refine & generate (ML)
```bash
harmonica-refine                        # refine your most recent take
harmonica-refine recordings/take_*.wav  # correct notes + auto-tempo + quantize
harmonica-refine --generate 16          # play a NEW 16-note melody in your style
```

---

## How the ML works

```
your voice ─▶ YIN pitch detection ─▶ note segmentation ─▶ HMM cleanup ─▶ tempo quantize ─▶ tab + playback
              (audio/pitch.py)        (apps/transcribe)    (ml/notemodel)  (audio/tempo)
```

- **Pitch detection** — the YIN algorithm (classic DSP, FFT-accelerated, no training). Turns audio into a frame-by-frame f0 curve.
- **Segmentation** — median-smooth the pitch track, gate silence, and a **debounce** so vocal wobble doesn't split one held note into many.
- **HMM cleanup** (`NoteModel`) — a smoothed **bigram over C-major scale degrees** (a mini melody "language model"). Viterbi decoding finds the most musically-likely note sequence, balancing *"stay close to what you sang"* against *"notes should connect like melodies usually do."* This fixes stray/off-key notes. It trains on the bundled seed tunes **plus your own takes**, so it drifts toward your style over time.
- **Tempo** — search for the BPM + phase that best line your onsets up to a grid, then quantize (proper rhythm instead of raw seconds).
- **Generation** — the *same* bigram samples new melodies. No retraining, no GPU.

> The model starts as a Markov/HMM because it works with a handful of takes. As your recordings pile up, it's a drop-in upgrade to a neural sequence model (LSTM/Transformer) behind the same interface.

---

## The instrument (C diatonic, Richter tuning)

```
Hole:  1   2   3   4   5   6   7   8   9   10
Blow:  C   E   G   C   E   G   C   E   G   C
Draw:  D   G   B   D   F   A   B   D   F   A
```
In tab, a bare number is a **blow**, a leading `-` is a **draw** (e.g. `4 -4 5 6`).

---

## Project layout

```
harmonica/
├── harmonica/              # the library
│   ├── core/               # layout · harp_map · synth   (the instrument + sound)
│   ├── audio/              # pitch (YIN) · tempo          (DSP)
│   ├── vision/             # gestures                     (hand tracking)
│   ├── ml/                 # notemodel · seeds            (the ML)
│   ├── viz/                # pitchplot                    (graphs)
│   ├── apps/               # keyboard · gesture_play · sing · transcribe · refine
│   └── paths.py            # where assets & recordings live
├── assets/                 # soundfonts/ · models/        (downloaded, gitignored)
├── recordings/             # your takes & output          (gitignored)
├── scripts/                # download_assets.sh
├── tests/                  # test_smoke.py
├── pyproject.toml · requirements.txt
```

---

## Development

```bash
python tests/test_smoke.py            # fast, no audio/GUI
# or:  python -m pytest tests
```

You can also use it as a library:

```python
from harmonica import HarmonicaSynth, YinPitch, NoteModel
from harmonica.core import layout, harp_map
```

---

## Roadmap

- [x] Keyboard, gesture, and voice control of a software harmonica
- [x] Offline transcription → harmonica tab + pitch graphs
- [x] ML note-correction, auto-tempo, and melody generation
- [ ] MIDI export (drop takes into a DAW / use as training data)
- [ ] Neural sequence model once enough takes are recorded
- [ ] **The physical robot** — swap `synth.py` for a pump + solenoid-valve driver over serial

---

## Credits

- **[FluidSynth](https://www.fluidsynth.org/)** + the FluidR3_GM soundfont — harmonica sound (GM program 22)
- **[MediaPipe](https://ai.google.dev/edge/mediapipe)** — hand landmark tracking
- **YIN** (de Cheveigné & Kawahara, 2002) — pitch detection

*MIT licensed.*
