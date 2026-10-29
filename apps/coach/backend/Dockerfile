# Build from the repository root:
# docker build -f apps/coach/backend/Dockerfile -t tonic-api .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY packages/core /app/packages/core
COPY apps/coach/backend /app/apps/coach/backend

WORKDIR /app/apps/coach/backend
RUN pip install --upgrade pip && pip install -r requirements.txt

EXPOSE 8008
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
