"""
jobs.py — in-memory async job runtime + progress stream.

Consolidates the copy-pasted job store + SSE progress-cursor pattern that coach
and piano each re-implemented. Framework-agnostic: a service layer can adapt
`events()` into an SSE endpoint; nothing here depends on a web framework.
"""

import asyncio
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Awaitable, Callable, Optional

from .model import Job, JobStatus


class JobRunner:
    """Framework-neutral job runtime with optional durable SQLite backing.

    Passing ``database`` persists job metadata and progress events. The API
    process can therefore recover completed jobs and replay their SSE history
    after a restart. A worker queue can use the same public methods later.
    """

    def __init__(self, database: str | Path | None = None):
        self._jobs: dict[str, Job] = {}
        self._events: dict[str, list[dict]] = {}
        self._database: sqlite3.Connection | None = None
        if database is not None:
            path = Path(database)
            path.parent.mkdir(parents=True, exist_ok=True)
            self._database = sqlite3.connect(path, check_same_thread=False)
            self._database.execute(
                """CREATE TABLE IF NOT EXISTS stemcore_jobs (
                    id TEXT PRIMARY KEY, status TEXT NOT NULL, progress REAL NOT NULL,
                    phase TEXT NOT NULL, error TEXT, meta_json TEXT NOT NULL
                )"""
            )
            self._database.execute(
                """CREATE TABLE IF NOT EXISTS stemcore_job_events (
                    job_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
                    event_json TEXT NOT NULL, PRIMARY KEY (job_id, ordinal)
                )"""
            )
            self._database.commit()

    def _save_job(self, job: Job) -> None:
        if self._database is None:
            return
        self._database.execute(
            """INSERT INTO stemcore_jobs (id, status, progress, phase, error, meta_json)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET status=excluded.status, progress=excluded.progress,
               phase=excluded.phase, error=excluded.error, meta_json=excluded.meta_json""",
            (job.id, job.status.value, job.progress, job.phase, job.error, json.dumps(job.meta)),
        )
        self._database.commit()

    def _load_job(self, job_id: str) -> Optional[Job]:
        if self._database is None:
            return None
        row = self._database.execute(
            "SELECT id, status, progress, phase, error, meta_json FROM stemcore_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            return None
        job = Job(
            id=row[0], status=JobStatus(row[1]), progress=float(row[2]), phase=row[3],
            error=row[4], meta=json.loads(row[5]),
        )
        self._jobs[job_id] = job
        return job

    def _load_events(self, job_id: str) -> list[dict]:
        if self._database is None:
            return []
        rows = self._database.execute(
            "SELECT event_json FROM stemcore_job_events WHERE job_id = ? ORDER BY ordinal", (job_id,)
        ).fetchall()
        events = [json.loads(row[0]) for row in rows]
        self._events[job_id] = events
        return events

    def create(self, meta: Optional[dict] = None) -> Job:
        jid = uuid.uuid4().hex[:8]
        self._jobs[jid] = Job(id=jid, meta=meta or {})
        self._events[jid] = []
        self._save_job(self._jobs[jid])
        return self._jobs[jid]

    def get(self, job_id: str) -> Optional[Job]:
        # SQLite is the source of truth when several API/worker processes are
        # alive. Refreshing here prevents a process from retaining a stale
        # pending status after another worker has claimed the job.
        if self._database is not None:
            return self._load_job(job_id)
        return self._jobs.get(job_id)

    def update_meta(self, job_id: str, **changes) -> Job:
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        job.meta.update({key: value for key, value in changes.items() if value is not None})
        self._save_job(job)
        return job

    def claim_next(self) -> Optional[Job]:
        """Atomically claim one pending job for a worker.

        A claimed job enters its first active status immediately, preventing a
        second worker from executing the same expensive download/separation
        pipeline. The worker emits the more detailed phase event when it starts.
        """
        if self._database is None:
            for job in self._jobs.values():
                if job.status is JobStatus.pending:
                    job.status = JobStatus.downloading
                    job.phase = "claimed"
                    self._save_job(job)
                    return job
            return None

        # BEGIN IMMEDIATE serializes claimers on SQLite. This can be replaced by
        # SELECT … FOR UPDATE SKIP LOCKED in a Postgres-backed repository later.
        self._database.execute("BEGIN IMMEDIATE")
        try:
            row = self._database.execute(
                "SELECT id FROM stemcore_jobs WHERE status = ? ORDER BY rowid LIMIT 1", (JobStatus.pending.value,)
            ).fetchone()
            if row is None:
                self._database.commit()
                return None
            self._database.execute(
                "UPDATE stemcore_jobs SET status = ?, phase = ? WHERE id = ? AND status = ?",
                (JobStatus.downloading.value, "claimed", row[0], JobStatus.pending.value),
            )
            self._database.commit()
        except Exception:
            self._database.rollback()
            raise
        self._jobs.pop(row[0], None)
        return self.get(row[0])

    def emit(self, job_id: str, phase: str, progress: float,
             status: Optional[JobStatus] = None):
        """Record a public progress event for an existing job.

        HTTP adapters use this for multi-step pipelines, while ``run`` remains
        useful for simple one-call pipelines. Keeping event ownership here
        prevents every application from reimplementing an SSE cursor store.
        """
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        job.phase = phase
        job.progress = float(progress)
        if status is not None:
            job.status = status
        event = {"phase": phase, "progress": job.progress, "status": job.status.value}
        events = self._events.setdefault(job_id, self._load_events(job_id))
        events.append(event)
        self._save_job(job)
        if self._database is not None:
            self._database.execute(
                "INSERT INTO stemcore_job_events (job_id, ordinal, event_json) VALUES (?, ?, ?)",
                (job_id, len(events) - 1, json.dumps(event)),
            )
            self._database.commit()

    def progress_cb(self, job_id: str, phase: str,
                    status: Optional[JobStatus] = None) -> Callable[[float], None]:
        """Hand this to a long-running step (download/separate/...) as its
        on_progress callback."""
        def cb(p: float):
            self.emit(job_id, phase, p, status)
        return cb

    async def run(self, job_id: str, pipeline: Callable[[str], Awaitable[None]]):
        """Run an async pipeline(job_id) to completion, recording final state."""
        job = self.get(job_id)
        if job is None:
            raise KeyError(job_id)
        try:
            await pipeline(job_id)
            self.emit(job_id, "complete", 1.0, JobStatus.complete)
        except Exception as e:  # noqa: BLE001 — surface any failure as job error
            job.error = str(e)
            self.emit(job_id, "error", job.progress, JobStatus.error)

    async def events(self, job_id: str, poll: float = 0.3):
        """Async generator of progress dicts until the job finishes (SSE-ready)."""
        cursor = 0
        while True:
            evs = self._events.get(job_id)
            if evs is None:
                evs = self._load_events(job_id)
            while cursor < len(evs):
                yield evs[cursor]
                cursor += 1
            job = self.get(job_id)
            if job and job.status in (JobStatus.complete, JobStatus.error):
                break
            await asyncio.sleep(poll)
