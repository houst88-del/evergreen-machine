from __future__ import annotations

import json
import time
import traceback
from datetime import datetime, UTC
from pathlib import Path

from app.services.account_sync_service import sync_all_connected_accounts
from app.services.job_queue import repair_stale_running_jobs
from app.services.job_runner import enqueue_due_autopilot_jobs, process_pending_jobs


POLL_SECONDS = 20
STARTUP_BURST_X_LIMIT = 200
STARTUP_BURST_BLUESKY_LIMIT = 150
HEARTBEAT_PATH = Path(__file__).resolve().parents[2] / "worker_heartbeat.json"


def write_heartbeat(
    status: str,
    *,
    queued: int = 0,
    processed: int = 0,
    synced: int = 0,
    repaired: int = 0,
    startup_burst_done: bool = False,
    error: str | None = None,
) -> None:
    payload = {
        "status": status,
        "timestamp": datetime.now(UTC).isoformat(),
        "queued": queued,
        "processed": processed,
        "synced_accounts": synced,
        "repaired_jobs": repaired,
        "startup_burst_done": startup_burst_done,
        "error": error,
        "poll_seconds": POLL_SECONDS,
    }
    HEARTBEAT_PATH.write_text(json.dumps(payload, indent=2))


def run_startup_burst() -> dict:
    print(
        f"[evergreen][autopilot] startup burst import "
        f"(x_limit={STARTUP_BURST_X_LIMIT}, bluesky_limit={STARTUP_BURST_BLUESKY_LIMIT})"
    )
    result = sync_all_connected_accounts(
        x_limit=STARTUP_BURST_X_LIMIT,
        bluesky_limit=STARTUP_BURST_BLUESKY_LIMIT,
    )
    synced = int(result.get("synced_count", 0) or 0)
    errors = int(result.get("error_count", 0) or 0)
    skipped = int(result.get("skipped_count", 0) or 0)
    print(
        f"[evergreen][autopilot] startup burst complete "
        f"synced={synced} errors={errors} skipped={skipped}"
    )
    return result


def run_forever() -> None:
    print("[evergreen][autopilot] worker started")
    write_heartbeat("starting")

    startup_burst_done = False

    while True:
        try:
            synced = 0
            repaired = repair_stale_running_jobs()

            if repaired:
                print(f"[evergreen][autopilot] repaired {repaired} stale running job(s)")

            if not startup_burst_done:
                startup_result = run_startup_burst()
                synced += int(startup_result.get("synced_count", 0) or 0)
                startup_burst_done = True

            sync_result = sync_all_connected_accounts()
            synced += int(sync_result.get("synced_count", 0) or 0)

            created = enqueue_due_autopilot_jobs()
            processed = process_pending_jobs()

            write_heartbeat(
                "running",
                queued=created,
                processed=processed,
                synced=synced,
                repaired=repaired,
                startup_burst_done=startup_burst_done,
            )

            if synced or created or processed or repaired:
                print(
                    f"[evergreen][autopilot] synced={synced} queued={created} "
                    f"processed={processed} repaired={repaired}"
                )

        except Exception as exc:
            write_heartbeat(
                "error",
                synced=0,
                queued=0,
                processed=0,
                repaired=0,
                startup_burst_done=startup_burst_done,
                error=str(exc),
            )
            print(f"[evergreen][autopilot] error: {exc}")
            traceback.print_exc()

        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run_forever()
