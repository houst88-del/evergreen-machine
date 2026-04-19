from __future__ import annotations

import socket
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.db import SessionLocal
from app.models.models import JobQueueItem


RUNNING_TIMEOUT_MINUTES = 20


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _iso_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat(timespec="seconds")


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip() or default))
    except Exception:
        return default


def _make_job_id(job_type: str, connected_account_id: int) -> str:
    return f"{job_type}-{connected_account_id}-{int(_utc_now_naive().timestamp() * 1000)}"


def _worker_identity() -> str:
    return f"{socket.gethostname()}:{Path.cwd().name}"


def _serialize_job(job: JobQueueItem) -> dict[str, Any]:
    return {
        "id": job.id,
        "connected_account_id": job.connected_account_id,
        "job_type": job.job_type,
        "payload": dict(job.payload_json or {}),
        "status": job.status,
        "created_at": _iso_or_none(job.created_at) or "",
        "started_at": _iso_or_none(job.started_at),
        "finished_at": _iso_or_none(job.finished_at),
        "result": job.result_json,
        "error": job.error,
        "worker_id": job.worker_id,
        "attempt_count": int(job.attempt_count or 0),
        "last_heartbeat_at": _iso_or_none(job.last_heartbeat_at),
    }


def load_jobs() -> list[dict[str, Any]]:
    db = SessionLocal()
    try:
        rows = (
            db.query(JobQueueItem)
            .order_by(JobQueueItem.created_at.asc(), JobQueueItem.id.asc())
            .all()
        )
        return [_serialize_job(row) for row in rows]
    finally:
        db.close()


