# Tonic Studio

A separate singing workspace: audio tracks above, piano-aligned pitch comparison
below. Built in `apps/studio`; the existing coach is still available separately.

## Run

From this directory, run `./dev.sh`, then open **http://localhost:3010**.
The API runs on **8010**. The script builds the frontend and starts both servers;
Ctrl-C stops them. Requires Node/npm, ffmpeg, and the existing coach Python
virtual environment (`../coach/backend/.venv`). Set `STUDIO_PYTHON` to use another
interpreter with the dependencies in `../coach/backend/requirements.txt`.

## Use

1. Upload an audio file or choose an existing song under **Sessions**. The original
   upload opens immediately. Separation adds Singer, Drums, Bass, and Instruments;
   the original mix is then muted. Processing progress and retry errors appear inline.
2. Play, pause, seek on the ruler/waveforms, and adjust each track's mute, solo,
   and volume. Space plays/pauses; arrow keys skip five seconds when focus is outside
   a form control. Solo includes all soloed tracks; mute always wins.
3. Add a **Vocal track**, choose a microphone, and press **Record** at the desired
   position. Recording becomes available after separation. Use headphones.
   **Stop & save** writes a WAV track. Reaching the song's end also saves the take.
   Finish a recording before seeking; this keeps a single take contiguous.
4. The lower pane compares the singer with live input and your selected recording.
   **Singer** controls offer gentle median smoothing, confidence and silence floors.
   **Live mic** adds stronger adjustable gating and octave-jump confirmation.
   **Take** offers reversible smoothing, timing correction, comparison statistics,
   and a download of the original recording. **Raw overlay** exposes unprocessed
   estimates alongside the guide. Swara tonic only changes labels.
5. Sessions, audio, pitch data and settings are stored in `.data/`. Reopen them
   through **Sessions**. Microphone access is intentionally off after a page reload.

## Audio and pitch

All decoded track buffers and microphone capture share one Web Audio clock.
An AudioWorklet records original mono PCM at the AudioContext's sample rate;
16-bit WAV encoding does not apply detection gain, gates, smoothing, or tuning.
Each take stores its start on the song timeline. Original uploads also remain on disk.

Raw CREPE estimates are retained separately from display processing. Playback and
recording stay usable while detailed analysis runs in a background thread. Live MPM
estimates are persisted immediately, then replaced by detailed raw CREPE analysis.
Projects interrupted during separation or analysis resume pending work on API restart.
This is a local singing tool, with no music-production effects or synthesized vocals.

“Raw” still means a pitch estimator's output, not ground truth: breaths, leakage and
silence can produce guesses. The processed view removes very quiet/uncertain frames
and smooths short spikes. Neither view snaps notes to a key. Live capture is faster
and more constrained than offline review. Timing correction adjusts the comparison
view; it does not rewrite the recorded audio.

## Checks

See [CHECKLIST.md](CHECKLIST.md) for acceptance results and browser evidence.

```sh
cd frontend
npm run lint
npm test
npm run build
cd ../backend
../../coach/backend/.venv/bin/python -m unittest discover -s tests -v
```

Frontend: Next.js 16, React 19, Canvas, Web Audio and pitchy.
Backend: FastAPI with the existing Demucs / CREPE engine and atomic JSON sidecars.
`STUDIO_DATA` changes the session directory. `STORAGE_DIR` and `KARAOKE_CACHE`
change the existing coach library location; defaults use Tonic's Application Support
folders on this Mac. `NEXT_PUBLIC_STUDIO_API` changes the browser's API origin at build time.
