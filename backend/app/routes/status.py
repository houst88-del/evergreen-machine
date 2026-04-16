from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Query, Body
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import AutopilotStatus
from app.services.pacing import pacing_payload

router = APIRouter(prefix="/api/status", tags=["status"])


def _safe_bool(v):
    return str(v).lower() in {"1", "true", "yes", "y"}


@router.get("")
def get_status(
    user_id: int = Query(...),
    connected_account_id: int | None = Query(default=None),
):
    db: Session = SessionLocal()

    try:
        query = db.query(AutopilotStatus).filter(AutopilotStatus.user_id == user_id)

        if connected_account_id:
            query = query.filter(
                AutopilotStatus.connected_account_id == connected_account_id
            )

        status = query.first()

        if not status:
            return {"running": False, "connected": False}

        pacing = pacing_payload(status.provider, getattr(status, "pacing_mode", None))

        return {
            "user_id": status.user_id,
            "connected_account_id": status.connected_account_id,
            "running": bool(status.enabled),
            "connected": bool(status.connected),
            "provider": status.provider,
            "posts_in_rotation": status.posts_in_rotation,
            "last_post_text": status.last_post_text,
            "last_action_at": (
                status.last_action_at.isoformat() if status.last_action_at else None
            ),
            "next_cycle_at": (
                status.next_cycle_at.isoformat() if status.next_cycle_at else None
            ),
            **pacing,
        }

    finally:
        db.close()


@router.post("/toggle")
def toggle_autopilot(
    user_id: int = Query(...),
    connected_account_id: int | None = Query(default=None),
    enabled: bool = Body(...),
):
    db: Session = SessionLocal()

    try:
        status = (
            db.query(AutopilotStatus)
            .filter(
                AutopilotStatus.user_id == user_id,
                AutopilotStatus.connected_account_id == connected_account_id,
            )
            .first()
        )

        if not status:
            return {"ok": False, "error": "Autopilot not found"}

        status.enabled = bool(enabled)
        status.updated_at = datetime.utcnow()

        db.commit()

        return {"ok": True}

    finally:
        db.close()


@router.post("/pacing")
def set_pacing(
    user_id: int = Query(...),
    connected_account_id: int | None = Query(default=None),
    mode: str = Body(...),
):
    db: Session = SessionLocal()

    try:
        status = (
            db.query(AutopilotStatus)
            .filter(
                AutopilotStatus.user_id == user_id,
                AutopilotStatus.connected_account_id == connected_account_id,
            )
            .first()
        )

        if not status:
            return {"ok": False, "error": "Autopilot not found"}

        status.pacing_mode = str(mode).lower().strip()
        status.updated_at = datetime.utcnow()

        db.commit()

        return {"ok": True}

    finally:
        db.close()
