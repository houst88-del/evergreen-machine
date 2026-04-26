from dotenv import load_dotenv
load_dotenv()

import os
import json
from datetime import datetime, UTC
from pathlib import Path

from atproto import Client
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import inspect, text
import stripe

from app.core.auth_store import (
    update_subscription_status,
)
from app.core.db import Base, SessionLocal, engine
from app.core.security import verify_token
from app.core.subscription_state import (
    STRIPE_ACTIVE_STATUSES,
    ensure_user_subscription_state,
    iso_from_unix_timestamp,
    update_user_subscription,
)
from app.models.models import AutopilotStatus, ConnectedAccount, JobQueueItem, Post, User
from app.routes.auth import router as auth_router
from app.routes.bluesky_routes import router as bluesky_router
from app.routes.galaxy import router as galaxy_router
from app.routes.x_oauth_routes import router as x_oauth_router
from app.services.job_queue import enqueue_job
from app.services.pacing import choose_next_cycle, normalize_mode, pacing_options_for_provider
from app.services.pool_service import active_rotation_count
from app.services.scoring import seed_demo_data
from app.services.secret_crypto import encrypt_metadata
from app.services.welcome_email import maybe_send_welcome_email, welcome_email_configured

app = FastAPI(title="Evergreen API")

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")

WORKER_HEARTBEAT_PATH = Path(__file__).resolve().parents[1] / "worker_heartbeat.json"


def canonical_dashboard_url() -> str:
    app_base = (
        os.getenv("EVERGREEN_APP_URL", "").strip()
        or os.getenv("EVERGREEN_DASHBOARD_URL", "").strip()
        or "https://www.evergreenmachine.ai"
    ).rstrip("/")

    if "vercel.app" in app_base or "vercel.com" in app_base:
        app_base = "https://www.evergreenmachine.ai"

    if app_base.endswith("/dashboard"):
        return app_base

    return f"{app_base}/dashboard"


def read_worker_heartbeat() -> dict:
    if not WORKER_HEARTBEAT_PATH.exists():
        return {"status": "missing", "timestamp": None}
    try:
        return json.loads(WORKER_HEARTBEAT_PATH.read_text())
    except Exception as exc:
        return {"status": "unreadable", "timestamp": None, "error": str(exc)}


def infer_worker_activity_from_jobs() -> dict:
    db = SessionLocal()
    try:
        latest_job = (
            db.query(JobQueueItem)
            .order_by(JobQueueItem.last_heartbeat_at.desc(), JobQueueItem.created_at.desc())
            .first()
        )
        if not latest_job:
            return {"ok": False, "timestamp": None}

        marker = (
            latest_job.last_heartbeat_at
            or latest_job.finished_at
            or latest_job.started_at
            or latest_job.created_at
        )
        if not marker:
            return {"ok": False, "timestamp": None}

        age = (datetime.now(UTC).replace(tzinfo=None) - marker).total_seconds()
        return {
            "ok": age <= 120,
            "timestamp": marker.isoformat(),
            "job_id": latest_job.id,
            "job_status": latest_job.status,
            "job_type": latest_job.job_type,
            "connected_account_id": latest_job.connected_account_id,
            "age_seconds": max(0, int(age)),
        }
    finally:
        db.close()


Base.metadata.create_all(bind=engine)


