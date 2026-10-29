# Tonic on AWS

## Runtime split

Tonic has two very different workloads and they should not share a web server.

```text
Browser
  ├─ CloudFront + S3: static Tonic Pitch frontend
  └─ ALB → ECS Fargate: FastAPI API
                    ├─ RDS Postgres: songs, jobs, users and scores
                    ├─ S3 private bucket: uploads, source media, stems, mixes, reference JSON
                    └─ SQS: separation work
                               └─ ECS on EC2 GPU: yt-dlp, Demucs, CREPE/pYIN
```

The browser performs only live microphone tracking. It never uploads a take until the user asks to score it. The API issues short-lived S3 presigned URLs for media, so audio does not pass through the API or frontend servers.

## Release order

1. Create private S3 buckets and lifecycle rules. Delete source media after a defined retention period; retain only outputs users explicitly save.
2. Move job and song metadata from local SQLite to RDS Postgres, and replace local paths with S3 object keys.
3. Put a message on SQS when a source is accepted. A worker claims it, runs download/separation/reference extraction, then records status and output keys in Postgres.
4. Deploy FastAPI to ECS Fargate behind an HTTPS ALB. Set `ALLOWED_ORIGINS` to the CloudFront domain and the custom domain.
5. Deploy `apps/tonic-pitch` as a static Next build to S3/CloudFront, with `NEXT_PUBLIC_API_URL` set to the API domain at build time.
6. Deploy the Demucs image to ECR and run it on an ECS EC2 GPU capacity provider. Fargate does not provide GPU scheduling for this worker.

## Immediate launch path

Before the migration, the existing application can run on one EC2 GPU instance with a persistent EBS volume. Build `apps/coach/backend/Dockerfile` for the API and `Dockerfile.gpu` for the worker, then run both against the same mounted `STORAGE_DIR`. This is a deliberately single-instance deployment, suitable for a private beta only. It must not be horizontally scaled because the current job runtime is SQLite plus local files.

## Required production controls

- Use Secrets Manager for database credentials and any third-party keys.
- Use CloudWatch logs, dead-letter queues and a retry limit for every separation job.
- Keep the worker in private subnets, restrict its egress, and give each task the smallest IAM role possible.
- Restrict direct source ingestion to media users own or are permitted to analyse. Downloading YouTube content may violate platform terms or copyright.
- Rate-limit ingestion and cap duration/file size before a job reaches Demucs.

## What is already compatible

- Tonic Pitch exposes a static `/sing` route and takes its API URL from `NEXT_PUBLIC_API_URL`.
- The FastAPI API now takes production CORS origins from `ALLOWED_ORIGINS`.
- Existing API contract remains: `POST /songs`, `GET /songs/:id/status`, `GET /songs/:id/reference`, karaoke/stem audio, and `POST /songs/:id/score`.

## Migration still required

The current worker uses local disk and SQLite. It is correct for a single machine but must be replaced with S3, Postgres and SQS before multi-instance AWS deployment. Do not attach a network volume as a shortcut: it makes long-running media processing fragile and expensive.
