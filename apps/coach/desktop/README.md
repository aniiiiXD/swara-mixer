# Tonic.app — the desktop build

Packages the Tonic frontend and backend into a single double-clickable Mac app.
No Python, no Node, no Homebrew required on the machine that runs it.

```
Tonic.app
├─ Tonic                     Tauri shell (Rust). Supervises everything below.
├─ Resources/
│  ├─ <static Next export>   the UI, served over Tauri's asset protocol
│  └─ runtime/…tar.gz        CPython 3.11 + torch/demucs/librosa + ffmpeg
└─ (on first launch the tarball is extracted to Application Support)
```

## How it starts

`src-tauri/src/lib.rs` does four things in order:

1. **Picks a free loopback port.** Not 8008 — that is often already taken by
   `make dev`, and two Tonics fighting over a port is a confusing failure.
2. **Extracts the runtime** into
   `~/Library/Application Support/studio.tonic.desktop/runtime` when its stamp
   does not match the bundled archive. The stamp is the app version *plus the
   archive size*, not the version alone — the runtime gets repacked on any
   backend edit, so version-only keying would leave existing installs running
   stale Python. Takes about a minute, once per runtime change.
3. **Spawns two Python processes** — the FastAPI API and the separation worker —
   with `STORAGE_DIR`, `KARAOKE_CACHE`, and `TORCH_HOME` pointed at per-user
   directories, and the bundled `bin/` first on `PATH`.
4. **Waits for `GET /health`,** then reveals the app window and closes the splash.

The port reaches the frontend through a Tauri initialization script that sets
`window.__TONIC_API__` before any page script runs. A static export has no server
to template a build-time value into, which is why `lib/runtimeConfig.ts` reads
that global first and only then falls back to `NEXT_PUBLIC_API_URL`.

## Why the runtime is a tarball

Shipping the interpreter as loose bundle resources has two problems: the Tauri
bundler makes no promise about preserving executable bits, and a code-signed
bundle is not a good place for Python to write `__pycache__` or for torch to
write its model cache. One opaque tarball extracted to a writable directory
avoids both, and compresses ~1.0 GB down to a ~450 MB download.

## Commands

```sh
make desktop                # dev: hot-reloading UI + the repo's .venv, no runtime build
make desktop-runtime        # build the bundled Python runtime (~15-25 min, run once)
make desktop-runtime-fast   # refresh just the backend source in it (~90s)
make desktop-build          # package Tonic.app + Tonic.dmg
```

`make desktop` deliberately ignores the bundled runtime and uses
`apps/coach/backend/.venv` instead, so shell changes are a 3-second rebuild
rather than a 20-minute one. Set `TONIC_USE_BUNDLED_RUNTIME=1` to exercise the
packaged path from a debug build.

The backend source is copied *into* the runtime tarball, so backend edits do need
a repack — but `make desktop-runtime-fast` reuses the staged interpreter and only
refreshes that copy, which is ~90s rather than reinstalling ~1GB of wheels. A full
`make desktop-runtime` is only needed when `requirements.txt` changes. Shell and
UI changes need neither.

## Known gap

Nothing stops two copies of Tonic running at once; each would pick its own port
and start its own worker against the same SQLite queue. `claim_next` is
transactional so this should not corrupt state, but it is untested — adding
`tauri-plugin-single-instance` would remove the question entirely.

## Constraints worth knowing

- **Apple Silicon only.** A universal build needs a second interpreter and a
  second full set of torch wheels, roughly doubling an already large download.
- **Gatekeeper.** The build is signed ad-hoc, so on another Mac the first launch
  needs right-click → Open. Real one-click distribution needs an Apple Developer
  account; then set `signingIdentity` in `tauri.conf.json` and notarize. The
  hardened runtime and entitlements are already configured for it.
- **ffmpeg licensing.** The bundled static ffmpeg/ffprobe are GPL builds. Fine
  for personal use; distributing them carries GPL source-availability
  obligations.
- **Microphone.** `Info.plist` carries `NSMicrophoneUsageDescription` and the
  entitlements request audio input. Without both, live pitch tracking fails
  silently — the prompt never appears and `getUserMedia` just rejects.
