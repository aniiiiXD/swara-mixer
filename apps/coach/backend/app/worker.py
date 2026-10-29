"""Durable worker for Coach/Mix processing jobs.

Run with ``python -m app.worker``. The API only enqueues jobs; this process
claims them from stemcore's SQLite runtime and performs download + separation.
"""

from __future__ import annotations

import asyncio
import logging

from app.models import Job, JobStatus
from app.routers.jobs import process_job, runtime

log = logging.getLogger("tonic-worker")


def _http_job(core_job) -> Job:
    return Job(
        id=core_job.id,
        url=core_job.meta["url"],
        status=JobStatus(core_job.status.value),
        title=core_job.meta.get("title"),
        duration=core_job.meta.get("duration"),
        progress=core_job.progress,
        error=core_job.meta.get("error") or core_job.error,
    )


async def run(poll_seconds: float = 0.5) -> None:
    log.info("Tonic worker started")
    while True:
        core_job = runtime.claim_next()
        if core_job is None:
            await asyncio.sleep(poll_seconds)
            continue
        try:
            await process_job(_http_job(core_job))
        except Exception:  # process_job records its own terminal error
            log.exception("unexpected worker failure for %s", core_job.id)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S")
    asyncio.run(run())


if __name__ == "__main__":
    main()
