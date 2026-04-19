from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query

from app.core.db import SessionLocal
from app.core.security import verify_token
from app.models.models import AutopilotStatus, ConnectedAccount, User

router = APIRouter(prefix="/api/providers", tags=["providers"])


def resolve_requested_user_id(authorization: str | None, fallback_user_id: int) -> int:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        payload = verify_token(token)
        if payload and payload.get("user_id"):
            return int(payload["user_id"])
    return fallback_user_id


def get_user(user_id: int):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {user_id} not found")
        return db, user
    except Exception:
        db.close()
        raise


def ensure_account_autopilot(db, user: User, account: ConnectedAccount) -> AutopilotStatus:
    autopilot = (
        db.query(AutopilotStatus)
        .filter(AutopilotStatus.connected_account_id == account.id)
        .first()
    )

    if not autopilot:
        autopilot = AutopilotStatus(
            user_id=user.id,
            connected_account_id=account.id,
            enabled=False,
            connected=(account.connection_status == "connected"),
            provider=account.provider,
            posts_in_rotation=0,
        )
        db.add(autopilot)
        db.flush()
    else:
        autopilot.connected = account.connection_status == "connected"
        autopilot.provider = account.provider

    return autopilot


def serialize_status(user: User, autopilot: AutopilotStatus) -> dict:
    account = autopilot.connected_account
    return {
        "user_id": user.id,
        "connected_account_id": autopilot.connected_account_id,
        "running": bool(autopilot.enabled),
        "connected": bool(autopilot.connected),
        "provider": autopilot.provider or (account.provider if account else "x"),
        "account_handle": account.handle if account else user.handle,
        "posts_in_rotation": int(autopilot.posts_in_rotation or 0),
        "last_post_text": autopilot.last_post_text,
        "last_action_at": autopilot.last_action_at.isoformat() if autopilot.last_action_at else None,
        "next_cycle_at": autopilot.next_cycle_at.isoformat() if autopilot.next_cycle_at else None,
    }


def _account_sort_key(account: ConnectedAccount) -> tuple[int, int]:
    connected = str(getattr(account, "connection_status", "") or "").strip().lower() == "connected"
    return (0 if connected else 1, -int(getattr(account, "id", 0) or 0))


@router.post("/connect")
def connect_provider(
    payload: dict,
    user_id: int = Query(1, ge=1),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user = get_user(resolved_user_id)

    try:
        provider = str(payload.get("provider", "x")).strip().lower() or "x"
        handle = str(payload.get("handle", user.handle or "@creator")).strip() or (user.handle or "@creator")

        if not handle.startswith("@") and provider == "x":
            handle = f"@{handle.lstrip('@')}"

        provider_account_id = str(
            payload.get("provider_account_id", f"local-{provider}-{user.id}")
        ).strip() or f"local-{provider}-{user.id}"

        access_token = str(payload.get("access_token", f"local-dev-{provider}-token")).strip() or f"local-dev-{provider}-token"

        account = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.provider == provider,
            )
            .order_by(ConnectedAccount.id.asc())
            .first()
        )

        if not account:
            account = ConnectedAccount(
                user_id=user.id,
                provider=provider,
                provider_account_id=provider_account_id,
                handle=handle,
                access_token=access_token,
                refresh_token=None,
                token_expires_at=None,
                connection_status="connected",
                metadata_json={"source": "local_dev_connect"},
            )
            db.add(account)
            db.flush()
        else:
            account.provider_account_id = provider_account_id
            account.handle = handle
            account.access_token = access_token
            account.connection_status = "connected"
            account.metadata_json = {"source": "local_dev_connect"}

        autopilot = ensure_account_autopilot(db, user, account)
        db.commit()
        db.refresh(autopilot)

        return {
            "ok": True,
            "message": f"{provider} connected in local dev mode",
            "account": {
                "id": account.id,
                "provider": account.provider,
                "handle": account.handle,
            },
            "status": serialize_status(user, autopilot),
        }
    finally:
        db.close()


@router.post("/disconnect")
def disconnect_provider(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user = get_user(resolved_user_id)

    try:
        query = db.query(ConnectedAccount).filter(ConnectedAccount.user_id == user.id)
        if connected_account_id is not None:
            query = query.filter(ConnectedAccount.id == connected_account_id)

        accounts = query.all()
        account = sorted(accounts, key=_account_sort_key)[0] if accounts else None
        if not account:
            raise HTTPException(status_code=404, detail="No connected account found")

        account.connection_status = "disconnected"

        autopilot = (
            db.query(AutopilotStatus)
            .filter(AutopilotStatus.connected_account_id == account.id)
            .first()
        )
        if not autopilot:
            autopilot = ensure_account_autopilot(db, user, account)

        autopilot.connected = False
        autopilot.enabled = False

        db.commit()
        db.refresh(autopilot)

        return {
            "ok": True,
            "message": f"{account.provider} disconnected",
            "status": serialize_status(user, autopilot),
        }
    finally:
        db.close()
