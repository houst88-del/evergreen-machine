from __future__ import annotations

import json
import socket
from datetime import datetime, timedelta, UTC
from pathlib import Path
from typing import Any


RUNNING_TIMEOUT_MINUTES = 20


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _iso_now() -> str:
    return _utc_now_naive().isoformat(timespec="seconds")


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def platform_dir() -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "platform"


def queue_dir() -> Path:
    path = platform_dir() / "queue"
    path.mkdir(parents=True, exist_ok=True)
    return path


def queue_file() -> Path:
    return queue_dir() / "jobs.json"


def ensure_queue_file() -> None:
    path = queue_file()
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def _normalize_job(job: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(job or {})
    normalized.setdefault("id", "")
    normalized.setdefault("connected_account_id", None)
    normalized.setdefault("job_type", "")
    normalized.setdefault("payload", {})
    normalized.setdefault("status", "queued")
    normalized.setdefault("created_at", "")
    normalized.setdefault("started_at", None)
    normalized.setdefault("finished_at", None)
    normalized.setdefault("result", None)
    normalized.setdefault("error", None)
    normalized.setdefault("worker_id", None)
    normalized.setdefault("attempt_count", 0)
    normalized.setdefault("last_heartbeat_at", None)
    return normalized


def load_jobs() -> list[dict[str, Any]]:
    ensure_queue_file()
    path = queue_file()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return []
        return [_normalize_job(job) for job in raw if isinstance(job, dict)]
    except Exception:
        return []


def save_jobs(jobs: list[dict[str, Any]]) -> None:
    ensure_queue_file()
    normalized = [_normalize_job(job) for job in jobs]
    queue_file().write_text(json.dumps(normalized, indent=2), encoding="utf-8")


def _make_job_id(job_type: str, connected_account_id: int) -> str:
    return f"{job_type}-{connected_account_id}-{int(_utc_now_naive().timestamp() * 1000)}"


def _worker_identity() -> str:
    return f"{socket.gethostname()}:{Path.cwd().name}"


def enqueue_job(
    job_type: str,
    *,
    connected_account_id: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    jobs = load_jobs()
    job = {
        "id": _make_job_id(job_type, connected_account_id),
        "connected_account_id": int(connected_account_id),
        "job_type": str(job_type).strip(),
        "payload": dict(payload or {}),
        "status": "queued",
        "created_at": _iso_now(),
        "started_at": None,
        "finished_at": None,
        "result": None,
        "error": None,
        "worker_id": None,
        "attempt_count": 0,
        "last_heartbeat_at": None,
    }
    jobs.append(job)
    save_jobs(jobs)
    return job


def start_job(job_id: str, worker_id: str | None = None) -> bool:
    jobs = load_jobs()
    claimed = False
    now = _iso_now()
    effective_worker_id = worker_id or _worker_identity()

    for job in jobs:
        if str(job.get("id", "")).strip() != str(job_id).strip():
            continue
        status = str(job.get("status", "")).strip().lower()
        if status != "queued":
            break
        job["status"] = "running"
        job["started_at"] = now
        job["finished_at"] = None
        job["error"] = None
        job["worker_id"] = effective_worker_id
        job["attempt_count"] = _safe_int(job.get("attempt_count", 0), 0) + 1
        job["last_heartbeat_at"] = now
        claimed = True
        break

    if claimed:
        save_jobs(jobs)
    return claimed


def heartbeat_job(job_id: str) -> bool:
    jobs = load_jobs()
    touched = False
    now = _iso_now()

    for job in jobs:
        if str(job.get("id", "")).strip() != str(job_id).strip():
            continue
        if str(job.get("status", "")).strip().lower() != "running":
            break
        job["last_heartbeat_at"] = now
        touched = True
        break

    if touched:
        save_jobs(jobs)
    return touched


def complete_job(job_id: str, result: Any) -> bool:
    jobs = load_jobs()
    changed = False
    now = _iso_now()

    for job in jobs:
        if str(job.get("id", "")).strip() != str(job_id).strip():
            continue
        job["status"] = "completed"
        job["finished_at"] = now
        job["result"] = result
        job["error"] = None
        job["last_heartbeat_at"] = now
        changed = True
        break

    if changed:
        save_jobs(jobs)
    return changed


def fail_job(job_id: str, error: str) -> bool:
    jobs = load_jobs()
    changed = False
    now = _iso_now()

    for job in jobs:
        if str(job.get("id", "")).strip() != str(job_id).strip():
            continue
        job["status"] = "failed"
        job["finished_at"] = now
        job["error"] = str(error)
        job["last_heartbeat_at"] = now
        changed = True
        break

    if changed:
        save_jobs(jobs)
    return changed


def claim_next_jobs(limit: int = 25, worker_id: str | None = None) -> list[dict[str, Any]]:
    jobs = load_jobs()
    claimed: list[dict[str, Any]] = []
    effective_worker_id = worker_id or _worker_identity()
    now = _iso_now()

    for job in jobs:
        if len(claimed) >= max(1, int(limit)):
            break
        if str(job.get("status", "")).strip().lower() != "queued":
            continue
        job["status"] = "running"
        job["started_at"] = now
        job["finished_at"] = None
        job["error"] = None
        job["worker_id"] = effective_worker_id
        job["attempt_count"] = _safe_int(job.get("attempt_count", 0), 0) + 1
        job["last_heartbeat_at"] = now
        claimed.append(dict(job))

    if claimed:
        save_jobs(jobs)

    return claimed


def repair_stale_running_jobs(timeout_minutes: int = RUNNING_TIMEOUT_MINUTES) -> int:
    jobs = load_jobs()
    repaired = 0
    now = _utc_now_naive()
    timeout_delta = timedelta(minutes=max(1, int(timeout_minutes)))

    for job in jobs:
        if str(job.get("status", "")).strip().lower() != "running":
            continue

        marker = str(job.get("last_heartbeat_at") or job.get("started_at") or "").strip()
        if not marker:
            job["status"] = "queued"
            job["started_at"] = None
            job["worker_id"] = None
            job["last_heartbeat_at"] = None
            repaired += 1
            continue

        try:
            started_dt = datetime.fromisoformat(marker)
        except Exception:
            job["status"] = "queued"
            job["started_at"] = None
            job["worker_id"] = None
            job["last_heartbeat_at"] = None
            repaired += 1
            continue

        if now - started_dt >= timeout_delta:
            job["status"] = "queued"
            job["started_at"] = None
            job["worker_id"] = None
            job["last_heartbeat_at"] = None
            repaired += 1

    if repaired:
        save_jobs(jobs)

    return repaired


def get_job(job_id: str) -> dict[str, Any] | None:
    for job in load_jobs():
        if str(job.get("id", "")).strip() == str(job_id).strip():
            return job
    return None


def list_jobs(limit: int = 100) -> list[dict[str, Any]]:
    jobs = load_jobs()
    return list(reversed(jobs))[:limit]
