# Tonic singing studio — acceptance checks

- [x] Separate application in `apps/studio`; existing coach remains available.
- [x] Upload an audio song; show progress, errors, separated waveform tracks.
- [x] Reopen existing separated songs and saved studio sessions.
- [x] Shared play/pause, seek, master volume, mute/solo and per-track level.
- [x] Add a vocal track, choose microphone, record at the current song position.
- [x] Recorded audio is aligned, playable, downloadable, and saved across reloads.
- [x] Lower half shows singer, live voice and selected take on a piano pitch scale.
- [x] Gentle, adjustable singer smoothing; no note snapping or forced key.
- [x] Stronger adjustable live gating, confidence, smoothing and jump stability.
- [x] Original audio and raw pitch retained for take review; processing is reversible.
- [x] Responsive layout, keyboard transport, clear loading/recording/error states.
- [x] Meaningful audio/pitch/API tests, production build and browser workflow checks.
- [x] Open the completed studio in the user's browser.

## Design

Slate console (#20262e), raised controls (#303945), paper ink (#e4e9ef), muted
ink (#aab5c3), reference blue (#91c6e8), take apricot (#efba91). System rounded
sans for controls, tabular figures for time. Color identifies an audio source.

One full-height workstation: transport, scrollable track lanes, large lower
pitch pane with vertical piano, compact inspector on the right. Real waveforms
and pitch curves carry the design; no marketing panels or decorative graphs.

## Verification log

Checks are marked only after implementation and the corresponding verification.


### Verified 2026-09-15

- Production build and ESLint pass. Seven frontend audio/pitch tests and four API
  tests pass; shell syntax and Python compilation checks pass.
- Real 6-second song upload exercised both through the HTTP API and the browser's
  actual file-input/change handler (a temporary fixture supplied the file).
  Demucs produced vocal/drum/bass/instrument tracks and completed CREPE analysis.
- Controlled browser microphone: 220 Hz at amplitude 0.015, through the production
  AudioWorklet, tracker, Record button, WAV writer, take API and neural analysis.
- Automatic stop: take began at song time 1.000 s, saved 240,512 samples at 48 kHz
  (5.0107 s); measured dominant frequency 219.9 Hz, RMS 0.01061.
- Manual stop: a second take began at 1.000 s and saved 1.720 s. Live noise gate
  was raised to -25 dB so the guide rejected the -39 dB input. The saved WAV still
  had RMS 0.010607: live constraints did not alter recorded audio.
- Browser mute Singer, solo Drums, and singer smoothing 50 → 90 ms while playing:
  transport continued at 1.25 s. Track mix and settings persisted to disk.
- Reloaded after restarting the API: original tracks, both takes, raw analysis,
  selected latest take, and pitch comparison were available. Mic started off.
- Desktop screenshot: four complete stem lanes above the lower pitch workspace.
  390 px iframe check: track list scrolls, pitch pane fits, time labels do not overlap.
- Verification sessions are archived under `.build/verification-sessions/`; they
  are not mixed into the user's session list. Generated microphone fixture was
  closed and its server stopped. The actual user's microphone was not recorded.
- Final user tab: http://localhost:3010/?project=64d4f6df57db, original song,
  paused at 40 seconds. Normal production page; no microphone fixture.

### Pitch chart follow-up
- [x] Playhead stays within 5% of the left edge, with up to 0.6 s of recent history. Chart clicks use the same time mapping.
- [x] Discontinuous estimates start separate strokes instead of drawing tall vertical connections; sustained leaps remain visible.
- [x] Optional “Suppress quiet bleed” uses the singer’s own level to reject faint stem leakage; raw data and audio remain unchanged.
- [x] Real song check: 147 stray estimates in 12–22.4 s reduced to zero; all 238 estimates in the first sung phrase (22.47–24.84 s) retained.
- [x] Ten frontend tests, ESLint, and production build pass. Browser verified left alignment, click-to-seek, playback, and final controls. Left paused at 23 s.