def enqueue_job(
    job_type: str,
    *,
    connected_account_id: int,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    db = SessionLocal()
    try:
        existing = (
            db.query(JobQueueItem)
            .filter(
                JobQueueItem.connected_account_id == int(connected_account_id),
                JobQueueItem.job_type == str(job_type).strip(),
                JobQueueItem.status.in_(("queued", "running")),
            )
            .order_by(JobQueueItem.created_at.asc(), JobQueueItem.id.asc())
            .first()
        )
        if existing:
            serialized = _serialize_job(existing)
            serialized["deduped"] = True
            return serialized

        job = JobQueueItem(
            id=_make_job_id(job_type, connected_account_id),
            connected_account_id=int(connected_account_id),
            job_type=str(job_type).strip(),
            payload_json=dict(payload or {}),
            status="queued",
            created_at=_utc_now_naive(),
            started_at=None,
            finished_at=None,
            result_json=None,
            error=None,
            worker_id=None,
            attempt_count=0,
            last_heartbeat_at=None,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return _serialize_job(job)
    finally:
        db.close()


def start_job(job_id: str, worker_id: str | None = None) -> bool:
    db = SessionLocal()
    try:
        job = db.query(JobQueueItem).filter(JobQueueItem.id == str(job_id).strip()).first()
        if not job:
            return False
        if str(job.status or "").strip().lower() != "queued":
            return False

        now = _utc_now_naive()
        job.status = "running"
        job.started_at = now
        job.finished_at = None
        job.error = None
        job.worker_id = worker_id or _worker_identity()
        job.attempt_count = int(job.attempt_count or 0) + 1
        job.last_heartbeat_at = now

        db.commit()
        return True
    finally:
        db.close()


def heartbeat_job(job_id: str) -> bool:
    db = SessionLocal()
    try:
        job = db.query(JobQueueItem).filter(JobQueueItem.id == str(job_id).strip()).first()
        if not job:
            return False
        if str(job.status or "").strip().lower() != "running":
            return False

        job.last_heartbeat_at = _utc_now_naive()
        db.commit()
        return True
    finally:
        db.close()


def complete_job(job_id: str, result: Any) -> bool:
    db = SessionLocal()
    try:
        job = db.query(JobQueueItem).filter(JobQueueItem.id == str(job_id).strip()).first()
        if not job:
            return False

        now = _utc_now_naive()
        job.status = "completed"
        job.finished_at = now
        job.result_json = result
        job.error = None
        job.last_heartbeat_at = now

        db.commit()
        return True
    finally:
        db.close()


def fail_job(job_id: str, error: str) -> bool:
    db = SessionLocal()
    try:
        job = db.query(JobQueueItem).filter(JobQueueItem.id == str(job_id).strip()).first()
        if not job:
            return False

        now = _utc_now_naive()
        job.status = "failed"
        job.finished_at = now
        job.error = str(error)
        job.last_heartbeat_at = now

        db.commit()
        return True
    finally:
        db.close()


def claim_next_jobs(limit: int = 25, worker_id: str | None = None) -> list[dict[str, Any]]:
    db = SessionLocal()
    try:
        effective_limit = max(1, int(limit))
        effective_worker_id = worker_id or _worker_identity()
        now = _utc_now_naive()

        rows = (
            db.query(JobQueueItem)
            .filter(JobQueueItem.status == "queued")
            .order_by(JobQueueItem.created_at.asc(), JobQueueItem.id.asc())
            .limit(effective_limit)
            .all()
        )

        claimed: list[JobQueueItem] = []
        for job in rows:
            if str(job.status or "").strip().lower() != "queued":
                continue
            job.status = "running"
            job.started_at = now
            job.finished_at = None
            job.error = None
            job.worker_id = effective_worker_id
            job.attempt_count = int(job.attempt_count or 0) + 1
            job.last_heartbeat_at = now
            claimed.append(job)

        if claimed:
            db.commit()
            for job in claimed:
                db.refresh(job)

        return [_serialize_job(job) for job in claimed]
    finally:
        db.close()


def repair_stale_running_jobs(timeout_minutes: int = RUNNING_TIMEOUT_MINUTES) -> int:
    db = SessionLocal()
    try:
        repaired = 0
        now = _utc_now_naive()
        timeout_delta = timedelta(minutes=max(1, int(timeout_minutes)))

        rows = (
            db.query(JobQueueItem)
            .filter(JobQueueItem.status == "running")
            .all()
        )

        for job in rows:
            marker = job.last_heartbeat_at or job.started_at
            if marker is None:
                job.status = "queued"
                job.started_at = None
                job.worker_id = None
                job.last_heartbeat_at = None
                repaired += 1
                continue

            if now - marker >= timeout_delta:
                job.status = "queued"
                job.started_at = None
                job.worker_id = None
                job.last_heartbeat_at = None
                repaired += 1

        if repaired:
            db.commit()

        return repaired
    finally:
        db.close()


def get_job(job_id: str) -> dict[str, Any] | None:
    db = SessionLocal()
    try:
        job = db.query(JobQueueItem).filter(JobQueueItem.id == str(job_id).strip()).first()
        if not job:
            return None
        return _serialize_job(job)
    finally:
        db.close()


def find_active_job(job_type: str, *, connected_account_id: int) -> dict[str, Any] | None:
    db = SessionLocal()
    try:
        row = (
            db.query(JobQueueItem)
            .filter(
                JobQueueItem.connected_account_id == int(connected_account_id),
                JobQueueItem.job_type == str(job_type).strip(),
                JobQueueItem.status.in_(("queued", "running")),
            )
            .order_by(JobQueueItem.created_at.asc(), JobQueueItem.id.asc())
            .first()
        )
        if not row:
            return None
        return _serialize_job(row)
    finally:
        db.close()


def list_jobs(limit: int = 100) -> list[dict[str, Any]]:
    db = SessionLocal()
    try:
        rows = (
            db.query(JobQueueItem)
            .order_by(JobQueueItem.created_at.desc(), JobQueueItem.id.desc())
            .limit(max(1, int(limit)))
            .all()
        )
        return [_serialize_job(row) for row in rows]
    finally:
        db.close()
