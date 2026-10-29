# Riyaz — Pages, Database & Search

Companion to ROADMAP.md. Frontend is built first against mocked data + the
existing audio engine; auth/DB wire in as it lands.

---

## 1. Route map (Next.js App Router)

| Route | Auth | Shell | Purpose |
|---|---|---|---|
| `/` | public | — | Landing; redirects to `/today` if signed in |
| `/sign-in`, `/sign-up` | public | — | Auth (Clerk) |
| `/onboarding` | authed | none | First run: tradition → set Sa → range test → goals |
| `/today` | authed | nav | Dashboard: streak, continue, recommendations, recents |
| `/learn` | authed | nav | Curriculum ladder for the active tradition |
| `/learn/[lessonId]` | authed | nav | Lesson detail: its exercises, mastery, start |
| `/songs` | authed | nav | Song library + **YouTube search & add** |
| `/songs/[songId]` | authed | nav | Song detail: sections/phrases, scores, practice entry |
| `/progress` | authed | nav | Progress dashboard: trends, range, weaknesses, history |
| `/progress/[attemptId]` | authed | nav | Single attempt: contour, per-note breakdown, replay |
| `/profile` | authed | nav | Profile & settings (Sa, range, tradition, accompaniment) |
| `/tuner` | authed | nav | Standalone tuner / re-set your Sa |
| `/practice/exercise/[exerciseId]` | authed | focus | Real-time **exercise runner** |
| `/practice/song/[songId]` | authed | focus | Sing-along runner (full song or a phrase) |
| `/practice/freestyle` | authed | focus | Open riyaz → raw-audio analysis |

**Shells:** `nav` = top/side nav + persistent **tanpura drone + metronome** mini-bar.
`focus` = distraction-free fullscreen (graph + cues + transport), no nav.

**Shared runner:** all three `/practice/*` screens are one `<PracticeRunner>` parameterized
by a *session target* (exercise | song/phrase | freestyle). It owns: count-in, accompaniment,
live pitch + target overlay, real-time cues, record → submit attempt → score.

---

## 2. Page-by-page

### `/onboarding`
- Steps: **(1)** pick tradition · **(2)** Set your Sa (sustain a comfortable tone → tonic Hz)
  · **(3)** range test (sing lowest/highest) · **(4)** goal.
- Writes `profile` (tonic_hz, voice_lo/hi, tradition_default, goals, onboarded=true).

### `/today` (dashboard)
- Streak + daily-goal ring; **Continue** (next due exercise / in-progress lesson);
  **Recommended** (from diagnostics); recent attempts with scores; quick-start Freestyle / Tuner.

### `/learn` + `/learn/[lessonId]`
- Ladder grouped by lesson/module for the active tradition; each exercise shows mastery
  (locked / available / in-progress / passed) and best score. Lesson page lists exercises,
  prerequisites, and a Start button → `/practice/exercise/[id]`.

### `/songs` (library + search)
- **Search bar** → YouTube results (thumbnail, title, channel, duration, views) → **Add**
  (separate). Library grid of ready songs (real titles now, not "audio"); separating songs
  show a progress chip. Card → `/songs/[songId]`.

### `/songs/[songId]`
- Header (title/artist/key), Karaoke/Learning toggle, **section & phrase map** (practice a
  phrase or the whole song), best scores, history. Practice → `/practice/song/[songId]`.

### `/progress` + `/progress/[attemptId]`
- Dashboard: score trends over time, range growth, weakness trends, calendar/streak.
- Attempt page: the pYIN contour + target overlay, per-note/swara breakdown, audio replay.

### `/practice/*` (runner)
- Transport: count-in → drone/metronome → record. Live pitch ribbon + target line + cues
  (in-tune meter, flat/sharp, "hold steady"). On finish → submit to engine → score → save attempt.
- Exercise mode adds loop & slow-down; song mode adds phrase looping; freestyle is open.

### `/profile`, `/tuner`
- Profile: edit Sa, range, tradition, accompaniment (drone pitch, metronome), account.
- Tuner: live tuner + re-set Sa (updates profile).

---

## 3. Database schema (Postgres / Neon)

> `traditions` stay as **code config** (pitch system, labels, tuning, accompaniment,
> ornament tolerance); exercises/songs reference a tradition by string key.

### profiles
| col | type | notes |
|---|---|---|
| user_id | text PK | from auth (Clerk) |
| display_name | text | |
| tradition_default | text | 'hindustani' \| 'carnatic' \| 'western' |
| tonic_hz | real | chosen Sa |
| voice_lo_midi / voice_hi_midi | real | from range test |
| goals | jsonb | |
| accompaniment | jsonb | drone on/off, drone pitch, metronome bpm |
| onboarded | bool | |
| created_at | timestamptz | |