def ensure_runtime_schema() -> None:
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    statements: list[str] = []

    if "welcome_email_sent_at" not in user_columns:
        if engine.dialect.name == "sqlite":
            statements.append("ALTER TABLE users ADD COLUMN welcome_email_sent_at DATETIME")
        else:
            statements.append("ALTER TABLE users ADD COLUMN welcome_email_sent_at TIMESTAMP NULL")

    user_datetime_type = "DATETIME" if engine.dialect.name == "sqlite" else "TIMESTAMP NULL"
    user_string_type = "TEXT" if engine.dialect.name == "sqlite" else "VARCHAR(255) NULL"

    if "subscription_status" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN subscription_status {user_string_type}")
    if "trial_started_at" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN trial_started_at {user_datetime_type}")
    if "trial_ends_at" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN trial_ends_at {user_datetime_type}")
    if "stripe_customer_id" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN stripe_customer_id {user_string_type}")
    if "stripe_subscription_id" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN stripe_subscription_id {user_string_type}")
    if "stripe_price_id" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN stripe_price_id {user_string_type}")
    if "stripe_billing_email" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN stripe_billing_email {user_string_type}")
    if "current_period_end" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN current_period_end {user_datetime_type}")
    if "subscription_updated_at" not in user_columns:
        statements.append(f"ALTER TABLE users ADD COLUMN subscription_updated_at {user_datetime_type}")

    if "autopilot_status" in inspector.get_table_names():
        autopilot_columns = {column["name"] for column in inspector.get_columns("autopilot_status")}
        if "metadata_json" not in autopilot_columns:
            if engine.dialect.name == "sqlite":
                statements.append("ALTER TABLE autopilot_status ADD COLUMN metadata_json JSON")
            else:
                statements.append("ALTER TABLE autopilot_status ADD COLUMN metadata_json JSON NULL")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


ensure_runtime_schema()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://evergreenmachine.ai",
        "https://www.evergreenmachine.ai",
        "https://evergreenmachine-git-main-houst88-4413s-projects.vercel.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.include_router(auth_router)
app.include_router(x_oauth_router)
app.include_router(bluesky_router)
app.include_router(galaxy_router)


def ensure_demo_seeded_once(db) -> None:
    existing_user = db.query(User).first()
    if existing_user:
        return
    seed_demo_data(db)


