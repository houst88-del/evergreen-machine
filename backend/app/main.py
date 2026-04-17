from dotenv import load_dotenv
load_dotenv()

import os
import json
from datetime import datetime, UTC
from pathlib import Path

from atproto import Client
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app.core.db import Base, SessionLocal, engine
from app.core.security import verify_token
from app.models.models import AutopilotStatus, ConnectedAccount, Post, User
from app.routes.auth import router as auth_router
from app.routes.bluesky_routes import router as bluesky_router
from app.routes.galaxy import router as galaxy_router
from app.routes.x_oauth_routes import router as x_oauth_router
from app.services.job_queue import enqueue_job, list_jobs
from app.services.pacing import normalize_mode, pacing_options_for_provider
from app.services.pool_service import active_rotation_count
from app.services.scoring import seed_demo_data
from app.services.secret_crypto import encrypt_metadata

app = FastAPI(title="Evergreen API")

WORKER_HEARTBEAT_PATH = Path(__file__).resolve().parents[1] / "worker_heartbeat.json"


def read_worker_heartbeat() -> dict:
    if not WORKER_HEARTBEAT_PATH.exists():
        return {"status": "missing", "timestamp": None}
    try:
        return json.loads(WORKER_HEARTBEAT_PATH.read_text())
    except Exception as exc:
        return {"status": "unreadable", "timestamp": None, "error": str(exc)}


Base.metadata.create_all(bind=engine)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://evergreenmachine-git-main-houst88-4413s-projects.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(x_oauth_router)
app.include_router(bluesky_router)
app.include_router(galaxy_router)


def ensure_demo_seeded_once(db) -> None:
    existing_user = db.query(User).first()
    if existing_user:
        return
    seed_demo_data(db)


def resolve_requested_user_id(authorization: str | None, fallback_user_id: int) -> int:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        payload = verify_token(token)
        if payload and payload.get("user_id"):
            return int(payload["user_id"])
    return fallback_user_id


def _account_pacing_mode(account: ConnectedAccount | None) -> str:
    metadata = getattr(account, "metadata_json", None) or {}
    return normalize_mode(metadata.get("pacing_mode"))


def serialize_status(user: User, autopilot: AutopilotStatus | None) -> dict:
    account = getattr(autopilot, "connected_account", None) if autopilot else None
    provider = getattr(autopilot, "provider", None) or getattr(account, "provider", None) or "x"
    pacing_mode = _account_pacing_mode(account)
    metadata = dict(getattr(autopilot, "metadata_json", None) or {}) if autopilot else {}
    next_refresh_at = metadata.get("next_refresh_at")
    visible_next_cycle_at = next_refresh_at or (
        autopilot.next_cycle_at.isoformat() if autopilot and autopilot.next_cycle_at else None
    )

    return {
        "user_id": user.id,
        "connected_account_id": getattr(autopilot, "connected_account_id", None) if autopilot else None,
        "running": bool(getattr(autopilot, "enabled", False)) if autopilot else False,
        "connected": bool(getattr(autopilot, "connected", False)) if autopilot else False,
        "provider": provider,
        "account_handle": getattr(account, "handle", None) or user.handle or "@demo_creator",
        "posts_in_rotation": int(getattr(autopilot, "posts_in_rotation", 0) or 0),
        "last_post_text": getattr(autopilot, "last_post_text", None),
        "last_action_at": autopilot.last_action_at.isoformat() if autopilot and autopilot.last_action_at else None,
        "next_cycle_at": visible_next_cycle_at,
        "pacing_mode": pacing_mode,
        "pacing_options": pacing_options_for_provider(provider),
        "metadata": metadata,
    }


def get_user_and_optional_account(user_id: int, connected_account_id: int | None = None):
    db = SessionLocal()
    try:
        ensure_demo_seeded_once(db)
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {user_id} not found")

        account = None
        if connected_account_id is not None:
            account = (
                db.query(ConnectedAccount)
                .filter(ConnectedAccount.id == connected_account_id, ConnectedAccount.user_id == user.id)
                .first()
            )
            if not account:
                raise HTTPException(status_code=404, detail=f"Connected account {connected_account_id} not found")

        return db, user, account
    except Exception:
        db.close()
        raise


