from __future__ import annotations

import json
from datetime import datetime, UTC
from typing import Any

from sqlalchemy import text

from app.core.db import SessionLocal, engine


WORKER_HEARTBEAT_KEY = "worker_heartbeat"


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _ensure_runtime_state_table(db) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS runtime_state (
                state_key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TIMESTAMP NULL
            )
            """
        )
    )


def write_worker_heartbeat(payload: dict[str, Any]) -> None:
    db = SessionLocal()
    try:
        _ensure_runtime_state_table(db)
        now = _utc_now_naive()
        encoded = json.dumps(payload)

        if engine.dialect.name == "sqlite":
            db.execute(
                text(
                    """
                    INSERT INTO runtime_state (state_key, value_json, updated_at)
                    VALUES (:state_key, :value_json, :updated_at)
                    ON CONFLICT(state_key) DO UPDATE SET
                        value_json = excluded.value_json,
                        updated_at = excluded.updated_at
                    """
                ),
                {
                    "state_key": WORKER_HEARTBEAT_KEY,
                    "value_json": encoded,
                    "updated_at": now,
                },
            )
        else:
            db.execute(
                text(
                    """
                    INSERT INTO runtime_state (state_key, value_json, updated_at)
                    VALUES (:state_key, :value_json, :updated_at)
                    ON CONFLICT (state_key) DO UPDATE SET
                        value_json = EXCLUDED.value_json,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "state_key": WORKER_HEARTBEAT_KEY,
                    "value_json": encoded,
                    "updated_at": now,
                },
            )

        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def read_worker_heartbeat() -> dict[str, Any] | None:
    db = SessionLocal()
    try:
        _ensure_runtime_state_table(db)
        row = (
            db.execute(
                text(
                    """
                    SELECT value_json, updated_at
                    FROM runtime_state
                    WHERE state_key = :state_key
                    """
                ),
                {"state_key": WORKER_HEARTBEAT_KEY},
            )
            .mappings()
            .first()
        )
        db.commit()
        if not row:
            return None

        payload = json.loads(str(row["value_json"]))
        if not isinstance(payload, dict):
            return None

        payload["source"] = "database"
        updated_at = row.get("updated_at")
        if updated_at and not payload.get("stored_at"):
            payload["stored_at"] = (
                updated_at.isoformat()
                if hasattr(updated_at, "isoformat")
                else str(updated_at)
            )
        return payload
    except Exception:
        db.rollback()
        return None
    finally:
        db.close()
