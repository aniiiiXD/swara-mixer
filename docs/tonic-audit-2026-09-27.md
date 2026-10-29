# Tonic audit — 27 September 2026

Tonic contains useful, working audio technology, but several generations of the product coexist without a clear owner for the singing workflow. The most serious problems are misleading exercise scores, incomplete job recovery, inconsistent recording lifecycle, and fragmented persistence. Another redesign would leave those problems intact.

My recommendation is to make Studio's **choose a song → record a take → listen and compare → repeat a phrase** the primary workflow. Keep the shared Python engine, the useful parts of Coach, and the desktop shell. Consolidate incrementally around that workflow, with a versioned recording/session model and one transport. Preserve the other apps as archives until their useful features and data have been accounted for.

This audit changed no application source or dependency manifests. It installed frontend dependencies, ran builds/checks, inspected the built Coach and Studio interfaces, and used isolated temporary data for backend tests and bug reproductions.

## What is actually here

The source inventory contains approximately **17,230 lines in 186 Python, TypeScript, JavaScript, Rust, and shell files**. This excludes dependencies, generated output, staged copies, assets, recordings, and next-env files; it does not count CSS or documentation. This is a manageable codebase. Its difficulty comes from competing implementations and unclear boundaries.

| Area | Existing responsibility | Assessment |
|---|---|---|
| `apps/coach` | Next frontend, song library, freestyle, lessons, stem mixer, pitch inspection; FastAPI and SQLite separation worker; Tauri desktop packaging | Main entry point, broadest integration, several concrete correctness defects |
| `apps/studio` | Separate Next/FastAPI singing workspace, multitrack transport, WAV takes, saved projects, pitch comparison | Strongest foundation for the central recording workflow |
| `apps/tonic-pitch` | Another Next frontend with local pitch practice, accompaniment, and Coach song APIs | Overlapping product; its `/studio` is a song list linking back to karaoke, not the separate recording Studio |
| `apps/pitch` | Older FastAPI/static-JavaScript pitch, DAW, and karaoke experiments | Useful experiments, another in-memory job implementation; uses port 8010, also used by Studio |
| `packages/core` | Shared ingest, Demucs, pitch, scoring, transcription, rendering, music model, storage, jobs | Real reuse exists; abstraction is incomplete and documentation is stale |
| `piano` | Separate audio-to-MIDI/piano app | Adjacent experiment; only part of its service implementation uses the shared engine |
| `harmonica` | Keyboard, gesture, voice, and transcription experiments | Adjacent instrument project, increasingly using stemcore |

The main navigation exposes Today, Library, Mix, Pitch, Learn, and Progress. It has no link to the separate Studio app. In Coach, Today’s Song tab initially sends the user to Library; Learn offers a separate recording runner; Pitch has its own listening UI; Mix has a separate playback engine. These paths do not share one complete practice session.

Data ownership is similarly split: Coach has SQLite job state, filesystem stems and JSON caches; exercise mastery uses browser localStorage; Studio has `.data` projects and takes; desktop data lives under Application Support; the generic engine defaults to `~/.stemcore`. These are not interchangeable catalogs.

## Findings, ordered by practical impact

1. **Exercise scores cannot currently establish mastery. Confirmed by executing the real scorer.**

   [`exerciseScore.ts`](../apps/coach/frontend/src/lib/exerciseScore.ts) compares notes by list position, discards duration and `cents_offset`, and folds octave errors to zero. Backend CREPE note segmentation supplies integer MIDI plus a separate cents offset, so the scorer throws away the intonation detail it needs. Its comment promises partial credit for octave errors, but the implementation awards full credit.

   An eight-beat C4 target received **100/100** for each of: a correctly held C4; a 50 ms C5 with a +49-cent offset; and a held C4 with a +49-cent offset. These were direct scorer fixtures, not claims about a microphone recording. The result writes to mastery and unlocks later exercises in [`progress.ts`](../apps/coach/frontend/src/lib/progress.ts).

   Repair the scoring contract before building progression on it: use continuous pitch, voiced coverage, target duration and timing, explicit octave policy, and alignment that tolerates segmentation errors. A short blip must not pass “sustain a steady Sa for four beats.”

