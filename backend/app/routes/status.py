from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Query, Body
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import AutopilotStatus, ConnectedAccount
from app.services.pacing import normalize_mode, pacing_payload

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

        account = None
        if status.connected_account_id:
            account = (
                db.query(ConnectedAccount)
                .filter(ConnectedAccount.id == status.connected_account_id)
                .first()
            )

        account_metadata = (
            dict(account.metadata_json or {})
            if account and isinstance(account.metadata_json, dict)
            else {}
        )
        pacing = pacing_payload(
            status.provider,
            account_metadata.get("pacing_mode") or getattr(status, "pacing_mode", None),
        )

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
            "metadata": account_metadata,
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
    payload: dict = Body(...),
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

        account = None
        if status.connected_account_id:
            account = (
                db.query(ConnectedAccount)
                .filter(ConnectedAccount.id == status.connected_account_id)
                .first()
            )

        if not account:
            return {"ok": False, "error": "Connected account not found"}

        mode = str(payload.get("mode", "")).strip()
        metadata = dict(account.metadata_json or {}) if isinstance(account.metadata_json, dict) else {}
        metadata["pacing_mode"] = normalize_mode(mode)
        account.metadata_json = metadata
        status.updated_at = datetime.utcnow()

        db.commit()

        return {
            "ok": True,
            **pacing_payload(status.provider, metadata["pacing_mode"]),
        }

    finally:
        db.close()
