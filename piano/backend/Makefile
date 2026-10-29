SF := assets/MuseScore_General.sf3
SF_URL := https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3

.PHONY: setup soundfont run cli

setup: .venv soundfont
	.venv/bin/pip install -r requirements.txt

.venv:
	python3.11 -m venv .venv
	.venv/bin/pip install -U pip

# Grand-piano soundfont for fluidsynth rendering (~38MB, gitignored).
soundfont: $(SF)
$(SF):
	@mkdir -p assets
	curl -L --fail -o $(SF) "$(SF_URL)"

run:
	.venv/bin/uvicorn app.main:app --reload --port 8009

# make cli URL="https://www.youtube.com/watch?v=..."
cli:
	.venv/bin/python transcribe_cli.py "$(URL)"
