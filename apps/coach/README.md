# Riyaz — Singing Coach

Real-time pitch tracking + accurate post-take note analysis.

## Practise a YouTube song

In Tonic, open **Library**, paste a YouTube video link, and choose **Show singer’s
pitch**. The app downloads the audio, separates the vocal, then opens its pitch
graph. Initial separation and pitch extraction can take several minutes; the
reference is cached for later visits.

Use the global player to play/pause, drag the timeline, or jump five seconds in
either direction. **Enable microphone** adds your gold pitch trace over the teal
reference without restarting playback. The player persists across Library visits.

The chart’s left edge is a vertical piano, with each key aligned to its semitone
line. The singer’s reference uses independent CREPE estimates from the original
isolated vocal: no temporal smoothing, confidence gate, note snapping, octave
correction or transposition. The model still requires mono audio resampled to
16 kHz. Raw estimates can include uncertain pitches during breaths and silence.
Microphone tracking controls affect only the mic trace. Raw references use a
separate cache so older processed contours are regenerated automatically.

Adjust speed, guide-vocal level, backing level, mic gain, noise gate, confidence,
smoothing, vocal range and mic timing while the song plays. Set A and B to repeat
a phrase. The pitch axis stays fixed; the input meter and live note also work
while paused. For a quiet microphone, raise input gain or lower the noise gate.
Use headphones to keep playback out of the microphone.

**Finish mic take & score** is optional and never blocks the transport. Scoring
needs an uninterrupted pass at 1×; after seeking or changing speed, toggle the mic
off/on at 1× to begin a new scorable pass.

The live overlay uses the song playback clock, including playback startup delays.

- **Live pass** (browser): mic → MPM (`pitchy`) every frame → continuous pitch
  ribbon flowing across note gridlines. Noise gated by RMS energy + MPM clarity
  + an 80 Hz high-pass + vocal-range clamp.
- **Accurate pass** (backend): on stop, the recorded clip is sent to FastAPI,
  decoded with PyAV, and run through **pYIN** (`librosa`) for a clean contour +
  segmented notes with per-note cents offsets.

## Layout
```
backend/     FastAPI · venv "riyaz" (Python 3.11) · app/services/pitch.py (pYIN)
frontend/    Next.js 16 · src/lib/pitch.ts (live MPM) · components/PitchGraph.tsx
dev.sh       runs both (backend :8008, frontend :3000)
```

## Run
```bash
./dev.sh
```
Then open http://localhost:3000 and allow the microphone.

Backend deps live in `backend/riyaz` (uv venv). Recreate with:
```bash
cd backend && uv venv riyaz --python 3.11 \
  && uv pip install --python riyaz/bin/python -r requirements.txt av
```

## Next steps (coaching layer)
- Reference melody + DTW alignment → per-note intonation & rhythm scores.
- Vibrato rate/extent and pitch-drift analysis on the accurate contour.
- Overlay the backend pYIN contour on the live graph after each take.