### exercises  (content; seeded per tradition)
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| tradition | text | |
| type | text | hold_tone \| interval \| scale \| alankar \| song_phrase \| custom |
| title / description | text | |
| difficulty | int | |
| order_index | int | within its lesson |
| lesson_id | uuid FK→lessons | nullable |
| prerequisites | uuid[] | exercise ids that must be passed first |
| target_sequence | jsonb | `[{degree, octave, duration_beats}]` (tonic-relative) |
| tempo_bpm | int | |
| params | jsonb | tolerance, loop, etc. |
| is_active | bool | |

### lessons
| id uuid PK · tradition · title · description · order_index · is_active |

### songs
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| job_id | text | stem-studio separation id (stems on engine disk) |
| youtube_id / source_url | text | |
| title / artist | text | from yt-dlp search metadata |
| duration_s | real | |
| tonic_hz | real | detected/assigned key |
| thumbnail | text | |
| status | text | separating \| ready \| error |
| reference_ref | text | pointer to cached `{job}.ref.json` (or blob) |
| created_by | text FK→profiles | |
| created_at | timestamptz | |

### song_sections / song_phrases
- **song_sections**: id, song_id FK, name (verse/chorus), start_s, end_s, order_index.
- **song_phrases**: id, song_id FK, section_id FK (nullable), start_s, end_s, order_index,
  ref_notes jsonb (target swaras for that phrase).

### attempts  (every take)
| col | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | text FK | |
| kind | text | exercise \| song \| freestyle |
| exercise_id / song_id / phrase_id | uuid | nullable per kind |
| session_id | uuid FK→sessions | |
| created_at | timestamptz | |
| duration_s | real | |
| audio_url | text | blob (nullable) |
| features | jsonb | intonation stats, stability, vibrato, onset, range, octave_errors |
| score | jsonb | overall, intonation, timing, stability, … |
| contour_ref | text | pointer to stored contour (optional) |

### mastery  (per user × exercise)
| user_id, exercise_id PK · best_score · attempts_count · status (locked\|available\|in_progress\|passed) · passed_at · srs_due_at · srs_interval · ease |

### sessions
| id uuid PK · user_id · started_at · ended_at · total_seconds · attempts_count · summary jsonb |

### practice_days  (streaks; or derived from sessions)
| user_id, date PK · seconds_practiced · sessions_count |

### diagnostics  (periodic rollup)
| id uuid PK · user_id · computed_at · findings jsonb `[{type, severity, evidence, recommended_exercise_ids}]` |

**Key relations:** profiles 1—* attempts/sessions/songs; lessons 1—* exercises;
exercises 1—* attempts & 1—1 mastery(per user); songs 1—* sections/phrases; sessions 1—* attempts.

---

## 4. YouTube search & add-song flow

Engine already provides `GET /api/search?q=` (yt-dlp `ytsearch10` → id, title, url, duration,
channel, thumbnail, view_count) and the job pipeline.

```
[/songs search box]
   → Riyaz GET /search?q=…           (new proxy → stem :8011/api/search)
   → results list (thumb/title/channel/duration/views)
   → "Add"  → Riyaz POST /songs {url}        (creates separation job)
   → poll GET /songs/{job}/status            (downloading → separating → complete)
   → on complete: create `songs` row (title/artist from search), trigger reference extraction
   → song appears in library, ready to practice
```

Backend additions needed (small): `GET /search` proxy on Riyaz; persist `songs` rows
(replaces the disk-listing once DB exists); store real titles from search metadata.

---

## 5. Frontend build order (FE first, mocked where needed)

1. **App shell + routing**: nav layout, focus layout, route stubs, design tokens (reuse the
   pre-dawn palette/fonts), tanpura+metronome mini-bar (UI only first).
2. **Songs**: search UI + results → add/poll → library grid → song detail. (Wire to engine now.)
3. **Practice runner**: refactor current PitchGraph/PracticeGraph into `<PracticeRunner>` with
   count-in, accompaniment, cues; freestyle + song modes working.
4. **Learn**: curriculum ladder + lesson pages against mocked exercises; exercise runner.
5. **Today / Progress / Profile / Onboarding / Tuner**: against mocked data.
6. **Then** wire auth (Clerk) + Neon: profiles, attempts, mastery, sessions replace mocks.
