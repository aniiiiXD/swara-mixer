#!/usr/bin/env bash
# Build the self-contained Python runtime that ships inside Tonic.app.
#
# Produces apps/coach/desktop/src-tauri/runtime/tonic-runtime.tar.gz containing:
#
#   python/   relocatable CPython 3.11 with every dependency pip-installed
#   backend/  the FastAPI app source
#   bin/      static ffmpeg + ffprobe, and a yt-dlp shim
#   models/   pre-downloaded Demucs weights, so the first separation is offline
#
# The shell extracts this into ~/Library/Application Support on first launch.
# Shipping a tarball rather than loose files keeps the code signature simple and
# preserves executable bits, which the Tauri bundler does not guarantee.
#
# Apple Silicon only. A universal build would need a second interpreter and a
# second full set of torch wheels, roughly doubling an already large download.
set -euo pipefail

PBS_TAG="20260807"          # astral-sh/python-build-standalone release
PY_MM="3.11"
PY_FULL="3.11.15"
FFMPEG_TAG="b6.1.1"         # eugeneware/ffmpeg-static release
DENO_TAG="v2.7.7"          # yt-dlp's supported JavaScript runtime (>=2.3)
ARCH="aarch64-apple-darwin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/apps/coach/desktop/src-tauri/runtime"
OUT="$OUT_DIR/tonic-runtime.tar.gz"
WORK="$ROOT/.build/desktop-runtime"
STAGE="$WORK/stage"
CACHE="$WORK/downloads"

if [ "$(uname -m)" != "arm64" ]; then
  echo "ERROR: this builds an arm64-only runtime; run it on Apple Silicon." >&2
  exit 1
fi

say() { printf '\n\033[1;33m→ %s\033[0m\n' "$1"; }

# --fast reuses an existing staging tree and only refreshes the backend source
# before repacking. Backend-only edits then cost ~90s instead of reinstalling
# ~1GB of wheels. Use a full run when requirements.txt changes.
FAST=0
if [ "${1:-}" = "--fast" ]; then
  if [ ! -x "$STAGE/python/bin/python$PY_MM" ]; then
    echo "ERROR: --fast needs a previous full build; none found at $STAGE" >&2
    exit 1
  fi
  FAST=1
fi

mkdir -p "$OUT_DIR" "$CACHE"
if [ "$FAST" = "0" ]; then
  rm -rf "$STAGE"
  mkdir -p "$STAGE/bin" "$STAGE/models"
fi

# ── 1. relocatable interpreter ──────────────────────────────────────────────
PY="$STAGE/python/bin/python$PY_MM"
if [ "$FAST" = "1" ]; then
  say "Fast repack: reusing the interpreter and dependencies already staged"
else
PY_ARCHIVE="cpython-${PY_FULL}+${PBS_TAG}-${ARCH}-install_only_stripped.tar.gz"
if [ ! -f "$CACHE/$PY_ARCHIVE" ]; then
  say "Downloading CPython $PY_FULL ($PBS_TAG)"
  curl -fL --retry 3 -o "$CACHE/$PY_ARCHIVE" \
    "https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PY_ARCHIVE}"
fi
say "Unpacking interpreter"
# The archive already contains a top-level python/ directory.
tar -xzf "$CACHE/$PY_ARCHIVE" -C "$STAGE"
"$PY" -V

# ── 2. dependencies ─────────────────────────────────────────────────────────
# requirements.txt ends with an editable install of packages/core pointing at a
# relative path. Editable installs bake in an absolute path to the source tree,
# which will not exist on a user's Mac, so strip that line and install the
# package normally below.
say "Installing Python dependencies (this is the slow part)"
grep -v -- '^-e ' "$ROOT/apps/coach/backend/requirements.txt" > "$WORK/requirements.txt"
"$PY" -m pip install --upgrade pip setuptools wheel
"$PY" -m pip install --no-cache-dir -r "$WORK/requirements.txt"
"$PY" -m pip install --no-cache-dir "$ROOT/packages/core"

# ── 3. static media binaries ────────────────────────────────────────────────
for tool in ffmpeg ffprobe; do
  if [ ! -f "$CACHE/$tool" ]; then
    say "Downloading static $tool"
    curl -fL --retry 3 -o "$CACHE/$tool.gz" \
      "https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}/${tool}-darwin-arm64.gz"
    gunzip -c "$CACHE/$tool.gz" > "$CACHE/$tool"
  fi
  cp "$CACHE/$tool" "$STAGE/bin/$tool"
  chmod +x "$STAGE/bin/$tool"
