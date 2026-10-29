"""
transcribe.py — the POST-PROCESS route: record a take (or load a file), then
analyze it offline into a clean harmonica transcription.

Unlike the live sing.py, this isn't real-time, so it can do a much better job:
it runs YIN across the whole recording, median-smooths the pitch track to kill
octave glitches, then segments it into discrete notes with real onsets and
durations before mapping to the harp.

Two ways to use it:

  1) Record interactively (default):
        ./.venv/bin/python transcribe.py
     SPACE start/stop recording -> it analyzes, shows the tab, and plays it back.

  2) Transcribe an existing file:
        ./.venv/bin/python transcribe.py path/to/humming.wav
     (.wav always works; .m4a/.mp3 work if ffmpeg is installed)

Output (tab + note names + timing) is saved to recordings/transcript_*.txt.
"""

import os
import shutil
import subprocess
import sys
import threading
import time
import wave

import numpy as np

from stemcore.instruments.harmonica import harp_hole, snap_to_harp, tab_token
from stemcore.model import midi_to_name as midi_name
from stemcore.pitch.yin import YinPitch, hz_to_midi
from stemcore.render.realtime import RealtimeSynth as HarmonicaSynth
from ..paths import SOUNDFONT, REC_DIR

SR = 44100

# ---- analysis tuning ----
HOP = 512             # ~11.6 ms between pitch estimates
WIN = 2048            # ~46 ms analysis window
RMS_GATE = 0.008      # frames quieter than this are treated as silence
CONF_GATE = 0.50      # minimum YIN confidence to trust a frame
MEDIAN_K = 9          # pitch-track median filter (odd) -> kills octave glitches
MIN_NOTE = 0.12       # notes shorter than this (s) are discarded as specks
GAP_MERGE = 0.06      # silences shorter than this between equal notes are bridged
DEBOUNCE_S = 0.07     # a new pitch must hold this long before it ends the current note
# -------------------------


# ----------------------------------------------------------------- analysis
def _median_track(vals, k):
    """Median filter over a list that may contain None (unvoiced) entries."""
    half = k // 2
    out = []
    for i in range(len(vals)):
        window = [v for v in vals[max(0, i - half): i + half + 1] if v is not None]
        out.append(float(np.median(window)) if window else None)
    return out


def pitch_track(y, sr):
    """Frame-by-frame pitch. Returns (times, raw_midi, conf) where raw_midi holds
    a MIDI float per frame or None when unvoiced. This is the raw material for
    both note segmentation and the pitch graph."""
    yin = YinPitch(sr)
    times, raw, confs = [], [], []
    n = len(y)
    for i in range(0, max(1, n - WIN), HOP):
        block = y[i:i + WIN]
        rms = float(np.sqrt(np.mean(block * block)) + 1e-12)
        times.append(i / sr)
        if rms < RMS_GATE:
            raw.append(None); confs.append(0.0)
            continue
        f0, conf = yin(block)
        if f0 is not None and conf >= CONF_GATE:
            raw.append(hz_to_midi(f0)); confs.append(conf)
        else:
            raw.append(None); confs.append(conf if f0 is not None else 0.0)
    return np.array(times), raw, confs


def analyze(y, sr):
    """Audio -> list of note events [{'midi', 'start', 'dur'}] (true sung pitches)."""
    _times, raw, _conf = pitch_track(y, sr)
    smoothed = _median_track(raw, MEDIAN_K)
    semis = [int(round(m)) if m is not None else None for m in smoothed]

    # bridge tiny silences between two equal notes (a brief consonant/breath)
    gap_frames = int(GAP_MERGE * sr / HOP)
    i = 0
    while i < len(semis):
        if semis[i] is None:
            j = i
            while j < len(semis) and semis[j] is None:
                j += 1
            left = semis[i - 1] if i > 0 else None
            right = semis[j] if j < len(semis) else None
            if left is not None and left == right and (j - i) <= gap_frames:
                for k in range(i, j):
                    semis[k] = left
            i = j
        else:
            i += 1

    return _segment_debounced(semis, sr)


