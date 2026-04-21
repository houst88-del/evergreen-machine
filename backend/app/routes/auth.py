from __future__ import annotations

import csv
import json
import os
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.auth_store import create_auth_user, get_auth_user_by_email, update_last_login
from app.core.db import SessionLocal
from app.core.security import create_token, get_current_auth_user, hash_password, verify_password
from app.core.subscription_state import ensure_user_subscription_state
from app.core.subscription_state import lookup_stripe_subscription_by_email, update_user_subscription
from app.models.models import AutopilotStatus, ConnectedAccount, Post, User
from app.services.pool_service import active_rotation_count
from app.services.welcome_email import maybe_send_welcome_email


router = APIRouter(prefix="/api/auth", tags=["auth"])


POOL_HEADERS = [
    "tweet_id",
    "tweet_url",
    "score",
    "underperform",
    "is_reply",
    "has_media",
    "media_type",
    "tweet_age_hours",
    "retired",
    "refresh_count",
    "cycle_retweeted",
    "last_retweeted_at",
    "funnel_stage",
    "funnel_stage_source",
    "impressions",
    "likes",
    "retweets",
    "replies",
    "quotes",
    "bookmarks",
    "profile_visits",
    "link_clicks",
    "of_clicks",
    "engagement_rate",
    "like_rate",
    "bookmark_rate",
    "profile_visit_rate",
    "link_click_rate",
    "of_click_rate",
    "resurface_baseline_score",
    "resurface_baseline_engagement_rate",
    "resurface_baseline_profile_visit_rate",
    "revival_score",
    "revival_lift",
    "strong_reviver",
    "pair_partner_id",
    "pair_memory_score",
    "pair_success_count",
    "archetype",
    "archetype_score",
    "entropy_score",
    "archive_signal",
    "top_terms",
    "gravity_tier",
    "gravity_score",
]

RESULTS_HEADERS = [
    "timestamp",
    "tweet_id",
    "tweet_url",
    "action",
    "result",
    "message",
]

ANALYTICS_HEADERS = [
    "tweet_id",
    "tweet_url",
    "score",
    "underperform",
    "is_reply",
    "has_media",
    "media_type",
    "tweet_age_hours",
    "impressions",
    "likes",
    "retweets",
    "replies",
    "quotes",
    "bookmarks",
    "profile_visits",
    "link_clicks",
    "of_clicks",
    "engagement_rate",
    "like_rate",
    "bookmark_rate",
    "profile_visit_rate",
    "link_click_rate",
    "of_click_rate",
    "funnel_stage",
    "contains_of_link",
    "predicted_velocity",
    "viral_velocity",
    "gravity_tier",
    "gravity_score",
    "archetype",
    "archetype_score",
    "entropy_score",
    "archive_signal",
    "top_terms",
]


