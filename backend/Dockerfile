FROM python:3.11-slim

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN pip install --no-cache-dir yt-dlp

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY app/ app/

# Create storage dirs
RUN mkdir -p /data/downloads /data/stems /data/exports

ENV STORAGE_DIR=/data
ENV CORS_ORIGINS=http://localhost:3000
ENV PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