done

# yt-dlp is pip-installed, but its console script has the build machine's
# interpreter path baked into the shebang. The backend resolves yt-dlp with
# shutil.which, so give it a path-independent shim instead.
cat > "$STAGE/bin/yt-dlp" <<'SHIM'
#!/bin/sh
exec "$(dirname "$0")/../python/bin/python3.11" -m yt_dlp "$@"
SHIM
chmod +x "$STAGE/bin/yt-dlp"

fi  # end of full-build-only section

# YouTube extraction needs both yt-dlp-ejs (the [default] extra) and a JS
# runtime. Bundle Deno so a Finder launch also works without Homebrew or Node.
if [ ! -f "$CACHE/deno-${DENO_TAG}.zip" ]; then
  say "Downloading Deno $DENO_TAG for YouTube extraction"
  curl -fL --retry 3 -o "$CACHE/deno-${DENO_TAG}.zip" \
    "https://github.com/denoland/deno/releases/download/${DENO_TAG}/deno-aarch64-apple-darwin.zip"
fi
unzip -p "$CACHE/deno-${DENO_TAG}.zip" deno > "$STAGE/bin/deno"
chmod +x "$STAGE/bin/deno"

# ── 4. backend source ───────────────────────────────────────────────────────
say "Copying backend source"
mkdir -p "$STAGE/backend/app"
# --delete so a --fast repack drops files removed from the source tree, rather
# than shipping stale modules alongside the current ones.
/usr/bin/rsync -a --delete \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  "$ROOT/apps/coach/backend/app/" "$STAGE/backend/app/"

# ── 5. pre-seed Demucs weights ──────────────────────────────────────────────
# Without this the first separation stalls on an 80MB download, and fails outright
# with no network. get_model fetches the checkpoint into TORCH_HOME/hub.
say "Pre-downloading Demucs weights"
TORCH_HOME="$STAGE/models" "$PY" -c "
from demucs.pretrained import get_model
get_model('htdemucs')
print('htdemucs cached')
"

# ── 6. trim ─────────────────────────────────────────────────────────────────
# torch ships C++ headers and its own test suite; neither is reachable at
# runtime for us (we never build extensions or run torch's tests).
say "Trimming the runtime"
SITE="$STAGE/python/lib/python$PY_MM/site-packages"
before=$(du -sm "$STAGE" | cut -f1)
rm -rf "$SITE/torch/include" "$SITE/torch/test" "$SITE/torch/utils/benchmark"
find "$STAGE" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" -name '*.pyc' -delete 2>/dev/null || true
find "$SITE" -type d -name 'tests' -prune -exec rm -rf {} + 2>/dev/null || true
find "$SITE" -name '*.a' -delete 2>/dev/null || true
after=$(du -sm "$STAGE" | cut -f1)
echo "   ${before}MB -> ${after}MB"

# ── 7. smoke test ───────────────────────────────────────────────────────────
# Verify the trimmed runtime can still import the whole stack and that the media
# binaries run. Cheaper to fail here than inside a packaged app.
say "Smoke-testing the runtime"
PATH="$STAGE/bin:$PATH" TORCH_HOME="$STAGE/models" \
  PYTHONPATH="$STAGE/backend" "$PY" -c "
import torch, librosa, demucs, soundfile, fastapi, uvicorn, yt_dlp
from demucs.pretrained import get_model
get_model('htdemucs')                      # must resolve from the bundled cache
import app.main                            # the FastAPI app itself
print('imports ok; torch', torch.__version__, '; mps', torch.backends.mps.is_available())
"
"$STAGE/bin/ffmpeg" -version | head -1
"$STAGE/bin/ffprobe" -version | head -1
"$STAGE/bin/yt-dlp" --version
"$STAGE/bin/deno" --version

# ── 8. pack ─────────────────────────────────────────────────────────────────
say "Packing $OUT"
rm -f "$OUT"
tar -czf "$OUT" -C "$STAGE" .

echo
echo "=== runtime built ==="
echo "  staged:  $(du -sh "$STAGE" | cut -f1)  ($STAGE)"
echo "  tarball: $(du -sh "$OUT" | cut -f1)  ($OUT)"
echo "  Now run: make desktop-build"