2. **Freestyle post-take analysis uses the wrong backend address in the desktop app. Source-confirmed.**

   [`today/page.tsx:10`](../apps/coach/frontend/src/app/today/page.tsx) constructs its own build-time API address, defaulting to `localhost:8008`. The desktop shell chooses a free port and injects `window.__TONIC_API__`, which [`runtimeConfig.ts`](../apps/coach/frontend/src/lib/runtimeConfig.ts) correctly handles elsewhere. The freestyle page bypasses it. Without a service on 8008, post-take analysis fails; with an unrelated/stale Tonic service there, it can use the wrong instance. The exercise page already uses the shared API resolver.

3. **Claimed separation jobs cannot recover after worker interruption. Reproduced.**

   [`JobRunner.claim_next`](../packages/core/stemcore/jobs.py) changes a pending job to downloading and only claims pending jobs. There is no lease, heartbeat, stale-job reset, or retry endpoint in the Coach worker flow. Creating a second runner after claiming a job leaves it `downloading`, with no claimable work. SQLite preserves the stuck status; persistence alone does not make execution recoverable. Studio has separate startup recovery logic, showing this behavior has already been solved differently elsewhere.

4. **The progress stream misses updates from the separate worker. Reproduced.**

   [`JobRunner.events`](../packages/core/stemcore/jobs.py) reuses its in-memory event list instead of refreshing SQLite. The API creates an empty list while the worker appends events through a different runner/process. Using two runners against one temporary database, the stream delivered no progress and ended without a terminal event, even though the database status was complete.

   [`ProcessingStatus.tsx`](../apps/coach/frontend/src/components/ProcessingStatus.tsx) polls job status every 2.5 seconds, which can still finish the user flow. This is a broken streaming path with a working fallback, not proof that every import hangs. Read new events after a persisted cursor or make polling the explicit supported mechanism.

5. **`/analyze` blocks the API event loop. Reproduced.**

   [`main.py:58`](../apps/coach/backend/app/main.py) calls synchronous pitch analysis directly inside an async endpoint. Replacing analysis with a controlled 300 ms workload delayed a 25 ms event-loop timer to **319 ms**. Actual analysis can last much longer. Requests and streaming work handled by that loop must wait.

   The song scoring endpoint already uses `run_in_threadpool`; its existing responsiveness test passes. Apply equivalent isolation to freestyle/exercise analysis and bound expensive inference concurrency.

6. **Coach's page-owned microphones lack navigation cleanup. Source-confirmed; hardware navigation not exercised.**

   Today creates a detector without an unmount effect. The exercise runner's cleanup only stops the drone, not its detector. [`LiveDetector`](../apps/coach/frontend/src/lib/pitch.ts) retains a MediaStream, MediaRecorder, AudioContext, and animation loop until explicitly stopped. Navigating away while recording can leave those resources alive. Switching Today to Song also hides the freestyle stop control without stopping its detector.

   The global song provider and Studio have more deliberate cleanup. Give recording one owner, stop or transfer it explicitly on navigation, and prevent duplicate starts while microphone permission is pending.

7. **Coach does not retain the practice history its roadmap requires. Implemented limitation, not merely an unfinished dashboard.**

   [`progress.ts`](../apps/coach/frontend/src/lib/progress.ts) stores only best score/pass state per exercise, Sa, and tradition. Coach's song score lives in React state, and the uploaded take is analyzed without being saved as an attempt. The Progress page explicitly says saved history is not connected. There is no durable Coach attempt history to power trends or review, even though a browser remembers an unlocked lesson. Studio does save original takes and timeline offsets.

   Standardize the attempt/session record before adding dashboards: original audio, song/phrase, timeline start, sample rate, analysis version, settings, and derived measurements. Local durable storage is enough for the current local product; accounts are not a prerequisite.

8. **Song scoring treats low-confidence raw reference guesses as voiced truth. Reproduced at the scorer boundary.**

   Coach deliberately preserves raw CREPE estimates, including uncertain frames; its raw-reference tests enforce that behavior. That is useful for inspection. But [`stemcore.score._points`](../packages/core/stemcore/score.py) only reads time and MIDI, ignoring confidence, while the reference cache is the raw result. A fixture with confidence 0.001 and the same fixture with confidence 0.99 produced identical scores.

   Preserve raw estimates, but derive a separate scoring reference with an explicit confidence/silence policy. Also retain the actual take start: Coach uploads just the clip and relies on subsequence DTW to choose a matching section, so repeated phrases can be aligned away from the section the user intended. A useful visual trace and a validated coaching score are different outputs.

