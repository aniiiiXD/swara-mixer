# Riyaz — Music Coach Roadmap

A multi-tradition vocal coach: structured curriculum + song-driven learning +
diagnostics, backed by accounts and cloud progress.

## Product pillars
1. **Tradition-agnostic core** — one engine, swappable notation/tuning/accompaniment
   per tradition (Hindustani sargam + drone, Carnatic + gamaka, Western + metronome).
2. **Three woven modes** — a graded **curriculum** ladder, **songs** you love as advanced
   lessons, and **diagnostics** that watch everything you sing and prescribe fixes.
3. **Memory** — accounts + cloud history so the coach adapts to *you* over time.

---

## Architecture

```
┌─────────────────────────── Next.js app (Vercel) ───────────────────────────┐
│  UI + real-time pitch (AudioWorklet/MPM, zero latency)                       │
│  Server Actions/API: auth, curriculum, progress, song catalog               │
└───────────┬───────────────────────────────────────────┬────────────────────┘
            │ Postgres (Neon)                             │ HTTP
            │  users, profiles, exercises, attempts,      │
            │  mastery, songs, streaks                    ▼
            │                            ┌─── Audio Engine (FastAPI, CPU) ───┐
            │                            │  pYIN analysis, feature extraction │
            │                            │  DTW scoring, diagnostics          │
            │                            └────────────────┬───────────────────┘
            │                                             │ enqueue
            ▼                                             ▼
   Blob storage (takes)              ┌─── Separation worker (GPU/queue) ───┐
                                     │  Demucs + yt-dlp (heavy, async job) │
                                     └──────────────────────────────────────┘
```

**Why this split**
- **Real-time stays in-browser** (MPM/AudioWorklet) — latency matters for cues.
- **Accurate analysis is server-side** Python (librosa pYIN, CPU-fine, containerized).
- **Separation is a queued worker** — Demucs/torch is heavy/slow on CPU; never put it
  in a serverless request path. Candidates: Modal, Replicate, Railway GPU, or a box.
- **App + auth + DB on Vercel** (Next App Router, Neon Postgres, Clerk/Auth.js).

**Tradition abstraction (the key design):** a `Tradition` config drives everything —
- pitch system: tonic-relative (Sa) vs absolute (note names)
- degree labels: sargam / solfège / letters
- tuning: equal-temperament vs just-intonation tolerance
- accompaniment: tanpura drone vs metronome
- ornament tolerance: how much gamaka/slide is "correct"
- exercise generators per tradition
All scoring/feedback reads this config, so adding a tradition = adding a config + generator.

---

## Data model (Postgres)
- **users / profiles** — auth identity; voice range (lo/hi), chosen Sa (tonic Hz),
  preferred tradition, goals.
- **exercises** — content: type (hold-tone | interval | scale | alankar/palta | song-phrase),
  target degree sequence + durations, tempo, tradition, difficulty, prerequisites.
- **attempts** — every take: extracted features (JSON), score breakdown, audio blob ref, ts.
- **mastery** — per-(user,exercise) state: best score, pass/fail, spaced-repetition due date.
- **songs** — separation job id, title, key, sections, phrase segmentation, source url.
- **streaks / sessions** — daily practice, time-on-task, history for the dashboard.

---

## Engine upgrades (beyond today's pYIN + DTW)
Per-attempt feature vector the coach reasons over:
- intonation: cents-error distribution per degree (mean/median/spread)
- **stability**: pitch jitter on sustained tones (the core of "hold Sa")
- note accuracy: % of targets hit within tolerance
- onset timing: how close note starts land vs the beat/reference
- range: lowest/highest sustained, vs the user's known range
- **vibrato**: rate (Hz) + extent (cents), and whether it's intentional vs wobble
- octave handling: detect octave errors, register breaks
- breath/phrase length

**Diagnostics** = roll these up across attempts → weaknesses ("consistently sharp above G4",
"sustain drifts after ~1.5 s", "weak on descending phrases").
**Recommendation** = rules engine maps weakness → next exercise; optionally an LLM layer for
natural-language feedback and adaptive lesson selection.

---

## Phased roadmap

### M0 — Foundation (make it a coach, not a demo)
- **Set your Sa / tonic** (relative pitch); tradition selector wired through the UI.
- **Tanpura drone + metronome** accompaniment (Web Audio).
- Tradition abstraction skeleton; refactor current sargam/scoring to read it.
- **Accounts + Postgres**; persist attempts + scores. Count-in before takes.
- Outcome: log in, pick tradition + Sa, sing, and have it remembered.

### M1 — Curriculum engine
- Exercise data model + per-tradition generators (hold-tone, scales/aroha-avaroha,
  alankars/paltas; Western scales/intervals).
- **Real-time exercise runner**: target overlay + live cues (in-tune meter, "hold steady",
  flat/sharp), loop, slow-down.
- Mastery + unlock ladder; spaced repetition for retention.

### M2 — Diagnostics & progress
- Expand feature extraction (stability, vibrato, onset, range, octave).
- Diagnostic rollups + recommendation engine.
- **Progress dashboard**: scores over time, streaks, range growth, weakness trends.

### M3 — Songs as lessons
- Phrase segmentation of the reference vocal; practice phrase-by-phrase with loop/slow-down.
- Lyrics + section map; difficulty rating; slot songs into the curriculum as advanced units.

### M4 — Intelligence & reach
- LLM-driven feedback + adaptive lesson selection.
- Fill out multi-tradition (Carnatic gamaka, just-intonation), leaderboards/social, mobile polish.

---

## First concrete step (M0, week 1)
1. **Set-your-Sa**: a tuner where the user sustains/sets a tonic; all sargam becomes relative.
2. **Tanpura drone**: looped Sa–Pa–Sa drone in Web Audio, keyed to the chosen Sa.
3. **Tradition config** object + thread it through the existing graph + scoring.
4. **Auth + Neon + `attempts` table**: persist every freestyle/song take.