def ensure_csv(path: Path, headers: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()


def client_base_dir() -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "clients"


def normalize_handle(handle: str) -> str:
    return str(handle).strip().lstrip("@") or "creator"


def ensure_client_scaffold(handle: str) -> Path:
    slug = normalize_handle(handle)
    folder = client_base_dir() / slug
    folder.mkdir(parents=True, exist_ok=True)

    ensure_csv(folder / "tweet_refresh_pool.csv", POOL_HEADERS)
    ensure_csv(folder / "tweet_results.csv", RESULTS_HEADERS)
    ensure_csv(folder / "tweet_analytics.csv", ANALYTICS_HEADERS)

    config_path = folder / "config.json"
    if not config_path.exists():
        config_path.write_text(
            json.dumps(
                {
                    "handle": f"@{slug}",
                    "provider": "x",
                    "api_key": "",
                    "api_secret": "",
                    "access_token": "",
                    "access_token_secret": "",
                    "user_id": "",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

    return folder


def serialize_user(user: User) -> dict:
    return {
        "id": int(user.id),
        "email": str(user.email),
        "handle": str(user.handle),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "welcome_email_sent_at": user.welcome_email_sent_at.isoformat() if user.welcome_email_sent_at else None,
        "subscription_status": str(user.subscription_status or "").strip().lower() or None,
        "trial_started_at": user.trial_started_at.isoformat() if user.trial_started_at else None,
        "trial_ends_at": user.trial_ends_at.isoformat() if user.trial_ends_at else None,
        "stripe_customer_id": str(user.stripe_customer_id or "").strip() or None,
        "stripe_subscription_id": str(user.stripe_subscription_id or "").strip() or None,
        "stripe_price_id": str(user.stripe_price_id or "").strip() or None,
        "stripe_billing_email": str(user.stripe_billing_email or "").strip() or None,
        "current_period_end": user.current_period_end.isoformat() if user.current_period_end else None,
        "subscription_updated_at": user.subscription_updated_at.isoformat() if user.subscription_updated_at else None,
    }


def subscription_plan_label(price_id: str | None) -> str | None:
    raw = str(price_id or "").strip().lower()
    if not raw:
        return None
    if "pro" in raw or "standard" in raw:
        return "Membership"
    return "Paid membership"


def migrate_user_records(db, source: User, target: User) -> None:
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


def ensure_db_user(email: str, handle: str) -> tuple[dict, dict]:
    db = SessionLocal()
    try:
        normalized_handle = handle if str(handle).startswith("@") else f"@{handle}"

        user_by_email = db.query(User).filter(User.email == email).first()
        user_by_handle = (
            db.query(User).filter(User.handle == normalized_handle).order_by(User.id.asc()).first()
        )

        if user_by_email and user_by_handle and user_by_email.id != user_by_handle.id:
            migrate_user_records(db, source=user_by_handle, target=user_by_email)
            user = user_by_email
        elif user_by_email:
            user = user_by_email
        elif user_by_handle:
            user = user_by_handle
            user.email = email
        else:
            user = None

        auth_user = get_auth_user_by_email(email)

        if not user:
            user = User(email=email, handle=normalized_handle)
            db.add(user)
            db.flush()

            autopilot = AutopilotStatus(
                user_id=user.id,
                enabled=False,
                connected=False,
                provider="x",
                posts_in_rotation=active_rotation_count(user.handle),
            )
            db.add(autopilot)
            db.commit()
            db.refresh(user)
            db.refresh(autopilot)
        else:
            user.email = email
            user.handle = normalized_handle
            autopilot = db.query(AutopilotStatus).filter(AutopilotStatus.user_id == user.id).first()
            if not autopilot:
                autopilot = AutopilotStatus(
                    user_id=user.id,
                    enabled=False,
                    connected=False,
                    provider="x",
                    posts_in_rotation=active_rotation_count(user.handle),
                )
                db.add(autopilot)
                db.commit()
                db.refresh(autopilot)

            autopilot.posts_in_rotation = active_rotation_count(user.handle)
            db.commit()
            db.refresh(user)
            db.refresh(autopilot)

        subscription_state = ensure_user_subscription_state(db, user, stripe_reconcile=True)
        user_data = serialize_user(user)
        user_data.update(subscription_state)
        autopilot_data = {
            "user_id": int(autopilot.user_id),
            "enabled": bool(autopilot.enabled),
            "connected": bool(autopilot.connected),
            "provider": str(autopilot.provider or "x"),
            "posts_in_rotation": int(autopilot.posts_in_rotation or 0),
        }
        return user_data, autopilot_data
    finally:
        db.close()


def trigger_welcome_email(user_id: int) -> None:
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return
        try:
            maybe_send_welcome_email(db, user)
        except Exception as exc:
            db.rollback()
            print(f"[evergreen][welcome-email] failed for {user.email}: {exc}")
    finally:
        db.close()


def auth_response(user_data: dict, token: str | None = None) -> dict:
    payload = {
        "user": {
            "id": user_data["id"],
            "email": user_data["email"],
            "handle": user_data["handle"],
            "subscription_status": user_data.get("subscription_status", "inactive"),
            "trial_started_at": user_data.get("trial_started_at"),
            "trial_ends_at": user_data.get("trial_ends_at"),
            "can_run_autopilot": bool(user_data.get("can_run_autopilot", False)),
            "stripe_price_id": user_data.get("stripe_price_id"),
            "stripe_billing_email": user_data.get("stripe_billing_email"),
            "current_period_end": user_data.get("current_period_end"),
        }
    }
    if token is not None:
        payload["token"] = token
    return payload


@router.post("/signup")
def signup(payload: dict):
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()
    handle = str(payload.get("handle", "")).strip().lstrip("@")

    if not email:
        raise HTTPException(status_code=400, detail="email is required")
    if not password or len(password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")
    if not handle:
        raise HTTPException(status_code=400, detail="handle is required")

    existing = get_auth_user_by_email(email)
    if existing:
        raise HTTPException(status_code=400, detail="email already exists")

    ensure_client_scaffold(handle)

    auth_user = create_auth_user(
        email=email,
        handle=f"@{handle}",
        password_hash=hash_password(password),
    )
    user_data, _autopilot = ensure_db_user(email=email, handle=f"@{handle}")
    trigger_welcome_email(user_data["id"])
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, token)


@router.post("/login")
def login(payload: dict):
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", "")).strip()

    if not email:
        raise HTTPException(status_code=400, detail="email is required")
    if not password:
        raise HTTPException(status_code=400, detail="password is required")

    auth_user = get_auth_user_by_email(email)
    if not auth_user:
        raise HTTPException(status_code=401, detail="invalid credentials")

    if not verify_password(password, str(auth_user.get("password_hash", ""))):
        raise HTTPException(status_code=401, detail="invalid credentials")

    ensure_client_scaffold(str(auth_user.get("handle", "@creator")).lstrip("@"))

    user_data, _autopilot = ensure_db_user(
        email=email,
        handle=str(auth_user.get("handle", "@demo_creator")),
    )
    trigger_welcome_email(user_data["id"])
    update_last_login(email)
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, token)


@router.get("/me")
def me(auth_user: dict = Depends(get_current_auth_user)):
    email = str(auth_user.get("email", "")).strip().lower()
    token_handle = str(auth_user.get("handle", "")).strip() or "@demo_creator"
    stored = get_auth_user_by_email(email)
    effective_handle = str((stored or {}).get("handle") or token_handle or "@demo_creator")

    ensure_client_scaffold(effective_handle.lstrip("@"))

    user_data, _autopilot = ensure_db_user(
        email=email,
        handle=effective_handle,
    )
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, token)


@router.get("/subscription")
def get_subscription(auth_user: dict = Depends(get_current_auth_user)):
    email = str(auth_user.get("email", "")).strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")
        state = ensure_user_subscription_state(db, user, stripe_reconcile=True)
        db.refresh(user)
        return {
            "ok": True,
            "subscription": {
                "status": state.get("subscription_status"),
                "trial_started_at": state.get("trial_started_at"),
                "trial_ends_at": state.get("trial_ends_at"),
                "can_run_autopilot": state.get("can_run_autopilot"),
                "plan": subscription_plan_label(user.stripe_price_id),
                "price_id": str(user.stripe_price_id or "").strip() or None,
                "billing_email": str(user.stripe_billing_email or "").strip() or None,
                "stripe_customer_id": str(user.stripe_customer_id or "").strip() or None,
                "stripe_subscription_id": str(user.stripe_subscription_id or "").strip() or None,
                "current_period_end": user.current_period_end.isoformat() if user.current_period_end else None,
            },
        }
    finally:
        db.close()


@router.post("/subscription/claim")
def claim_subscription(payload: dict, auth_user: dict = Depends(get_current_auth_user)):
    billing_email = str(payload.get("billing_email", "")).strip().lower()
    if not billing_email:
        raise HTTPException(status_code=400, detail="billing_email is required")

    email = str(auth_user.get("email", "")).strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            raise HTTPException(status_code=404, detail="user not found")

        stripe_match = lookup_stripe_subscription_by_email(billing_email)
        if not stripe_match:
            raise HTTPException(status_code=404, detail="No live Stripe subscription found for that billing email")

        update_user_subscription(
            user,
            status=stripe_match.get("status") or "inactive",
            stripe_customer_id=stripe_match.get("stripe_customer_id"),
            stripe_subscription_id=stripe_match.get("stripe_subscription_id"),
            stripe_price_id=stripe_match.get("stripe_price_id"),
            stripe_billing_email=billing_email,
            current_period_end=stripe_match.get("current_period_end"),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        state = ensure_user_subscription_state(db, user, stripe_reconcile=False)
        return {
            "ok": True,
            "subscription": {
                "status": state.get("subscription_status"),
                "trial_started_at": state.get("trial_started_at"),
                "trial_ends_at": state.get("trial_ends_at"),
                "can_run_autopilot": state.get("can_run_autopilot"),
                "plan": subscription_plan_label(user.stripe_price_id),
                "price_id": str(user.stripe_price_id or "").strip() or None,
                "billing_email": str(user.stripe_billing_email or "").strip() or None,
                "stripe_customer_id": str(user.stripe_customer_id or "").strip() or None,
                "stripe_subscription_id": str(user.stripe_subscription_id or "").strip() or None,
                "current_period_end": user.current_period_end.isoformat() if user.current_period_end else None,
            },
        }
    finally:
        db.close()


@router.post("/bootstrap-clerk")
def bootstrap_clerk(payload: dict, x_evergreen_internal_secret: str | None = Header(default=None)):
    expected_secret = os.getenv("EVERGREEN_INTERNAL_BOOTSTRAP_SECRET")
    if not expected_secret:
        raise HTTPException(status_code=500, detail="missing bootstrap secret")

    if x_evergreen_internal_secret != expected_secret:
        raise HTTPException(status_code=401, detail="invalid bootstrap secret")

    email = str(payload.get("email", "")).strip().lower()
    handle = str(payload.get("handle", "")).strip().lstrip("@")

    if not email:
        raise HTTPException(status_code=400, detail="email is required")

    if not handle:
        handle = email.split("@")[0] or "creator"

    existing = get_auth_user_by_email(email)
    created_auth_user = existing is None
    if not existing:
        existing = create_auth_user(
            email=email,
            handle=f"@{handle}",
            password_hash=hash_password(secrets.token_urlsafe(24)),
        )

    ensure_client_scaffold(str(existing.get("handle", f"@{handle}")).lstrip("@"))

    user_data, _autopilot = ensure_db_user(
        email=email,
        handle=str(existing.get("handle", f"@{handle}")),
    )
    trigger_welcome_email(user_data["id"])
    update_last_login(email)
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, token)
