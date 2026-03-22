.PHONY: setup dev backend frontend clean

setup:
	./scripts/setup.sh

dev:
	./scripts/dev.sh

backend:
	cd backend && source .venv/bin/activate && PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0 uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && bun dev --port 3000

clean:
	rm -rf storage/downloads/* storage/stems/* storage/exports/*