def _segment_debounced(semis, sr):
    """Segment the per-frame semitone track into notes, but only switch notes
    once a NEW value has persisted for DEBOUNCE_S. Brief excursions (vocal
    wobble, a stray octave frame) shorter than that are absorbed into the note
    in progress instead of splitting it."""
    debounce = max(1, int(round(DEBOUNCE_S * sr / HOP)))

    def t(i):
        return i * HOP / sr

    events = []
    cur, cur_start = None, 0            # committed note + its start frame
    cand, cand_start, cand_n = None, 0, 0  # pending challenger value

    for i, s in enumerate(semis):
        if s == cur:
            cand, cand_n = None, 0       # challenger defeated; note holds
            continue
        if s == cand:
            cand_n += 1
        else:
            cand, cand_start, cand_n = s, i, 1
        if cand_n >= debounce:           # challenger has held long enough -> switch
            if cur is not None:
                dur = t(cand_start) - t(cur_start)
                if dur >= MIN_NOTE:
                    events.append({"midi": cur, "start": t(cur_start), "dur": dur})
            cur, cur_start = cand, cand_start
            cand, cand_n = None, 0

    if cur is not None:                   # flush the final note
        dur = t(len(semis)) - t(cur_start)
        if dur >= MIN_NOTE:
            events.append({"midi": cur, "start": t(cur_start), "dur": dur})
    return events


# ------------------------------------------------------------------ i/o
def load_wav(path):
    with wave.open(path, "rb") as w:
        sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(n)
    dtype = {2: np.int16, 4: np.int32}.get(sw)
    if dtype is None:                      # 8-bit or unusual: coarse fallback
        y = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    else:
        y = np.frombuffer(raw, dtype=dtype).astype(np.float32) / np.iinfo(dtype).max
    if ch > 1:
        y = y.reshape(-1, ch).mean(axis=1)
    return y.astype(np.float32), sr


def load_audio(path):
    if path.lower().endswith(".wav"):
        return load_wav(path)
    if shutil.which("ffmpeg"):
        os.makedirs(REC_DIR, exist_ok=True)
        tmp = os.path.join(REC_DIR, "_converted.wav")
        subprocess.run(["ffmpeg", "-y", "-i", path, "-ac", "1", "-ar", str(SR), tmp],
                       check=True, capture_output=True)
        return load_wav(tmp)
    raise SystemExit("Only .wav is supported unless ffmpeg is installed (for m4a/mp3).")


def save_transcript(events, octave_shift, path=None):
    if not events:
        print("Nothing to save (no notes detected).")
        return None
    os.makedirs(REC_DIR, exist_ok=True)
    if path is None:
        path = os.path.join(REC_DIR, f"transcript_{time.strftime('%Y%m%d_%H%M%S')}.txt")
    with open(path, "w") as fp:
        fp.write("# Offline transcription (C diatonic harmonica). '-' = draw.\n")
        fp.write(f"# octave_shift={octave_shift}\n")
        toks, sung, harp = [], [], []
        for ev in events:
            tgt = snap_to_harp(ev["midi"], octave_shift)
            hole, draw = harp_hole(tgt)
            toks.append(tab_token(hole, draw))
            sung.append(midi_name(ev["midi"]))
            harp.append(midi_name(tgt))
        fp.write("tab:       " + " ".join(toks) + "\n")
        fp.write("you sang:  " + " ".join(sung) + "\n")
        fp.write("harp plays:" + " ".join(harp) + "\n\n")
        fp.write("# start(s)  dur(s)  tab  sung -> harp\n")
        for ev, tok, s, h in zip(events, toks, sung, harp):
            fp.write(f"{ev['start']:7.2f}  {ev['dur']:5.2f}  {tok:>4}  {s:>4} -> {h}\n")
    print(f"Saved {len(events)} notes -> {path}")
    return path