def _normalized_handle(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return raw if raw.startswith("@") else f"@{raw}"


def _migrate_user_records(db, source: User, target: User) -> None:
    if source.id == target.id:
        return

    for account in db.query(ConnectedAccount).filter(ConnectedAccount.user_id == source.id).all():
        account.user_id = target.id

    for post in db.query(Post).filter(Post.user_id == source.id).all():
        post.user_id = target.id

    target_default_autopilot = (
        db.query(AutopilotStatus)
        .filter(
            AutopilotStatus.user_id == target.id,
            AutopilotStatus.connected_account_id.is_(None),
        )
        .first()
    )

    for autopilot in db.query(AutopilotStatus).filter(AutopilotStatus.user_id == source.id).all():
        if autopilot.connected_account_id is None and target_default_autopilot:
            db.delete(autopilot)
            continue
        autopilot.user_id = target.id

    db.flush()
    db.delete(source)
    db.flush()


def resolve_requested_user_id(
    db,
    authorization: str | None,
    fallback_user_id: int,
    hinted_email: str | None = None,
    hinted_handle: str | None = None,
) -> int:
    payload = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        payload = verify_token(token)

    token_email = str((payload or {}).get("email", "")).strip().lower()
    token_handle = _normalized_handle((payload or {}).get("handle"))
    candidate_email = str(hinted_email or token_email).strip().lower()
    candidate_handle = _normalized_handle(hinted_handle or token_handle)

    user_by_email = (
        db.query(User).filter(User.email == candidate_email).first()
        if candidate_email
        else None
    )
    if not candidate_handle and user_by_email:
        candidate_handle = _normalized_handle(getattr(user_by_email, "handle", None))
    user_by_handle = (
        db.query(User).filter(User.handle == candidate_handle).order_by(User.id.asc()).first()
        if candidate_handle
        else None
    )

    if user_by_email and user_by_handle and user_by_email.id != user_by_handle.id:
        _migrate_user_records(db, source=user_by_handle, target=user_by_email)
        db.commit()
        db.refresh(user_by_email)
        return int(user_by_email.id)

    if user_by_email:
        return int(user_by_email.id)

    if user_by_handle:
        return int(user_by_handle.id)

    if payload and payload.get("user_id"):
        return int(payload["user_id"])
    return fallback_user_id


def _account_pacing_mode(account: ConnectedAccount | None) -> str:
    metadata = getattr(account, "metadata_json", None) or {}
    return normalize_mode(metadata.get("pacing_mode"))


def _safe_boolish(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return bool(value)


def posts_in_rotation_for_account(db, account: ConnectedAccount) -> int:
    db_active_posts = (
        db.query(Post)
        .filter(
            Post.connected_account_id == account.id,
            Post.state == "active",
        )
        .count()
    )
    if db_active_posts > 0:
        return db_active_posts
    return active_rotation_count(account.handle)


def get_user_subscription_state(db, user: User) -> dict:
    return ensure_user_subscription_state(db, user, stripe_reconcile=True)


def require_autopilot_access(user: User) -> dict:
    db = SessionLocal()
    try:
        persistent_user = db.query(User).filter(User.id == user.id).first()
        state = get_user_subscription_state(db, persistent_user or user)
    finally:
        db.close()
    if state.get("can_run_autopilot"):
        return state

    if state.get("subscription_status") == "expired":
        raise HTTPException(
            status_code=402,
            detail="Your 3-day trial has ended. Subscribe to restart Autopilot.",
        )

    raise HTTPException(
        status_code=402,
        detail="Start your 3-day trial or subscribe to use Autopilot.",
    )


def _stripe_email_from_event_object(obj: dict) -> str:
    customer_details = obj.get("customer_details") or {}
    return (
        str(
            customer_details.get("email")
            or obj.get("customer_email")
            or obj.get("receipt_email")
            or ""
        )
        .strip()
        .lower()
    )


def _iso_from_unix_timestamp(value: object) -> str | None:
    try:
        ts = int(value or 0)
    except Exception:
        return None
    if ts <= 0:
        return None
    return datetime.fromtimestamp(ts, UTC).replace(tzinfo=None).isoformat(timespec="seconds")


def _sync_subscription_from_stripe_payload(
    *,
    email: str,
    status: str,
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
    stripe_price_id: str | None = None,
    stripe_billing_email: str | None = None,
    current_period_end: str | None = None,
) -> dict | None:
    if not email:
        return None

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            update_user_subscription(
                user,
                status=status,
                stripe_customer_id=stripe_customer_id,
                stripe_subscription_id=stripe_subscription_id,
                stripe_price_id=stripe_price_id,
                stripe_billing_email=stripe_billing_email,
                current_period_end=current_period_end,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return update_subscription_status(
            email,
            status=status,
            stripe_customer_id=stripe_customer_id,
            stripe_subscription_id=stripe_subscription_id,
            stripe_price_id=stripe_price_id,
            stripe_billing_email=stripe_billing_email,
            current_period_end=current_period_end,
        )
    finally:
        db.close()


def serialize_status(db, user: User, autopilot: AutopilotStatus | None) -> dict:
    account = getattr(autopilot, "connected_account", None) if autopilot else None
    provider = getattr(autopilot, "provider", None) or getattr(account, "provider", None) or "x"
    pacing_mode = _account_pacing_mode(account)
    account_metadata = dict(getattr(account, "metadata_json", None) or {}) if account else {}
    autopilot_metadata = dict(getattr(autopilot, "metadata_json", None) or {}) if autopilot else {}
    metadata = {
        **account_metadata,
        **autopilot_metadata,
    }
    next_refresh_at = metadata.get("next_refresh_at")
    visible_next_cycle_at = next_refresh_at or (
        autopilot.next_cycle_at.isoformat() if autopilot and autopilot.next_cycle_at else None
    )
    subscription = get_user_subscription_state(db, user)
    can_run_autopilot = bool(subscription.get("can_run_autopilot", False))
    running = bool(getattr(autopilot, "enabled", False)) if autopilot else False

    return {
        "user_id": user.id,
        "connected_account_id": getattr(autopilot, "connected_account_id", None) if autopilot else None,
        "running": running and can_run_autopilot,
        "connected": bool(getattr(autopilot, "connected", False)) if autopilot else False,
        "provider": provider,
        "account_handle": getattr(account, "handle", None) or user.handle or "@demo_creator",
        "posts_in_rotation": int(getattr(autopilot, "posts_in_rotation", 0) or 0),
        "last_post_text": getattr(autopilot, "last_post_text", None),
        "last_action_at": autopilot.last_action_at.isoformat() if autopilot and autopilot.last_action_at else None,
        "next_cycle_at": visible_next_cycle_at,
        "pacing_mode": pacing_mode,
        "pacing_options": pacing_options_for_provider(provider),
        "breathing_room_active": _safe_boolish(metadata.get("breathing_room_active", False)),
        "breathing_room_until": metadata.get("breathing_room_until") or None,
        "breathing_room_reason": metadata.get("breathing_room_reason") or None,
        "latest_original_post_at": metadata.get("latest_original_post_at") or None,
        "fresh_post_protection_enabled": _safe_boolish(
            metadata.get("fresh_post_protection_enabled", True),
            True,
        ),
        "subscription_status": subscription.get("subscription_status"),
        "trial_started_at": subscription.get("trial_started_at"),
        "trial_ends_at": subscription.get("trial_ends_at"),
        "can_run_autopilot": can_run_autopilot,
        "autopilot_blocked": running and not can_run_autopilot,
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
    posts_in_rotation = posts_in_rotation_for_account(db, account)

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


def maybe_enable_connected_lane(db, user: User, autopilot: AutopilotStatus) -> AutopilotStatus:
    subscription = get_user_subscription_state(db, user)
    if not subscription.get("can_run_autopilot"):
        return autopilot

    if not autopilot.connected:
        return autopilot

    autopilot.enabled = True
    autopilot.last_action_at = datetime.now(UTC).replace(tzinfo=None)
    autopilot.next_cycle_at = datetime.now(UTC).replace(tzinfo=None)
    return autopilot


def _account_sort_key(account: ConnectedAccount) -> tuple[int, int]:
    connected = str(getattr(account, "connection_status", "") or "").strip().lower() == "connected"
    return (0 if connected else 1, -int(getattr(account, "id", 0) or 0))


def _preferred_accounts(accounts: list[ConnectedAccount]) -> list[ConnectedAccount]:
    ranked = sorted(accounts, key=_account_sort_key)
    deduped: list[ConnectedAccount] = []
    seen_providers: set[str] = set()

    for account in ranked:
        provider = str(getattr(account, "provider", "") or "").strip().lower()
        if provider in seen_providers:
            continue
        seen_providers.add(provider)
        deduped.append(account)

    return deduped


def get_default_connected_account(db, user: User) -> ConnectedAccount | None:
    accounts = (
        db.query(ConnectedAccount)
        .filter(ConnectedAccount.user_id == user.id)
        .all()
    )
    preferred = _preferred_accounts(accounts)
    return preferred[0] if preferred else None


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

    inferred_worker = infer_worker_activity_from_jobs()
    if not worker_alive and inferred_worker.get("ok"):
        worker_alive = True
        heartbeat = {
            **heartbeat,
            "status": heartbeat.get("status") or "inferred",
            "inferred_from_jobs": True,
            "job_activity": inferred_worker,
        }

    return {
        "backend": {"ok": True},
        "worker": {
            "ok": worker_alive,
            "heartbeat": heartbeat,
        },
        "frontend_hint": canonical_dashboard_url(),
    }


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
    if not webhook_secret:
        raise HTTPException(status_code=500, detail="missing stripe webhook secret")

    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    if not signature:
        raise HTTPException(status_code=400, detail="missing stripe signature")

    try:
        event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid stripe webhook: {exc}")

    event_type = str(event.get("type") or "").strip()
    obj = dict(((event.get("data") or {}).get("object") or {}))

    if event_type in {"checkout.session.completed", "checkout.session.async_payment_succeeded"}:
        email = _stripe_email_from_event_object(obj)
        subscription_id = str(obj.get("subscription") or "").strip() or None
        price_id = None
        line_items = obj.get("display_items") or []
        if isinstance(line_items, list) and line_items:
            first = line_items[0] or {}
            if isinstance(first, dict):
                price_id = str(first.get("price") or "").strip() or None

        updated = _sync_subscription_from_stripe_payload(
            email=email,
            status="active",
            stripe_customer_id=str(obj.get("customer") or "").strip() or None,
            stripe_subscription_id=subscription_id,
            stripe_price_id=price_id,
            stripe_billing_email=email,
        )
        return {"ok": True, "handled": True, "type": event_type, "updated": bool(updated)}

    if event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        email = str(((obj.get("customer_email") or "") if isinstance(obj, dict) else "")).strip().lower()
        if not email:
            try:
                customer_id = str(obj.get("customer") or "").strip()
                if customer_id:
                    customer = stripe.Customer.retrieve(customer_id)
                    email = str(getattr(customer, "email", "") or customer.get("email") or "").strip().lower()
            except Exception:
                email = ""

        stripe_status = str(obj.get("status") or "").strip().lower()
        internal_status = "active" if stripe_status in {"active", "trialing", "past_due"} else "inactive"
        items = (((obj.get("items") or {}).get("data")) or []) if isinstance(obj, dict) else []
        price_id = None
        if isinstance(items, list) and items:
            first = items[0] or {}
            if isinstance(first, dict):
                price = first.get("price") or {}
                if isinstance(price, dict):
                    price_id = str(price.get("id") or "").strip() or None

        updated = _sync_subscription_from_stripe_payload(
            email=email,
            status=internal_status,
            stripe_customer_id=str(obj.get("customer") or "").strip() or None,
            stripe_subscription_id=str(obj.get("id") or "").strip() or None,
            stripe_price_id=price_id,
            stripe_billing_email=email,
            current_period_end=_iso_from_unix_timestamp(obj.get("current_period_end")),
        )
        return {"ok": True, "handled": True, "type": event_type, "updated": bool(updated)}

    if event_type in {"customer.subscription.deleted"}:
        email = ""
        try:
            customer_id = str(obj.get("customer") or "").strip()
            if customer_id:
                customer = stripe.Customer.retrieve(customer_id)
                email = str(getattr(customer, "email", "") or customer.get("email") or "").strip().lower()
        except Exception:
            email = ""

        updated = _sync_subscription_from_stripe_payload(
            email=email,
            status="inactive",
            stripe_customer_id=str(obj.get("customer") or "").strip() or None,
            stripe_subscription_id=str(obj.get("id") or "").strip() or None,
            stripe_billing_email=email,
            current_period_end=None,
        )
        return {"ok": True, "handled": True, "type": event_type, "updated": bool(updated)}

    if event_type in {"invoice.paid"}:
        email = str(obj.get("customer_email") or obj.get("receipt_email") or "").strip().lower()
        updated = _sync_subscription_from_stripe_payload(
            email=email,
            status="active",
            stripe_customer_id=str(obj.get("customer") or "").strip() or None,
            stripe_subscription_id=str(obj.get("subscription") or "").strip() or None,
            stripe_billing_email=email,
        )
        return {"ok": True, "handled": True, "type": event_type, "updated": bool(updated)}

    return {"ok": True, "handled": False, "type": event_type}


@app.get("/api/jobs")
def get_jobs(
    limit: int = Query(50, ge=1, le=200),
    connected_account_id: int | None = Query(default=None),
    user_id: int = Query(1, ge=1),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
        user = db.query(User).filter(User.id == resolved_user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail=f"User {resolved_user_id} not found")

        user_account_ids = [
            int(account.id)
            for account in db.query(ConnectedAccount).filter(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.connection_status == "connected",
            ).all()
        ]

        if not user_account_ids:
            return {"jobs": []}

        query = db.query(JobQueueItem).filter(JobQueueItem.connected_account_id.in_(user_account_ids))

        if connected_account_id is not None:
            if int(connected_account_id) not in user_account_ids:
                return {"jobs": []}
            query = query.filter(JobQueueItem.connected_account_id == int(connected_account_id))

        rows = (
            query
            .order_by(JobQueueItem.created_at.desc(), JobQueueItem.id.desc())
            .limit(max(1, int(limit)))
            .all()
        )

        return {
            "jobs": [
                {
                    "id": row.id,
                    "connected_account_id": row.connected_account_id,
                    "job_type": row.job_type,
                    "payload": dict(row.payload_json or {}),
                    "status": row.status,
                    "created_at": row.created_at.isoformat() if row.created_at else "",
                    "started_at": row.started_at.isoformat() if row.started_at else None,
                    "finished_at": row.finished_at.isoformat() if row.finished_at else None,
                    "result": row.result_json,
                    "error": row.error,
                    "worker_id": row.worker_id,
                    "attempt_count": int(row.attempt_count or 0),
                    "last_heartbeat_at": row.last_heartbeat_at.isoformat() if row.last_heartbeat_at else None,
                }
                for row in rows
            ]
        }
    finally:
        db.close()


@app.get("/api/connected-accounts")
def list_connected_accounts(
    user_id: int = Query(1, ge=1),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
    db, user, _ = get_user_and_optional_account(resolved_user_id)
    try:
        accounts = (
            db.query(ConnectedAccount)
            .filter(
                ConnectedAccount.user_id == user.id,
                ConnectedAccount.connection_status == "connected",
            )
            .all()
        )
        accounts = sorted(_preferred_accounts(accounts), key=lambda account: str(account.provider or "").lower())
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
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                return serialize_status(db, user, None)

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        db.commit()
        db.refresh(autopilot)
        return serialize_status(db, user, autopilot)
    finally:
        db.close()


@app.post("/api/status/toggle")
def toggle_status(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        enabled = bool(payload.get("enabled", False))
        if enabled:
            require_autopilot_access(user)
        autopilot.enabled = enabled
        autopilot.connected = account.connection_status == "connected"
        autopilot.provider = account.provider
        autopilot.posts_in_rotation = posts_in_rotation_for_account(db, account)
        autopilot.last_action_at = datetime.now(UTC).replace(tzinfo=None)
        autopilot.next_cycle_at = datetime.now(UTC).replace(tzinfo=None) if enabled else None

        db.commit()
        db.refresh(autopilot)
        return serialize_status(db, user, autopilot)
    finally:
        db.close()


@app.post("/api/status/pacing")
def set_pacing_mode(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        metadata = dict(account.metadata_json or {})
        metadata["pacing_mode"] = normalize_mode(payload.get("mode"))
        next_cycle_at, next_delay_minutes = choose_next_cycle(account.provider, metadata["pacing_mode"])
        metadata["next_refresh_at"] = next_cycle_at.isoformat()
        metadata["next_refresh_delay_minutes"] = next_delay_minutes
        account.metadata_json = metadata

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        autopilot.provider = account.provider
        autopilot.connected = account.connection_status == "connected"
        autopilot.posts_in_rotation = posts_in_rotation_for_account(db, account)
        autopilot.next_cycle_at = next_cycle_at

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)
        return serialize_status(db, user, autopilot)
    finally:
        db.close()


@app.post("/api/status/breathing-room")
def set_breathing_room(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        enabled = bool(payload.get("enabled"))

        account_metadata = dict(account.metadata_json or {})
        account_metadata["fresh_post_protection_enabled"] = enabled
        if not enabled:
            account_metadata["breathing_room_active"] = False
            account_metadata["breathing_room_until"] = ""
            account_metadata["breathing_room_reason"] = ""
            account_metadata["latest_original_post_at"] = ""
            account_metadata["latest_original_post_id"] = ""
            account_metadata["next_refresh_at"] = ""
            account_metadata["next_refresh_delay_minutes"] = ""
        account.metadata_json = account_metadata

        autopilot_metadata = dict(getattr(autopilot, "metadata_json", None) or {})
        autopilot_metadata["fresh_post_protection_enabled"] = enabled
        if not enabled:
            autopilot_metadata["breathing_room_active"] = False
            autopilot_metadata["breathing_room_until"] = ""
            autopilot_metadata["breathing_room_reason"] = ""
            autopilot_metadata["latest_original_post_at"] = ""
            autopilot_metadata["latest_original_post_id"] = ""
            autopilot_metadata["next_refresh_at"] = ""
            autopilot_metadata["next_refresh_delay_minutes"] = ""
            autopilot.next_cycle_at = None
        autopilot.metadata_json = autopilot_metadata
        autopilot.updated_at = datetime.now(UTC).replace(tzinfo=None)
        account.updated_at = datetime.now(UTC).replace(tzinfo=None)

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)
        return serialize_status(db, user, autopilot)
    finally:
        db.close()


@app.post("/api/providers/connect")
def connect_provider(
    payload: dict,
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
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
        autopilot.posts_in_rotation = posts_in_rotation_for_account(db, account)
        autopilot = maybe_enable_connected_lane(db, user, autopilot)

        db.commit()
        db.refresh(account)
        db.refresh(autopilot)
        return serialize_status(db, user, autopilot)
    finally:
        db.close()


@app.post("/api/providers/disconnect")
def disconnect_provider(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
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
        return serialize_status(db, user, autopilot)
    finally:
        db.close()


@app.post("/api/jobs/refresh-now")
def refresh_now(
    user_id: int = Query(1, ge=1),
    connected_account_id: int | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
    db, user, account = get_user_and_optional_account(resolved_user_id, connected_account_id)
    try:
        if account is None:
            account = get_default_connected_account(db, user)
            if not account:
                raise HTTPException(status_code=400, detail="No connected account available")

        autopilot = get_or_create_autopilot_for_account(db, user, account)
        subscription = get_user_subscription_state(db, user)
        if (
            account.connection_status == "connected"
            and subscription.get("can_run_autopilot")
        ):
            autopilot.connected = True
            autopilot.provider = account.provider
            autopilot.enabled = True
            if not autopilot.next_cycle_at:
                autopilot.next_cycle_at = datetime.now(UTC).replace(tzinfo=None)
            db.flush()

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
    x_evergreen_email: str | None = Header(default=None),
    x_evergreen_handle: str | None = Header(default=None),
):
    db = SessionLocal()
    try:
        resolved_user_id = resolve_requested_user_id(
            db, authorization, user_id, x_evergreen_email, x_evergreen_handle
        )
    finally:
        db.close()
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
                    "email": user.email,
                    "handle": user.handle,
                    "subscription_status": user.subscription_status,
                    "trial_started_at": (
                        user.trial_started_at.isoformat()
                        if user.trial_started_at
                        else None
                    ),
                    "trial_ends_at": (
                        user.trial_ends_at.isoformat()
                        if user.trial_ends_at
                        else None
                    ),
                    "stripe_customer_id": user.stripe_customer_id,
                    "stripe_subscription_id": user.stripe_subscription_id,
                    "current_period_end": (
                        user.current_period_end.isoformat()
                        if user.current_period_end
                        else None
                    ),
                    "welcome_email_sent_at": (
                        user.welcome_email_sent_at.isoformat()
                        if user.welcome_email_sent_at
                        else None
                    ),
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


@app.post("/api/dev/send-welcome-email")
def send_dev_welcome_email(payload: dict):
    email = str(payload.get("email", "")).strip().lower()
    user_id = payload.get("user_id")
    force = bool(payload.get("force", False))

    db = SessionLocal()
    try:
        ensure_demo_seeded_once(db)

        user = None
        if user_id is not None:
            user = db.query(User).filter(User.id == int(user_id)).first()
        elif email:
            user = db.query(User).filter(User.email == email).first()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if force:
            user.welcome_email_sent_at = None
            db.add(user)
            db.commit()
            db.refresh(user)

        if not welcome_email_configured():
            return {
                "ok": False,
                "configured": False,
                "detail": "Welcome email env vars are missing",
                "user_id": user.id,
                "email": user.email,
                "welcome_email_sent_at": None,
            }

        sent = maybe_send_welcome_email(db, user)
        return {
            "ok": True,
            "configured": True,
            "sent": sent,
            "user_id": user.id,
            "email": user.email,
            "welcome_email_sent_at": (
                user.welcome_email_sent_at.isoformat()
                if user.welcome_email_sent_at
                else None
            ),
        }
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        return {
            "ok": False,
            "configured": welcome_email_configured(),
            "detail": str(exc),
            "email": email or None,
            "user_id": int(user_id) if user_id is not None else None,
        }
    finally:
        db.close()


@app.get("/api/dev/stripe-lookup")
def dev_stripe_lookup(email: str):
    normalized_email = str(email or "").strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="email is required")

    customers_out = []
    subscriptions_out = []

    if stripe.api_key:
        try:
            customers = list((stripe.Customer.list(email=normalized_email, limit=10) or {}).get("data") or [])
        except Exception as exc:
            return {
                "ok": False,
                "configured": True,
                "mode": "live" if str(stripe.api_key).startswith("sk_live_") else "test",
                "detail": f"Stripe customer lookup failed: {exc}",
            }

        for customer in customers:
            customer_id = str(getattr(customer, "id", "") or customer.get("id") or "").strip()
            customer_email = str(getattr(customer, "email", "") or customer.get("email") or "").strip() or None
            if not customer_id:
                continue

            customers_out.append(
                {
                    "id": customer_id,
                    "email": customer_email,
                }
            )

            try:
                subscriptions = list(
                    (stripe.Subscription.list(customer=customer_id, status="all", limit=10) or {}).get("data") or []
                )
            except Exception:
                subscriptions = []

            for subscription in subscriptions:
                items = getattr(subscription, "items", None) or subscription.get("items") or {}
                item_rows = getattr(items, "data", None) or items.get("data") or []
                price_id = None
                if isinstance(item_rows, list) and item_rows:
                    first = item_rows[0]
                    price = getattr(first, "price", None) or first.get("price") or {}
                    price_id = str(getattr(price, "id", "") or price.get("id") or "").strip() or None

                subscriptions_out.append(
                    {
                        "id": str(getattr(subscription, "id", "") or subscription.get("id") or "").strip(),
                        "customer": customer_id,
                        "status": str(getattr(subscription, "status", "") or subscription.get("status") or "").strip(),
                        "price_id": price_id,
                        "current_period_end": iso_from_unix_timestamp(
                            getattr(subscription, "current_period_end", None) or subscription.get("current_period_end")
                        ),
                    }
                )

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == normalized_email).first()
        return {
            "ok": True,
            "configured": bool(stripe.api_key),
            "mode": "live" if str(stripe.api_key).startswith("sk_live_") else "test" if stripe.api_key else "unset",
            "user": {
                "id": user.id if user else None,
                "email": user.email if user else normalized_email,
                "subscription_status": user.subscription_status if user else None,
                "trial_started_at": user.trial_started_at.isoformat() if user and user.trial_started_at else None,
                "trial_ends_at": user.trial_ends_at.isoformat() if user and user.trial_ends_at else None,
                "stripe_customer_id": user.stripe_customer_id if user else None,
                "stripe_subscription_id": user.stripe_subscription_id if user else None,
                "stripe_price_id": user.stripe_price_id if user else None,
                "current_period_end": user.current_period_end.isoformat() if user and user.current_period_end else None,
            },
            "customers": customers_out,
            "subscriptions": subscriptions_out,
        }
    finally:
        db.close()


@app.post("/api/dev/reconcile-subscription")
def dev_reconcile_subscription(payload: dict):
    email = str(payload.get("email", "")).strip().lower()
    force = bool(payload.get("force", True))
    if not email:
        raise HTTPException(status_code=400, detail="email is required")

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if force:
            user.subscription_updated_at = None
            db.add(user)
            db.commit()
            db.refresh(user)

        state = ensure_user_subscription_state(db, user, stripe_reconcile=True)
        db.refresh(user)

        return {
            "ok": True,
            "state": state,
            "user": {
                "id": user.id,
                "email": user.email,
                "subscription_status": user.subscription_status,
                "trial_started_at": user.trial_started_at.isoformat() if user.trial_started_at else None,
                "trial_ends_at": user.trial_ends_at.isoformat() if user.trial_ends_at else None,
                "stripe_customer_id": user.stripe_customer_id,
                "stripe_subscription_id": user.stripe_subscription_id,
                "stripe_price_id": user.stripe_price_id,
                "current_period_end": user.current_period_end.isoformat() if user.current_period_end else None,
            },
        }
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
