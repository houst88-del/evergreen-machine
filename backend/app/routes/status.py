from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Query, Body
from sqlalchemy.orm import Session

from app.core.db import SessionLocal
from app.models.models import AutopilotStatus, ConnectedAccount
from app.services.pacing import choose_next_cycle, normalize_mode, pacing_payload

router = APIRouter(prefix="/api/status", tags=["status"])


def _safe_bool(v):
    return str(v).lower() in {"1", "true", "yes", "y"}


def _serialize_utc(dt: datetime | None) -> str | None:
    if not dt:
        return None
    return f"{dt.isoformat()}Z"


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
        autopilot_metadata = (
            dict(getattr(status, "metadata_json", None) or {})
            if isinstance(getattr(status, "metadata_json", None), dict)
            else {}
        )
        merged_metadata = {
            **account_metadata,
            **autopilot_metadata,
        }
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
            "last_action_at": _serialize_utc(status.last_action_at),
            "next_cycle_at": _serialize_utc(status.next_cycle_at),
            "breathing_room_active": _safe_bool(merged_metadata.get("breathing_room_active", False)),
            "breathing_room_until": merged_metadata.get("breathing_room_until") or None,
            "breathing_room_reason": merged_metadata.get("breathing_room_reason") or None,
            "latest_original_post_at": merged_metadata.get("latest_original_post_at") or None,
            "fresh_post_protection_enabled": (
                _safe_bool(merged_metadata.get("fresh_post_protection_enabled"))
                if merged_metadata.get("fresh_post_protection_enabled") is not None
                else True
            ),
            "metadata": merged_metadata,
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
        next_cycle_at, next_delay_minutes = choose_next_cycle(status.provider, metadata["pacing_mode"])
        metadata["next_refresh_at"] = next_cycle_at.isoformat()
        metadata["next_refresh_delay_minutes"] = next_delay_minutes
        account.metadata_json = metadata
        status.next_cycle_at = next_cycle_at
        status.updated_at = datetime.utcnow()

        db.commit()

        return {
            "ok": True,
            "next_cycle_at": _serialize_utc(next_cycle_at),
            "next_delay_minutes": next_delay_minutes,
            **pacing_payload(status.provider, metadata["pacing_mode"]),
        }

    finally:
        db.close()


@router.post("/breathing-room")
def set_breathing_room(
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

        enabled = payload.get("enabled")
        metadata = dict(account.metadata_json or {}) if isinstance(account.metadata_json, dict) else {}
        metadata["fresh_post_protection_enabled"] = bool(enabled)
        account.metadata_json = metadata
        account.updated_at = datetime.utcnow()

        status_metadata = (
            dict(status.metadata_json or {}) if isinstance(getattr(status, "metadata_json", None), dict) else {}
        )
        status_metadata["fresh_post_protection_enabled"] = bool(enabled)
        if not enabled:
            status_metadata["breathing_room_active"] = False
            status_metadata["breathing_room_until"] = ""
            status_metadata["breathing_room_reason"] = ""
            status.next_cycle_at = datetime.utcnow()
        status.metadata_json = status_metadata
        status.updated_at = datetime.utcnow()
        db.commit()

        return {
            "ok": True,
            "enabled": bool(enabled),
            "account_handle": account.handle,
        }
    finally:
        db.close()