def get_or_create_autopilot_for_account(db, user: User, account: ConnectedAccount) -> AutopilotStatus:
    autopilot = (
        db.query(AutopilotStatus)
        .filter(AutopilotStatus.connected_account_id == account.id)
        .first()
    )

    provider = str(account.provider or "").strip().lower()

    if provider == "bluesky":
        posts_in_rotation = (
            db.query(Post)
            .filter(
                Post.connected_account_id == account.id,
                Post.state == "active",
            )
            .count()
        )
    else:
        posts_in_rotation = active_rotation_count(account.handle)

    if autopilot:
        autopilot.provider = provider
        autopilot.connected = account.connection_status == "connected"
        autopilot.posts_in_rotation = posts_in_rotation
        return autopilot

    autopilot = AutopilotStatus(
        user_id=user.id,
        connected_account_id=account.id,
        enabled=False,
        connected=account.connection_status == "connected",
        provider=provider,
        posts_in_rotation=posts_in_rotation,
    )
    db.add(autopilot)
    db.flush()
    return autopilot


def get_default_connected_account(db, user: User) -> ConnectedAccount | None:
    return (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.user_id == user.id)
        .order_by(ConnectedAccount.id.asc())
        .first()
    )


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/system-status")
def system_status():
    heartbeat = read_worker_heartbeat()
    timestamp = heartbeat.get("timestamp")
    worker_alive = False
    if timestamp:
        try:
            worker_seen = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
            age = (datetime.now(UTC) - worker_seen.astimezone(UTC)).total_seconds()
            worker_alive = age <= 60
        except Exception:
            worker_alive = False

    return {
        "backend": {"ok": True},
        "worker": {
            "ok": worker_alive,
            "heartbeat": heartbeat,
        },
        "frontend_hint": os.getenv("EVERGREEN_DASHBOARD_URL", "http://127.0.0.1:3000/dashboard"),
    }


@app.get("/api/jobs")
def get_jobs(limit: int = Query(50, ge=1, le=200), connected_account_id: int | None = Query(default=None)):
    jobs = list_jobs(limit)
    if connected_account_id is not None:
        jobs = [j for j in jobs if int(j.get("connected_account_id", -1)) == int(connected_account_id)]
    return {"jobs": jobs}