def save_wav(y, sr, path):
    yi = (np.clip(y, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(yi.tobytes())
    return path


def save_take(y, sr, events, octave_shift):
    """Save everything for one take with a shared timestamp: raw WAV (so it can
    be re-analyzed later), the transcript, and the continuous pitch graph PNG."""
    if not events:
        print("Nothing to save (no notes detected).")
        return None
    os.makedirs(REC_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    wav = save_wav(y, sr, os.path.join(REC_DIR, f"take_{stamp}.wav"))
    txt = save_transcript(events, octave_shift, os.path.join(REC_DIR, f"transcript_{stamp}.txt"))
    png = os.path.join(REC_DIR, f"pitch_{stamp}.png")
    from stemcore.viz.pitchplot import plot_from_audio
    times, raw, _ = pitch_track(y, sr)
    smoothed = _median_track(raw, MEDIAN_K)
    plot_from_audio(times, raw, smoothed, events, octave_shift, png, title=f"take {stamp}")
    print(f"Saved take: {wav}\n            {txt}\n            {png}")
    return {"wav": wav, "txt": txt, "png": png, "stamp": stamp}


def tab_string(events, octave_shift):
    out = []
    for ev in events:
        hole, draw = harp_hole(snap_to_harp(ev["midi"], octave_shift))
        out.append(tab_token(hole, draw))
    return " ".join(out)


# --------------------------------------------------------------- playback
class Player:
    def __init__(self, synth):
        self.synth = synth
        self._stop = threading.Event()
        self._thread = None

    def play(self, events, octave_shift):
        self.stop()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, args=(events, octave_shift), daemon=True)
        self._thread.start()

    def _run(self, events, octave_shift):
        prev_end = 0.0
        for ev in events:
            if self._stop.is_set():
                break
            # honor the original rests between notes
            gap = ev["start"] - prev_end
            if gap > 0:
                self._sleep(min(gap, 0.4))
            self.synth.set_note(snap_to_harp(ev["midi"], octave_shift))
            self._sleep(ev["dur"])
            prev_end = ev["start"] + ev["dur"]
        self.synth.note_off()

    def _sleep(self, secs):
        end = secs
        t = 0.0
        while t < end and not self._stop.is_set():
            time.sleep(0.01)
            t += 0.01

    def stop(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=0.5)
        self.synth.note_off()


# ----------------------------------------------------------- file (CLI) mode
def run_file(path):
    print(f"Loading {path} ...")
    y, sr = load_audio(path)
    print(f"  {len(y)/sr:.1f}s @ {sr} Hz. Analyzing...")
    events = analyze(y, sr)
    if not events:
        print("No clear pitches found. Try a louder/steadier recording.")
        return
    shift = 1
    print(f"\n{len(events)} notes. Harmonica tab (octave_shift={shift}):")
    print("  " + tab_string(events, shift))
    save_take(y, sr, events, shift)
    print("\nPlaying it on the harmonica...")
    synth = HarmonicaSynth(SOUNDFONT); synth.set_volume(0.95)
    player = Player(synth)
    player.play(events, shift)
    while player._thread.is_alive():
        time.sleep(0.1)
    synth.close()


# -------------------------------------------------------- interactive (GUI)
def run_interactive():
    import pygame as pg
    import sounddevice as sd

    os.makedirs(REC_DIR, exist_ok=True)
    synth = HarmonicaSynth(SOUNDFONT); synth.set_volume(0.95)
    player = Player(synth)

    pg.init()
    screen = pg.display.set_mode((760, 420))
    pg.display.set_caption("Transcribe (post-process)")
    clock = pg.time.Clock()
    f_s = pg.font.SysFont("menlo,consolas,monospace", 15)
    f_m = pg.font.SysFont("menlo,consolas,monospace", 22)
    f_b = pg.font.SysFont("menlo,consolas,monospace", 34, bold=True)

    BG = (18, 20, 24); FG = (230, 230, 230); DIM = (110, 110, 120)
    GREEN = (80, 220, 120); RED = (235, 90, 90); BLUE = (90, 170, 245)

    state = "idle"          # idle | recording | result
    rec_chunks = []
    rec_level = 0.0
    rec_start = 0.0
    events = []
    shift = 1

    def on_audio(indata, frames, t, status):
        nonlocal rec_level
        rec_chunks.append(indata[:, 0].copy())
        rec_level = float(np.sqrt(np.mean(indata * indata)) + 1e-12)

    stream = sd.InputStream(channels=1, samplerate=SR, blocksize=1024,
                            dtype="float32", callback=on_audio)

    def start_rec():
        nonlocal state, rec_start
        rec_chunks.clear()
        stream.start()
        rec_start = time.time()
        state = "recording"

    def stop_rec_and_analyze():
        nonlocal state, events
        stream.stop()
        state = "result"
        y = np.concatenate(rec_chunks) if rec_chunks else np.zeros(1, np.float32)
        events = analyze(y, SR)
        if events:
            save_take(y, SR, events, shift)
            player.play(events, shift)

    running = True
    try:
        while running:
            clock.tick(60)
            for e in pg.event.get():
                if e.type == pg.QUIT or (e.type == pg.KEYDOWN and e.key == pg.K_ESCAPE):
                    running = False
                elif e.type == pg.KEYDOWN and e.key == pg.K_SPACE:
                    if state in ("idle", "result"):
                        player.stop()
                        start_rec()
                    elif state == "recording":
                        stop_rec_and_analyze()
                elif e.type == pg.KEYDOWN and state == "result":
                    if e.key == pg.K_p:
                        player.play(events, shift)
                    elif e.key in (pg.K_UP, pg.K_DOWN):
                        shift = min(2, shift + 1) if e.key == pg.K_UP else max(0, shift - 1)
                        if events:
                            player.play(events, shift)   # take already saved; just re-map/replay

            # ---- draw ----
            screen.fill(BG)
            screen.blit(f_m.render("TRANSCRIBE  (post-process)", True, FG), (24, 18))

            if state == "idle":
                screen.blit(f_b.render("press SPACE to record", True, FG), (24, 120))
                screen.blit(f_s.render("hum a melody; SPACE again to stop & transcribe", True, DIM), (24, 168))
            elif state == "recording":
                elapsed = time.time() - rec_start
                pg.draw.circle(screen, RED, (40, 118), 12)
                screen.blit(f_b.render(f"recording  {elapsed:4.1f}s", True, RED), (64, 100))
                screen.blit(f_s.render("SPACE to stop & transcribe", True, DIM), (24, 168))
                pg.draw.rect(screen, (45, 48, 54), (24, 210, 400, 16), border_radius=4)
                pg.draw.rect(screen, GREEN, (24, 210, int(400 * min(1, rec_level / 0.1)), 16), border_radius=4)
            else:  # result
                screen.blit(f_s.render(f"{len(events)} notes  |  octave shift {shift:+d} (Up/Down)", True, DIM), (24, 78))
                # tab, wrapped
                toks = tab_string(events, shift).split()
                line, y = [], 110
                for tk in toks:
                    line.append(tk)
                    if len(" ".join(line)) > 44:
                        screen.blit(f_m.render(" ".join(line), True, GREEN), (24, y))
                        line, y = [], y + 30
                if line:
                    screen.blit(f_m.render(" ".join(line), True, GREEN), (24, y))
                screen.blit(f_s.render("SPACE = record again   P = play   Up/Down = octave   Esc = quit", True, DIM), (24, 384))

            if state != "result":
                screen.blit(f_s.render("SPACE = record/stop      Esc = quit", True, DIM), (24, 384))
            pg.display.flip()
    finally:
        player.stop()
        try:
            stream.close()
        except Exception:
            pass
        synth.close()
        pg.quit()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if "--devices" in sys.argv:
        import sounddevice as sd
        print(sd.query_devices())
    elif args:
        run_file(args[0])
    else:
        run_interactive()


if __name__ == "__main__":
    main()
