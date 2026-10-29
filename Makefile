.PHONY: setup dev clean api worker web desktop desktop-runtime desktop-build

setup:
	./scripts/setup.sh

dev:
	./scripts/dev.sh

# Individual processes (run `make dev` to launch both together)
api:
	cd apps/coach/backend && PYTHONPATH=../../../packages/core PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 .venv/bin/python -m uvicorn app.main:app --reload --port 8008

worker:
	cd apps/coach/backend && PYTHONPATH=../../../packages/core PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 .venv/bin/python -m app.worker

web:
	cd apps/coach/frontend && NEXT_PUBLIC_API_URL=http://localhost:8008 npm run dev -- --port 3001

# ── Desktop app (Tonic.app) ─────────────────────────────────────────────────
# Iterate on the Mac app. Uses the repo's own .venv, so no runtime build needed.
desktop:
	cd apps/coach/desktop && npx tauri dev

# Build the bundled Python runtime (~15-25 min, ~500MB tarball). Only needs
# rerunning when requirements.txt or the backend source changes.
desktop-runtime:
	./scripts/build-desktop-runtime.sh

# Refresh only the backend source in an already-built runtime (~90s). Use this
# after editing backend code; use desktop-runtime when requirements.txt changes.
desktop-runtime-fast:
	./scripts/build-desktop-runtime.sh --fast

# Package Tonic.app + the DMG. Requires desktop-runtime to have run once.
desktop-build:
	cd apps/coach/desktop && npx tauri build

clean:
	rm -rf storage/downloads/* storage/stems/* storage/exports/*