9. **Studio retains all decoded audio buffers across session changes. Source-confirmed.**

   [`StudioEngine.load`](../apps/studio/frontend/src/lib/engine.ts) adds every track to a buffer map, including muted originals, without evicting previous projects. Five stereo 44.1 kHz, five-minute float buffers occupy about **505 MiB**, before takes, decoder copies, or other state. This is an arithmetic estimate, not a measured browser heap. Repeatedly opening sessions increases retained memory.

   Clear unused project buffers, cancel stale loads, and consider lazy loading or streaming long material. The shared AudioContext scheduling itself is a useful design to preserve.

10. **The repository cannot reproduce the current product from its committed root history. Observed state.**

    Before adding this report, `git status --porcelain --untracked-files=all` returned **368 entries, including 254 untracked entries**. Counts include non-source artifacts and do not mean 254 new features. Root HEAD is July 18, 2026. Much of the app move is staged; substantial desktop, Studio, Pitch, core, and test work is untracked. `apps/tonic-pitch` has a separate nested repository with its own uncommitted changes. There are no root GitHub Actions workflows.

    Preserve this working tree before consolidation, account explicitly for the nested repository, and establish a reviewed baseline. A fresh checkout currently omits major parts of what is running here.

## Other architecture and release gaps

- **The core exists, but applications still own shared behavior.** Coach and Piano use shared download/separation adapters; harmonica imports shared modules. Yet Studio inserts Coach's backend into `sys.path` and calls private song helpers, and neural vocal analysis still lives inside Coach. Move stable services into an explicit shared boundary rather than adding more cross-app imports. The core README both describes unified apps and says apps are not built on it yet; the latter is outdated.
- **Three competing transport implementations remain.** Coach's song practice synchronizes two HTML audio elements and periodically corrects drift; Mix has a Web Audio stem engine; Studio schedules tracks and recording on one AudioContext clock. Prefer the last mechanism for integrated take recording. Do not conflate microphone display latency with recording timeline position.
- **Studio's main component combines too many responsibilities.** Its 1,373 lines handle project loading, polling, recording, saving, keyboard transport, track changes, analysis, and inspector UI. Extract controllers around those responsibilities after behavior is covered; splitting JSX alone would not resolve state ownership. Track changes are also sent as overlapping PATCH requests without ordering, so rapid adjustments deserve a persistence race test.
- **Metadata writes are atomic but not concurrency-safe as a transaction.** `JsonArtifactStore` uses a fixed `.tmp` name and Coach performs read/merge/write metadata updates without a shared lock. API and worker writes can overlap. Use unique temporary files plus transactional metadata ownership; atomic rename only solves partial-file visibility.
- **Media range handling is handwritten twice in Coach.** The stem and karaoke routes do not correctly handle suffix ranges, malformed ranges, or out-of-bounds requests. Studio already uses `FileResponse`. Prefer a single tested implementation.
- **Desktop refresh rules are fragile.** Runtime invalidation uses app version plus archive byte length rather than a content hash. Fast repacking copies backend source but skips reinstalling `packages/core`. Current staged core files match the source in this checkout; this is a future-change hazard, not an observed stale runtime today. The shell's loopback binding, startup health wait, bundled binaries, and parent-exit guard are useful work.
- **Launch instructions disagree with current paths.** Coach README refers to a missing local `dev.sh`, port 3000, and a `riyaz` venv; root scripts use port 3001 and `.venv`. Studio needs its own launcher, and the older Pitch launcher collides on API port 8010. The expected development Python environments were absent at audit start; backend checks here used the already-staged Python runtime with current source on `PYTHONPATH`.
- **Cloud plans are not an implemented production backend.** The inspected services have no user isolation/authentication or durable cloud attempt store. Coach upload endpoints read complete files without application-level size limits. The AWS document describes S3/RDS/SQS migrations that are absent. It also calls for a static S3 build of Tonic Pitch, whose Next configuration does not enable static export. CORS is not an authentication mechanism. Treat the current implementation as a local tool until the intended hosting model is chosen.

