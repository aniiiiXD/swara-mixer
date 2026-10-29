"""Entry point used by the packaged Mac app to run the API and the worker.

The Tauri shell spawns this twice — ``-m app.desktop api`` and ``-m app.desktop
worker`` — instead of invoking uvicorn/app.worker directly, so that both children
carry an orphan guard.

Why the guard: Tauri kills its children on a clean quit, but a force-quit or a
crash of the shell leaves them running, and a stray API process keeps holding the
port and the SQLite job queue. A thread watching ``os.getppid()`` costs nothing
and makes that impossible: when the parent dies the process is reparented to
launchd (pid 1), which the watchdog treats as its cue to exit.
"""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time


def _exit_with_parent(poll_seconds: float = 1.0) -> None:
    """Exit this process once its parent is gone (reparented to launchd)."""
    original = os.getppid()
    while True:
        time.sleep(poll_seconds)
        current = os.getppid()
        if current != original or current == 1:
            # os._exit, not sys.exit: this runs on a non-main thread, where a
            # SystemExit would only unwind this thread and leave uvicorn serving.
            os._exit(0)


def main() -> None:
    parser = argparse.ArgumentParser(prog="app.desktop")
    parser.add_argument("mode", choices=["api", "worker"])
    parser.add_argument("--port", type=int, default=8008, help="API port (api mode only)")
    parser.add_argument(
        "--no-orphan-guard",
        action="store_true",
        help="Skip the parent-exit watchdog (useful when running by hand).",
    )
    args = parser.parse_args()

    if not args.no_orphan_guard:
        threading.Thread(target=_exit_with_parent, daemon=True).start()

    if args.mode == "api":
        import uvicorn

        # Bind to loopback only. This is a local desktop backend; it must not be
        # reachable from the network.
        uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, log_level="info")
    else:
        from app.worker import main as worker_main

        worker_main()


if __name__ == "__main__":
    sys.exit(main())
