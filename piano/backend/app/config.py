"""Piano config — YouTube → piano MIDI conversion service.

No recording, no mic, no MIDI keyboard: a batch pipeline that takes a YouTube
URL and produces a downloadable/playable piano transcription.
"""

import os
from pathlib import Path

# app/config.py -> parents[2] = the piano/ project root
BASE_DIR = Path(os.environ.get("PIANO_ROOT", str(Path(__file__).resolve().parents[2])))

STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", str(BASE_DIR / "storage")))
DOWNLOADS_DIR = STORAGE_DIR / "downloads"   # yt-dlp output (audio.wav per job)
STEMS_DIR = STORAGE_DIR / "stems"           # Demucs output (de-drum step)
MIDI_DIR = STORAGE_DIR / "midi"             # basic-pitch output (piano.mid + notes)
for d in (DOWNLOADS_DIR, STEMS_DIR, MIDI_DIR):
    d.mkdir(parents=True, exist_ok=True)

# Which "brain" turns audio into piano notes:
#   "pop2piano"   — musical COVER: beat-aligned, real dynamics (needs torch+essentia)
#   "basic_pitch" — literal polyphonic transcription (light, no torch)
BRAIN = os.environ.get("PIANO_BRAIN", "pop2piano")

# Pop2Piano — pretrained pop-song → piano-cover transformer (HuggingFace).
# ~21 "composer" arranger styles (composer1..composer21) tweak the feel.
POP2PIANO_MODEL = os.environ.get("POP2PIANO_MODEL", "sweetcocoa/pop2piano")
POP2PIANO_COMPOSER = os.environ.get("POP2PIANO_COMPOSER", "composer1")

# Pop2Piano only models note on/off (flat velocity). Paint dynamics back on from
# the source audio's loudness envelope so the cover breathes with the real song.
DYNAMICS_FROM_AUDIO = os.environ.get("PIANO_DYNAMICS", "1") != "0"

# Audio render — MIDI → real piano via fluidsynth + a soundfont. Falls back to
# a sine synth if either is missing. Soundfont lives in backend/assets/ (gitignored,
# ~38MB); grab it with: make soundfont  (or see README).
FLUIDSYNTH_BIN = os.environ.get("FLUIDSYNTH_BIN", "fluidsynth")
SOUNDFONT = Path(os.environ.get(
    "PIANO_SOUNDFONT",
    str(Path(__file__).resolve().parents[1] / "assets" / "MuseScore_General.sf3"),
))
RENDER_SR = int(os.environ.get("PIANO_RENDER_SR", "44100"))

# Piano range clamps for basic-pitch — A0..C8. Keeps the transcription inside a
# real keyboard and drops sub/ultrasonic noise that pollutes the note list.
PIANO_FMIN = 27.5      # A0
PIANO_FMAX = 4186.01   # C8

# Demucs de-mud step. Pop2Piano transcribes the whole mix, so bass + drums land
# as muddy low chords/noise. Separating and keeping only vocals + melodic
# instruments (dropping BASS and drums) roughly halves the sub-C3 clutter — the
# bass is the real culprit, so keeping it out matters more than the drums.
DEMUCS_MODEL = "htdemucs"
STEM_NAMES = ["vocals", "drums", "bass", "other"]
CLEAN_KEEP_STEMS = os.environ.get("PIANO_KEEP_STEMS", "vocals,other").split(",")
CLEAN_DEFAULT = os.environ.get("PIANO_CLEAN", "1") != "0"  # de-mud on by default

PORT = int(os.environ.get("PIANO_PORT", "8009"))
