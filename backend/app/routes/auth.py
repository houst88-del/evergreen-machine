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
from app.models.models import AutopilotStatus, User
from app.services.pool_service import active_rotation_count


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
    }


def ensure_db_user(email: str, handle: str) -> tuple[dict, dict]:
    db = SessionLocal()
    try:
        normalized_handle = handle if str(handle).startswith("@") else f"@{handle}"

        user = db.query(User).filter(User.email == email).first()
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

        user_data = serialize_user(user)
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


def auth_response(user_data: dict, auth_user: dict, token: str | None = None) -> dict:
    payload = {
        "user": {
            "id": user_data["id"],
            "email": user_data["email"],
            "handle": user_data["handle"],
            "subscription_status": auth_user.get("subscription_status", "inactive"),
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
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, auth_user, token)


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
    update_last_login(email)
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, auth_user, token)


@router.get("/me")
def me(auth_user: dict = Depends(get_current_auth_user)):
    email = str(auth_user.get("email", "")).strip().lower()
    stored = get_auth_user_by_email(email)
    if not stored:
        raise HTTPException(status_code=404, detail="auth user not found")

    ensure_client_scaffold(str(stored.get("handle", "@creator")).lstrip("@"))

    user_data, _autopilot = ensure_db_user(
        email=email,
        handle=str(stored.get("handle", "@demo_creator")),
    )
    return auth_response(user_data, stored)


@router.post("/bootstrap-clerk")
def bootstrap_clerk(payload: dict, x_evergreen_internal_secret: str | None = Header(default=None)):
    expected_secret = os.getenv("EVERGREEN_INTERNAL_BOOTSTRAP_SECRET", "evergreen-bootstrap-dev-secret")
    if x_evergreen_internal_secret != expected_secret:
        raise HTTPException(status_code=401, detail="invalid bootstrap secret")

    email = str(payload.get("email", "")).strip().lower()
    handle = str(payload.get("handle", "")).strip().lstrip("@")

    if not email:
        raise HTTPException(status_code=400, detail="email is required")

    if not handle:
        handle = email.split("@")[0] or "creator"

    existing = get_auth_user_by_email(email)
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
    update_last_login(email)
    token = create_token(
        {
            "email": user_data["email"],
            "handle": user_data["handle"],
            "user_id": user_data["id"],
        }
    )
    return auth_response(user_data, existing, token)