@app.get("/api/connected-accounts")
def list_connected_accounts(
    user_id: int = Query(1, ge=1),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, _ = get_user_and_optional_account(resolved_user_id)
    try:
        accounts = (
            db.query(ConnectedAccount)
            .filter(ConnectedAccount.user_id == user.id)
            .order_by(ConnectedAccount.provider.asc(), ConnectedAccount.id.asc())
            .all()
        )
        return {
            "ok": True,
            "user_id": user.id,
            "accounts": [
                {
                    "id": account.id,
                    "provider": account.provider,
                    "handle": account.handle,
                    "provider_account_id": account.provider_account_id,
                    "connection_status": account.connection_status,
                }
                for account in accounts
            ],
        }
    finally:
        db.close()


@app.get("/api/status")
def get_status(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                return serialize_status(user, None)

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        db.commit()
        db.refresh(autopilot)
        return serialize_status(user, autopilot)
    finally:
        db.close()


@app.post("/api/status/toggle")
def toggle_status(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        enabled = bool(payload.get("enabled", False))
        autopilot.enabled = enabled
        autopilot.connected = account.connection_status == "connected"
        autopilot.provider = account.provider
        autopilot.posts_in_rotation = active_rotation_count(account.handle)
        autopilot.last_action_at = datetime.now(UTC).replace(tzinfo=None)
        autopilot.next_cycle_at = datetime.now(UTC).replace(tzinfo=None) if enabled else None

        db.commit()
        db.refresh(autopilot)
        return serialize_status(user, autopilot)
    finally:
        db.close()


@app.post("/api/status/pacing")
def set_pacing_mode(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        metadata = dict(account.metadata_json or {})
        metadata["pacing_mode"] = normalize_mode(payload.get("mode"))
        account.metadata_json = metadata

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        autopilot.provider = account.provider
        autopilot.connected = account.connection_status == "connected"
        autopilot.posts_in_rotation = active_rotation_count(account.handle)

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)
        return serialize_status(user, autopilot)
    finally:
        db.close()


@app.post("/api/providers/connect")
def connect_provider(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        provider = str(payload.get("provider", "x")).strip().lower() or "x"
        handle = str(payload.get("handle", user.handle or "@creator")).strip() or (user.handle or "@creator")

        if account is None:
            account = (
                db.query(ConnectedAccount)
                .filter(ConnectedAccount.user_id == user.id, ConnectedAccount.provider == provider)
                .order_by(ConnectedAccount.id.asc())
                .first()
            )

        if provider == "bluesky":
            app_password = str(payload.get("app_password", "")).strip()
            if not handle or not app_password:
                raise HTTPException(status_code=400, detail="handle and app_password required for Bluesky")

            client = Client()
            profile = client.login(handle, app_password)
            provider_account_id = str(getattr(profile, "did", "") or "").strip() or f"local-bluesky-{user.id}"

            secure_metadata = encrypt_metadata({
                "source": "bluesky_atproto",
                "pacing_mode": "standard",
                "app_password": app_password,
            })

            if not account:
                account = ConnectedAccount(
                    user_id=user.id,
                    provider="bluesky",
                    provider_account_id=provider_account_id,
                    handle=handle,
                    access_token="bluesky",
                    refresh_token="bluesky",
                    token_expires_at=None,
                    connection_status="connected",
                    metadata_json=secure_metadata,
                )
                db.add(account)
                db.flush()
            else:
                account.provider = "bluesky"
                account.provider_account_id = provider_account_id
                account.handle = handle
                account.access_token = "bluesky"
                account.refresh_token = "bluesky"
                account.token_expires_at = None
                account.connection_status = "connected"
                account.metadata_json = secure_metadata

        else:
            provider_account_id = str(
                payload.get("provider_account_id", f"local-{provider}-{user.id}")
            ).strip() or f"local-{provider}-{user.id}"

            if not account:
                account = ConnectedAccount(
                    user_id=user.id,
                    provider=provider,
                    provider_account_id=provider_account_id,
                    handle=handle,
                    access_token="local-dev-token",
                    refresh_token=None,
                    token_expires_at=None,
                    connection_status="connected",
                    metadata_json={"source": "evergreen_local_connect", "pacing_mode": "standard"},
                )
                db.add(account)
                db.flush()
            else:
                metadata = dict(account.metadata_json or {})
                metadata.setdefault("pacing_mode", "standard")
                account.provider = provider
                account.provider_account_id = provider_account_id
                account.handle = handle
                account.connection_status = "connected"
                account.metadata_json = metadata

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        autopilot.connected = True
        autopilot.provider = provider
        autopilot.posts_in_rotation = active_rotation_count(account.handle)

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)
        return serialize_status(user, autopilot)
    finally:
        db.close()


@app.post("/api/providers/disconnect")
def disconnect_provider(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        account.connection_status = "disconnected"
        autopilot.connected = False
        autopilot.enabled = False

        db.commit()
        db.refresh(autopilot)
        return serialize_status(user, autopilot)
    finally:
        db.close()


@app.post("/api/jobs/refresh-now")
def refresh_now(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        metadata = dict(account.metadata_json or {})
        pacing_mode = normalize_mode(metadata.get("pacing_mode"))

        job = enqueue_job(
            connected_account_id=account.id,
            job_type="refresh",
            payload={
                "source": "manual",
                "requested_by_user_id": resolved_user_id,
                "pacing_mode": pacing_mode,
            },
        )
        return {"ok": True, "job": job}
    finally:
        db.close()


@app.post("/api/jobs/run-analytics")
def run_analytics(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    resolved_user_id = resolve_requested_user_id(authorization, user_id)
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        job = enqueue_job(
            connected_account_id=account.id,
            job_type="analytics",
            payload={"source": "manual", "requested_by_user_id": resolved_user_id},
        )
        return {"ok": True, "job": job}
    finally:
        db.close()


@app.get("/api/users")
def list_users():
    db = SessionLocal()
    try:
        ensure_demo_seeded_once(db)
        users = db.query(User).order_by(User.id.asc()).all()
        out = []
        for user in users:
            accounts = (
                db.query(ConnectedAccount)
                .filter(ConnectedAccount.user_id == user.id)
                .order_by(ConnectedAccount.id.asc())
                .all()
            )
            out.append(
                {
                    "user_id": user.id,
                    "handle": user.handle,
                    "accounts": [
                        {
                            "id": account.id,
                            "provider": account.provider,
                            "handle": account.handle,
                            "connection_status": account.connection_status,
                        }
                        for account in accounts
                    ],
                }
            )
        return {"users": out}
    finally:
        db.close()


@app.post("/api/dev/create-user")
def create_dev_user(payload: dict):
    email = str(payload.get("email", "")).strip().lower()
    handle = str(payload.get("handle", "")).strip().lstrip("@")

    if not email:
        raise HTTPException(status_code=400, detail="email is required")
    if not handle:
        raise HTTPException(status_code=400, detail="handle is required")

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            return {"user_id": existing.id, "handle": existing.handle}

        user = User(email=email, handle=f"@{handle}")
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"user_id": user.id, "handle": user.handle}
    finally:
        db.close()
