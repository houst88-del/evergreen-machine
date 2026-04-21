from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path


TRIAL_HOURS = max(1, int(os.getenv("EVERGREEN_TRIAL_HOURS", "72")))
PAID_SUBSCRIPTION_STATUSES = {"active", "subscribed", "paid"}


def auth_store_dir() -> Path:
    return Path.home() / "Applications" / "evergreen-system" / "platform"


def auth_store_file() -> Path:
    return auth_store_dir() / "auth_users.json"


def ensure_auth_store() -> None:
    path = auth_store_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("[]", encoding="utf-8")


def load_auth_users() -> list[dict]:
    ensure_auth_store()
    path = auth_store_file()
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_auth_users(users: list[dict]) -> None:
    ensure_auth_store()
    auth_store_file().write_text(json.dumps(users, indent=2), encoding="utf-8")


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_naive_iso(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None

    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def subscription_snapshot(user: dict | None) -> dict:
    if not user:
        return {
            "subscription_status": "inactive",
            "trial_started_at": None,
            "trial_ends_at": None,
            "can_run_autopilot": False,
        }

    raw_status = str(user.get("subscription_status", "")).strip().lower()
    trial_started_at = user.get("trial_started_at")
    trial_ends_at = user.get("trial_ends_at")
    trial_ends_at_dt = _parse_naive_iso(trial_ends_at)

    if raw_status in PAID_SUBSCRIPTION_STATUSES:
        return {
            "subscription_status": "active",
            "trial_started_at": trial_started_at,
            "trial_ends_at": trial_ends_at,
            "can_run_autopilot": True,
        }

    if trial_ends_at_dt and trial_ends_at_dt > _utc_now_naive():
        return {
            "subscription_status": "trialing",
            "trial_started_at": trial_started_at,
            "trial_ends_at": trial_ends_at,
            "can_run_autopilot": True,
        }

    if trial_ends_at_dt:
        return {
            "subscription_status": "expired",
            "trial_started_at": trial_started_at,
            "trial_ends_at": trial_ends_at,
            "can_run_autopilot": False,
        }

    return {
        "subscription_status": "inactive",
        "trial_started_at": trial_started_at,
        "trial_ends_at": trial_ends_at,
        "can_run_autopilot": False,
    }


def _decorate_auth_user(user: dict) -> tuple[dict, bool]:
    updated = dict(user)
    return {**updated, **subscription_snapshot(updated)}, False


def get_auth_user_by_email(email: str) -> dict | None:
    email = str(email).strip().lower()
    users = load_auth_users()
    changed_any = False

    for idx, user in enumerate(users):
        if str(user.get("email", "")).strip().lower() == email:
            decorated, changed = _decorate_auth_user(user)
            if changed:
                users[idx] = {
                    key: value
                    for key, value in decorated.items()
                    if key not in {"can_run_autopilot"}
                }
                changed_any = True
            if changed_any:
                save_auth_users(users)
            return decorated
    return None


def create_auth_user(email: str, handle: str, password_hash: str) -> dict:
    email = str(email).strip().lower()
    handle = str(handle).strip()
    users = load_auth_users()

    existing = [u for u in users if str(u.get("email", "")).strip().lower() == email]
    if existing:
        decorated, changed = _decorate_auth_user(existing[0])
        if changed:
            for idx, user in enumerate(users):
                if str(user.get("email", "")).strip().lower() == email:
                    users[idx] = {
                        key: value for key, value in decorated.items() if key not in {"can_run_autopilot"}
                    }
                    save_auth_users(users)
                    break
        return decorated

    now = _utc_now_naive().isoformat(timespec="seconds")
    user = {
        "email": email,
        "handle": handle,
        "password_hash": password_hash,
        "created_at": now,
        "subscription_status": "inactive",
        "trial_started_at": None,
        "trial_ends_at": None,
    }
    users.append(user)
    save_auth_users(users)
    return {**user, **subscription_snapshot(user)}


def update_last_login(email: str) -> None:
    email = str(email).strip().lower()
    users = load_auth_users()
    changed = False
    now = datetime.now(UTC).replace(tzinfo=None).isoformat(timespec="seconds")
    for user in users:
        if str(user.get("email", "")).strip().lower() == email:
            user["last_login_at"] = now
            changed = True
            break
    if changed:
        save_auth_users(users)


def update_subscription_status(
    email: str,
    *,
    status: str,
    stripe_customer_id: str | None = None,
    stripe_subscription_id: str | None = None,
    stripe_price_id: str | None = None,
    current_period_end: str | None = None,
) -> dict | None:
    email = str(email).strip().lower()
    users = load_auth_users()
    changed = False
    updated_user: dict | None = None
    now = _utc_now_naive().isoformat(timespec="seconds")

    for user in users:
        if str(user.get("email", "")).strip().lower() != email:
            continue

        user["subscription_status"] = str(status).strip().lower() or "inactive"
        user["subscription_updated_at"] = now
        if stripe_customer_id:
            user["stripe_customer_id"] = stripe_customer_id
        if stripe_subscription_id:
            user["stripe_subscription_id"] = stripe_subscription_id
        if stripe_price_id:
            user["stripe_price_id"] = stripe_price_id
        if current_period_end:
            user["current_period_end"] = current_period_end
        changed = True
        updated_user = user
        break

    if not changed:
        return None

    save_auth_users(users)
    decorated, _ = _decorate_auth_user(updated_user or {})
    return decorated


def start_trial(email: str) -> dict | None:
    email = str(email).strip().lower()
    users = load_auth_users()
    started_user: dict | None = None
    changed = False

    for user in users:
        if str(user.get("email", "")).strip().lower() != email:
            continue

        raw_status = str(user.get("subscription_status", "")).strip().lower()
        if raw_status in PAID_SUBSCRIPTION_STATUSES:
            started_user = user
            break
        if str(user.get("trial_started_at", "")).strip() or str(user.get("trial_ends_at", "")).strip():
            started_user = user
            break

        now_dt = _utc_now_naive()
        now = now_dt.isoformat(timespec="seconds")
        user["subscription_status"] = "trialing"
        user["trial_started_at"] = now
        user["trial_ends_at"] = (now_dt + timedelta(hours=TRIAL_HOURS)).isoformat(timespec="seconds")
        user["subscription_updated_at"] = now
        started_user = user
        changed = True
        break

    if changed:
        save_auth_users(users)

    if not started_user:
        return None

    decorated, _ = _decorate_auth_user(started_user)
    return decorated