## Product assessment

The promise is understandable: let someone hear a singer, sing a phrase, and understand where their voice differs. The current navigation exposes implementation categories before completing that loop. In the inspected Coach interface, the first lesson says to hold Sa for four beats, but the scorer does not evaluate that duration. Today says “Listening” before the microphone starts. Progress is a visible destination containing future functionality. Tonic Pitch's Studio label leads to a song picker; the actual recording Studio is a different app.

The visual quality is not uniformly poor. Coach has a restrained warm interface; Studio has a coherent transport and a direct upload entry point. The more consequential UX issue is continuity: which song is selected, which player owns playback, where the take went, and what the score means.

Studio is the best starting point for continuity because it already saves WAV audio and take offsets, retains raw estimates separately from reversible display processing, offers explicit retry when saving fails, and schedules playback/recording against one clock. That recommendation concerns its workflow and audio primitives; its monolithic component and unbounded buffer cache still need work.

## Keep, fix, and retire

| Action | Scope |
|---|---|
| Keep | Studio recording/transport primitives and original-audio preservation; stemcore ingest/separation and useful domain types; Coach library/ingestion; desktop supervision; accompaniment and exercise content worth migrating |
| Fix first | Exercise scoring, desktop API routing, microphone cleanup, event-loop blocking, worker recovery, progress delivery, and durable attempts |
| Consolidate | One application entry point, song catalog, session/take schema, analysis contract, transport owner, and backend service boundary |
| Archive after migration | Older `apps/pitch` product surfaces and duplicated Tonic Pitch/Coach flows; preserve their history and any unique features before removal |
| Keep outside the primary launch | Piano and harmonica experiments; cloud architecture expansion until the local singing loop is reliable |

The implementation order should be: preserve a baseline; repair the confirmed defects with regression checks; agree on the session/take contract; bring Studio's workflow into one product entry point; migrate unique library/accompaniment/lesson features; then remove duplicate implementations. Avoid a wholesale rewrite: the working audio primitives and tests are valuable.

Release acceptance should follow a real session: import a permitted fixture, interrupt/restart processing, reopen the prepared song, record from a nonzero position, seek safely, save, restart, replay the original take, inspect an honest comparison, and leave the page with no microphone leak. Include one clean-machine desktop check and one long-session memory check.

## Verification performed

| Check | Result |
|---|---|
| Coach production build | Pass |
| Coach standalone TypeScript check | Pass |
| Coach live detector test | 1/1 pass |
| Coach backend tests | 4/4 pass |
| Coach ESLint | Fail: 3 errors in `tests/pitch.test.mjs`, plus one image warning |
| Studio ESLint and production build | Pass |
| Studio audio/pitch/transport tests | 10/10 pass |
| Studio backend tests | 4/4 pass |
| Core lightweight tests | 6/6 pass |
| Core downloader tests | 2/2 pass |
| Tonic Pitch ESLint and production build | Pass |
| Two-runner SQLite progress reproduction | Confirmed missing progress/terminal delivery |
| Claimed-job restart reproduction | Confirmed job remains active and unclaimable |
| Controlled `/analyze` responsiveness reproduction | Confirmed event-loop blocking |
| Direct exercise scorer fixtures | Confirmed undeserved perfect scores |
| Confidence variation in song scorer | Confirmed confidence ignored |
| Browser inspection | Coach landing/practice/lesson navigation and Studio empty interface inspected |

**27 existing tests passed.** Their success does not cover the additional reproduced defects. Some tests use mocked inference or browser I/O; they are not evidence of pitch accuracy on real singers.

No new real-microphone recording, full-song Demucs/CREPE benchmark, fresh desktop package build, cloud deployment, or end-to-end Piano/Harmonica run was performed. Existing Studio acceptance notes describe earlier full audio/browser checks; those are historical evidence, not reruns from this audit. Browser inspection in this audit covered the built interfaces rather than a live processing session. Source review and executable reproductions support the findings above; musical accuracy, long-session behavior, and hardware lifecycle still need targeted validation.
